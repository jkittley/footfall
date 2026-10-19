import { FacilityKind, Tenant, evictTenant, type Facility } from "./facilities";
import { Tile, Zone, type Rect } from "./grid";
import type { IslandDef } from "./maps/harbourStreet";
import { applyPlacement, previewPlacement, type BuildOpts, type PlacementPreview, type ToolId } from "./build";
import { SIM_DT } from "./constants";
import { PRICES, dailyUpkeep } from "./economy";
import { addPlatform } from "./growth";
import { step, type World } from "./world";

/**
 * A scripted "reasonable player" for balance runs (a test tool, not an AI). It builds only through
 * previewPlacement/applyPlacement and evictTenant, and once each game hour:
 * - opens a gate on any island whose gate queue stayed long (over GATE_QUEUE_LONG people for
 *   GATE_QUEUE_MINUTES, net of short minutes) since the last turn;
 * - while the meter is heading for growth, extends a 3-wide corridor along the concourse to the
 *   foot of the next platform's island; widens the approaches to entrances A and B as platforms
 *   are added, and from FOOTBRIDGE_AT platforms builds a route east to the footbridge (C), with
 *   toilets along it;
 * - for every two platforms opened (an island), adds a food unit on the concourse below its foot,
 *   a toilet and seating on its centre and a toilets sign on its foot, and evicts a tenant from the
 *   food unit that is not food and drink.
 */

/** People at an island's gate line (both sides) above which its queue counts as long. */
export const GATE_QUEUE_LONG = 8;
/** Game minutes a long queue must last (net of short ones) before the player buys a gate there. */
export const GATE_QUEUE_MINUTES = 15;
/** Rows from the top of an island's walkway to its toilet (near the gates, so nobody crosses them for it) and its seating. */
const TOILET_ROW = 22;
const SEAT_ROW = 12;
/** Money the player keeps in the bank after any build or eviction. */
const RESERVE = 3000;

export interface Autoplay {
  /** False: the player never builds toilets or seating (to show what they are worth). */
  restrooms: boolean;
  /** Per island (index = id - 1): game minutes its gate queue has been long, less the short minutes since. */
  longFor: number[];
  /** Islands whose queue stayed long since the last turn. */
  wantsGate: Set<number>;
  /** Facility ids of the food units built, keyed "food:<island id>". */
  units: Map<string, number>;
  /** The last whole game minute observed. */
  minute: number;
  /** The last game hour acted on. */
  hour: number;
}

export function createAutoplay(w: World, opts: { restrooms?: boolean } = {}): Autoplay {
  return {
    restrooms: opts.restrooms ?? true,
    longFor: w.map.islands.map(() => 0),
    wantsGate: new Set(),
    units: new Map(),
    minute: Math.floor(w.minute),
    hour: Math.floor(w.minute / 60),
  };
}

/** Call after every world step: watches the gate queues each game minute and takes a turn each game hour. */
export function autoplayStep(a: Autoplay, w: World): void {
  const minute = Math.floor(w.minute);
  if (minute !== a.minute) {
    a.minute = minute;
    watchGates(a, w);
  }
  const hour = Math.floor(w.minute / 60);
  if (hour !== a.hour) {
    a.hour = hour;
    takeTurn(a, w);
  }
}

/** Rows either side of a gate line counted as its queue. */
const GATE_QUEUE_ROWS = 2;

/** People bunched at an island's gate line: on it or within GATE_QUEUE_ROWS of it, either side, across its width. */
export function gateQueue(w: World, island: IslandDef): number {
  const r = island.gateLine;
  const p = w.people;
  let n = 0;
  for (let i = 0, end = p.end; i < end; i++) {
    if (!p.isAlive(i)) continue;
    const x = Math.floor(p.x[i]!);
    const y = Math.floor(p.y[i]!);
    if (x >= r.x && x < r.x + r.w && Math.abs(y - r.y) <= GATE_QUEUE_ROWS) n++;
  }
  return n;
}

function openGates(w: World, isl: IslandDef): number {
  const r = isl.gateLine;
  let n = 0;
  for (let x = r.x; x < r.x + r.w; x++) if (w.grid.tile(x, r.y) === Tile.Gate) n++;
  return n;
}

function watchGates(a: Autoplay, w: World): void {
  for (const isl of openedIslands(w)) {
    const k = isl.id - 1;
    // Queues come and go with each train, so a short minute takes one off the count rather than clearing it.
    a.longFor[k] = gateQueue(w, isl) > GATE_QUEUE_LONG ? a.longFor[k]! + 1 : Math.max(0, a.longFor[k]! - 1);
    if (a.longFor[k]! >= GATE_QUEUE_MINUTES) a.wantsGate.add(isl.id);
  }
}

