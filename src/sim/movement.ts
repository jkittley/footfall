import { Dir, Grid, Tile, Zone } from "./grid";
import { DRIFT_PER_TILE, GATE_INTERVAL_SEC, TRAVELATOR_COST, WALK_TILES_PER_SEC } from "./constants";
import { CrowdGrid, speedFactor } from "./crowd";
import { PState, type PeopleStore } from "./people";
import type { Rng } from "./rng";
import { diagonalTouchesGate, nextStep, type FieldCache } from "./routeField";

/** No sub-step moves further than this (tiles), so a large dt cannot jump a wall. */
const MAX_SUBSTEP = 0.4;
/** A `spot:` walker has arrived within this distance (tiles) of the spot tile's centre. */
const SPOT_ARRIVE_DIST = 0.15;
const SPOT_PREFIX = "spot:";
const EPS_TIME = 1e-9;
// Direction vectors indexed by Dir (N, E, S, W).
const DIR_DX = [0, 1, 0, -1];
const DIR_DY = [-1, 0, 1, 0];

// One shared thunk for FieldCache.get, so a cache lookup allocates no closure per person.
let thunkKey = "";
let thunkTargets: (key: string) => readonly number[] = () => [];
const targetsThunk = (): readonly number[] => thunkTargets(thunkKey);

/** Tile index named by a `spot:<tileIdx>` key, or -1 for any other key. Parses without allocating. */
function spotTile(key: string): number {
  if (key.length <= SPOT_PREFIX.length || !key.startsWith(SPOT_PREFIX)) return -1;
  let n = 0;
  for (let c = SPOT_PREFIX.length; c < key.length; c++) {
    const d = key.charCodeAt(c) - 48;
    if (d < 0 || d > 9) return -1;
    n = n * 10 + d;
  }
  return n;
}

/** True while standing on a travelator and moving (dx, dy) with its direction. */
function riding(grid: Grid, tile: number, dx: number, dy: number): boolean {
  if (grid.zones[tile] !== Zone.Travelator) return false;
  const d = grid.dir[tile]!;
  if (d === Dir.None) return false;
  return dx * DIR_DX[d]! + dy * DIR_DY[d]! > 0;
}

/** Speed for a sub-step starting on `tile` heading (dx, dy): faster riding a travelator; in a gate, uncrowded walking. */
function subStepSpeed(grid: Grid, tile: number, dx: number, dy: number, base: number, gateSpeed: number): number {
  if (grid.tiles[tile] === Tile.Gate) return gateSpeed;
  return riding(grid, tile, dx, dy) ? base / TRAVELATOR_COST : base;
}

/**
 * True if a straight move from (ax, ay) to (bx, by), at most one tile apart on each axis,
 * touches only walkable tiles (a diagonal tile change needs both side tiles open too).
 */
function canMove(grid: Grid, ax: number, ay: number, bx: number, by: number): boolean {
  const fx = Math.floor(ax);
  const fy = Math.floor(ay);
  const tx = Math.floor(bx);
  const ty = Math.floor(by);
  if (!grid.isWalkable(tx, ty)) return false;
  if ((tx !== fx || ty !== fy) && grid.tile(fx, fy) === Tile.Gate && grid.tile(tx, ty) === Tile.Gate) return false;
  if (tx !== fx && ty !== fy) return grid.isWalkable(tx, fy) && grid.isWalkable(fx, ty) && !diagonalTouchesGate(grid, fx, fy, tx, ty);
  return true;
}

/**
 * A station's ticket gates: the real seconds stepped so far, when each gate tile next admits
 * someone, and who is waiting to enter which gate. A gate that is ready admits whoever has been
 * waiting at it longest (lowest index on a tie), so queues from both sides take turns.
 */
