import { Grid, Tile, type Rect } from "../../src/sim/grid";
import { HARBOUR_STREET, type StationMap } from "../../src/sim/maps/harbourStreet";

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

/**
 * Counts distinct narrow gaps: a run of min..max non-obstacle tiles in a row or
 * column with obstacles at both ends. Runs repeating with the same extent on
 * consecutive lines are one gap.
 */
export function countNarrowGaps(map: StationMap, min: number, max: number): number {
  const blocked = new Uint8Array(map.w * map.h);
  for (const o of map.obstacles) for (const [x, y] of tilesOf(o.rect)) blocked[y * map.w + x] = 1;
  const at = (x: number, y: number) => blocked[y * map.w + x] === 1;
  const found = new Set<string>();
  let count = 0;
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
        if (start > 0 && p < len) {
          const run = p - start;
          if (run >= min && run <= max) {
            const key = `${horizontal ? "h" : "v"}:${start}:${run}:${line}`;
            const prev = `${horizontal ? "h" : "v"}:${start}:${run}:${line - 1}`;
            if (!found.has(prev)) count++;
            found.add(key);
          }
        }
        start = -1;
      }
    }
  };
  scan(true);
  scan(false);
  return count;
}
