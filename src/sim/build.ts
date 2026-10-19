import { PRICES, REMOVE_REFUND } from "./economy";
import { FacilityKind, createFacility, refreshAccess, releasePerson, removeFacility, serviceTilesOf, type Facility } from "./facilities";
import { Dir, Tile, Zone, type Grid, type Rect } from "./grid";
import { inRect, walkArea } from "./maps/city";
import { isIslandCentre, isPlatformEdge } from "./maps/harbourStreet";
import { nudgeToWalkable } from "./movement";
import { addSign, refreshSigns, type Sign } from "./needs";
import { PState } from "./people";
import { tileOf } from "./walk";
import { activePlatformIds, fieldTargets, waitingSpots, type World } from "./world";

export type ToolId = "floor" | "retail" | "seating" | "toilet" | "wall" | "rail" | "gate" | "sign" | "travelator" | "remove";

export interface PlacementPreview {
  tool: ToolId;
  rect: Rect;
  /** Tiles that will change. */
  tiles: number[];
  /** Tiles in the rect that can't take it. */
  blocked: number[];
  /** Negative is a refund. */
  cost: number;
  valid: boolean;
  reason: string | null;
  signKind?: Sign["kind"];
  dir?: Dir;
}

export interface BuildOpts {
  signKind?: Sign["kind"];
  dir?: Dir;
}

/** One tile's change: any field left out stays as it is. */
interface Edit {
  i: number;
  tile?: Tile;
  zone?: Zone;
  dir?: Dir;
}

/** Everything a placement would do, worked out without touching the world. */
interface Plan {
  preview: PlacementPreview;
  edits: Edit[];
  newFacility: FacilityKind | null;
  removedFacilities: Facility[];
  removedSigns: Sign[];
}

const FACILITY_OF: Partial<Record<ToolId, FacilityKind>> = {
  retail: FacilityKind.Retail,
  toilet: FacilityKind.Toilet,
  seating: FacilityKind.Seating,
};

const ZONE_OF: Record<FacilityKind, Zone> = {
  [FacilityKind.Retail]: Zone.Retail,
  [FacilityKind.Toilet]: Zone.Toilet,
  [FacilityKind.Seating]: Zone.Seating,
};

const PRICE_OF: Record<FacilityKind, number> = {
  [FacilityKind.Retail]: PRICES.retail,
  [FacilityKind.Toilet]: PRICES.toilet,
  [FacilityKind.Seating]: PRICES.seating,
};

/** Smallest unit as [short side, long side]. */
const MIN_SIZE: Record<FacilityKind, [number, number]> = {
  [FacilityKind.Retail]: [2, 2],
  [FacilityKind.Toilet]: [2, 2],
  [FacilityKind.Seating]: [1, 2],
};