export interface Turnstiles {
  clock: number;
  /** Calls of stepMovement completed. */
  step: number;
  /** Per tile: the clock at which it next admits someone. */
  nextFree: Float64Array;
  /** Per person: the gate tile they last asked to enter, -1 once through (or never). */
  waitGate: Int32Array;
  /** Per person: the clock when they began waiting at `waitGate`. */
  waitSince: Float64Array;
  /** Per person: the step in which they last asked; a wait not renewed by the next step lapses. */
  waitStep: Float64Array;
  /** Per gate tile, everyone who asked to enter it in the last step, longest waiting first. */
  queues: Map<number, number[]>;
}

/** Turnstiles for a grid of `tiles` tiles and a people store of `people` slots. */
export function createTurnstiles(tiles: number, people: number): Turnstiles {
  return {
    clock: 0,
    step: 0,
    nextFree: new Float64Array(tiles).fill(-Infinity),
    waitGate: new Int32Array(people).fill(-1),
    waitSince: new Float64Array(people),
    waitStep: new Float64Array(people).fill(-Infinity),
    queues: new Map(),
  };
}

/** The turnstiles as saved: each gate tile's next-free time, and each wait still running as [person, gate, since, step]. */
export interface TurnstileSave {
  clock: number;
  step: number;
  gates: [number, number][];
  waiting: [number, number, number, number][];
}

/** Only tiles that are still gates are kept: a closed slot has no cadence to carry. */
export function saveTurnstiles(ts: Turnstiles, grid: Grid): TurnstileSave {
  const gates: [number, number][] = [];
  ts.nextFree.forEach((t, i) => {
    if (Number.isFinite(t) && grid.tiles[i] === Tile.Gate) gates.push([i, t]);
  });
  const waiting: [number, number, number, number][] = [];
  ts.waitGate.forEach((g, i) => {
    if (g >= 0 && ts.waitStep[i]! >= ts.step - 1) waiting.push([i, g, ts.waitSince[i]!, ts.waitStep[i]!]);
  });
  return { clock: ts.clock, step: ts.step, gates, waiting };
}

/** Puts saved turnstiles back; throws `Corrupt save: turnstiles` on a tile or person out of range. */
export function restoreTurnstiles(ts: Turnstiles, s: TurnstileSave): void {
  const inRange = (i: number, n: number): boolean => Number.isInteger(i) && i >= 0 && i < n;
  ts.clock = s.clock;
  ts.step = s.step;
  ts.nextFree.fill(-Infinity);
  for (const [i, t] of s.gates) {
    if (!inRange(i, ts.nextFree.length)) throw new Error("Corrupt save: turnstiles");
    ts.nextFree[i] = t;
  }
  ts.waitGate.fill(-1);
  ts.waitStep.fill(-Infinity);
  for (const [i, g, since, step] of s.waiting) {
    if (!inRange(i, ts.waitGate.length) || !inRange(g, ts.nextFree.length)) throw new Error("Corrupt save: turnstiles");
    ts.waitGate[i] = g;
    ts.waitSince[i] = since;
    ts.waitStep[i] = step;
  }
  rebuildQueues(ts, ts.step - 1);
}

/** Each gate's queue from the waits renewed in step `step`, longest waiting first, then by index. */
function rebuildQueues(ts: Turnstiles, step: number): void {
  ts.queues.clear();
  ts.waitGate.forEach((g, i) => {
    if (g < 0 || ts.waitStep[i] !== step) return;
    let q = ts.queues.get(g);
    if (!q) ts.queues.set(g, (q = []));
    q.push(i);
  });
  for (const q of ts.queues.values()) q.sort((a, b) => ts.waitSince[a]! - ts.waitSince[b]! || a - b);
}

/**
 * True if someone who has waited longer than person `i` (or as long, with a lower index) is still
 * waiting at `gate`. Anyone stepped already this step who did not ask again has gone elsewhere.
 */
