import { expect, test } from "vitest";
import { DESPERATE_AFTER_MIN, SIM_DT } from "../../src/sim/constants";
import { FacilityKind, TENANTS, Tenant, createFacility, tryJoin, type Facility } from "../../src/sim/facilities";
import { Tile, type Rect } from "../../src/sim/grid";
import { stepMovement } from "../../src/sim/movement";
import { addSign, refreshSigns } from "../../src/sim/needs";
import { NEED_COUNT, Need, PState, PeopleStore } from "../../src/sim/people";
import { Rng } from "../../src/sim/rng";
import { CrowdGrid } from "../../src/sim/crowd";
import { FieldCache, walkMinutes } from "../../src/sim/routeField";
import { createWorld, fieldTargets, step, type World } from "../../src/sim/world";
import { openFloor, runMinutes } from "./helpers";

// An island of floor in the empty slot field: no spawned passenger can reach it.
const ISLAND: Rect = { x: 60, y: 30, w: 20, h: 20 };

function islandWorld(): World {
  const w = createWorld(1);
  for (let y = ISLAND.y; y < ISLAND.y + ISLAND.h; y++)
    for (let x = ISLAND.x; x < ISLAND.x + ISLAND.w; x++) w.grid.setTile(x, y, Tile.Floor);
  return w;
}

function letTo(f: Facility, tenant: Tenant): Facility {
  f.tenant = tenant;
  f.tenantAt = -1;
  return f;
}

/** A walker heading for exit A, `slack` minutes over their deadline (island goals count as no walk). */
function person(w: World, x: number, y: number, slack: number, state = PState.Walking): number {
  const p = w.people;
  const i = p.alloc();
  p.x[i] = x + 0.5;
  p.y[i] = y + 0.5;
  p.state[i] = state;
  p.goalKey[i] = "exit:A";
  p.targetKey[i] = state === PState.Walking ? "exit:A" : "";
  p.deadline[i] = w.minute + slack;
  return i;
}

function need(w: World, i: number, n: Need): number {
  return w.people.needs[i * NEED_COUNT + n]!;
}

function setNeed(w: World, i: number, n: Need, v: number): void {
  w.people.needs[i * NEED_COUNT + n] = v;
}

function tileOf(w: World, i: number): number {
  return w.grid.idx(Math.floor(w.people.x[i]!), Math.floor(w.people.y[i]!));
}

test("a hungry person with time to spare finds a visible food unit and eats", () => {
  const w = islandWorld();
  const f = letTo(createFacility(w, FacilityKind.Retail, { x: 70, y: 40, w: 2, h: 2 }), Tenant.FoodDrink);
  const pid = person(w, 65, 40, 60, PState.Waiting);
  setNeed(w, pid, Need.Hunger, 1);
  const until = w.minute + 30;
  while (w.minute < until && need(w, pid, Need.Hunger) !== 0) step(w, SIM_DT);
  expect(need(w, pid, Need.Hunger)).toBe(0);
  expect(w.ledger.today.rent).toBeGreaterThan(0);
  expect(f.takingsToday).toBeGreaterThan(0);
  expect(w.people.errand[pid]).toBe(-1);
});

test("a person does not know about a toilet out of sight, but a sign teaches it", () => {
  const w = islandWorld();
  // A wall down the island with a gap at the bottom: the toilet is a long walk round.
  for (let y = ISLAND.y; y < ISLAND.y + ISLAND.h - 2; y++) w.grid.setTile(70, y, Tile.Wall);
  const toilet = createFacility(w, FacilityKind.Toilet, { x: 74, y: 31, w: 1, h: 2 });
  const pid = person(w, 66, 31, 600, PState.Waiting);
  setNeed(w, pid, Need.Toilet, 1);
  const field = w.fields.get(`facility:${toilet.id}`, () => fieldTargets(w, `facility:${toilet.id}`));
  expect(field[tileOf(w, pid)]!).toBeGreaterThan(30);

  runMinutes(w, 10);
  expect(w.people.errand[pid]).toBe(Need.Toilet);
  expect(w.people.known[pid * NEED_COUNT + Need.Toilet]).toBe(-1);

  const sign = addSign(w, w.grid.idx(65, 31), "toilets");
  expect(sign.pointsTo).toBe(toilet.id);
  runMinutes(w, 1.5);
  expect(w.people.known[pid * NEED_COUNT + Need.Toilet]).toBe(toilet.id);
  expect(w.people.targetKey[pid]).toBe(`facility:${toilet.id}`);
});

