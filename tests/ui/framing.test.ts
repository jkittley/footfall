import { expect, test } from "vitest";
import { Tile } from "../../src/sim/grid";
import { createWorld } from "../../src/sim/world";
import { Camera } from "../../src/render/camera";
import { framingInsets, stationBounds } from "../../src/ui/framing";

test("the station is the floor and platforms, not lone entrance tiles", () => {
  const w = createWorld(1);
  const b = stationBounds(w.grid);
  expect(b).not.toBeNull();
  const r = b!;
  // Platforms 1 and 2 start at row 24; Entrance C sits alone at the far right.
  expect(r.y).toBe(24);
  expect(r.x + r.w).toBeLessThan(40);
  for (let y = 0; y < w.grid.h; y++) {
    for (let x = 0; x < w.grid.w; x++) {
      const t = w.grid.tiles[w.grid.idx(x, y)];
      if (t !== Tile.Floor && t !== Tile.Platform) continue;
      expect(x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h).toBe(true);
    }
  }
});

test("floorOnly leaves the platforms out", () => {
  const w = createWorld(1);
  const r = stationBounds(w.grid, true)!;
  expect(r.y).toBeGreaterThan(50);
  for (let x = r.x; x < r.x + r.w; x++) for (let y = r.y; y < r.y + r.h; y++) expect(w.grid.tiles[w.grid.idx(x, y)]).not.toBe(Tile.Platform);
});

test("built floor widens the bounds", () => {
  const w = createWorld(1);
  const before = stationBounds(w.grid)!;
  w.grid.setTile(60, 70, Tile.Floor);
  const after = stationBounds(w.grid)!;
  expect(after.x + after.w).toBe(61);
  expect(after.y).toBe(before.y);
});

test("the framed station leaves room for Entrance B's pill right of the rail", () => {
  const w = createWorld(1);
  const railRight = 112;
  const ins = framingInsets(railRight, 200);
  expect(ins.left).toBeGreaterThan(railRight);
  const cam = new Camera();
  cam.setBounds(w.grid.w, w.grid.h);
  cam.setViewport(1180, 1000);
  cam.setInsets(ins.left, ins.top, ins.right, ins.bottom);
  const r = stationBounds(w.grid)!;
  if (!cam.frame(r, 2, 1.5, 2)) cam.frame(stationBounds(w.grid, true)!, 2, 1.5, 2);
  // "Entrance B · Market Place" is about 190px wide at 12px, drawn 0.6 of a tile outside the map's left edge.
  const [mapLeft] = cam.worldToScreen(0, 0);
  expect(mapLeft - 0.6 * cam.scale - 200).toBeGreaterThan(railRight);
  expect(cam.zoom).toBeGreaterThanOrEqual(1.5);
});
