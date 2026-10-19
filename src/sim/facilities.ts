import {
  EMPTY_AFTER_EVICT_MIN,
  FOOTFALL_RADIUS,
  LEISURE_SPEND_MUL,
  MAX_QUEUE_TILES,
  SEAT_LEAVE_MARGIN,
  SEAT_MAX_MIN,
  TENANT_DELAY_MIN,
} from "./constants";
import { PRICES, RENT_SHARE } from "./economy";
import { Tile, Zone, type Grid, type Rect } from "./grid";
import { NEED_COUNT, Need, PState, type PeopleStore } from "./people";
import type { Rng } from "./rng";
import { walkMinutes } from "./routeField";
import { fieldTargets, type World } from "./world";

export enum FacilityKind {
  Retail = 0,
  Toilet = 1,
  Seating = 2,
}

export enum Tenant {
  None = 0,
  FoodDrink = 1,
  Newsagent = 2,
  PhoneCharging = 3,
  Electronics = 4,
}

type LetTenant = Exclude<Tenant, Tenant.None>;

export const TENANTS: Record<LetTenant, { name: string; serveMin: number; spend: number; maxQueue: number; meets: Need[] }> = {
  [Tenant.FoodDrink]: { name: "Food and drink", serveMin: 4, spend: 6, maxQueue: 8, meets: [Need.Hunger, Need.Thirst] },
  [Tenant.Newsagent]: { name: "Newsagent", serveMin: 2, spend: 3, maxQueue: 5, meets: [Need.Browse] },
  [Tenant.PhoneCharging]: { name: "Phone charging", serveMin: 10, spend: 2, maxQueue: 4, meets: [Need.Charge] },
  [Tenant.Electronics]: { name: "Electronics", serveMin: 6, spend: 25, maxQueue: 4, meets: [Need.Browse] },
};

export const TOILET = { serveMin: 3, maxQueue: 10 } as const;

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
  /** People already counted in `footfall` while the unit is to let. */
  footfallSeen: Set<number>;
  /** Person ids, front first. */
  queue: number[];
  /** Being served (retail, toilet) or sitting (seating; `until` is the latest they stand). */
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