function openedIslands(w: World): IslandDef[] {
  const ids = new Set(w.map.slots.slice(0, w.platformsAdded).map((s) => s.island));
  return w.map.islands.filter((isl) => ids.has(isl.id));
}

function overlaps(p: Rect, q: Rect): boolean {
  return p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;
}

/** Previews and, if valid, builds; true if it built. */
function build(w: World, tool: ToolId, rect: Rect, opts: BuildOpts = {}): boolean {
  const pv = previewPlacement(w, tool, rect, opts);
  return affordable(w, pv) && applyPlacement(w, pv);
}

/** Valid, and leaves RESERVE in the bank. */
function affordable(w: World, pv: PlacementPreview): boolean {
  return pv.valid && w.ledger.balance - pv.cost >= RESERVE;
}

function takeTurn(a: Autoplay, w: World): void {
  for (const id of a.wantsGate) openGate(w, w.map.islands[id - 1]!);
  a.wantsGate.clear();
  layFloor(w);
  const islands = openedIslands(w).slice(0, Math.floor(w.platformsAdded / 2));
  for (const isl of islands) furnish(a, w, isl);
  if (a.restrooms && w.platformsAdded >= FOOTBRIDGE_AT) routeToilets(w);
}

/** Toilets beside the footbridge route (station x of each), each with a sign on the route before it: the walk is long. */
const ROUTE_TOILETS = [70, 100];

/** Once the footbridge route reaches a toilet's spot: floor, the toilet just south of the route, and a sign. */
function routeToilets(w: World): void {
  for (const x of ROUTE_TOILETS) {
    const unit = st(w, x, 59, 2, 2);
    if (w.grid.zone(unit.x, unit.y) === Zone.Toilet) continue;
    if (w.grid.tile(unit.x, unit.y - 1) !== Tile.Floor) return;
    const floor = previewPlacement(w, "floor", unit);
    if (floor.tiles.length > 0 && !(affordable(w, floor) && applyPlacement(w, floor))) return;
    if (!build(w, "toilet", unit)) return;
    for (const sx of [x - 8, x + 8]) {
      const sign = st(w, sx, 56, 1, 1);
      build(w, "sign", sign, { signKind: "toilets" });
    }
  }
}

/** Opens the closed gate slot nearest the line's middle. */
function openGate(w: World, isl: IslandDef): void {
  const r = isl.gateLine;
  const mid = r.x + (r.w - 1) / 2;
  const slots: number[] = [];
  for (let x = r.x; x < r.x + r.w; x++) if (w.grid.tile(x, r.y) === Tile.GateClosed) slots.push(x);
  slots.sort((p, q) => Math.abs(p - mid) - Math.abs(q - mid) || p - q);
  for (const x of slots) if (build(w, "gate", { x, y: r.y, w: 1, h: 1 })) return;
}

/** Rows of the concourse corridor, just below the islands' feet. */
function corridorRows(isl: IslandDef): { y: number; h: number } {
  return { y: isl.foot.y + isl.foot.h, h: 3 };
}

/** A rect in the station's own coordinates (the station grounds' corner is 0,0). */
function st(w: World, x: number, y: number, rw: number, rh: number): Rect {
  return { x: w.map.grounds.x + x, y: w.map.grounds.y + y, w: rw, h: rh };
}

/** Platforms added at which the approaches widen, and by how many tiles each side. */
const WIDEN_STEPS: readonly { at: number; by: number }[] = [
  { at: 3, by: 2 },
  { at: 6, by: 4 },
];
/**
 * Platforms added at which the player builds the route to the footbridge entrance. Built at 6, 8 or
 * 10 it cost 10-20 points of weekday on-time (docs/balance.md): a third of passengers then walk
 * the long way round, where toilet needs catch up with them.
 */
const FOOTBRIDGE_AT = 12;

/**
 * The floor the player wants now, in build order (each piece joins floor laid before it):
 * the concourse corridor to the next platform's island while growth is near, the approaches to
 * entrances A and B widened as platforms are added, then the route east to the footbridge.
 */