function someoneAhead(ts: Turnstiles, people: PeopleStore, gate: number, i: number): boolean {
  const q = ts.queues.get(gate);
  if (!q) return false;
  const since = ts.waitSince[i]!;
  for (const j of q) {
    if (j === i) return false;
    if (!people.isAlive(j) || ts.waitGate[j] !== gate || (j < i && ts.waitStep[j] !== ts.step)) continue;
    // The queue is in order, so the first still waiting decides.
    return ts.waitSince[j]! < since || (ts.waitSince[j] === since && j < i);
  }
  return false;
}

/**
 * Real seconds person `i` waits, from clock `now`, before stepping from tile `from` onto tile `to`:
 * 0 unless `to` is a gate being entered; else until GATE_INTERVAL_SEC has passed since its last
 * entry, or Infinity while someone who has waited longer is still waiting for it. Asking renews `i`'s wait.
 */
function gateWait(ts: Turnstiles, people: PeopleStore, grid: Grid, from: number, to: number, now: number, i: number): number {
  if (to === from || grid.tiles[to] !== Tile.Gate) return 0;
  if (ts.waitGate[i] !== to || ts.waitStep[i]! < ts.step - 1) {
    ts.waitGate[i] = to;
    ts.waitSince[i] = now;
  }
  ts.waitStep[i] = ts.step;
  const wait = ts.nextFree[to]! - now;
  if (wait > EPS_TIME) return wait;
  return someoneAhead(ts, people, to, i) ? Infinity : 0;
}

/** Person `i` steps from tile `from` onto tile `to` at clock `now`: entering a gate starts its interval and ends their wait. */
function noteEntry(ts: Turnstiles, grid: Grid, from: number, to: number, now: number, i: number): void {
  if (to === from || grid.tiles[to] !== Tile.Gate) return;
  ts.nextFree[to] = now + GATE_INTERVAL_SEC;
  ts.waitGate[i] = -1;
}

/** True if person `i`'s straight move from (ax, ay) to (bx, by) is open and needs no wait at a gate. */
function canMoveAs(
  ts: Turnstiles,
  people: PeopleStore,
  grid: Grid,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  now: number,
  i: number,
): boolean {
  if (!canMove(grid, ax, ay, bx, by)) return false;
  const from = Math.floor(ay) * grid.w + Math.floor(ax);
  return gateWait(ts, people, grid, from, Math.floor(by) * grid.w + Math.floor(bx), now, i) === 0;
}

/** A random walkable neighbour of (x, y), 8-way without cutting corners; -1 if none. */
function randomNeighbour(grid: Grid, x: number, y: number, rng: Rng): number {
  let count = 0;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) if ((dx !== 0 || dy !== 0) && canMove(grid, x, y, x + dx, y + dy)) count++;
  if (count === 0) return -1;
  let k = Math.floor(rng.next() * count);
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++)
      if ((dx !== 0 || dy !== 0) && canMove(grid, x, y, x + dx, y + dy) && k-- === 0) return (y + dy) * grid.w + x + dx;
  return -1;
}

/**
 * Moves every Walking person, and every Waiting or InQueue person with a targetKey, for `dtReal`
 * real seconds and returns the indices that are at their targetKey (their state is unchanged; the
 * caller decides what happens next).
 *
 * Field keys follow nextStep toward the next tile's centre; arrival is standing on a tile
 * whose field value is 0. `spot:<tileIdx>` keys steer straight at that tile's centre, sliding along
 * one axis when the straight move is blocked; arrival is being within SPOT_ARRIVE_DIST of the centre.
 * Speed comes from `crowd` as passed in (the caller rebuilds it); the walker counts in its own tile.
 * Positions are written back through Math.fround after every sub-step, so the stored Float32 value
 * is the one that was checked against walls.
 * Given `rng`, a desperate field walker lurches to a random neighbouring
 * tile about DRIFT_PER_TILE of the tiles they walk, following the field otherwise.
 * A gate tile is a turnstile (`turnstiles`, sized for `grid` and `people`): it admits one person
 * per GATE_INTERVAL_SEC, whoever is still on it, longest waiting first. Anyone it is not ready for
 * waits at its edge, still counted in the crowd (that is the queue); on it they walk at full speed,
 * the crowd outside not slowing them.
 */
