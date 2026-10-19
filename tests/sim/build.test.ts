import { expect, test } from "vitest";
import { applyPlacement, previewPlacement } from "../../src/sim/build";
import { PRICES, REMOVE_REFUND } from "../../src/sim/economy";
import { FacilityKind, tryJoin, Tenant } from "../../src/sim/facilities";
import { Dir, Grid, Tile, Zone, type Rect } from "../../src/sim/grid";
import { PState } from "../../src/sim/people";
import { createWorld, type World } from "../../src/sim/world";
import { entranceTiles, platformTiles, reachable, tilesOf, type XY } from "./helpers";

// Platform 1's foot row at the top of its apron: its only way down to the concourse.
function wallAcrossPlatformOneFoot(w: World): Rect {
  const foot = w.map.slots[0]!.foot;
  return { x: foot.x, y: foot.y, w: foot.w, h: 1 };
}

function person(w: World, x: number, y: number): number {
  const p = w.people;
  const i = p.alloc();
  p.x[i] = x + 0.5;
  p.y[i] = y + 0.5;
  p.state[i] = PState.Walking;
  p.goalKey[i] = "platform:1";
  p.targetKey[i] = "platform:1";
  p.deadline[i] = w.minute + 600;
  return i;
}

function tileAt(w: World, i: number): XY {
  return [Math.floor(w.people.x[i]!), Math.floor(w.people.y[i]!)];
}

const ALL_ENTRANCES = (): XY[] => [...entranceTiles("A"), ...entranceTiles("B"), ...entranceTiles("C")];

test("floor preview counts only ground tiles and prices them", () => {
  const w = createWorld(1);
  // Two of these tiles are St Mary's Church; (8, 61) sits next to the floor column at x 9.
  const rect = { x: 5, y: 61, w: 4, h: 2 };
  expect(tilesOf(rect).filter(([x, y]) => w.grid.tile(x, y) === Tile.Obstacle)).toHaveLength(2);
  const p = previewPlacement(w, "floor", rect);
  expect(p.tiles).toHaveLength(6);
  expect(p.blocked).toHaveLength(2);
  expect(p.cost).toBe(600);
  expect(p.valid).toBe(true);
  expect(p.reason).toBeNull();
});

test("floor must join existing floor", () => {
  const w = createWorld(1);
  const p = previewPlacement(w, "floor", { x: 20, y: 58, w: 2, h: 2 });
  expect(p.valid).toBe(false);
  expect(p.reason).toBe("Must join existing floor");
});

test("refuses a wall that cuts off a platform", () => {
  const w = createWorld(1);
  const p = previewPlacement(w, "wall", wallAcrossPlatformOneFoot(w));
  expect(p.valid).toBe(false);
  expect(p.reason).toBe("Would cut off Platform 1");
  const before = w.ledger.balance,
    v = w.grid.version;
  expect(applyPlacement(w, p)).toBe(false);
  expect(w.ledger.balance).toBe(before);
  expect(w.grid.version).toBe(v);
  expect(w.grid.tile(9, 54)).toBe(Tile.Floor);
});

test("moves people out of newly blocked tiles", () => {
  const w = createWorld(1);
  // A walkable pocket diagonally off the concourse corner, cut off from everything: the nearest
  // walkable tile to (15, 59) once the unit covers it, but not one anyone could walk out of.
  w.grid.setTile(16, 60, Tile.Floor);
  const i = person(w, 15, 59);
  const p = previewPlacement(w, "retail", { x: 14, y: 58, w: 2, h: 2 });
  expect(p.valid).toBe(true);
  expect(applyPlacement(w, p)).toBe(true);
  expect(w.grid.zone(15, 59)).toBe(Zone.Retail);
  const [x, y] = tileAt(w, i);
  expect(w.grid.isWalkable(x, y)).toBe(true);
  expect([x, y]).not.toEqual([16, 60]);
  expect(reachable(w.grid, ALL_ENTRANCES(), [[x, y]])).toBe(true);
  expect(Math.max(Math.abs(x - 15), Math.abs(y - 59))).toBe(2);
});