function wantedFloor(w: World): Rect[] {
  const out: Rect[] = [];
  const first = w.map.islands[0]!;
  const { y, h } = corridorRows(first);
  const next = w.map.slots[w.platformsAdded];
  if (next && w.growth.goodSince !== null) {
    const end = w.map.islands[next.island - 1]!.foot;
    for (let x = first.foot.x; x < end.x + end.w; x += first.foot.w) out.push({ x, y, w: Math.min(first.foot.w, end.x + end.w - x), h });
  }
  const by = WIDEN_STEPS.filter((s) => w.platformsAdded >= s.at).reduce((m, s) => Math.max(m, s.by), 0);
  const a = w.map.entrances.find((e) => e.id === "A")!.tiles;
  const b = w.map.entrances.find((e) => e.id === "B")!.tiles;
  if (by > 0) {
    // A: floor either side of its corridor, from the concourse down to the entrance row.
    out.push({ x: a.x - by, y: y + h, w: by, h: a.y + 1 - (y + h) });
    out.push({ x: a.x + a.w, y: y + h, w: by, h: a.y + 1 - (y + h) });
    // B: a wider hall inside the entrance.
    out.push({ x: b.x + 1, y: b.y - by, w: 5 + by, h: b.h + 2 * by });
  }
  if (w.platformsAdded >= FOOTBRIDGE_AT) {
    // Along the concourse, through the gap between the goods shed and the sidings, north to the
    // gap in the signal works, through it, south again and east to the footbridge.
    out.push(st(w, 16, 56, 34, 3), st(w, 50, 56, 40, 3), st(w, 88, 44, 2, 12), st(w, 88, 44, 8, 3));
    out.push(st(w, 93, 47, 3, 12), st(w, 96, 56, 23, 3));
  }
  return out;
}

/** Lays the wanted floor piece by piece (obstacles in a piece are skipped); stops at one it can't build. */
function layFloor(w: World): void {
  for (const rect of wantedFloor(w)) {
    const pv = previewPlacement(w, "floor", rect);
    if (pv.tiles.length === 0) continue;
    if (!affordable(w, pv) || !applyPlacement(w, pv)) return;
  }
}

/** One island's set: a food unit on the concourse below its foot, a toilet and seating on its centre, a toilets sign on its foot. */
function furnish(a: Autoplay, w: World, isl: IslandDef): void {
  if (a.restrooms && !hasKind(w, isl, FacilityKind.Toilet)) build(w, "toilet", { x: isl.walkway.x + 1, y: isl.walkway.y + TOILET_ROW, w: 2, h: 2 });
  const toilet = hasKind(w, isl, FacilityKind.Toilet);
  const food = foodUnit(a, w, isl);
  if (food && food.tenant !== Tenant.None && food.tenant !== Tenant.FoodDrink && w.ledger.balance - PRICES.evict >= RESERVE) evictTenant(w, food.id);
  if (!a.restrooms) return;
  const cx = isl.walkway.x + 1;
  if (!hasKind(w, isl, FacilityKind.Seating)) build(w, "seating", { x: cx, y: isl.walkway.y + SEAT_ROW, w: 2, h: 3 });
  const sx = isl.foot.x + isl.foot.w - 1;
  const sy = isl.foot.y + isl.foot.h - 1;
  if (toilet && !w.signs.some((s) => s.tile === w.grid.idx(sx, sy))) build(w, "sign", { x: sx, y: sy, w: 1, h: 1 }, { signKind: "toilets" });
}

/** Every tile of the rect is unbuilt ground or plain, unzoned floor without a sign. */
function bareGround(w: World, r: Rect): boolean {
  const g = w.grid;
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const t = g.tile(x, y);
      const i = g.idx(x, y);
      if (t !== Tile.Ground && !(t === Tile.Floor && g.zones[i] === Zone.None && !w.signs.some((s) => s.tile === i))) return false;
    }
  }
  return true;
}

function hasKind(w: World, isl: IslandDef, kind: FacilityKind): boolean {
  for (const f of w.facilities.values()) if (f.kind === kind && overlaps(f.rect, isl.walkway)) return true;
  return false;
}

/**
 * The island's food unit, building it if it has none: a 2x2 just below the corridor, as near the
 * island's foot as it fits (up to two islands either side) and clear of entrance A's approach, on
 * floor laid first. Undefined if there is none yet.
 */
function foodUnit(a: Autoplay, w: World, isl: IslandDef): Facility | undefined {
  const key = `food:${isl.id}`;
  const id = a.units.get(key);
  const existing = id === undefined ? undefined : w.facilities.get(id);
  if (existing) return existing;
  const { y, h } = corridorRows(isl);
  const ry = y + h;
  const ent = w.map.entrances.find((e) => e.id === "A")!.tiles;
  const maxBy = WIDEN_STEPS[WIDEN_STEPS.length - 1]!.by;
  // As wide as entrance A's approach will ever be.
  const approach = { x: ent.x - maxBy, y: ry, w: ent.w + 2 * maxBy, h: ent.y - ry };
  // Nearest first, out to two islands either side.
  const xs: number[] = [];
  for (let d = 0; d <= 2 * isl.foot.w; d++) xs.push(isl.foot.x + d, isl.foot.x - d);
  for (const x of xs) {
    const rect = { x, y: ry, w: 2, h: 2 };
    if (overlaps(rect, approach) || !bareGround(w, rect)) continue;
    const floor = previewPlacement(w, "floor", rect);
    if (floor.tiles.length > 0 && !(affordable(w, floor) && applyPlacement(w, floor))) return undefined;
    const before = new Set(w.facilities.keys());
    if (!build(w, "retail", rect)) return undefined;
    for (const k of w.facilities.keys()) if (!before.has(k)) a.units.set(key, k);
    return undefined;
  }
  return undefined;
}