export function stepMovement(
  grid: Grid,
  fields: FieldCache,
  fieldTargets: (key: string) => readonly number[],
  people: PeopleStore,
  crowd: CrowdGrid,
  turnstiles: Turnstiles,
  dtReal: number,
  rng?: Rng,
): number[] {
  const arrived: number[] = [];
  if (dtReal <= 0) return arrived;
  thunkTargets = fieldTargets;
  const counts = crowd.counts;
  const crowdAt = (n: number): number => counts[n]!;
  const w = grid.w;
  const { x, y, state, targetKey, speedMul, drift, desperate } = people;
  const ts = turnstiles;

  for (let i = 0, end = people.end; i < end; i++) {
    const st = state[i]!;
    // Waiting and queueing people still walk to their spot; with no target they stand.
    const walksToSpot = st === PState.Waiting || st === PState.InQueue;
    if ((st !== PState.Walking && (!walksToSpot || targetKey[i] === "")) || !people.isAlive(i)) continue;
    let px = x[i]!;
    let py = y[i]!;
    let tx = Math.floor(px);
    let ty = Math.floor(py);
    if (!grid.isWalkable(tx, ty)) {
      nudgeToWalkable(grid, people, i);
      px = x[i]!;
      py = y[i]!;
      tx = Math.floor(px);
      ty = Math.floor(py);
      if (!grid.isWalkable(tx, ty)) continue;
    }
    const clock = ts.clock;

    const base = WALK_TILES_PER_SEC * speedFactor(crowd.density(tx, ty)) * speedMul[i]!;
    const gateSpeed = WALK_TILES_PER_SEC * speedMul[i]!;
    if (!(base > 0)) continue;
    const maxIter = 4 * Math.ceil((dtReal * Math.max(base, gateSpeed)) / TRAVELATOR_COST / MAX_SUBSTEP) + 4;
    let time = dtReal;
    const key = targetKey[i]!;
    const spot = spotTile(key);

    if (spot >= 0) {
      const sx = (spot % w) + 0.5;
      const sy = Math.floor(spot / w) + 0.5;
      for (let iter = 0; iter < maxIter; iter++) {
        const dx = sx - px;
        const dy = sy - py;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= SPOT_ARRIVE_DIST) {
          arrived.push(i);
          break;
        }
        if (time <= EPS_TIME) break;
        const here = ty * w + tx;
        const speed = subStepSpeed(grid, here, dx, dy, base, gateSpeed);
        const move = Math.min(MAX_SUBSTEP, speed * time, dist);
        const nx = Math.fround(px + (dx / dist) * move);
        const ny = Math.fround(py + (dy / dist) * move);
        const now = clock + dtReal - time;
        if (canMoveAs(ts, people, grid, px, py, nx, ny, now, i)) {
          px = nx;
          py = ny;
        } else if (nx !== px && canMoveAs(ts, people, grid, px, py, nx, py, now, i)) {
          px = nx;
        } else if (ny !== py && canMoveAs(ts, people, grid, px, py, px, ny, now, i)) {
          py = ny;
        }
        time -= move / speed;
        tx = Math.floor(px);
        ty = Math.floor(py);
        noteEntry(ts, grid, here, ty * w + tx, now, i);
      }
    } else {
      thunkKey = key;
      const field = fields.get(key, targetsThunk);
      const drifts = rng !== undefined && desperate[i] === 1;
      for (let iter = 0; iter < maxIter; iter++) {
        const here = ty * w + tx;
        if (field[here] === 0) {
          arrived.push(i);
          break;
        }
        if (time <= EPS_TIME) break;
        let n = -1;
        if (drifts) {
          const d = drift[i]!;
          const ddx = (d % w) - tx;
          const ddy = Math.floor(d / w) - ty;
          if (d >= 0 && d !== here && Math.abs(ddx) <= 1 && Math.abs(ddy) <= 1) n = d;
          else drift[i] = -1;
        }
        if (n < 0) n = nextStep(grid, field, tx, ty, crowdAt);
        if (n < 0) break;
        const nx = n % w;
        const ny = (n - nx) / w;
        // The segment from anywhere in this tile to the centre of a neighbour nextStep allows
        // stays inside walkable tiles, and fround keeps each point between two Float32 endpoints.
        const dx = nx + 0.5 - px;
        const dy = ny + 0.5 - py;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const speed = subStepSpeed(grid, here, nx - tx, ny - ty, base, gateSpeed);
        const move = Math.min(MAX_SUBSTEP, speed * time, dist);
        const mx = Math.fround(px + (dx / dist) * move);
        const my = Math.fround(py + (dy / dist) * move);
        const to = Math.floor(my) * w + Math.floor(mx);
        const now = clock + dtReal - time;
        const wait = gateWait(ts, people, grid, here, to, now, i);
        if (wait > 0) {
          // The turnstile is not ready: stand at its edge, giving up any lurch toward it, and step
          // through within this dt if its cadence comes round in time.
          drift[i] = -1;
          if (wait >= time) break;
          time -= wait;
          continue;
        }
        noteEntry(ts, grid, here, to, now, i);
        px = mx;
        py = my;
        time -= move / speed;
        tx = Math.floor(px);
        ty = Math.floor(py);
        if (drifts && drift[i]! < 0 && rng.next() < move * DRIFT_PER_TILE) drift[i] = randomNeighbour(grid, tx, ty, rng);
      }
    }
    x[i] = px;
    y[i] = py;
  }
  ts.clock += dtReal;
  rebuildQueues(ts, ts.step);
  ts.step++;
  return arrived;
}

