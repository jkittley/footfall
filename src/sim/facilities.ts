import {
  EMPTY_AFTER_EVICT_MIN,
  FOOTFALL_RADIUS,
  LEISURE_SPEND_MUL,
  MAX_QUEUE_TILES,
  QUEUE_GIVE_UP_MIN,
  QUEUE_LEAVE_MARGIN,
  RENT_FOOTFALL_REF,
  RENT_MUL_MAX,
  RENT_MUL_MIN,
  SEAT_LEAVE_MARGIN,
  SEAT_MAX_MIN,
  TENANT_DELAY_MIN,
} from "./constants";
import { PRICES, RENT_SHARE } from "./economy";
import { Tile, Zone, type Grid, type Rect } from "./grid";
import { isIslandCentre, isPlatformEdge, type StationMap } from "./maps/harbourStreet";
import { NEED_COUNT, Need, PState, type PeopleStore } from "./people";
import { FacilityKind, Tenant } from "./facilityKinds";
import { refreshSigns } from "./needs";
import type { Rng } from "./rng";
import { spareMinutes, tileOf } from "./walk";
import type { World } from "./world";

export { FacilityKind, Tenant };

type LetTenant = Exclude<Tenant, Tenant.None>;

export const TENANTS: Record<LetTenant, { name: string; serveMin: number; spend: number; maxQueue: number; meets: Need[] }> = {
  [Tenant.FoodDrink]: { name: "Food and drink", serveMin: 4, spend: 6, maxQueue: 8, meets: [Need.Hunger, Need.Thirst] },
  [Tenant.Newsagent]: { name: "Newsagent", serveMin: 2, spend: 3, maxQueue: 5, meets: [Need.Browse] },
  [Tenant.PhoneCharging]: { name: "Phone charging", serveMin: 10, spend: 2, maxQueue: 4, meets: [Need.Charge] },
  [Tenant.Electronics]: { name: "Electronics", serveMin: 6, spend: 25, maxQueue: 4, meets: [Need.Browse] },
};

export const TOILET = { serveMin: 1, maxQueue: 10 } as const;

const LET_TENANTS: readonly LetTenant[] = [Tenant.FoodDrink, Tenant.Newsagent, Tenant.PhoneCharging, Tenant.Electronics];
const COMMUTER_WEIGHTS: Record<LetTenant, number> = {
  [Tenant.FoodDrink]: 0.45,
  [Tenant.Newsagent]: 0.35,
  [Tenant.PhoneCharging]: 0.1,
  [Tenant.Electronics]: 0.1,
};
const LEISURE_WEIGHTS: Record<LetTenant, number> = {
  [Tenant.FoodDrink]: 0.3,
  [Tenant.Newsagent]: 0.1,
  [Tenant.PhoneCharging]: 0.2,
  [Tenant.Electronics]: 0.4,
};

export interface Facility {
  id: number;
  kind: FacilityKind;
  rect: Rect;
  /** Walkable tiles orthogonally next to the rect (retail and toilet; seating has none). */
  serviceTiles: number[];
  /** Where a queue stands, front first: a line of plain floor starting at one service tile. */
  queueTiles: number[];
  tenant: Tenant;
  /** Minute a tenant moves in, -1 if it has one (or never takes one). */
  tenantAt: number;
  footfall: { commuter: number; leisure: number };
  /** Serials of people already counted in `footfall` while the unit is to let. */
  footfallSeen: Set<number>;
  /** Serials of the distinct people within FOOTFALL_RADIUS since midnight, let or to let; cleared at each midnight. */
  passedSeen: Set<number>;
  /** People counted in `passedSeen` today. */
  footfallToday: number;
  /** Minute the unit was built; its first, partial day sets no rent multiplier. */
  builtAt: number;
  /** People who passed in the last full day; -1 until the unit has had one. */
  footfallYesterday: number;
  /** Scales the rent share of every sale today, set at midnight from yesterday's passers-by. */
  rentMul: number;
  /** Person ids, front first. */
  queue: number[];
  /** Being served (retail, toilet; `until` service ends) or sitting (seating; `until` the latest they stand). */
  serving: { pid: number; until: number }[];
  capacity: number;
  takingsToday: number;
  builtPrice: number;
}

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

function inRect(r: Rect, x: number, y: number): boolean {
  return x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
}

