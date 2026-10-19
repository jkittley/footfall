import { expect, test } from "vitest";
import { Grid, Tile, Zone } from "../../src/sim/grid";

test("floor is walkable, retail zone is not, seating is", () => {
  const g = new Grid(4, 1);
  for (let x = 0; x < 4; x++) g.setTile(x, 0, Tile.Floor);
  g.setZone(1, 0, Zone.Retail, 3); g.setZone(2, 0, Zone.Seating, 4);
  expect([0, 1, 2, 3].map((x) => g.isWalkable(x, 0))).toEqual([true, false, true, true]);
});
test("mutations bump version", () => {
  const g = new Grid(2, 2); const v = g.version; g.setTile(0, 0, Tile.Floor);
  expect(g.version).toBeGreaterThan(v);
});
test("obstacles, walls, rails, track and ground are not walkable", () => {
  const g = new Grid(5, 1);
  [Tile.Obstacle, Tile.Wall, Tile.Rail, Tile.Track, Tile.Ground].forEach((t, x) => g.setTile(x, 0, t));
  expect([0, 1, 2, 3, 4].some((x) => g.isWalkable(x, 0))).toBe(false);
});
