import { describe, expect, test } from "vitest";
import { Tile } from "../../src/sim/grid";
import { HARBOUR_STREET, buildGrid } from "../../src/sim/maps/harbourStreet";
import {
  countNarrowGaps,
  entranceTiles,
  fillGroundWithFloor,
  overlaps,
  platformTiles,
  reachable,
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