/** Walkable tiles orthogonally next to `r`, but never a gate or a platform edge: those are kept for passing through and boarding. */
export function serviceTilesOf(grid: Grid, map: StationMap, r: Rect): number[] {
  const out = new Set<number>();
  const add = (x: number, y: number): void => {
    if (grid.isWalkable(x, y) && grid.tile(x, y) !== Tile.Gate && !isPlatformEdge(map, x, y)) out.add(grid.idx(x, y));
  };
  for (let x = r.x; x < r.x + r.w; x++) {
    add(x, r.y - 1);
    add(x, r.y + r.h);
  }
  for (let y = r.y; y < r.y + r.h; y++) {
    add(r.x - 1, y);
    add(r.x + r.w, y);
  }
  return [...out].sort((a, b) => a - b);
}

/** Where a queue may stand: walkable and unzoned, not a gate, and not platform unless in an island's centre. */
function queueable(grid: Grid, map: StationMap, x: number, y: number): boolean {
  const t = grid.tile(x, y);
  if (!grid.isWalkable(x, y) || grid.zone(x, y) !== Zone.None || t === Tile.Gate) return false;
  return t !== Tile.Platform || isIslandCentre(map, x, y);
}

/**
 * A line of up to MAX_QUEUE_TILES tiles from `start` heading away from the rect: straight on
 * while it can, otherwise turning (away from the rect's centre first).
 */
function growLine(grid: Grid, map: StationMap, r: Rect, start: number): number[] {
  const [sx, sy] = grid.xy(start);
  if (!queueable(grid, map, sx, sy)) return [];
  let dx = sx < r.x ? -1 : sx >= r.x + r.w ? 1 : 0;
  let dy = dx !== 0 ? 0 : sy < r.y ? -1 : 1;
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const line = [start];
  const used = new Set(line);
  let x = sx;
  let y = sy;
  while (line.length < MAX_QUEUE_TILES) {
    const turns: [number, number][] = [
      [dy, dx],
      [-dy, -dx],
    ];
    const away = (v: [number, number]): number => (x + v[0] - cx) ** 2 + (y + v[1] - cy) ** 2;
    if (away(turns[1]!) > away(turns[0]!)) turns.reverse();
    let moved = false;
    for (const [mx, my] of [[dx, dy] as [number, number], ...turns]) {
      const nx = x + mx;
      const ny = y + my;
      const n = grid.idx(nx, ny);
      if (inRect(r, nx, ny) || !queueable(grid, map, nx, ny) || used.has(n)) continue;
      line.push(n);
      used.add(n);
      x = nx;
      y = ny;
      dx = mx;
      dy = my;
      moved = true;
      break;
    }
    if (!moved) break;
  }
  return line;
}

function queueTilesOf(grid: Grid, map: StationMap, r: Rect, service: readonly number[]): number[] {
  let best: number[] = [];
  for (const s of service) {
    const line = growLine(grid, map, r, s);
    if (line.length > best.length) best = line;
  }
  return best;
}

export function createFacility(w: World, kind: FacilityKind, rect: Rect): Facility {
  const id = w.nextId++;
  for (let y = rect.y; y < rect.y + rect.h; y++)
    for (let x = rect.x; x < rect.x + rect.w; x++) w.grid.setZone(x, y, ZONE_OF[kind], id);
  const area = rect.w * rect.h;
  const serviceTiles = kind === FacilityKind.Seating ? [] : serviceTilesOf(w.grid, w.map, rect);
  const f: Facility = {
    id,
    kind,
    rect: { ...rect },
    serviceTiles,
    queueTiles: kind === FacilityKind.Seating ? [] : queueTilesOf(w.grid, w.map, rect, serviceTiles),
    tenant: Tenant.None,
    tenantAt: kind === FacilityKind.Retail ? w.minute + TENANT_DELAY_MIN : -1,
    footfall: { commuter: 0, leisure: 0 },
    footfallSeen: new Set(),
    passedSeen: new Set(),
    footfallToday: 0,
    builtAt: w.minute,
    footfallYesterday: -1,
    rentMul: 1,
    queue: [],
    serving: [],
    capacity: kind === FacilityKind.Retail ? Math.ceil(area / 4) : kind === FacilityKind.Toilet ? area : area * 2,
    takingsToday: 0,
    builtPrice: area * PRICE_OF[kind],
  };
  w.facilities.set(id, f);
  refreshSigns(w);
  return f;
}

/**
 * Re-reads the tiles round `f` after the grid changed. Queuers whose spot is no longer on the
 * line walk on; the rest keep their order and are sent to their new spots.
 */
