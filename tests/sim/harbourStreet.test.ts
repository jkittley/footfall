import { describe, expect, test } from "vitest";
import { Tile } from "../../src/sim/grid";
import { HARBOUR_STREET, buildGrid } from "../../src/sim/maps/harbourStreet";
import {
  countNarrowGaps,
  entranceTiles,
  fillGroundWithFloor,
  overlaps,
  narrowGaps,
  platformTiles,
  reachable,
  shortestPath,
  tilesOf,
} from "./helpers";

describe("Harbour Street", () => {
  test("has 18 slots that never overlap obstacles", () => {
    expect(HARBOUR_STREET.slots).toHaveLength(18);
    for (const s of HARBOUR_STREET.slots)
      for (const o of HARBOUR_STREET.obstacles)
        for (const r of [s.track, s.platform, s.foot]) expect(overlaps(r, o.rect)).toBe(false);
  });

  test("slot geometry follows the layout rules", () => {
    for (const s of HARBOUR_STREET.slots) {
      const x = 8 + 4 * (s.id - 1);
      expect(s.track).toMatchObject({ x, w: 1, h: 30 });
      expect(s.platform).toMatchObject({ x: x + 1, w: 2, h: 30, y: s.track.y });
      expect(s.foot.y).toBe(s.track.y + 30);
    }
  });

  test("everything sits in bounds, obstacles disjoint from entrances and floor", () => {
    const m = HARBOUR_STREET;
    const all = [...m.obstacles.map((o) => o.rect), ...m.entrances.map((e) => e.tiles), ...m.startingFloor, ...m.slots.flatMap((s) => [s.track, s.platform, s.foot])];
    for (const r of all) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(m.w);
      expect(r.y + r.h).toBeLessThanOrEqual(m.h);
    }
    for (const o of m.obstacles)
      for (const r of [...m.entrances.map((e) => e.tiles), ...m.startingFloor]) expect(overlaps(o.rect, r)).toBe(false);
  });

  test("slots 3 to 18 are entirely Ground in the starting grid", () => {
    const g = buildGrid(HARBOUR_STREET, 2);
    for (const s of HARBOUR_STREET.slots.slice(2))
      for (const r of [s.track, s.platform, s.foot])
        for (const [x, y] of tilesOf(r)) expect(g.tile(x, y)).toBe(Tile.Ground);
  });

  test("blocking the canal crossing cuts off Quay Lane", () => {
    const g = buildGrid(HARBOUR_STREET, 18);
    fillGroundWithFloor(g);
    expect(reachable(g, entranceTiles("A"), entranceTiles("C"))).toBe(true);
    for (let y = 56; y < 60; y++) for (let x = 96; x < 102; x++) g.setTile(x, y, Tile.Obstacle);
    expect(reachable(g, entranceTiles("A"), entranceTiles("C"))).toBe(false);
  });

  test("the shortest route from A to C passes through at least 3 narrow gaps", () => {
    const g = buildGrid(HARBOUR_STREET, 18);
    fillGroundWithFloor(g);
    const path = shortestPath(g, entranceTiles("A"), entranceTiles("C"));
    expect(path).not.toBeNull();
    const onPath = new Set(path!.map(([x, y]) => y * g.w + x));
    const used = narrowGaps(HARBOUR_STREET, 2, 4).filter((gap) => gap.some(([x, y]) => onPath.has(y * g.w + x)));
    expect(used.length).toBeGreaterThanOrEqual(3);
  });

  test("countNarrowGaps counts each gap once", () => {
    const rect = (x: number) => ({ x, y: 10, w: 2, h: 5 });
    const synth = (xs: number[]) => ({ ...HARBOUR_STREET, obstacles: xs.map((x) => ({ name: "b", rect: rect(x) })) });
    expect(countNarrowGaps(synth([10, 15]), 2, 4)).toBe(1);
    expect(countNarrowGaps(synth([10, 15, 20]), 2, 4)).toBe(2);
    expect(countNarrowGaps(synth([10, 19]), 2, 4)).toBe(0);
    expect(countNarrowGaps(synth([10]), 2, 4)).toBe(0);
  });

  test("buildGrid paints only the platforms added", () => {
    const g = buildGrid(HARBOUR_STREET, 2);
    expect(g.tile(HARBOUR_STREET.slots[0]!.track.x, 30)).toBe(Tile.Track);
    expect(g.tile(HARBOUR_STREET.slots[1]!.platform.x, 30)).toBe(Tile.Platform);
    expect(g.tile(HARBOUR_STREET.slots[2]!.platform.x, 30)).toBe(Tile.Ground);
  });

  test("starting grid connects entrances A and B to platforms 1 and 2", () => {
    const g = buildGrid(HARBOUR_STREET, 2);
    expect(reachable(g, entranceTiles("A"), platformTiles(1))).toBe(true);
    expect(reachable(g, entranceTiles("B"), platformTiles(2))).toBe(true);
    expect(reachable(g, entranceTiles("A"), platformTiles(3))).toBe(false);
    expect(reachable(g, entranceTiles("A"), entranceTiles("C"))).toBe(false);
  });

  test("every slot and entrance is reachable if all ground were floor", () => {
    const g = buildGrid(HARBOUR_STREET, 18);
    fillGroundWithFloor(g);
    for (const s of HARBOUR_STREET.slots) expect(reachable(g, entranceTiles("A"), tilesOf(s.platform))).toBe(true);
    expect(reachable(g, entranceTiles("A"), entranceTiles("C"))).toBe(true);
    expect(reachable(g, entranceTiles("A"), entranceTiles("B"))).toBe(true);
  });

  test("has at least 10 obstacles and 3 narrow gaps", () => {
    expect(HARBOUR_STREET.obstacles.length).toBeGreaterThanOrEqual(10);
    expect(countNarrowGaps(HARBOUR_STREET, 2, 4)).toBeGreaterThanOrEqual(3);
  });
});