// Reused BFS scratch for nudgeToWalkable: a queue and a visit stamp per tile.
let bfsQueue = new Int32Array(0);
let bfsSeen = new Uint32Array(0);
let bfsStamp = 0;

/**
 * Moves person `i` to the centre of the nearest walkable tile (8-neighbour BFS, so nearest by
 * Chebyshev distance), only taking tiles marked in `allowed` when given; no-op if none.
 */
export function nudgeToWalkable(grid: Grid, people: PeopleStore, i: number, allowed?: Uint8Array): void {
  const w = grid.w;
  const h = grid.h;
  const sx = Math.min(w - 1, Math.max(0, Math.floor(people.x[i]!)));
  const sy = Math.min(h - 1, Math.max(0, Math.floor(people.y[i]!)));
  if (bfsSeen.length < w * h) {
    bfsQueue = new Int32Array(w * h);
    bfsSeen = new Uint32Array(w * h);
    bfsStamp = 0;
  }
  bfsStamp = (bfsStamp + 1) >>> 0;
  if (bfsStamp === 0) {
    bfsSeen.fill(0);
    bfsStamp = 1;
  }
  let head = 0;
  let tail = 0;
  const start = sy * w + sx;
  bfsQueue[tail++] = start;
  bfsSeen[start] = bfsStamp;
  while (head < tail) {
    const t = bfsQueue[head++]!;
    const tx = t % w;
    const ty = (t - tx) / w;
    if (grid.isWalkable(tx, ty) && (allowed === undefined || allowed[t] === 1)) {
      people.x[i] = tx + 0.5;
      people.y[i] = ty + 0.5;
      return;
    }
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = tx + dx;
        const ny = ty + dy;
        if ((dx === 0 && dy === 0) || nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = ny * w + nx;
        if (bfsSeen[n] === bfsStamp) continue;
        bfsSeen[n] = bfsStamp;
        bfsQueue[tail++] = n;
      }
    }
  }
}
