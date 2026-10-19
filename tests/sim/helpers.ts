import { Grid, Tile, type Rect } from "../../src/sim/grid";
import { HARBOUR_STREET, type StationMap } from "../../src/sim/maps/harbourStreet";
import { SIM_DT } from "../../src/sim/constants";
import { step, type World } from "../../src/sim/world";

export type XY = [number, number];
const DIRS: XY[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function tilesOf(r: Rect): XY[] {
  const out: XY[] = [];
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) out.push([x, y]);
  return out;
}

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function entranceTiles(id: string, map: StationMap = HARBOUR_STREET): XY[] {
  const e = map.entrances.find((en) => en.id === id);
  if (!e) throw new Error(`no entrance ${id}`);
  return tilesOf(e.tiles);
}

export function platformTiles(slotId: number, map: StationMap = HARBOUR_STREET): XY[] {
  const s = map.slots.find((sl) => sl.id === slotId);
  if (!s) throw new Error(`no slot ${slotId}`);
  return tilesOf(s.platform);
}

/** BFS over walkable tiles (4-neighbour); true if any target is reached from any source. */
export function reachable(g: Grid, from: XY[], to: XY[]): boolean {
  const targets = new Set(to.map(([x, y]) => g.idx(x, y)));
  const seen = new Uint8Array(g.w * g.h);
  const queue: number[] = [];
  for (const [x, y] of from) {
    if (!g.isWalkable(x, y)) continue;
    const i = g.idx(x, y);
    seen[i] = 1;
    queue.push(i);
  }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head]!;
    if (targets.has(i)) return true;
    const [x, y] = g.xy(i);
    for (const [dx, dy] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!g.isWalkable(nx, ny)) continue;
      const ni = g.idx(nx, ny);
      if (seen[ni]) continue;
      seen[ni] = 1;
      queue.push(ni);
    }
  }
  return false;
}

export function fillGroundWithFloor(g: Grid): void {
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (g.tile(x, y) === Tile.Ground) g.setTile(x, y, Tile.Floor);
}

/** BFS shortest path (4-neighbour) over walkable tiles, or null. */
export function shortestPath(g: Grid, from: XY[], to: XY[]): XY[] | null {
  const targets = new Set(to.map(([x, y]) => g.idx(x, y)));
  const parent = new Int32Array(g.w * g.h).fill(-2);
  const queue: number[] = [];
  for (const [x, y] of from) {
    if (!g.isWalkable(x, y)) continue;
    const i = g.idx(x, y);
    parent[i] = -1;
    queue.push(i);
  }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head]!;
    if (targets.has(i)) {
      const path: XY[] = [];
      for (let c = i; c !== -1; c = parent[c]!) path.push(g.xy(c));
      return path.reverse();
    }
    const [x, y] = g.xy(i);
    for (const [dx, dy] of DIRS) {
      if (!g.isWalkable(x + dx, y + dy)) continue;
      const ni = g.idx(x + dx, y + dy);
      if (parent[ni] !== -2) continue;
      parent[ni] = i;
      queue.push(ni);
    }
  }
  return null;
}

/**
 * Narrow gaps: runs of min..max non-obstacle tiles in a row or column with
 * obstacles at both ends. A run repeating with the same extent on consecutive
 * lines is one gap (otherwise a 10-row-long channel would count 10 times).
 */
export function narrowGaps(map: StationMap, min: number, max: number): XY[][] {
  const blocked = new Uint8Array(map.w * map.h);
  for (const o of map.obstacles) for (const [x, y] of tilesOf(o.rect)) blocked[y * map.w + x] = 1;
  const at = (x: number, y: number) => blocked[y * map.w + x] === 1;
  const gaps: XY[][] = [];
  const open = new Map<string, XY[]>();
  const scan = (horizontal: boolean) => {
    const lines = horizontal ? map.h : map.w;
    const len = horizontal ? map.w : map.h;
    for (let line = 0; line < lines; line++) {
      let start = -1;
      for (let p = 0; p <= len; p++) {
        const b = p < len && (horizontal ? at(p, line) : at(line, p));
        if (p < len && !b) {
          if (start < 0) start = p;
          continue;
        }
        if (start > 0 && p < len && p - start >= min && p - start <= max) {
          const tag = `${horizontal ? "h" : "v"}:${start}:${p - start}`;
          const tiles: XY[] = [];
          for (let q = start; q < p; q++) tiles.push(horizontal ? [q, line] : [line, q]);
          const existing = open.get(`${tag}:${line - 1}`);
          if (existing) {
            existing.push(...tiles);
            open.set(`${tag}:${line}`, existing);
          } else {
            gaps.push(tiles);
            open.set(`${tag}:${line}`, tiles);
          }
        }
        start = -1;
      }
    }
  };
  scan(true);
  scan(false);
  return gaps;
}

export function countNarrowGaps(map: StationMap, min: number, max: number): number {
  return narrowGaps(map, min, max).length;
}

/** w x h grid of walkable floor. */
export function openFloor(w: number, h: number): Grid {
  const g = new Grid(w, h);
  fillGroundWithFloor(g);
  return g;
}

/** A 1-tile-high floor strip. */
export function strip(w: number): Grid {
  return openFloor(w, 1);
}

/** 7x3 floor with a wall at x=3 on rows 0 and 1, leaving a gap on row 2. */
export function corridorWithWall(): Grid {
  const g = openFloor(7, 3);
  g.setTile(3, 0, Tile.Wall);
  g.setTile(3, 1, Tile.Wall);
  return g;
}

/** Opens every closed slot in an island's gate line, so its foot is no bottleneck. */
export function openAllGates(w: World, islandId = 1): void {
  const line = w.map.islands[islandId - 1]!.gateLine;
  for (const [x, y] of tilesOf(line)) if (w.grid.tile(x, y) === Tile.GateClosed) w.grid.setTile(x, y, Tile.Gate);
}

/** Steps the world at SIM_DT until its clock has advanced by `minutes`. */
export function runMinutes(w: World, minutes: number): void {
  const until = w.minute + minutes;
  while (w.minute < until) step(w, SIM_DT);
}