function serviceTilesOf(grid: Grid, r: Rect): number[] {
  const out = new Set<number>();
  const add = (x: number, y: number): void => {
    if (grid.isWalkable(x, y)) out.add(grid.idx(x, y));
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

/** Plain floor a queue may stand on: walkable, unzoned, not a platform. */
function queueable(grid: Grid, x: number, y: number): boolean {
  return grid.isWalkable(x, y) && grid.zone(x, y) === Zone.None && grid.tile(x, y) !== Tile.Platform;
}

/**
 * A line of up to MAX_QUEUE_TILES tiles from `start` heading away from the rect: straight on
 * while it can, otherwise turning (away from the rect's centre first).
 */
function growLine(grid: Grid, r: Rect, start: number): number[] {
  const [sx, sy] = grid.xy(start);
  if (!queueable(grid, sx, sy)) return [];
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
      if (inRect(r, nx, ny) || !queueable(grid, nx, ny) || used.has(n)) continue;
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

function queueTilesOf(grid: Grid, r: Rect, service: readonly number[]): number[] {
  let best: number[] = [];
  for (const s of service) {
    const line = growLine(grid, r, s);
    if (line.length > best.length) best = line;
  }
  return best;
}

export function createFacility(w: World, kind: FacilityKind, rect: Rect): Facility {
  const id = w.nextId++;
  for (let y = rect.y; y < rect.y + rect.h; y++)
    for (let x = rect.x; x < rect.x + rect.w; x++) w.grid.setZone(x, y, ZONE_OF[kind], id);
  const area = rect.w * rect.h;
  const serviceTiles = kind === FacilityKind.Seating ? [] : serviceTilesOf(w.grid, rect);
  const f: Facility = {
    id,
    kind,
    rect: { ...rect },
    serviceTiles,
    queueTiles: kind === FacilityKind.Seating ? [] : queueTilesOf(w.grid, rect, serviceTiles),
    tenant: Tenant.None,
    tenantAt: kind === FacilityKind.Retail ? w.minute + TENANT_DELAY_MIN : -1,
    footfall: { commuter: 0, leisure: 0 },
    footfallSeen: new Set(),
    queue: [],
    serving: [],
    capacity: kind === FacilityKind.Retail ? Math.ceil(area / 4) : kind === FacilityKind.Toilet ? area : area * 2,
    takingsToday: 0,
    builtPrice: area * PRICE_OF[kind],
  };
  w.facilities.set(id, f);
  return f;
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

/** Back on their way to their goal, errand over. */
function resume(p: PeopleStore, pid: number): void {
  p.state[pid] = PState.Walking;
  p.targetKey[pid] = p.goalKey[pid]!;
  p.errand[pid] = -1;
  p.errandFacility[pid] = -1;
}

/** Joins a retail unit's or toilet's queue; false if it is closed, a seat block, or its queue is full. */
export function tryJoin(w: World, f: Facility, pid: number): boolean {
  if (!isOpen(f)) return false;
  prune(w.people, f, PState.InFacility);
  if (f.queue.length >= maxQueue(f) || f.queue.length >= f.queueTiles.length) return false;
  w.people.state[pid] = PState.InQueue;
  w.people.targetKey[pid] = `spot:${f.queueTiles[f.queue.length]}`;
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
  p.timer[pid] = 0;
  f.serving.push({ pid, until: w.minute + SEAT_MAX_MIN });
  return true;
}

/** A person has reached facility `f`: they join its queue, or sit if it is seating. */
export function arriveAtFacility(w: World, f: Facility, pid: number): boolean {
  return f.kind === FacilityKind.Seating ? sit(w, f, pid) : tryJoin(w, f, pid);
}

function tileOf(w: World, pid: number): number {
  return w.grid.idx(Math.floor(w.people.x[pid]!), Math.floor(w.people.y[pid]!));
}

function countFootfall(w: World, f: Facility): void {
  const p = w.people;
  const r = f.rect;
  const R = FOOTFALL_RADIUS;
  for (let i = 0, end = p.end; i < end; i++) {
    if (!p.isAlive(i) || f.footfallSeen.has(i)) continue;
    const s = p.state[i]!;
    if (s !== PState.Walking && s !== PState.Waiting && s !== PState.InQueue && s !== PState.Seated) continue;
    const px = p.x[i]!;
    const py = p.y[i]!;
    if (px < r.x - R || px > r.x + r.w + R || py < r.y - R || py > r.y + r.h + R) continue;
    const ddx = Math.max(r.x - px, 0, px - (r.x + r.w));
    const ddy = Math.max(r.y - py, 0, py - (r.y + r.h));
    if (ddx * ddx + ddy * ddy > R * R) continue;
    f.footfallSeen.add(i);
    if (p.leisure[i]) f.footfall.leisure++;
    else f.footfall.commuter++;
  }
}

function moveIn(w: World, f: Facility): void {
  f.tenant = chooseTenant(f, w.rng);
  f.tenantAt = -1;
  f.footfall = { commuter: 0, leisure: 0 };
  f.footfallSeen.clear();
}

function finishService(w: World, f: Facility, pid: number): void {
  const p = w.people;
  const base = pid * NEED_COUNT;
  if (f.kind === FacilityKind.Retail && f.tenant !== Tenant.None) {
    const t = TENANTS[f.tenant];
    const spend = t.spend * (p.leisure[pid] ? LEISURE_SPEND_MUL : 1);
    w.ledger.credit("rent", spend * RENT_SHARE);
    f.takingsToday += spend;
    for (const need of t.meets) p.needs[base + need] = 0;
  } else if (f.kind === FacilityKind.Toilet) {
    p.needs[base + Need.Toilet] = 0;
  }
  resume(p, pid);
}

function stepQueue(w: World, f: Facility): void {
  const p = w.people;
  prune(p, f, PState.InFacility);
  let n = 0;
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

function stepSeats(w: World, f: Facility, dtMin: number): void {
  const p = w.people;
  prune(p, f, PState.Seated);
  let n = 0;
  for (const s of f.serving) {
    const pid = s.pid;
    p.timer[pid] = p.timer[pid]! + dtMin;
    const goal = p.goalKey[pid]!;
    const walk = walkMinutes(
      w.fields.get(goal, () => fieldTargets(w, goal)),
      tileOf(w, pid),
    );
    // Someone who cannot reach their goal from here loses nothing by sitting on.
    const leaveBy = p.deadline[pid]! - (Number.isFinite(walk) ? walk : 0) - SEAT_LEAVE_MARGIN;
    if (p.timer[pid]! >= SEAT_MAX_MIN || w.minute >= leaveBy) {
      p.needs[pid * NEED_COUNT + Need.Tired] = 0;
      resume(p, pid);
    } else {
      f.serving[n++] = s;
    }
  }
  f.serving.length = n;
}

/**
 * Advances every facility by `dtMin` game minutes: to-let units count passers-by (once a game
 * minute) until their tenant moves in; queues shuffle forward and are served from the front;
 * seated people stand when rested or when they need to go.
 */
export function stepFacilities(w: World, dtMin: number): void {
  const minuteTick = Math.floor(w.minute) !== Math.floor(w.minute - dtMin);
  for (const f of w.facilities.values()) {
    if (f.kind === FacilityKind.Retail && f.tenant === Tenant.None) {
      if (f.tenantAt >= 0 && w.minute >= f.tenantAt) moveIn(w, f);
      else if (minuteTick) countFootfall(w, f);
    }
    if (f.kind === FacilityKind.Seating) stepSeats(w, f, dtMin);
    else stepQueue(w, f);
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
  return true;
}
