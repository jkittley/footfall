import { Dir, Grid, Tile, Zone } from "./grid";
import {
  DENSITY_WEIGHT,
  GAME_MIN_PER_REAL_SEC,
  SEATING_COST,
  TRAVELATOR_COST,
  WALK_TILES_PER_SEC,
} from "./constants";

const SQRT2 = Math.SQRT2;
const NDX = [1, -1, 0, 0, 1, 1, -1, -1];
const NDY = [0, 0, 1, -1, 1, -1, 1, -1];
// Direction vectors indexed by Dir (N, E, S, W).
const DIR_DX = [0, 1, 0, -1];
const DIR_DY = [-1, 0, 1, 0];

/** Cost of moving one step from `from` to the adjacent tile `to`. */
export function stepCost(grid: Grid, from: number, to: number): number {
  const fx = from % grid.w;
  const fy = (from - fx) / grid.w;
  const tx = to % grid.w;
  const ty = (to - tx) / grid.w;
  const dx = tx - fx;
  const dy = ty - fy;
  let cost = dx !== 0 && dy !== 0 ? SQRT2 : 1;
  if (grid.zones[to] === Zone.Seating) cost *= SEATING_COST;
  if (grid.zones[to] === Zone.Travelator && grid.dir[to] !== Dir.None) {
    if (dx * DIR_DX[grid.dir[to]!]! + dy * DIR_DY[grid.dir[to]!]! < 0) return Infinity;
  }
  if (grid.zones[from] === Zone.Travelator && grid.dir[from] !== Dir.None) {
    const dot = dx * DIR_DX[grid.dir[from]!]! + dy * DIR_DY[grid.dir[from]!]!;
    if (dot < 0) return Infinity;
    if (dot > 0) cost *= TRAVELATOR_COST;
  }
  return cost;
}

/**
 * True if a step (dx, dy) from (x, y) lands on a walkable tile without cutting a corner. Gates are
 * walked straight through: no diagonal step touches one and nobody steps from one gate to the next,
 * so every crossing is one entry through one turnstile.
 */
function canStep(grid: Grid, x: number, y: number, dx: number, dy: number): boolean {
  if (!grid.isWalkable(x + dx, y + dy)) return false;
  if (grid.tile(x, y) === Tile.Gate && grid.tile(x + dx, y + dy) === Tile.Gate) return false;
  if (dx !== 0 && dy !== 0) {
    return grid.isWalkable(x + dx, y) && grid.isWalkable(x, y + dy) && !diagonalTouchesGate(grid, x, y, x + dx, y + dy);
  }
  return true;
}

/** True if any of the four tiles a diagonal step from (fx, fy) to (tx, ty) touches is a gate. */
export function diagonalTouchesGate(grid: Grid, fx: number, fy: number, tx: number, ty: number): boolean {
  const g = Tile.Gate;
  return grid.tile(fx, fy) === g || grid.tile(tx, ty) === g || grid.tile(tx, fy) === g || grid.tile(fx, ty) === g;
}

// Shared binary min-heap (lazy deletion) over typed arrays; grown on demand, never shrunk.
let heapKey = new Float32Array(4096);
let heapVal = new Int32Array(4096);
let heapSize = 0;

function heapPush(key: number, val: number): void {
  if (heapSize === heapKey.length) {
    const k = new Float32Array(heapSize * 2);
    k.set(heapKey);
    heapKey = k;
    const v = new Int32Array(heapSize * 2);
    v.set(heapVal);
    heapVal = v;
  }
  let i = heapSize++;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (heapKey[p]! <= key) break;
    heapKey[i] = heapKey[p]!;
    heapVal[i] = heapVal[p]!;
    i = p;
  }
  heapKey[i] = key;
  heapVal[i] = val;
}