export function refreshAccess(w: World, f: Facility): void {
  if (f.kind === FacilityKind.Seating) return;
  const p = w.people;
  f.serviceTiles = serviceTilesOf(w.grid, w.map, f.rect);
  f.queueTiles = queueTilesOf(w.grid, w.map, f.rect, f.serviceTiles);
  prune(p, f, PState.InFacility);
  const line = new Set(f.queueTiles);
  let n = 0;
  for (const pid of f.queue) {
    const key = p.targetKey[pid]!;
    const spot = key.startsWith("spot:") ? Number(key.slice(5)) : tileOf(w, pid);
    if (line.has(spot) && n < f.queueTiles.length) f.queue[n++] = pid;
    else resume(p, pid);
  }
  f.queue.length = n;
  for (let k = 0; k < n; k++) {
    const pid = f.queue[k]!;
    const spot = f.queueTiles[k]!;
    if (p.targetKey[pid] !== "" || tileOf(w, pid) !== spot) p.targetKey[pid] = `spot:${spot}`;
  }
}

/** Takes person `pid` out of any queue, service or seat they hold, and sends them on their way. */
export function releasePerson(w: World, pid: number): void {
  for (const f of w.facilities.values()) {
    const q = f.queue.indexOf(pid);
    if (q >= 0) f.queue.splice(q, 1);
    const s = f.serving.findIndex((x) => x.pid === pid);
    if (s >= 0) f.serving.splice(s, 1);
  }
  resume(w.people, pid);
}

/** Takes `f` down: everyone queued, served or seated there walks on, and its tiles are unzoned. */
export function removeFacility(w: World, f: Facility): void {
  const p = w.people;
  prune(p, f, f.kind === FacilityKind.Seating ? PState.Seated : PState.InFacility);
  for (const pid of f.queue) resume(p, pid);
  for (const s of f.serving) resume(p, s.pid);
  f.queue.length = 0;
  f.serving.length = 0;
  w.facilities.delete(f.id);
  w.fields.delete(`facility:${f.id}`);
  w.fields.delete(`seat:${f.id}`);
  const r = f.rect;
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) w.grid.setZone(x, y, Zone.None, -1);
}

export function chooseTenant(f: Facility, rng: Rng): Tenant {
  const total = f.footfall.commuter + f.footfall.leisure;
  const t = total > 0 ? f.footfall.leisure / total : 0.5;
  return rng.weighted(
    LET_TENANTS.map((item) => ({ item, w: COMMUTER_WEIGHTS[item] + (LEISURE_WEIGHTS[item] - COMMUTER_WEIGHTS[item]) * t })),
  );
}

function isOpen(f: Facility): boolean {
  return f.kind === FacilityKind.Toilet || (f.kind === FacilityKind.Retail && f.tenant !== Tenant.None);
}

function maxQueue(f: Facility): number {
  if (f.kind === FacilityKind.Toilet) return TOILET.maxQueue;
  return f.tenant === Tenant.None ? 0 : TENANTS[f.tenant].maxQueue;
}

/** Drops anyone freed, or moved on by something else, from the queue and serving lists. */
function prune(p: PeopleStore, f: Facility, servingState: PState): void {
  let n = 0;
  for (const pid of f.queue) if (p.isAlive(pid) && p.state[pid] === PState.InQueue) f.queue[n++] = pid;
  f.queue.length = n;
  n = 0;
  for (const s of f.serving) if (p.isAlive(s.pid) && p.state[s.pid] === servingState) f.serving[n++] = s;
  f.serving.length = n;
}

/** Back on their way to their goal at full speed, errand over. */
function resume(p: PeopleStore, pid: number): void {
  p.state[pid] = PState.Walking;
  p.targetKey[pid] = p.goalKey[pid]!;
  p.endErrand(pid);
}

/** Joins a retail unit's or toilet's queue; false if it is closed, a seat block, or its queue is full. */
export function tryJoin(w: World, f: Facility, pid: number): boolean {
  if (!isOpen(f)) return false;
  prune(w.people, f, PState.InFacility);
  if (f.queue.length >= maxQueue(f) || f.queue.length >= f.queueTiles.length) return false;
  w.people.state[pid] = PState.InQueue;
  w.people.targetKey[pid] = `spot:${f.queueTiles[f.queue.length]}`;
  w.people.timer[pid] = 0;
  f.queue.push(pid);
  return true;
}

