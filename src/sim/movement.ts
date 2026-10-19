import { Dir, Grid, Zone } from "./grid";
import { DRIFT_PER_TILE, TRAVELATOR_COST, WALK_TILES_PER_SEC } from "./constants";
import { CrowdGrid, speedFactor } from "./crowd";
import { PState, type PeopleStore } from "./people";
import type { Rng } from "./rng";
import { nextStep, type FieldCache } from "./routeField";

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
  if (tx !== fx && ty !== fy) return grid.isWalkable(tx, fy) && grid.isWalkable(fx, ty);
  return true;
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

    const base = WALK_TILES_PER_SEC * speedFactor(crowd.density(tx, ty)) * speedMul[i]!;
    if (!(base > 0)) continue;
    const maxIter = 4 * Math.ceil((dtReal * base) / TRAVELATOR_COST / MAX_SUBSTEP) + 4;
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
        const speed = riding(grid, ty * w + tx, dx, dy) ? base / TRAVELATOR_COST : base;
        const move = Math.min(MAX_SUBSTEP, speed * time, dist);
        const nx = Math.fround(px + (dx / dist) * move);
        const ny = Math.fround(py + (dy / dist) * move);
        if (canMove(grid, px, py, nx, ny)) {
          px = nx;
          py = ny;
        } else if (nx !== px && canMove(grid, px, py, nx, py)) {
          px = nx;
        } else if (ny !== py && canMove(grid, px, py, px, ny)) {
          py = ny;
        }
        time -= move / speed;
        tx = Math.floor(px);
        ty = Math.floor(py);
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
        const speed = riding(grid, here, nx - tx, ny - ty) ? base / TRAVELATOR_COST : base;
        const move = Math.min(MAX_SUBSTEP, speed * time, dist);
        px = Math.fround(px + (dx / dist) * move);
        py = Math.fround(py + (dy / dist) * move);
        time -= move / speed;
        tx = Math.floor(px);
        ty = Math.floor(py);
        if (drifts && drift[i]! < 0 && rng.next() < move * DRIFT_PER_TILE) drift[i] = randomNeighbour(grid, tx, ty, rng);
      }
    }
    x[i] = px;
    y[i] = py;
  }
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