/** One closed game day of a balance run. */
export interface DayRow {
  day: number;
  added: number;
  active: number;
  /** Platforms closed during the day (the service meter's shrink rules). */
  closed: number;
  /** Inactive platforms reopened during the day. */
  reopened: number;
  moved: number;
  /** On-time share of the day's counted journeys (disruptions excluded), or null with none. */
  onTime: number | null;
  /** Lowest meter reading over the day (the worst 2-hour stretch), or null if it never read. */
  worstMeter: number | null;
  income: number;
  /** Upkeep charged at the day's close. */
  upkeep: number;
  balance: number;
  /** Most people at any one island's gate line at once. */
  peakGateQueue: number;
  /** Open gates on each opened island. */
  gates: number[];
  /** Rent multiplier for the day just starting of each retail unit that has had a full day. */
  rentMuls: number[];
}

/**
 * Steps `w` for `days` game days at SIM_DT, the autoplay player taking turns if given (null: an
 * idle player), and returns a row per day closed. Drains `w.events`.
 */
export function playDays(w: World, days: number, player: Autoplay | null, onDay?: (row: DayRow) => void): DayRow[] {
  const rows: DayRow[] = [];
  const until = w.minute + days * 1440;
  let worst: number | null = null;
  let peak = 0;
  let closed = 0;
  let reopened = 0;
  let active = w.platformActive.filter(Boolean).length;
  let added = w.platformsAdded;
  let lastMinute = Math.floor(w.minute);
  while (w.minute < until) {
    step(w, SIM_DT);
    if (player) autoplayStep(player, w);
    const m = Math.floor(w.minute);
    if (m !== lastMinute) {
      lastMinute = m;
      const r = w.meter.rate(m);
      if (r !== null && (worst === null || r < worst)) worst = r;
      for (const isl of openedIslands(w)) peak = Math.max(peak, gateQueue(w, isl));
    }
    const nowActive = w.platformActive.filter(Boolean).length;
    if (nowActive < active) closed += active - nowActive;
    else if (nowActive > active && w.platformsAdded === added) reopened += nowActive - active;
    active = nowActive;
    added = w.platformsAdded;
    for (const e of w.events) {
      if (e.kind !== "dayEnd") continue;
      const s = e.summary;
      const counted = s.onTime + s.missed;
      const row: DayRow = {
        day: s.day,
        added: w.platformsAdded,
        active: w.platformActive.filter(Boolean).length,
        closed,
        reopened,
        moved: s.moved,
        onTime: counted > 0 ? s.onTime / counted : null,
        worstMeter: worst,
        income: s.income,
        upkeep: dailyUpkeep(w),
        balance: s.balance,
        peakGateQueue: peak,
        gates: openedIslands(w).map((isl) => openGates(w, isl)),
        rentMuls: [...w.facilities.values()].filter((f) => f.kind === FacilityKind.Retail && f.footfallYesterday >= 0).map((f) => f.rentMul),
      };
      rows.push(row);
      onDay?.(row);
      worst = null;
      peak = 0;
      closed = 0;
      reopened = 0;
    }
    w.events.length = 0;
  }
  return rows;
}

/** Station-coordinate x of each toilet along the back of the roomy station's hall. */
const ROOMY_TOILETS = [4, 18, 26, 40, 58];
const ROOMY_PLATFORMS = 8;

/**
 * A roomy hand-built station for the whole-day needs check: ROOMY_PLATFORMS platforms, every gate
 * open, an 8-row concourse hall, and (with `restrooms`) toilets along the back of the hall and a
 * toilet and seating on each island. Built through the build tools; the caller funds it.
 */
export function roomyStation(w: World, restrooms: boolean): void {
  while (w.platformsAdded < ROOMY_PLATFORMS) addPlatform(w, w.platformsAdded + 1);
  for (const isl of openedIslands(w)) for (let x = isl.gateLine.x; x < isl.gateLine.x + isl.gateLine.w; x++) build(w, "gate", { x, y: isl.gateLine.y, w: 1, h: 1 });
  build(w, "floor", st(w, 1, 56, 62, 8));
  if (!restrooms) return;
  for (const x of ROOMY_TOILETS) build(w, "toilet", st(w, x, 62, 2, 2));
  for (const isl of openedIslands(w)) {
    build(w, "toilet", { x: isl.walkway.x + 1, y: isl.walkway.y + TOILET_ROW, w: 2, h: 2 });
    build(w, "seating", { x: isl.walkway.x + 1, y: isl.walkway.y + SEAT_ROW, w: 2, h: 3 });
  }
}
