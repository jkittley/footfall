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

/** A grid's turnstiles: the real seconds stepped so far, and when each gate tile next admits someone. */
interface Turnstiles {
  clock: number;
  nextFree: Float64Array;
}

// Kept per grid rather than on the world, so every caller of stepMovement gets the cadence.
const turnstilesOf = new WeakMap<Grid, Turnstiles>();

function turnstilesFor(grid: Grid): Turnstiles {
  let ts = turnstilesOf.get(grid);
  if (!ts || ts.nextFree.length !== grid.w * grid.h) {
    ts = { clock: 0, nextFree: new Float64Array(grid.w * grid.h).fill(-Infinity) };
    turnstilesOf.set(grid, ts);
  }
  return ts;
}

/** The turnstiles as saved: the clock, and each gate tile's next-free time where it has one. */
export interface TurnstileSave {
  clock: number;
  gates: [number, number][];
}

export function saveTurnstiles(grid: Grid): TurnstileSave {
  const ts = turnstilesFor(grid);
  const gates: [number, number][] = [];
  ts.nextFree.forEach((t, i) => {
    if (Number.isFinite(t)) gates.push([i, t]);
  });
  return { clock: ts.clock, gates };
}

/** Puts saved turnstiles back on `grid`; throws `Corrupt save: turnstiles` on a tile off the grid. */
export function restoreTurnstiles(grid: Grid, s: TurnstileSave): void {
  const ts = turnstilesFor(grid);
  ts.clock = s.clock;
  ts.nextFree.fill(-Infinity);
  for (const [i, t] of s.gates) {
    if (!Number.isInteger(i) || i < 0 || i >= ts.nextFree.length) throw new Error("Corrupt save: turnstiles");
    ts.nextFree[i] = t;
  }
}

/**
 * Real seconds to wait, from turnstile clock `now`, before stepping from tile `from` onto tile
 * `to`: 0 unless `to` is a gate being entered, else until GATE_INTERVAL_SEC has passed since its last entry.
 */
function gateWait(ts: Turnstiles, grid: Grid, from: number, to: number, now: number): number {
  if (to === from || grid.tiles[to] !== Tile.Gate) return 0;
  const wait = ts.nextFree[to]! - now;
  return wait > EPS_TIME ? wait : 0;
}

/** A step from tile `from` onto tile `to` at turnstile clock `now`: entering a gate starts its interval. */
function noteEntry(ts: Turnstiles, grid: Grid, from: number, to: number, now: number): void {
  if (to !== from && grid.tiles[to] === Tile.Gate) ts.nextFree[to] = now + GATE_INTERVAL_SEC;
}

/** True if a straight move from (ax, ay) to (bx, by) is open and needs no wait at a gate. */
function canMoveAs(ts: Turnstiles, grid: Grid, ax: number, ay: number, bx: number, by: number, now: number): boolean {
  if (!canMove(grid, ax, ay, bx, by)) return false;
  const from = Math.floor(ay) * grid.w + Math.floor(ax);
  return gateWait(ts, grid, from, Math.floor(by) * grid.w + Math.floor(bx), now) === 0;
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
 * Given `rng`, a field walker slowed below full speed (desperate) lurches to a random neighbouring
 * tile about DRIFT_PER_TILE of the tiles they walk, following the field otherwise.
 * A gate tile is a turnstile: it admits one person per GATE_INTERVAL_SEC, whoever is still on it.
 * Anyone it is not ready for waits at its edge, still counted in the crowd (that is the queue); on
 * it they walk at full speed, the crowd outside not slowing them.
 */
export function stepMovement(
  grid: Grid,
  fields: FieldCache,
  fieldTargets: (key: string) => readonly number[],
  people: PeopleStore,
  crowd: CrowdGrid,
  dtReal: number,
  rng?: Rng,
): number[] {
  const arrived: number[] = [];
  if (dtReal <= 0) return arrived;
  thunkTargets = fieldTargets;
  const counts = crowd.counts;
  const crowdAt = (n: number): number => counts[n]!;
  const w = grid.w;
  const { x, y, state, targetKey, speedMul, drift } = people;
  const ts = turnstilesFor(grid);

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
        if (canMoveAs(ts, grid, px, py, nx, ny, now)) {
          px = nx;
          py = ny;
        } else if (nx !== px && canMoveAs(ts, grid, px, py, nx, py, now)) {
          px = nx;
        } else if (ny !== py && canMoveAs(ts, grid, px, py, px, ny, now)) {
          py = ny;
        }
        time -= move / speed;
        tx = Math.floor(px);
        ty = Math.floor(py);
        noteEntry(ts, grid, here, ty * w + tx, now);
      }
    } else {
      thunkKey = key;
      const field = fields.get(key, targetsThunk);
      const drifts = rng !== undefined && speedMul[i]! < 1;
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
        const wait = gateWait(ts, grid, here, to, now);
        if (wait > 0) {
          // The turnstile is not ready: stand at its edge, giving up any lurch toward it, and step
          // through within this dt if its cadence comes round in time.
          drift[i] = -1;
          if (wait >= time) break;
          time -= wait;
          continue;
        }
        noteEntry(ts, grid, here, to, now);
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
