import { describe, expect, test } from "vitest";
import { Grid, Tile } from "../../src/sim/grid";
import { HARBOUR_STREET, buildGrid } from "../../src/sim/maps/harbourStreet";
import {
  OX,
  OY,
  countNarrowGaps,
  entranceTiles,
  fillGroundsWithFloor,
  overlaps,
  narrowGaps,
  platformTiles,
  reachable,
  shortestPath,
  st,
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
      const x0 = OX + 8 + 8 * (s.island - 1);
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
      const x0 = OX + 8 + 8 * (isl.id - 1);
      expect(isl.walkway).toEqual({ x: x0 + 1, y: OY + 24, w: 5, h: 30 });
      expect(isl.leftTrack).toEqual({ x: x0, y: OY + 24, w: 1, h: 30 });
      expect(isl.rightTrack).toEqual({ x: x0 + 6, y: OY + 24, w: 1, h: 30 });
      expect(isl.gateLine).toEqual({ x: x0 + 1, y: OY + 53, w: 5, h: 1 });
      const left = m.slots[2 * isl.id - 2]!;
      const right = m.slots[2 * isl.id - 1]!;
      expect(left).toMatchObject({ id: 2 * isl.id - 1, island: isl.id, side: "left", track: isl.leftTrack });
      expect(right).toMatchObject({ id: 2 * isl.id, island: isl.id, side: "right", track: isl.rightTrack });
    }
    const s3 = m.slots[2]!;
    expect(s3).toMatchObject({ island: 2, side: "left" });
    expect(s3.platform).toEqual({ x: OX + 16 + 1, y: OY + 24, w: 2, h: 30 });
    // The island field ends at station x 79, short of the goods shed.
    const last = m.islands[8]!;
    expect(last.foot.x + last.foot.w - 1).toBe(OX + 79);
  });

  test("islands 2..9 are all Ground in the starting grid and clear of obstacles and the city", () => {
    const g = buildGrid(HARBOUR_STREET, 2);
    for (const isl of HARBOUR_STREET.islands.slice(1)) {
      for (const r of [isl.walkway, isl.leftTrack, isl.rightTrack, isl.foot]) {
        for (const o of HARBOUR_STREET.obstacles) expect(overlaps(r, o.rect)).toBe(false);
        for (const [x, y] of tilesOf(r)) expect(g.tile(x, y)).toBe(Tile.Ground);
      }
    }
  });

  test("everything sits in the station grounds, obstacles disjoint from entrances and floor", () => {
    const m = HARBOUR_STREET;
    const all = [...m.obstacles.map((o) => o.rect), ...m.entrances.map((e) => e.tiles), ...m.startingFloor, ...m.slots.flatMap((s) => [s.track, s.platform, s.foot])];
    for (const r of all) {
      expect(r.x).toBeGreaterThanOrEqual(m.grounds.x);
      expect(r.y).toBeGreaterThanOrEqual(m.grounds.y);
      expect(r.x + r.w).toBeLessThanOrEqual(m.grounds.x + m.grounds.w);
      expect(r.y + r.h).toBeLessThanOrEqual(m.grounds.y + m.grounds.h);
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

  test("entrances: A Harbour Road (south), B Market Street (west), C Footbridge (east)", () => {
    const m = HARBOUR_STREET;
    const g = buildGrid(m, 2);
    const byId = new Map(m.entrances.map((e) => [e.id, e]));
    expect([...byId.values()].map((e) => [e.id, e.name, e.faces])).toEqual([
      ["A", "Harbour Road", "S"],
      ["B", "Market Street", "W"],
      ["C", "Footbridge", "E"],
    ]);
    const a = byId.get("A")!.tiles;
    const b = byId.get("B")!.tiles;
    const c = byId.get("C")!.tiles;
    // B and C sit on the grounds' west and east edges.
    expect(b.x).toBe(m.grounds.x);
    expect(c.x + c.w).toBe(m.grounds.x + m.grounds.w);
    // A pavement leads from A and B to their roads; from C, the footbridge runs out over the river.
    for (let x = a.x; x < a.x + a.w; x++) {
      let y = a.y + a.h;
      while (g.tile(x, y) === Tile.Pavement) y++;
      expect(y).toBeGreaterThan(a.y + a.h);
      expect(g.tile(x, y)).toBe(Tile.Road);
    }
    for (let y = b.y; y < b.y + b.h; y++) {
      let x = b.x - 1;
      while (g.tile(x, y) === Tile.Pavement) x--;
      expect(x).toBeLessThan(b.x - 1);
      expect(g.tile(x, y)).toBe(Tile.Road);
    }
    for (let y = c.y; y < c.y + c.h; y++) {
      let x = c.x + c.w;
      while (g.tile(x, y) === Tile.Pavement) x++;
      expect(x).toBeGreaterThan(c.x + c.w + 20);
    }
    expect(g.tile(c.x + 20, c.y - 1)).toBe(Tile.Water);
    expect(g.tile(c.x + 20, c.y + c.h)).toBe(Tile.Water);
  });

  test("blocking the neck between the river and Riverside Gardens cuts off the footbridge", () => {
    const g = buildGrid(HARBOUR_STREET, 18);
    fillGroundsWithFloor(g);
    expect(reachable(g, entranceTiles("A"), entranceTiles("C"))).toBe(true);
    for (let y = 56; y < 60; y++) for (let x = 96; x < 102; x++) g.setTile(...st(x, y), Tile.Obstacle);
    expect(reachable(g, entranceTiles("A"), entranceTiles("C"))).toBe(false);
  });

  test("the shortest route from A to C passes through at least 3 narrow gaps", () => {
    const g = buildGrid(HARBOUR_STREET, 18);
    fillGroundsWithFloor(g);
    const path = shortestPath(g, entranceTiles("A"), entranceTiles("C"));
    expect(path).not.toBeNull();
    const onPath = new Set(path!.map(([x, y]) => y * g.w + x));
    const used = narrowGaps(buildGrid(HARBOUR_STREET, 18), HARBOUR_STREET.grounds, 2, 4).filter((gap) =>
      gap.some(([x, y]) => onPath.has(y * g.w + x)),
    );
    expect(used.length).toBeGreaterThanOrEqual(3);
  });

  test("countNarrowGaps counts each gap once", () => {
    const area = { x: 0, y: 0, w: 40, h: 30 };
    const synth = (xs: number[]): Grid => {
      const g = new Grid(40, 30);
      for (const x of xs) for (let y = 10; y < 15; y++) for (let dx = 0; dx < 2; dx++) g.setTile(x + dx, y, Tile.Obstacle);
      return g;
    };
    expect(countNarrowGaps(synth([10, 15]), area, 2, 4)).toBe(1);
    expect(countNarrowGaps(synth([10, 15, 20]), area, 2, 4)).toBe(2);
    expect(countNarrowGaps(synth([10, 19]), area, 2, 4)).toBe(0);
    expect(countNarrowGaps(synth([10]), area, 2, 4)).toBe(0);
  });

  test("buildGrid paints only the platforms added", () => {
    const g = buildGrid(HARBOUR_STREET, 2);
    expect(g.tile(HARBOUR_STREET.slots[0]!.track.x, OY + 30)).toBe(Tile.Track);
    expect(g.tile(HARBOUR_STREET.slots[1]!.platform.x, OY + 30)).toBe(Tile.Platform);
    expect(g.tile(HARBOUR_STREET.slots[2]!.platform.x, OY + 30)).toBe(Tile.Ground);
  });

  test("starting grid connects entrances A and B to platforms 1 and 2", () => {
    const g = buildGrid(HARBOUR_STREET, 2);
    expect(reachable(g, entranceTiles("A"), platformTiles(1))).toBe(true);
    expect(reachable(g, entranceTiles("B"), platformTiles(2))).toBe(true);
    expect(reachable(g, entranceTiles("A"), platformTiles(3))).toBe(false);
    expect(reachable(g, entranceTiles("A"), entranceTiles("C"))).toBe(false);
  });

  test("every slot and entrance is reachable if all the station's ground were floor", () => {
    const g = buildGrid(HARBOUR_STREET, 18);
    fillGroundsWithFloor(g);
    for (const s of HARBOUR_STREET.slots) expect(reachable(g, entranceTiles("A"), tilesOf(s.platform))).toBe(true);
    expect(reachable(g, entranceTiles("A"), entranceTiles("C"))).toBe(true);
    expect(reachable(g, entranceTiles("A"), entranceTiles("B"))).toBe(true);
  });

  test("has at least 10 obstacles and 3 narrow gaps", () => {
    expect(HARBOUR_STREET.obstacles.length).toBeGreaterThanOrEqual(10);
    expect(countNarrowGaps(buildGrid(HARBOUR_STREET, 2), HARBOUR_STREET.grounds, 2, 4)).toBeGreaterThanOrEqual(3);
  });
});