test("a person with almost no time left drops their errand", () => {
  const w = createWorld(1);
  // Built on Harbour Road's corridor floor; any unit will do, it never gets reached.
  const f = letTo(createFacility(w, FacilityKind.Retail, { x: 12, y: 64, w: 1, h: 2 }), Tenant.FoodDrink);
  const p = w.people;
  const pid = person(w, 10, 70, 0);
  const walk = walkMinutes(
    w.fields.get("exit:A", () => fieldTargets(w, "exit:A")),
    tileOf(w, pid),
  );
  p.deadline[pid] = w.minute + walk + 2;
  setNeed(w, pid, Need.Hunger, 1);
  p.errand[pid] = Need.Hunger;
  p.errandFacility[pid] = f.id;
  p.targetKey[pid] = `facility:${f.id}`;
  step(w, SIM_DT);
  expect(p.errand[pid]).toBe(-1);
  expect(p.errandFacility[pid]).toBe(-1);
  expect(p.targetKey[pid]).toBe("exit:A");
  expect(need(w, pid, Need.Hunger)).toBeGreaterThanOrEqual(1);
});

test("a desperate person with no toilet slows down", () => {
  const w = islandWorld();
  const pid = person(w, 65, 40, 600, PState.Waiting);
  setNeed(w, pid, Need.Toilet, 1);
  runMinutes(w, DESPERATE_AFTER_MIN - 1);
  expect(w.people.errand[pid]).toBe(Need.Toilet);
  expect(w.people.speedMul[pid]).toBe(1);
  runMinutes(w, 2);
  expect(w.people.speedMul[pid]).toBeCloseTo(0.7);
  // A toilet opens in sight: once they have been, they are back to full speed.
  createFacility(w, FacilityKind.Toilet, { x: 70, y: 40, w: 1, h: 2 });
  const until = w.minute + 30;
  while (w.minute < until && need(w, pid, Need.Toilet) !== 0) step(w, SIM_DT);
  expect(need(w, pid, Need.Toilet)).toBe(0);
  expect(w.people.speedMul[pid]).toBe(1);
});

test("a desperate walker drifts off the straight route but still gets there", () => {
  const grid = openFloor(40, 9);
  const fields = new FieldCache(grid);
  const people = new PeopleStore(4);
  const crowd = new CrowdGrid(grid.w, grid.h);
  const targets = [grid.idx(39, 4)];
  const i = people.alloc();
  people.x[i] = 0.5;
  people.y[i] = 4.5;
  people.state[i] = PState.Walking;
  people.targetKey[i] = "end";
  people.speedMul[i] = 0.7;
  const rng = new Rng(3);
  let offRow = 0;
  let arrived = false;
  for (let n = 0; n < 20000 && !arrived; n++) {
    crowd.rebuild(people, grid);
    arrived = stepMovement(grid, fields, () => targets, people, crowd, SIM_DT, rng).includes(i);
    if (Math.floor(people.y[i]!) !== 4) offRow++;
  }
  expect(arrived).toBe(true);
  expect(offRow).toBeGreaterThan(0);
});

test("a unit heading for that no longer meets the errand is forgotten, errand kept", () => {
  const w = islandWorld();
  const f = letTo(createFacility(w, FacilityKind.Retail, { x: 70, y: 40, w: 2, h: 2 }), Tenant.FoodDrink);
  const p = w.people;
  const pid = person(w, 62, 32, 600);
  setNeed(w, pid, Need.Browse, 1);
  p.errand[pid] = Need.Browse;
  p.errandFacility[pid] = f.id;
  p.known[pid * NEED_COUNT + Need.Browse] = f.id;
  p.targetKey[pid] = `facility:${f.id}`;
  step(w, SIM_DT);
  expect(p.errand[pid]).toBe(Need.Browse);
  expect(p.errandFacility[pid]).toBe(-1);
  expect(p.known[pid * NEED_COUNT + Need.Browse]).toBe(-1);
  expect(p.targetKey[pid]).toBe("exit:A");
});

test("arriving at a full queue drops the errand, need unmet", () => {
  const w = islandWorld();
  const f = letTo(createFacility(w, FacilityKind.Retail, { x: 70, y: 40, w: 2, h: 2 }), Tenant.FoodDrink);
  const p = w.people;
  for (let k = 0; k < TENANTS[Tenant.FoodDrink].maxQueue; k++) expect(tryJoin(w, f, person(w, 62 + k, 46, 600))).toBe(true);
  const last = f.queueTiles[f.queueTiles.length - 1]!;
  const pid = person(w, last % w.grid.w, Math.floor(last / w.grid.w), 600);
  setNeed(w, pid, Need.Hunger, 1);
  p.errand[pid] = Need.Hunger;
  p.errandFacility[pid] = f.id;
  p.targetKey[pid] = `facility:${f.id}`;
  step(w, SIM_DT);
  expect(p.state[pid]).toBe(PState.Walking);
  expect(p.errand[pid]).toBe(-1);
  expect(p.errandFacility[pid]).toBe(-1);
  expect(p.targetKey[pid]).toBe("exit:A");
  expect(f.queue).not.toContain(pid);
  expect(need(w, pid, Need.Hunger)).toBeGreaterThanOrEqual(1);
});