/** Sits a person on the seat block they are standing on; false if every seat is taken. */
function sit(w: World, f: Facility, pid: number): boolean {
  const p = w.people;
  prune(p, f, PState.Seated);
  if (f.serving.length >= f.capacity) return false;
  p.state[pid] = PState.Seated;
  p.targetKey[pid] = "";
  f.serving.push({ pid, until: w.minute + SEAT_MAX_MIN });
  return true;
}

/** A person has reached facility `f`: they join its queue, or sit if it is seating. */
export function arriveAtFacility(w: World, f: Facility, pid: number): boolean {
  return f.kind === FacilityKind.Seating ? sit(w, f, pid) : tryJoin(w, f, pid);
}

type Buckets = Map<number, number[]>;

/** Everyone who counts as passing a unit, by the tile they stand on, so a unit reads only the tiles round it. */
function bucketPassers(w: World): Buckets {
  const p = w.people;
  const gw = w.grid.w;
  const buckets: Buckets = new Map();
  for (let i = 0, end = p.end; i < end; i++) {
    if (!p.isAlive(i)) continue;
    const s = p.state[i]!;
    if (s !== PState.Walking && s !== PState.Waiting && s !== PState.InQueue && s !== PState.Seated) continue;
    const key = Math.floor(p.y[i]!) * gw + Math.floor(p.x[i]!);
    const at = buckets.get(key);
    if (at) at.push(i);
    else buckets.set(key, [i]);
  }
  return buckets;
}

function countFootfall(w: World, f: Facility, buckets: Buckets): void {
  const p = w.people;
  const r = f.rect;
  const R = FOOTFALL_RADIUS;
  const gw = w.grid.w;
  const toLet = f.tenant === Tenant.None;
  const x0 = Math.max(0, Math.floor(r.x - R));
  const x1 = Math.min(gw - 1, Math.floor(r.x + r.w + R));
  const y0 = Math.max(0, Math.floor(r.y - R));
  const y1 = Math.min(w.grid.h - 1, Math.floor(r.y + r.h + R));
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const here = buckets.get(ty * gw + tx);
      if (!here) continue;
      for (const i of here) {
        const sid = p.serial[i]!;
        const newToday = !f.passedSeen.has(sid);
        const newToLet = toLet && !f.footfallSeen.has(sid);
        if (!newToday && !newToLet) continue;
        const px = p.x[i]!;
        const py = p.y[i]!;
        const ddx = Math.max(r.x - px, 0, px - (r.x + r.w));
        const ddy = Math.max(r.y - py, 0, py - (r.y + r.h));
        if (ddx * ddx + ddy * ddy > R * R) continue;
        if (newToday) {
          f.passedSeen.add(sid);
          f.footfallToday++;
        }
        if (newToLet) {
          f.footfallSeen.add(sid);
          if (p.leisure[i]) f.footfall.leisure++;
          else f.footfall.commuter++;
        }
      }
    }
  }
}

/** At midnight: rent for the new day follows yesterday's passers-by, then the count starts again. */
export function closeFootfallDay(f: Facility, dayStart: number): void {
  if (f.builtAt > dayStart) {
    f.footfallToday = 0;
    f.passedSeen.clear();
    return;
  }
  f.rentMul = Math.min(RENT_MUL_MAX, Math.max(RENT_MUL_MIN, f.footfallToday / RENT_FOOTFALL_REF));
  f.footfallYesterday = f.footfallToday;
  f.footfallToday = 0;
  f.passedSeen.clear();
}

function moveIn(w: World, f: Facility): void {
  f.tenant = chooseTenant(f, w.rng);
  f.tenantAt = -1;
  f.footfall = { commuter: 0, leisure: 0 };
  f.footfallSeen.clear();
  refreshSigns(w);
}

function finishService(w: World, f: Facility, pid: number): void {
  const p = w.people;
  const base = pid * NEED_COUNT;
  if (f.kind === FacilityKind.Retail && f.tenant !== Tenant.None) {
    const t = TENANTS[f.tenant];
    const spend = t.spend * (p.leisure[pid] ? LEISURE_SPEND_MUL : 1);
    w.ledger.credit("rent", spend * RENT_SHARE * f.rentMul);
    f.takingsToday += spend;
    for (const need of t.meets) p.needs[base + need] = 0;
  } else if (f.kind === FacilityKind.Toilet) {
    p.needs[base + Need.Toilet] = 0;
    p.desperate[pid] = 0;
  }
  resume(p, pid);
  p.refreshSpeed(pid);
}