test("retail too small and off-floor are refused with reasons", () => {
  const w = createWorld(1);
  const small = previewPlacement(w, "retail", { x: 12, y: 57, w: 1, h: 2 });
  expect(small.valid).toBe(false);
  expect(small.reason).toBe("Too small");
  const ground = previewPlacement(w, "retail", { x: 20, y: 58, w: 2, h: 2 });
  expect(ground.valid).toBe(false);
  expect(ground.reason).toBe("Must be on plain floor");
});

test("a cost exactly equal to the balance is allowed", () => {
  const w = createWorld(1);
  w.ledger.balance = 600;
  const p = previewPlacement(w, "floor", { x: 5, y: 61, w: 4, h: 2 });
  expect(p.valid).toBe(true);
  expect(applyPlacement(w, p)).toBe(true);
  expect(w.ledger.balance).toBe(0);
});

test("a unit with no walkable tile beside it is refused", () => {
  const w = createWorld(1);
  // An island of floor walled in by ground on every side.
  for (const [x, y] of tilesOf({ x: 20, y: 58, w: 2, h: 2 })) w.grid.setTile(x, y, Tile.Floor);
  expect(previewPlacement(w, "retail", { x: 20, y: 58, w: 2, h: 2 }).reason).toBe("Needs a floor tile beside it");
});

test("nothing to remove and a blocked entrance are refused with reasons", () => {
  const w = createWorld(1);
  expect(previewPlacement(w, "remove", { x: 20, y: 58, w: 2, h: 2 }).reason).toBe("Nothing to remove here");
  // The starting floor between Market Place and the concourse is Entrance B's only way in.
  const p = previewPlacement(w, "remove", { x: 1, y: 55, w: 5, h: 3 });
  expect(p.valid).toBe(false);
  expect(p.reason).toBe("Would block Entrance B");
});

test("separate entrance-to-platform regions that already exist do not freeze building", () => {
  const w = createWorld(1);
  // Split the station in two: a wall across the top of the floor column cuts Harbour Road off from
  // the concourse, leaving Market Place with island 1 (both its platforms share one walkway).
  for (let x = 9; x <= 12; x++) w.grid.setTile(x, 60, Tile.Wall);
  expect(reachable(w.grid, entranceTiles("A"), platformTiles(1))).toBe(false);
  expect(reachable(w.grid, entranceTiles("A"), platformTiles(2))).toBe(false);
  expect(reachable(w.grid, entranceTiles("B"), platformTiles(1))).toBe(true);
  expect(reachable(w.grid, entranceTiles("B"), platformTiles(2))).toBe(true);
  // Joins the floor column below the wall, on Harbour Road's side.
  const p = previewPlacement(w, "floor", { x: 5, y: 61, w: 4, h: 2 });
  expect(p.reason).toBeNull();
  expect(p.valid).toBe(true);
  // Cutting Market Place's side is still refused.
  expect(previewPlacement(w, "wall", wallAcrossPlatformOneFoot(w)).reason).toBe("Would cut off Platform 1");
  expect(previewPlacement(w, "remove", { x: 1, y: 55, w: 5, h: 3 }).reason).toBe("Would cut off Platform 1");
});

