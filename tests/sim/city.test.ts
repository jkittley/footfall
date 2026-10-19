import { describe, expect, test } from "vitest";
import { previewPlacement } from "../../src/sim/build";
import { Tile } from "../../src/sim/grid";
import { CITY, flatten, rasterise, smoothPath, walkArea, type CityShape } from "../../src/sim/maps/city";
import { HARBOUR_STREET, buildGrid } from "../../src/sim/maps/harbourStreet";
import { createWorld } from "../../src/sim/world";
import { entranceTiles, isBarrier, st, tilesOf, type XY } from "./helpers";

function shape(name: string): CityShape {
  const s = CITY.shapes.find((sh) => sh.name === name);
  if (!s) throw new Error(`no shape ${name}`);
  return s;
}

/** Tiles of the city painted as `t` (in the plain city, before the station goes on). */
function count(t: Tile): number {
  return rasterise(CITY).tiles.filter((x) => x === t).length;
}

describe("the city map", () => {
  test("is 500 x 320 tiles with the station's 120 x 90 grounds at its origin", () => {
    expect([CITY.w, CITY.h]).toEqual([500, 320]);
    expect(CITY.station.grounds).toEqual({ x: CITY.station.origin[0], y: CITY.station.origin[1], w: 120, h: 90 });
    const g = buildGrid(HARBOUR_STREET, 2);
    expect([g.w, g.h]).toEqual([500, 320]);
  });

  test("water, parks, roads and locked sites are painted and none of them is walkable", () => {
    for (const t of [Tile.Water, Tile.Park, Tile.Road, Tile.Locked]) expect(count(t)).toBeGreaterThan(500);
    const g = buildGrid(HARBOUR_STREET, 2);
    for (let i = 0; i < g.tiles.length; i++) {
      if (!isBarrier(g.tiles[i] as Tile) || g.tiles[i] === Tile.Obstacle) continue;
      const [x, y] = g.xy(i);
      expect(g.isWalkable(x, y)).toBe(false);
    }
  });

  test("named places land on their own kind of tile", () => {
    const g = rasterise(CITY);
    expect(g.tile(290, 100)).toBe(Tile.Water); // the Ashby River beside the station
    expect(g.tile(60, 145)).toBe(Tile.Park); // St Mary's churchyard
    expect(g.tile(...st(105, 70))).toBe(Tile.Park); // Riverside Gardens
    expect(g.tile(50, 185)).toBe(Tile.Road); // Harbour Road
    expect(g.tile(128, 120)).toBe(Tile.Road); // Market Street
    expect(g.tile(400, 100)).toBe(Tile.Locked); // the airport
    expect(g.tile(180, 220)).toBe(Tile.Locked); // the bus depot, across Harbour Road
  });

  test("the footbridge is walkable pavement over the river, from Entrance C", () => {
    const g = buildGrid(HARBOUR_STREET, 2);
    const c = HARBOUR_STREET.entrances.find((e) => e.id === "C")!.tiles;
    let overWater = 0;
    for (let x = c.x + 1; g.tile(x, c.y) === Tile.Pavement; x++) {
      for (let y = c.y; y < c.y + c.h; y++) expect(g.isWalkable(x, y)).toBe(true);
      if (g.tile(x, c.y - 1) === Tile.Water && g.tile(x, c.y + c.h) === Tile.Water) overWater++;
    }
    expect(overWater).toBeGreaterThan(20);
  });

  test("Harbour Road crosses the river on a road bridge with a pavement either side", () => {
    const g = rasterise(CITY);
    const x = 290;
    const column = Array.from({ length: 20 }, (_, k) => g.tile(x, 196 + k));
    const road = column.map((t, k) => (t === Tile.Road ? k : -1)).filter((k) => k >= 0);
    expect(road.length).toBe(7);
    expect(column[road[0]! - 1]).toBe(Tile.Pavement);
    expect(column[road[road.length - 1]! + 1]).toBe(Tile.Pavement);
    expect(column[road[0]! - 2]).toBe(Tile.Water);
  });

  test("every later stage's site is locked, named and says when it opens", () => {
    const locked = CITY.shapes.filter((s) => s.kind === "locked").map((s) => [s.name, s.area]);
    expect(locked).toEqual([
      ["Airport", "Opens at 18 rail + 6 subway platforms"],
      ["Exhibition centre", "Opens at 24 airport gates"],
      ["Exhibition car park", "Opens at 24 airport gates"],
      ["Shopping mall", "Opens at 36 airport gates"],
      ["Bus depot", "Opens at 6 rail platforms"],
      ["Stadium", "Opens at 48 airport gates"],
      ["Stadium car park", "Opens at 48 airport gates"],
    ]);
    expect([CITY.subway.name, CITY.subway.area]).toEqual(["Subway (below)", "Opens at 10 rail platforms"]);
    const g = rasterise(CITY);
    for (const s of CITY.shapes.filter((sh) => sh.kind === "locked")) {
      const [x, y] = s.points.reduce(([ax, ay], [px, py]) => [ax + px / s.points.length, ay + py / s.points.length], [0, 0]);
      expect(g.tile(Math.floor(x), Math.floor(y)), s.name).toBe(Tile.Locked);
    }
    const copy = CITY.shapes.flatMap((s) => [s.name ?? "", s.area ?? ""]).join(" ");
    expect(copy).not.toMatch(/[–—]/);
  });

  test("floor can be built only on the station's grounds", () => {
    const w = createWorld(1);
    const [bx, by] = entranceTiles("B")[0]!;
    // Ground just outside the grounds, beside the Market Street pavement.
    const out = previewPlacement(w, "floor", { x: bx - 6, y: by - 4, w: 3, h: 3 });
    expect(out.valid).toBe(false);
    expect(out.reason).toBe("Outside the station grounds");
    expect(out.tiles).toHaveLength(0);
    // A drag that reaches over the edge builds only the part inside.
    const edge = previewPlacement(w, "floor", { x: bx - 2, y: by + 3, w: 4, h: 1 });
    expect(edge.tiles.every((i) => w.grid.xy(i)[0] >= HARBOUR_STREET.grounds.x)).toBe(true);
  });

  test("water, park, road and locked tiles take no build", () => {
    const w = createWorld(1);
    // Riverside Gardens, the river, Harbour Road (all in the grounds) and the bus depot (outside them).
    const depot: XY = [180, 220];
    for (const [x, y] of [st(105, 70), st(100, 40), st(20, 84), depot]) {
      expect([Tile.Park, Tile.Water, Tile.Road, Tile.Locked]).toContain(w.grid.tile(x, y));
      const p = previewPlacement(w, "floor", { x, y, w: 1, h: 1 });
      expect(p.valid).toBe(false);
      expect(p.blocked).toEqual([w.grid.idx(x, y)]);
    }
  });

  test("the walk area holds the grounds and the pavements off them, and nothing else walkable", () => {
    const a = walkArea();
    const r = CITY.station.grounds;
    expect(a.x).toBeLessThanOrEqual(r.x);
    expect(a.y).toBeLessThanOrEqual(r.y);
    expect(a.x + a.w).toBeGreaterThanOrEqual(r.x + r.w);
    const g = buildGrid(HARBOUR_STREET, 18);
    for (const s of CITY.shapes.filter((sh) => sh.kind === "pavement"))
      for (const [x, y] of tilesOf({ x: Math.min(...s.points.map((p) => p[0])), y: Math.min(...s.points.map((p) => p[1])), w: 1, h: 1 }))
        expect(x >= a.x && y >= a.y && x < a.x + a.w && y < a.y + a.h).toBe(true);
    // Floor anywhere on the grounds, and everyone reachable stays inside the area.
    for (const [x, y] of tilesOf(r)) if (g.tile(x, y) === Tile.Ground) g.setTile(x, y, Tile.Floor);
    const seen = new Uint8Array(g.w * g.h);
    const queue = entranceTiles("A").map(([x, y]) => g.idx(x, y));
    for (const i of queue) seen[i] = 1;
    for (let h = 0; h < queue.length; h++) {
      const [x, y] = g.xy(queue[h]!);
      expect(x >= a.x && y >= a.y && x < a.x + a.w && y < a.y + a.h).toBe(true);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        if (!g.isWalkable(x + dx, y + dy) || seen[g.idx(x + dx, y + dy)]) continue;
        seen[g.idx(x + dx, y + dy)] = 1;
        queue.push(g.idx(x + dx, y + dy));
      }
    }
  });

  test("smoothing keeps straight runs straight and a repeated point sharp", () => {
    const line = flatten(smoothPath([[0, 0], [5, 0], [10, 0], [10, 0], [10, 10]], false));
    for (const [, y] of line.filter(([x]) => x < 10)) expect(y).toBeCloseTo(0, 9);
    expect(line.some(([x, y]) => x === 10 && y === 0)).toBe(true);
    for (const [x] of line.filter(([, y]) => y > 0)) expect(x).toBeCloseTo(10, 9);
  });
});