test("signs point to the nearest matching open facility, and follow changes", () => {
  const w = islandWorld();
  const far = letTo(createFacility(w, FacilityKind.Retail, { x: 76, y: 44, w: 2, h: 2 }), Tenant.Newsagent);
  const shops = addSign(w, w.grid.idx(62, 32), "shops");
  const seating = addSign(w, w.grid.idx(62, 33), "seating");
  expect(shops.pointsTo).toBe(far.id);
  expect(seating.pointsTo).toBe(-1);
  // A nearer unit is to let: the sign still points past it.
  const near = createFacility(w, FacilityKind.Retail, { x: 64, y: 34, w: 2, h: 2 });
  expect(shops.pointsTo).toBe(far.id);
  // Its tenant moves in: now it is the nearest.
  runMinutes(w, 41);
  expect(near.tenant).not.toBe(Tenant.None);
  expect(shops.pointsTo).toBe(near.id);
  const seat = createFacility(w, FacilityKind.Seating, { x: 66, y: 44, w: 2, h: 1 });
  expect(seating.pointsTo).toBe(seat.id);
  w.facilities.delete(far.id);
  w.facilities.delete(near.id);
  refreshSigns(w);
  expect(shops.pointsTo).toBe(-1);
});

test("a known facility that has gone is forgotten on use", () => {
  const w = islandWorld();
  const toilet = createFacility(w, FacilityKind.Toilet, { x: 70, y: 40, w: 1, h: 2 });
  const pid = person(w, 62, 32, 600, PState.Waiting);
  setNeed(w, pid, Need.Toilet, 1);
  w.people.known[pid * NEED_COUNT + Need.Toilet] = toilet.id;
  w.facilities.delete(toilet.id);
  runMinutes(w, 0.5);
  expect(w.people.errand[pid]).toBe(Need.Toilet);
  expect(w.people.known[pid * NEED_COUNT + Need.Toilet]).toBe(-1);
  expect(w.people.state[pid]).toBe(PState.Waiting);
});

test("needs rise at their rates, faster for waiting tiredness and leisure browsing", () => {
  const w = islandWorld();
  const walker = person(w, 62, 32, 600);
  w.people.targetKey[walker] = "";
  const waiter = person(w, 64, 32, 600, PState.Waiting);
  w.people.leisure[waiter] = 1;
  runMinutes(w, 30);
  expect(need(w, walker, Need.Hunger)).toBeCloseTo(30 / 240, 1);
  expect(need(w, walker, Need.Tired)).toBeCloseTo(30 / 200, 1);
  expect(need(w, waiter, Need.Tired)).toBeCloseTo((2 * 30) / 200, 1);
  expect(need(w, walker, Need.Browse)).toBeCloseTo(30 / 300, 1);
  expect(need(w, waiter, Need.Browse)).toBeCloseTo((2 * 30) / 300, 1);
});

test("errands never make a fair-deadline person miss on an empty map", () => {
  const w = createWorld(5);
  // Floor east of the concourse for the units, joined to it along x = 16.
  for (let y = 56; y < 63; y++) for (let x = 16; x < 30; x++) w.grid.setTile(x, y, Tile.Floor);
  letTo(createFacility(w, FacilityKind.Retail, { x: 20, y: 60, w: 2, h: 2 }), Tenant.FoodDrink);
  const toilet = createFacility(w, FacilityKind.Toilet, { x: 25, y: 60, w: 2, h: 2 });
  addSign(w, w.grid.idx(10, 56), "toilets");
  addSign(w, w.grid.idx(11, 64), "shops");
  let toiletUsed = false;
  const until = w.minute + 6 * 60;
  while (w.minute < until) {
    step(w, SIM_DT);
    if (toilet.serving.length > 0) toiletUsed = true;
  }
  let onTime = 0;
  let all = 0;
  for (const e of w.events) {
    if (e.kind !== "outcome") continue;
    all++;
    if (e.onTime) onTime++;
  }
  expect(all).toBeGreaterThan(200);
  expect(w.ledger.today.rent).toBeGreaterThan(0);
  expect(toiletUsed).toBe(true);
  expect(onTime / all).toBeGreaterThanOrEqual(0.95);
});