test("a ring of walls closed round a queue sends the shopper back out", () => {
  const w = createWorld(1);
  // A floor bay east of the floor column, and a toilet in it.
  expect(applyPlacement(w, previewPlacement(w, "floor", { x: 13, y: 64, w: 7, h: 9 }))).toBe(true);
  expect(applyPlacement(w, previewPlacement(w, "toilet", { x: 16, y: 67, w: 2, h: 2 }))).toBe(true);
  const f = [...w.facilities.values()][0]!;
  const front = f.queueTiles[0]!;
  const [qx, qy] = w.grid.xy(front);
  const i = person(w, qx, qy);
  expect(tryJoin(w, f, i)).toBe(true);
  w.people.targetKey[i] = "";
  // Two wall placements: the first leaves a gap, the second closes the bay off.
  expect(applyPlacement(w, previewPlacement(w, "wall", { x: 13, y: 64, w: 1, h: 5 }))).toBe(true);
  expect(w.people.state[i]).toBe(PState.InQueue);
  expect(applyPlacement(w, previewPlacement(w, "wall", { x: 13, y: 69, w: 1, h: 4 }))).toBe(true);
  expect(reachable(w.grid, entranceTiles("A"), [[16, 66]])).toBe(false);
  expect(w.people.state[i]).toBe(PState.Walking);
  expect(f.queue).not.toContain(i);
  const at = tileAt(w, i);
  expect(reachable(w.grid, ALL_ENTRANCES(), [at])).toBe(true);
  expect(reachable(w.grid, [at], platformTiles(1))).toBe(true);
});

test("not enough money refuses", () => {
  const w = createWorld(1);
  w.ledger.balance = 50;
  const p = previewPlacement(w, "floor", { x: 5, y: 61, w: 4, h: 2 });
  expect(p.cost).toBe(600);
  expect(p.valid).toBe(false);
  expect(p.reason).toBe("Not enough money");
  expect(applyPlacement(w, p)).toBe(false);
  expect(w.ledger.balance).toBe(50);
});

test("remove refunds half and keeps platforms reachable", () => {
  const w = createWorld(1);
  const start = w.ledger.balance;
  const wall = previewPlacement(w, "wall", { x: 6, y: 58, w: 4, h: 1 });
  expect(wall.cost).toBe(80);
  expect(applyPlacement(w, wall)).toBe(true);
  expect(w.ledger.balance).toBe(start - 80);
  const rm = previewPlacement(w, "remove", { x: 6, y: 58, w: 4, h: 1 });
  expect(rm.cost).toBe(-40);
  expect(applyPlacement(w, rm)).toBe(true);
  expect(w.ledger.balance).toBe(start - 40);
  expect(w.ledger.today.removals).toBe(40);
  // The wall's tiles are plain floor again, not ground.
  expect(w.grid.tile(6, 58)).toBe(Tile.Floor);

  // Wall along island 1's foot but for its east end: the island's only way down is then (14, 56).
  expect(applyPlacement(w, previewPlacement(w, "wall", { x: 8, y: 55, w: 6, h: 1 }))).toBe(true);
  const cut = previewPlacement(w, "remove", { x: 12, y: 56, w: 4, h: 1 });
  expect(cut.valid).toBe(false);
  expect(cut.reason).toBe("Would cut off Platform 1");
});

test("previews never change the world", () => {
  const w = createWorld(1);
  const v = w.grid.version;
  const balance = w.ledger.balance;
  const tiles = w.grid.tiles.slice();
  const zones = w.grid.zones.slice();
  previewPlacement(w, "retail", { x: 12, y: 57, w: 2, h: 2 });
  previewPlacement(w, "remove", { x: 0, y: 0, w: 120, h: 90 });
  previewPlacement(w, "travelator", { x: 7, y: 58, w: 5, h: 1 }, { dir: Dir.E });
  previewPlacement(w, "wall", wallAcrossPlatformOneFoot(w));
  expect(w.grid.version).toBe(v);
  expect(w.ledger.balance).toBe(balance);
  expect(w.grid.tiles).toEqual(tiles);
  expect(w.grid.zones).toEqual(zones);
  expect(w.facilities.size).toBe(0);
});

test("a drag in any direction is normalised and clipped to the map", () => {
  const w = createWorld(1);
  const p = previewPlacement(w, "floor", { x: 9, y: 63, w: -4, h: -2 });
  expect(p.rect).toEqual({ x: 5, y: 61, w: 4, h: 2 });
  expect(p.tiles).toHaveLength(6);
  const edge = previewPlacement(w, "remove", { x: 118, y: 88, w: 10, h: 10 });
  expect(edge.rect).toEqual({ x: 118, y: 88, w: 2, h: 2 });
});