/** Pops the minimum into popKey/popVal. */
let popKey = 0;
let popVal = 0;
function heapPop(): void {
  popKey = heapKey[0]!;
  popVal = heapVal[0]!;
  const key = heapKey[--heapSize]!;
  const val = heapVal[heapSize]!;
  let i = 0;
  for (;;) {
    let c = 2 * i + 1;
    if (c >= heapSize) break;
    if (c + 1 < heapSize && heapKey[c + 1]! < heapKey[c]!) c++;
    if (heapKey[c]! >= key) break;
    heapKey[i] = heapKey[c]!;
    heapVal[i] = heapVal[c]!;
    i = c;
  }
  heapKey[i] = key;
  heapVal[i] = val;
}

/** Walking distance (in tiles) from every tile to the nearest target; Infinity if unreachable. */
export function computeField(grid: Grid, targets: readonly number[]): Float32Array {
  const field = new Float32Array(grid.w * grid.h).fill(Infinity);
  heapSize = 0;
  for (const t of targets) {
    if (t < 0 || t >= field.length || field[t] === 0) continue;
    field[t] = 0;
    heapPush(0, t);
  }
  while (heapSize > 0) {
    heapPop();
    const b = popVal;
    const d = popKey;
    if (d > field[b]!) continue;
    const bx = b % grid.w;
    const by = (b - bx) / grid.w;
    for (let k = 0; k < 8; k++) {
      const dx = NDX[k]!;
      const dy = NDY[k]!;
      // Step a -> b is (-dx, -dy) from a = b + (dx, dy); corner rule is symmetric.
      const ax = bx + dx;
      const ay = by + dy;
      if (!canStep(grid, ax, ay, -dx, -dy)) continue;
      if (!grid.isWalkable(ax, ay)) continue;
      const a = ay * grid.w + ax;
      const nd = d + stepCost(grid, a, b);
      if (nd < field[a]!) {
        field[a] = nd;
        heapPush(nd, a);
      }
    }
  }
  return field;
}

/**
 * The neighbour of (x, y) to step to, minimising remaining distance plus a crowd penalty.
 * Returns -1 when no neighbour has a finite route.
 */
export function bestNeighbour(
  grid: Grid,
  field: Float32Array,
  x: number,
  y: number,
  crowdAt?: (i: number) => number,
  densityWeight: number = DENSITY_WEIGHT,
): number {
  const here = y * grid.w + x;
  let best = -1;
  let bestScore = Infinity;
  for (let k = 0; k < 8; k++) {
    const dx = NDX[k]!;
    const dy = NDY[k]!;
    if (!canStep(grid, x, y, dx, dy)) continue;
    const n = (y + dy) * grid.w + x + dx;
    let score = field[n]! + stepCost(grid, here, n);
    if (crowdAt) score += densityWeight * crowdAt(n);
    if (score < bestScore) {
      bestScore = score;
      best = n;
    }
  }
  return best;
}

/**
 * The tile a walker at (x, y) actually steps to: bestNeighbour's crowd-weighted choice, unless that
 * would not get closer to the target, in which case the plain shortest-route neighbour. Crowding may
 * divert a walker sideways but never back, since a retreat would be undone next step and leave it
 * ping-ponging at the crowd's edge. Returns -1 when no neighbour has a finite route.
 */
export function nextStep(
  grid: Grid,
  field: Float32Array,
  x: number,
  y: number,
  crowdAt?: (i: number) => number,
  densityWeight: number = DENSITY_WEIGHT,
): number {
  const n = bestNeighbour(grid, field, x, y, crowdAt, densityWeight);
  if (n < 0 || !crowdAt || field[n]! < field[y * grid.w + x]!) return n;
  return bestNeighbour(grid, field, x, y);
}

export function walkMinutes(field: Float32Array, tile: number): number {
  return (field[tile]! / WALK_TILES_PER_SEC) * GAME_MIN_PER_REAL_SEC;
}

/** Caches fields per key for one grid; a key recomputes when that grid's version has moved. */
export class FieldCache {
  private readonly entries = new Map<string, { version: number; field: Float32Array }>();
  constructor(private readonly grid: Grid) {}

  get(key: string, targets: () => readonly number[]): Float32Array {
    const hit = this.entries.get(key);
    if (hit && hit.version === this.grid.version) return hit.field;
    const field = computeField(this.grid, targets());
    this.entries.set(key, { version: this.grid.version, field });
    return field;
  }
}