const LINE_PRICE = { wall: PRICES.wall, rail: PRICES.rail, travelator: PRICES.travelator } as const;
const MIN_TRAVELATOR = 3;
const NEIGHBOURS: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** A drag's rect with negative sides flipped, clipped to the map. */
function normalise(g: Grid, r: Rect): Rect {
  let { x, y, w, h } = r;
  if (w < 0) {
    x += w;
    w = -w;
  }
  if (h < 0) {
    y += h;
    h = -h;
  }
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(g.w, x + w);
  const y1 = Math.min(g.h, y + h);
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

function rectTiles(g: Grid, r: Rect): number[] {
  const out: number[] = [];
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) out.push(g.idx(x, y));
  return out;
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function signTiles(w: World): Set<number> {
  return new Set(w.signs.map((s) => s.tile));
}

/** Unzoned floor with no sign on it: what travelators are built on. */
function plainFloor(w: World, signs: Set<number>, i: number): boolean {
  return w.grid.tiles[i] === Tile.Floor && w.grid.zones[i] === Zone.None && !signs.has(i);
}

/** Plain floor, or bare platform in an island's centre: what facilities, walls, rails and signs are built on. */
function buildable(w: World, signs: Set<number>, i: number): boolean {
  if (plainFloor(w, signs, i)) return true;
  const g = w.grid;
  const [x, y] = g.xy(i);
  return g.tiles[i] === Tile.Platform && g.zones[i] === Zone.None && !signs.has(i) && isIslandCentre(w.map, x, y);
}

/** Tiles in the rect on a platform edge (beside a track, above the gate row) of an island already painted. */
function edgeTiles(w: World, rect: Rect): number[] {
  const g = w.grid;
  return rectTiles(g, rect).filter((i) => {
    const [x, y] = g.xy(i);
    return g.tiles[i] === Tile.Platform && isPlatformEdge(w.map, x, y);
  });
}

function isFoot(w: World, i: number): boolean {
  const [x, y] = w.grid.xy(i);
  return w.map.slots.some((s) => x >= s.foot.x && y >= s.foot.y && x < s.foot.x + s.foot.w && y < s.foot.y + s.foot.h);
}

/**
 * Tiles in the rect that an island with no platform opened yet keeps for itself: its walkway and
 * tracks take nothing, and its foot takes only floor (how the player joins it up before it opens).
 */
function reservedTiles(w: World, tool: ToolId, rect: Rect): number[] {
  const g = w.grid;
  const opened = new Set(w.map.slots.slice(0, w.platformsAdded).map((s) => s.island));
  const unopened = w.map.islands.filter((isl) => !opened.has(isl.id));
  return rectTiles(g, rect).filter((i) => {
    const [x, y] = g.xy(i);
    return unopened.some(
      (isl) =>
        inRect(isl.walkway, x, y) ||
        inRect(isl.leftTrack, x, y) ||
        inRect(isl.rightTrack, x, y) ||
        (tool !== "floor" && inRect(isl.foot, x, y)),
    );
  });
}

function emptyPlan(tool: ToolId, rect: Rect, opts: BuildOpts): Plan {
  const preview: PlacementPreview = { tool, rect, tiles: [], blocked: [], cost: 0, valid: false, reason: null };
  if (opts.signKind !== undefined) preview.signKind = opts.signKind;
  if (opts.dir !== undefined) preview.dir = opts.dir;
  return { preview, edits: [], newFacility: null, removedFacilities: [], removedSigns: [] };
}

function refuse(plan: Plan, reason: string): Plan {
  plan.preview.valid = false;
  plan.preview.reason = reason;
  return plan;
}

function planFloor(w: World, plan: Plan): Plan {
  const g = w.grid;
  const pv = plan.preview;
  let joins = false;
  let outside = false;
  for (const i of rectTiles(g, pv.rect)) {
    const t = g.tiles[i] as Tile;
    const [gx, gy] = g.xy(i);
    if (t === Tile.Ground && !inRect(w.map.grounds, gx, gy)) {
      outside = true;
      pv.blocked.push(i);
    } else if (t === Tile.Ground) {
      pv.tiles.push(i);
      const [x, y] = g.xy(i);
      if (NEIGHBOURS.some(([dx, dy]) => g.isWalkable(x + dx, y + dy))) joins = true;
    } else if (t !== Tile.Floor && t !== Tile.Platform && t !== Tile.Entrance) {
      pv.blocked.push(i);
    }
  }
  pv.cost = pv.tiles.length * PRICES.floor;
  plan.edits = pv.tiles.map((i) => ({ i, tile: Tile.Floor }));
  if (pv.tiles.length === 0) return refuse(plan, outside ? "Outside the station grounds" : "Nothing to build here");
  if (!joins) return refuse(plan, "Must join existing floor");
  return plan;
}

function planFacility(w: World, plan: Plan, kind: FacilityKind): Plan {
  const g = w.grid;
  const pv = plan.preview;
  const r = pv.rect;
  const signs = signTiles(w);
  for (const i of rectTiles(g, r)) (buildable(w, signs, i) ? pv.tiles : pv.blocked).push(i);
  pv.cost = r.w * r.h * PRICE_OF[kind];
  plan.newFacility = kind;
  plan.edits = pv.tiles.map((i) => ({ i, zone: ZONE_OF[kind] }));
  if (r.w * r.h === 0) return refuse(plan, "Nothing to build here");
  const [short, long] = MIN_SIZE[kind];
  if (Math.min(r.w, r.h) < short || Math.max(r.w, r.h) < long) return refuse(plan, "Too small");
  if (pv.blocked.length > 0) return refuse(plan, "Must be on plain floor");
  if (kind !== FacilityKind.Seating && serviceTilesOf(g, w.map, r).length === 0) return refuse(plan, "Needs a floor tile beside it");
  return plan;
}

/** Walls, rails and travelators: a line one tile thick on plain floor (walls and rails also on an island's centre). */
function planLine(w: World, plan: Plan, tool: "wall" | "rail" | "travelator", dir: Dir | undefined): Plan {
  const g = w.grid;
  const pv = plan.preview;
  const r = pv.rect;
  const signs = signTiles(w);
  const fits = tool === "travelator" ? plainFloor : buildable;
  for (const i of rectTiles(g, r)) (fits(w, signs, i) ? pv.tiles : pv.blocked).push(i);
  pv.cost = pv.tiles.length * LINE_PRICE[tool];
  if (tool === "travelator") {
    plan.edits = pv.tiles.map((i) => ({ i, zone: Zone.Travelator, dir: dir ?? Dir.None }));
  } else {
    plan.edits = pv.tiles.map((i) => ({ i, tile: tool === "wall" ? Tile.Wall : Tile.Rail }));
  }
  if (r.w * r.h === 0) return refuse(plan, "Nothing to build here");
  if (r.w !== 1 && r.h !== 1) return refuse(plan, "Draw a line");
  if (tool === "travelator") {
    if (Math.max(r.w, r.h) < MIN_TRAVELATOR) return refuse(plan, "Too short");
    const along = r.w > 1 ? dir === Dir.E || dir === Dir.W : dir === Dir.N || dir === Dir.S;
    if (!along) return refuse(plan, "Draw it along its direction");
    if (pv.blocked.length > 0) return refuse(plan, "Must be on plain floor");
  }
  if (pv.tiles.length === 0) return refuse(plan, "Must be on plain floor");
  return plan;
}

function planSign(w: World, plan: Plan): Plan {
  const pv = plan.preview;
  const r = pv.rect;
  const signs = signTiles(w);
  for (const i of rectTiles(w.grid, r)) (buildable(w, signs, i) ? pv.tiles : pv.blocked).push(i);
  pv.cost = PRICES.sign;
  if (pv.signKind === undefined) return refuse(plan, "Choose a sign");
  if (r.w !== 1 || r.h !== 1) return refuse(plan, "Pick one tile");
  if (pv.blocked.length > 0) return refuse(plan, "Must be on plain floor");
  return plan;
}

/** Opens a closed-off slot in the gate line of an island whose platforms have opened. */
function planGate(w: World, plan: Plan): Plan {
  const g = w.grid;
  const pv = plan.preview;
  const r = pv.rect;
  for (const i of rectTiles(g, r)) (g.tiles[i] === Tile.GateClosed ? pv.tiles : pv.blocked).push(i);
  pv.cost = PRICES.gate;
  plan.edits = pv.tiles.map((i) => ({ i, tile: Tile.Gate }));
  if (r.w !== 1 || r.h !== 1) return refuse(plan, "Pick one tile");
  if (pv.tiles.length === 0) return refuse(plan, "Pick a closed gate slot");
  return plan;
}

/** Open gates per island once `edits` are applied, for every island with a painted gate line. */
function gatesAfter(w: World, edits: readonly Edit[]): number[] {
  const g = w.grid;
  const changed = new Map(edits.filter((e) => e.tile !== undefined).map((e) => [e.i, e.tile!]));
  const counts: number[] = [];
  for (const isl of w.map.islands) {
    const tiles = rectTiles(g, isl.gateLine);
    if (!tiles.some((i) => g.tiles[i] === Tile.Gate || g.tiles[i] === Tile.GateClosed)) continue;
    counts.push(tiles.filter((i) => (changed.get(i) ?? g.tiles[i]) === Tile.Gate).length);
  }
  return counts;
}

/**
 * Walls, rails, travelators and signs in the rect and every facility it touches come down, each
 * tile back to what it was built on (plain floor, or platform on an island); plain floor in the
 * rect (never a platform, entrance or apron) goes back to ground; an open gate closes again,
 * unless it is its island's last.
 */
function planRemove(w: World, plan: Plan): Plan {
  const g = w.grid;
  const pv = plan.preview;
  const changed = new Set<number>();
  let refund = 0;
  for (const f of w.facilities.values()) {
    if (!overlaps(f.rect, pv.rect)) continue;
    plan.removedFacilities.push(f);
    refund += f.builtPrice;
    for (const i of rectTiles(g, f.rect)) {
      plan.edits.push({ i, zone: Zone.None });
      changed.add(i);
    }
  }
  const signs = signTiles(w);
  for (const s of w.signs) {
    const [x, y] = g.xy(s.tile);
    if (!overlaps({ x, y, w: 1, h: 1 }, pv.rect)) continue;
    plan.removedSigns.push(s);
    refund += PRICES.sign;
    changed.add(s.tile);
  }
  for (const i of travelatorTiles(g, rectTiles(g, pv.rect))) {
    plan.edits.push({ i, zone: Zone.None, dir: Dir.None });
    refund += PRICES.travelator;
    changed.add(i);
  }
  for (const i of rectTiles(g, pv.rect)) {
    const t = g.tiles[i] as Tile;
    if (t === Tile.Gate) {
      plan.edits.push({ i, tile: Tile.GateClosed });
      refund += PRICES.gate;
      changed.add(i);
    } else if (t === Tile.Wall || t === Tile.Rail) {
      const [x, y] = g.xy(i);
      plan.edits.push({ i, tile: isIslandCentre(w.map, x, y) ? Tile.Platform : Tile.Floor });
      refund += t === Tile.Wall ? PRICES.wall : PRICES.rail;
      changed.add(i);
    } else if (g.zones[i] === Zone.Travelator) {
      continue;
    } else if (plainFloor(w, signs, i) && !isFoot(w, i)) {
      plan.edits.push({ i, tile: Tile.Ground });
      refund += PRICES.floor;
      changed.add(i);
    } else if (t === Tile.Platform || t === Tile.Entrance || (t === Tile.Floor && g.zones[i] === Zone.None && isFoot(w, i))) {
      pv.blocked.push(i);
    }
  }
  pv.tiles = [...changed].sort((a, b) => a - b);
  pv.cost = -REMOVE_REFUND * refund;
  if (pv.tiles.length === 0) return refuse(plan, "Nothing to remove here");
  if (gatesAfter(w, plan.edits).some((n) => n === 0)) return refuse(plan, "An island needs at least one gate");
  return plan;
}

/** Every tile of each travelator touching `tiles`, whole travelators as one owner id each. */
function travelatorTiles(g: Grid, tiles: readonly number[]): number[] {
  const owners = new Set<number>();
  const out = new Set<number>();
  for (const i of tiles) {
    if (g.zones[i] !== Zone.Travelator) continue;
    const owner = g.zoneOwner[i]!;
    if (owner >= 0) owners.add(owner);
    else out.add(i);
  }
  if (owners.size > 0)
    for (const i of rectTiles(g, walkArea())) if (g.zones[i] === Zone.Travelator && owners.has(g.zoneOwner[i]!)) out.add(i);
  return [...out];
}

/** Zones are written with `owner` (a new travelator's id), or none when cleared. */
function applyEdits(g: Grid, edits: readonly Edit[], owner = -1): void {
  for (const e of edits) {
    const [x, y] = g.xy(e.i);
    if (e.tile !== undefined) g.setTile(x, y, e.tile);
    if (e.zone !== undefined) g.setZone(x, y, e.zone, e.zone === Zone.None ? -1 : owner);
    if (e.dir !== undefined) g.setDir(x, y, e.dir);
  }
}

/**
 * Connected walkable regions (4-neighbour) over the walk area (nothing outside it is ever walkable),
 * as a label per tile of the area, -1 where not walkable.
 */
class Regions {
  readonly area: Rect;
  readonly label: Int32Array;

  constructor(g: Grid) {
    const a = walkArea();
    this.area = a;
    const label = new Int32Array(a.w * a.h).fill(-1);
    this.label = label;
    const queue = new Int32Array(a.w * a.h);
    let next = 0;
    for (let s = 0; s < label.length; s++) {
      if (label[s] !== -1) continue;
      const sx = a.x + (s % a.w);
      const sy = a.y + Math.floor(s / a.w);
      if (!g.isWalkable(sx, sy)) continue;
      let head = 0;
      let tail = 0;
      queue[tail++] = s;
      label[s] = next;
      while (head < tail) {
        const t = queue[head++]!;
        const lx = t % a.w;
        const ly = (t - lx) / a.w;
        for (const [dx, dy] of NEIGHBOURS) {
          const nx = lx + dx;
          const ny = ly + dy;
          if (nx < 0 || ny < 0 || nx >= a.w || ny >= a.h || !g.isWalkable(a.x + nx, a.y + ny)) continue;
          const n = ny * a.w + nx;
          if (label[n] !== -1) continue;
          label[n] = next;
          queue[tail++] = n;
        }
      }
      next++;
    }
  }

  /** The region of grid tile `i`, -1 if it is not walkable (or outside the area). */
  at(g: Grid, i: number): number {
    const a = this.area;
    const x = (i % g.w) - a.x;
    const y = Math.floor(i / g.w) - a.y;
    if (x < 0 || y < 0 || x >= a.w || y >= a.h) return -1;
    return this.label[y * a.w + x]!;
  }
}

function labelsOf(g: Grid, regions: Regions, tiles: readonly number[]): Set<number> {
  const out = new Set<number>();
  for (const t of tiles) {
    const l = regions.at(g, t);
    if (l >= 0) out.add(l);
  }
  return out;
}

function shares(a: Set<number>, b: Set<number>): boolean {
  for (const x of a) if (b.has(x)) return true;
  return false;
}

// Previews run on every mouse move: the world's own regions only change with its grid.
const regionCache = new WeakMap<Grid, { version: number; regions: Regions }>();

function currentRegions(g: Grid): Regions {
  const hit = regionCache.get(g);
  if (hit && hit.version === g.version) return hit.regions;
  const regions = new Regions(g);
  regionCache.set(g, { version: g.version, regions });
  return regions;
}

/**
 * Null if every (entrance, active platform) pair that shared a region before still does after the
 * change; otherwise the reason: the lowest platform no entrance it had still reaches, else the
 * first entrance that lost a platform it had.
 */
function reachReason(w: World, after: Grid): string | null {
  const before = currentRegions(w.grid);
  const now = new Regions(after);
  // Where its passengers board: built-on platform and the gate row do not count.
  const platforms = activePlatformIds(w).map((id) => ({ id, tiles: fieldTargets(w, `platform:${id}`) }));
  const entrances = w.map.entrances.map((e) => ({ id: e.id, tiles: rectTiles(w.grid, e.tiles) }));
  const pairs = entrances.flatMap((e) =>
    platforms.filter((p) => shares(labelsOf(w.grid, before, e.tiles), labelsOf(w.grid, before, p.tiles))).map((p) => ({ e, p })),
  );
  const kept = pairs.filter(({ e, p }) => shares(labelsOf(after, now, e.tiles), labelsOf(after, now, p.tiles)));
  for (const p of platforms) {
    if (pairs.some((x) => x.p === p) && !kept.some((x) => x.p === p)) return `Would cut off Platform ${p.id}`;
  }
  for (const e of entrances) {
    if (pairs.filter((x) => x.e === e).length > kept.filter((x) => x.e === e).length) return `Would block Entrance ${e.id}`;
  }
  return null;
}

function plan(w: World, tool: ToolId, rect: Rect, opts: BuildOpts): Plan {
  const p = emptyPlan(tool, normalise(w.grid, rect), opts);
  p.preview.valid = true;
  const kind = FACILITY_OF[tool];
  if (kind !== undefined) planFacility(w, p, kind);
  else if (tool === "floor") planFloor(w, p);
  else if (tool === "wall" || tool === "rail" || tool === "travelator") planLine(w, p, tool, opts.dir);
  else if (tool === "sign") planSign(w, p);
  else if (tool === "gate") planGate(w, p);
  else planRemove(w, p);
  const pv = p.preview;
  if (tool !== "remove") {
    const reserved = reservedTiles(w, tool, pv.rect);
    if (reserved.length > 0) {
      pv.blocked = [...new Set([...pv.blocked, ...reserved])].sort((a, b) => a - b);
      return refuse(p, "Reserved for a future platform");
    }
  }
  if (tool !== "remove" && tool !== "floor" && tool !== "gate") {
    const edge = edgeTiles(w, pv.rect);
    if (edge.length > 0) {
      pv.blocked = [...new Set([...pv.blocked, ...edge])].sort((a, b) => a - b);
      return refuse(p, "Keep the platform edge clear");
    }
  }
  if (!pv.valid) return p;
  if (p.edits.length > 0) {
    const after = w.grid.clone();
    applyEdits(after, p.edits);
    const reason = reachReason(w, after);
    if (reason !== null) return refuse(p, reason);
  }
  if (pv.cost > 0 && !w.ledger.canAfford(pv.cost)) return refuse(p, "Not enough money");
  return p;
}

/** What placing `tool` over `rect` would change and cost, and why not if it can't. Changes nothing. */
export function previewPlacement(w: World, tool: ToolId, rect: Rect, opts: BuildOpts = {}): PlacementPreview {
  return plan(w, tool, rect, opts).preview;
}

/**
 * Builds (or removes) what `p` previewed, checked afresh against the world as it is now; false and
 * nothing changed if it is no longer valid. Afterwards anyone left on a blocked tile steps to the
 * nearest tile still joined to an entrance, queues re-form, and signs re-point.
 */
export function applyPlacement(w: World, p: PlacementPreview): boolean {
  const opts: BuildOpts = {};
  if (p.signKind !== undefined) opts.signKind = p.signKind;
  if (p.dir !== undefined) opts.dir = p.dir;
  const fresh = plan(w, p.tool, p.rect, opts);
  const pv = fresh.preview;
  if (!pv.valid) return false;
  if (pv.cost > 0) w.ledger.debit("build", pv.cost);
  else if (pv.cost < 0) w.ledger.credit("removals", -pv.cost);

  for (const f of fresh.removedFacilities) removeFacility(w, f);
  if (fresh.removedSigns.length > 0) w.signs = w.signs.filter((s) => !fresh.removedSigns.includes(s));
  if (fresh.newFacility !== null) createFacility(w, fresh.newFacility, pv.rect);
  else applyEdits(w.grid, fresh.edits, pv.tool === "travelator" ? w.nextId++ : -1);
  // A gate that closes forgets its cadence, so one opened there later starts fresh.
  for (const e of fresh.edits) if (e.tile === Tile.GateClosed) w.turnstiles.nextFree[e.i] = -Infinity;
  if (pv.tool === "sign" && pv.signKind !== undefined) addSign(w, pv.tiles[0]!, pv.signKind);

  for (const f of w.facilities.values()) refreshAccess(w, f);
  settlePeople(w);
  refreshSigns(w);
  return true;
}

/**
 * Anyone on a tile that is blocked, or walkable but cut off from every entrance that leads to a
 * platform (a pocket a ring of walls has closed), leaves any facility they were at and steps to the
 * nearest tile that is joined; anyone waiting for a spot that is no longer walkable picks another
 * along their platform.
 */
function settlePeople(w: World): void {
  const g = w.grid;
  const p = w.people;
  const regions = currentRegions(g);
  const platformRegions = new Set<number>();
  for (const id of activePlatformIds(w))
    for (const l of labelsOf(g, regions, fieldTargets(w, `platform:${id}`))) platformRegions.add(l);
  const safeRegions = new Set<number>();
  for (const e of w.map.entrances)
    for (const l of labelsOf(g, regions, rectTiles(g, e.tiles))) if (platformRegions.has(l)) safeRegions.add(l);
  const joined = new Uint8Array(g.w * g.h);
  for (const t of rectTiles(g, regions.area)) if (safeRegions.has(regions.at(g, t))) joined[t] = 1;

  for (let i = 0, end = p.end; i < end; i++) {
    if (!p.isAlive(i)) continue;
    if (joined[tileOf(w, i)] !== 1) {
      const st = p.state[i];
      if (st === PState.InQueue || st === PState.InFacility || st === PState.Seated) releasePerson(w, i);
      nudgeToWalkable(g, p, i, joined);
      if (!g.isWalkable(Math.floor(p.x[i]!), Math.floor(p.y[i]!))) nudgeToWalkable(g, p, i);
    }
    const key = p.targetKey[i]!;
    if (p.state[i] !== PState.Waiting || !key.startsWith("spot:")) continue;
    const spot = Number(key.slice(5));
    const [sx, sy] = g.xy(spot);
    if (g.isWalkable(sx, sy)) continue;
    const tiles = waitingSpots(w, p.goalKey[i]!);
    p.targetKey[i] = tiles.length > 0 ? `spot:${w.rng.pick(tiles)}` : "";
  }
}
