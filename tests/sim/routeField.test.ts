import { describe, expect, test } from "vitest";
import { Dir, Tile, Zone } from "../../src/sim/grid";
import { DENSITY_WEIGHT, GAME_MIN_PER_REAL_SEC, WALK_TILES_PER_SEC } from "../../src/sim/constants";
import { FieldCache, bestNeighbour, computeField, nextStep, walkMinutes } from "../../src/sim/routeField";
import { corridorWithWall, openFloor, strip } from "./helpers";

describe("route fields", () => {
  test("distance grows away from the target and walls are routed around", () => {
    const g = corridorWithWall();
    const f = computeField(g, [g.idx(6, 0)]);
    expect(f[g.idx(6, 0)]).toBe(0);
    expect(f[g.idx(0, 0)]).toBeGreaterThan(6);
    expect(f[g.idx(3, 0)]).toBe(Infinity);
  });

  test("travelator is cheap one way and impassable the other", () => {
    const g = strip(10);
    for (let x = 2; x < 8; x++) {
      g.setZone(x, 0, Zone.Travelator, -1);
      g.dir[g.idx(x, 0)] = Dir.E;
    }
    const east = computeField(g, [g.idx(9, 0)]);
    const west = computeField(g, [g.idx(0, 0)]);
    expect(east[g.idx(0, 0)]).toBeLessThan(9);
    expect(west[g.idx(9, 0)]).toBe(Infinity);
  });

  test("bestNeighbour steps around a crowded tile when density weight is high", () => {
    const g = openFloor(5, 3);
    const f = computeField(g, [g.idx(4, 1)]);
    const crowd = (i: number) => (i === g.idx(1, 1) ? 10 : 0);
    expect(bestNeighbour(g, f, 0, 1, crowd, DENSITY_WEIGHT)).not.toBe(g.idx(1, 1));
  });

  test("cache recomputes after the grid changes", () => {
    const g = openFloor(5, 1);
    const c = new FieldCache(g);
    const a = c.get("t", () => [g.idx(4, 0)]);
    expect(c.get("t", () => [g.idx(4, 0)])).toBe(a);
    g.setTile(2, 0, Tile.Wall);
    const b = c.get("t", () => [g.idx(4, 0)]);
    expect(b[g.idx(0, 0)]).toBe(Infinity);
    expect(a).not.toBe(b);
  });

  test("diagonals cost sqrt2 and cannot cut a wall corner", () => {
    const g = openFloor(3, 3);
    expect(computeField(g, [g.idx(2, 2)])[g.idx(0, 0)]).toBeCloseTo(2 * Math.SQRT2, 5);
    g.setTile(1, 0, Tile.Wall);
    const f = computeField(g, [g.idx(2, 0)]);
    // (0,0) -> (0,1) -> (1,1) -> (2,1) -> (2,0): the diagonal (1,1)->(2,0) would cut the wall corner.
    expect(f[g.idx(0, 0)]).toBeCloseTo(4, 5);
  });

  test("seating tiles cost extra to cross", () => {
    const g = strip(3);
    g.setZone(1, 0, Zone.Seating, 0);
    expect(computeField(g, [g.idx(2, 0)])[g.idx(0, 0)]).toBe(3 + 1);
  });

  test("walkMinutes converts distance with the time constants", () => {
    const f = new Float32Array([5]);
    expect(walkMinutes(f, 0)).toBeCloseTo((5 / WALK_TILES_PER_SEC) * GAME_MIN_PER_REAL_SEC, 5);
  });

  test("large open grid computes quickly", () => {
    const g = openFloor(200, 120);
    const t = performance.now();
    const f = computeField(g, [g.idx(100, 60)]);
    expect(performance.now() - t).toBeLessThan(250);
    expect(Number.isFinite(f[g.idx(0, 0)]!)).toBe(true);
  });

  test("crowd-weighted nextStep never steps to a tile further from the target", () => {
    const g = corridorWithWall();
    const f = computeField(g, [g.idx(6, 0)]);
    // Heavy crowding everywhere except a few tiles, so the crowd-weighted pick would often retreat.
    const crowd = new Uint16Array(g.w * g.h);
    for (let i = 0; i < crowd.length; i++) crowd[i] = (i * 7) % 5 === 0 ? 0 : 4;
    const crowdAt = (i: number) => crowd[i]!;
    let retreatsAvoided = 0;
    for (let y = 0; y < g.h; y++) {
      for (let x = 0; x < g.w; x++) {
        const here = g.idx(x, y);
        if (!g.isWalkable(x, y) || f[here] === 0) continue;
        const n = nextStep(g, f, x, y, crowdAt);
        expect(n).toBeGreaterThanOrEqual(0);
        expect(f[n]!).toBeLessThan(f[here]!);
        const greedy = bestNeighbour(g, f, x, y, crowdAt);
        if (f[greedy]! >= f[here]!) retreatsAvoided++;
      }
    }
    // The setup really does tempt bestNeighbour into retreating somewhere.
    expect(retreatsAvoided).toBeGreaterThan(0);
  });

  test("nextStep still diverts around a crowded tile when a closer one is free", () => {
    const g = openFloor(5, 3);
    const f = computeField(g, [g.idx(4, 1)]);
    const crowdAt = (i: number) => (i === g.idx(2, 1) ? 10 : 0);
    const n = nextStep(g, f, 1, 1, crowdAt);
    expect(n).not.toBe(g.idx(2, 1));
    expect(f[n]!).toBeLessThan(f[g.idx(1, 1)]!);
  });
});