test("walls and rails need a line on plain floor", () => {
  const w = createWorld(1);
  expect(previewPlacement(w, "wall", { x: 6, y: 57, w: 2, h: 2 }).reason).toBe("Draw a line");
  const rail = previewPlacement(w, "rail", { x: 6, y: 58, w: 3, h: 1 });
  expect(rail.valid).toBe(true);
  expect(rail.cost).toBe(3 * PRICES.rail);
});

test("a travelator runs along its direction and sets it through the grid", () => {
  const w = createWorld(1);
  const line = { x: 9, y: 62, w: 1, h: 5 };
  expect(previewPlacement(w, "travelator", line).reason).toBe("Draw it along its direction");
  expect(previewPlacement(w, "travelator", line, { dir: Dir.E }).reason).toBe("Draw it along its direction");
  const p = previewPlacement(w, "travelator", line, { dir: Dir.S });
  expect(p.valid).toBe(true);
  expect(p.cost).toBe(5 * PRICES.travelator);
  const v = w.grid.version;
  expect(applyPlacement(w, p)).toBe(true);
  expect(w.grid.version).toBeGreaterThan(v);
  expect(w.grid.zone(9, 64)).toBe(Zone.Travelator);
  expect(w.grid.dir[w.grid.idx(9, 64)]).toBe(Dir.S);

  // Touching one tile takes the whole travelator up, refunding every tile of it.
  const rm = previewPlacement(w, "remove", { x: 9, y: 64, w: 1, h: 1 });
  expect(rm.tiles).toHaveLength(5);
  expect(rm.cost).toBe(-REMOVE_REFUND * 5 * PRICES.travelator);
  expect(applyPlacement(w, rm)).toBe(true);
  for (const [x, y] of tilesOf(line)) {
    expect(w.grid.zone(x, y)).toBe(Zone.None);
    expect(w.grid.dir[w.grid.idx(x, y)]).toBe(Dir.None);
    expect(w.grid.tile(x, y)).toBe(Tile.Floor);
  }
});

test("a travelator shorter than three tiles is refused", () => {
  const w = createWorld(1);
  expect(previewPlacement(w, "travelator", { x: 9, y: 62, w: 1, h: 2 }, { dir: Dir.S }).reason).toBe("Too short");
});

test("setDir bumps the grid version", () => {
  const g = new Grid(3, 3);
  const v = g.version;
  g.setDir(1, 1, Dir.W);
  expect(g.dir[g.idx(1, 1)]).toBe(Dir.W);
  expect(g.version).toBe(v + 1);
});

test("a sign needs a kind and one plain floor tile", () => {
  const w = createWorld(1);
  expect(previewPlacement(w, "sign", { x: 7, y: 57, w: 1, h: 1 }).reason).toBe("Choose a sign");
  expect(previewPlacement(w, "sign", { x: 7, y: 57, w: 2, h: 1 }, { signKind: "toilets" }).reason).toBe("Pick one tile");
  const p = previewPlacement(w, "sign", { x: 7, y: 57, w: 1, h: 1 }, { signKind: "toilets" });
  expect(p.valid).toBe(true);
  expect(p.cost).toBe(PRICES.sign);
  expect(applyPlacement(w, p)).toBe(true);
  expect(w.signs).toHaveLength(1);
  expect(w.signs[0]!.tile).toBe(w.grid.idx(7, 57));

  const toilet = previewPlacement(w, "toilet", { x: 12, y: 57, w: 2, h: 2 });
  expect(applyPlacement(w, toilet)).toBe(true);
  const id = [...w.facilities.keys()][0]!;
  expect(w.signs[0]!.pointsTo).toBe(id);

  const rm = previewPlacement(w, "remove", { x: 7, y: 57, w: 1, h: 1 });
  expect(rm.cost).toBe(-REMOVE_REFUND * PRICES.sign);
  expect(applyPlacement(w, rm)).toBe(true);
  expect(w.signs).toHaveLength(0);
  expect(w.grid.tile(7, 57)).toBe(Tile.Floor);
});

