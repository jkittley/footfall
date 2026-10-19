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
      const x0 = 8 + 8 * (s.island - 1);
      const left = s.side === "left";
      expect(s.track).toMatchObject({ x: left ? x0 : x0 + 6, w: 1, h: 30 });
      // Each half is the edge column beside its track and one column in; x0 + 3 is shared.
      expect(s.platform).toMatchObject({ x: left ? x0 + 1 : x0 + 4, w: 2, h: 30, y: s.track.y });
      expect(s.foot).toEqual(HARBOUR_STREET.islands[s.island - 1]!.foot);
      expect(s.foot).toMatchObject({ x: x0, w: 8, y: s.track.y + 30 });
    }
  });

  test("9 islands, 18 slots, slot 2i-1 left and 2i right of island i", () => {
    const m = HARBOUR_STREET;
    expect(m.islands).toHaveLength(9);
    expect(m.slots).toHaveLength(18);
    for (const isl of m.islands) {
      const x0 = 8 + 8 * (isl.id - 1);
      expect(isl.walkway).toEqual({ x: x0 + 1, y: 24, w: 5, h: 30 });
      expect(isl.leftTrack).toEqual({ x: x0, y: 24, w: 1, h: 30 });
      expect(isl.rightTrack).toEqual({ x: x0 + 6, y: 24, w: 1, h: 30 });
      expect(isl.gateLine).toEqual({ x: x0 + 1, y: 53, w: 5, h: 1 });
      const left = m.slots[2 * isl.id - 2]!;
      const right = m.slots[2 * isl.id - 1]!;
      expect(left).toMatchObject({ id: 2 * isl.id - 1, island: isl.id, side: "left", track: isl.leftTrack });
      expect(right).toMatchObject({ id: 2 * isl.id, island: isl.id, side: "right", track: isl.rightTrack });
    }
    const s3 = m.slots[2]!;
    expect(s3).toMatchObject({ island: 2, side: "left" });
    expect(s3.platform).toEqual({ x: 16 + 1, y: 24, w: 2, h: 30 });
    // The island field ends at x 79, short of the goods shed.
    const last = m.islands[8]!;
    expect(last.foot.x + last.foot.w - 1).toBe(79);
  });

  test("islands 2..9 are all Ground in the starting grid and clear of obstacles", () => {
    const g = buildGrid(HARBOUR_STREET, 2);
    for (const isl of HARBOUR_STREET.islands.slice(1)) {
      for (const r of [isl.walkway, isl.leftTrack, isl.rightTrack, isl.foot]) {
        for (const o of HARBOUR_STREET.obstacles) expect(overlaps(r, o.rect)).toBe(false);
        for (const [x, y] of tilesOf(r)) expect(g.tile(x, y)).toBe(Tile.Ground);
      }
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