function stepQueue(w: World, f: Facility, dtMin: number): void {
  const p = w.people;
  prune(p, f, PState.InFacility);
  // Nobody waits forever, or past the point of making their train: they walk on, need unmet.
  let n = 0;
  for (const pid of f.queue) {
    p.timer[pid] = p.timer[pid]! + dtMin;
    if (p.timer[pid]! > QUEUE_GIVE_UP_MIN || spareMinutes(w, pid) < QUEUE_LEAVE_MARGIN) resume(p, pid);
    else f.queue[n++] = pid;
  }
  f.queue.length = n;
  n = 0;
  for (const s of f.serving) {
    if (w.minute >= s.until) finishService(w, f, s.pid);
    else f.serving[n++] = s;
  }
  f.serving.length = n;

  const serveMin = f.kind === FacilityKind.Toilet ? TOILET.serveMin : f.tenant === Tenant.None ? 0 : TENANTS[f.tenant].serveMin;
  while (isOpen(f) && f.serving.length < f.capacity && f.queue.length > 0) {
    const front = f.queue[0]!;
    // Served once standing at the counter, not while still walking to it.
    if (p.targetKey[front] !== "" || tileOf(w, front) !== f.queueTiles[0]) break;
    f.queue.shift();
    p.state[front] = PState.InFacility;
    f.serving.push({ pid: front, until: w.minute + serveMin });
  }

  for (let k = 0; k < f.queue.length; k++) {
    const pid = f.queue[k]!;
    const spot = f.queueTiles[k]!;
    const key = p.targetKey[pid]!;
    if (key === "" ? tileOf(w, pid) !== spot : key !== `spot:${spot}`) p.targetKey[pid] = `spot:${spot}`;
  }
}

function stepSeats(w: World, f: Facility): void {
  const p = w.people;
  prune(p, f, PState.Seated);
  let n = 0;
  for (const s of f.serving) {
    const pid = s.pid;
    if (w.minute >= s.until || spareMinutes(w, s.pid) <= SEAT_LEAVE_MARGIN) {
      p.needs[pid * NEED_COUNT + Need.Tired] = 0;
      resume(p, pid);
      p.refreshSpeed(pid);
    } else {
      f.serving[n++] = s;
    }
  }
  f.serving.length = n;
}

/**
 * Advances every facility by `dtMin` game minutes: retail units count passers-by (once a game
 * minute), and a to-let unit's count also steers which tenant moves in; queues shuffle forward and are served from the front;
 * seated people stand when rested or when they need to go.
 */
export function stepFacilities(w: World, dtMin: number): void {
  const minuteTick = Math.floor(w.minute) !== Math.floor(w.minute - dtMin);
  let hasRetail = false;
  for (const f of w.facilities.values()) if (f.kind === FacilityKind.Retail) hasRetail = true;
  const buckets = minuteTick && hasRetail ? bucketPassers(w) : null;
  for (const f of w.facilities.values()) {
    if (f.kind === FacilityKind.Retail) {
      if (f.tenant === Tenant.None && f.tenantAt >= 0 && w.minute >= f.tenantAt) moveIn(w, f);
      else if (buckets) countFootfall(w, f, buckets);
    }
    if (f.kind === FacilityKind.Seating) stepSeats(w, f);
    else stepQueue(w, f, dtMin);
  }
}

/** Pays the eviction fee to empty a let unit for EMPTY_AFTER_EVICT_MIN; false if not let or unaffordable. */
export function evictTenant(w: World, id: number): boolean {
  const f = w.facilities.get(id);
  if (!f || f.kind !== FacilityKind.Retail || f.tenant === Tenant.None) return false;
  if (!w.ledger.canAfford(PRICES.evict)) return false;
  w.ledger.debit("evictions", PRICES.evict);
  f.tenant = Tenant.None;
  f.tenantAt = w.minute + EMPTY_AFTER_EVICT_MIN;
  f.footfall = { commuter: 0, leisure: 0 };
  f.footfallSeen.clear();
  const p = w.people;
  prune(p, f, PState.InFacility);
  for (const pid of f.queue) resume(p, pid);
  for (const s of f.serving) resume(p, s.pid);
  f.queue.length = 0;
  f.serving.length = 0;
  refreshSigns(w);
  return true;
}