test("removing a facility frees its queue, clears its zone and refunds half its price", () => {
  const w = createWorld(1);
  expect(applyPlacement(w, previewPlacement(w, "toilet", { x: 12, y: 57, w: 2, h: 2 }))).toBe(true);
  const f = [...w.facilities.values()][0]!;
  expect(f.kind).toBe(FacilityKind.Toilet);
  const q = person(w, 6, 56);
  expect(tryJoin(w, f, q)).toBe(true);
  const balance = w.ledger.balance;
  // Touching one corner removes the whole unit.
  const rm = previewPlacement(w, "remove", { x: 13, y: 58, w: 1, h: 1 });
  expect(rm.cost).toBe(-REMOVE_REFUND * f.builtPrice);
  expect(applyPlacement(w, rm)).toBe(true);
  expect(w.facilities.size).toBe(0);
  expect(w.ledger.balance).toBe(balance + REMOVE_REFUND * f.builtPrice);
  for (const [x, y] of tilesOf(f.rect)) {
    expect(w.grid.zone(x, y)).toBe(Zone.None);
    expect(w.grid.tile(x, y)).toBe(Tile.Floor);
  }
  expect(w.people.state[q]).toBe(PState.Walking);
  expect(w.people.targetKey[q]).toBe("platform:1");
});

test("a build that shortens a queue line sends the queuers past its end on their way", () => {
  const w = createWorld(1);
  // A food unit in the concourse's south-west corner, its queue running east along the concourse.
  expect(applyPlacement(w, previewPlacement(w, "retail", { x: 6, y: 58, w: 2, h: 2 }))).toBe(true);
  const f = [...w.facilities.values()][0]!;
  f.tenant = Tenant.FoodDrink;
  f.tenantAt = -1;
  expect(f.queueTiles.length).toBeGreaterThan(4);
  const queuers = [0, 1, 2, 3, 4].map(() => person(w, 6, 59));
  for (const pid of queuers) expect(tryJoin(w, f, pid)).toBe(true);
  // A rail across the line after its third tile.
  const cutAt = f.queueTiles[3]!;
  const [cx, cy] = w.grid.xy(cutAt);
  const rail = previewPlacement(w, "rail", { x: cx, y: cy, w: 1, h: 1 });
  expect(rail.valid).toBe(true);
  expect(applyPlacement(w, rail)).toBe(true);
  expect(f.queueTiles).not.toContain(cutAt);
  for (const pid of f.queue) {
    const spot = Number(w.people.targetKey[pid]!.slice("spot:".length));
    expect(f.queueTiles).toContain(spot);
  }
  const left = queuers.filter((pid) => w.people.state[pid] === PState.Walking);
  expect(left.length).toBeGreaterThan(0);
  for (const pid of left) expect(w.people.targetKey[pid]).toBe("platform:1");
});

test("an unopened slot's track and platform are reserved; its foot takes floor only", () => {
  const w = createWorld(1);
  const slot3 = w.map.slots[2]!;
  const onPlatform = previewPlacement(w, "retail", { x: slot3.platform.x, y: slot3.platform.y + 10, w: 2, h: 2 });
  expect(onPlatform.valid).toBe(false);
  expect(onPlatform.reason).toBe("Reserved for a future platform");
  expect(previewPlacement(w, "floor", { x: slot3.track.x, y: slot3.track.y + 29, w: 1, h: 1 }).reason).toBe(
    "Reserved for a future platform",
  );

  const foot = previewPlacement(w, "floor", slot3.foot);
  expect(foot.valid).toBe(true);
  expect(applyPlacement(w, foot)).toBe(true);
  const shop = previewPlacement(w, "retail", { x: slot3.foot.x, y: slot3.foot.y, w: 2, h: 2 });
  expect(shop.valid).toBe(false);
  expect(shop.reason).toBe("Reserved for a future platform");
  expect(previewPlacement(w, "wall", { x: slot3.foot.x + 1, y: slot3.foot.y, w: 1, h: 2 }).reason).toBe(
    "Reserved for a future platform",
  );
});
