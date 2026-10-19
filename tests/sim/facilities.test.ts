import { expect, test } from "vitest";
import {
  EMPTY_AFTER_EVICT_MIN,
  LEISURE_SPEND_MUL,
  QUEUE_GIVE_UP_MIN,
  SIM_DT,
  TENANT_DELAY_MIN,
} from "../../src/sim/constants";
import { PRICES, RENT_SHARE } from "../../src/sim/economy";
import {
  FacilityKind,
  TENANTS,
  Tenant,
  arriveAtFacility,
  chooseTenant,
  createFacility,
  evictTenant,
  stepFacilities,
  tryJoin,
  type Facility,
} from "../../src/sim/facilities";
import { Tile, Zone, type Rect } from "../../src/sim/grid";
import { stepMovement } from "../../src/sim/movement";
import { NEED_COUNT, Need, PState } from "../../src/sim/people";
import { Rng } from "../../src/sim/rng";
import { createWorld, fieldTargets, step, type World } from "../../src/sim/world";
import { runMinutes } from "./helpers";

// An island of floor in the empty slot field: no spawned passenger can reach it.
const ISLAND: Rect = { x: 60, y: 30, w: 20, h: 20 };
const UNIT: Rect = { x: 68, y: 40, w: 2, h: 2 };

function islandWorld(): World {
  const w = createWorld(1);
  for (let y = ISLAND.y; y < ISLAND.y + ISLAND.h; y++)
    for (let x = ISLAND.x; x < ISLAND.x + ISLAND.w; x++) w.grid.setTile(x, y, Tile.Floor);
  return w;
}

function foodUnit(w: World): Facility {
  const f = createFacility(w, FacilityKind.Retail, UNIT);
  f.tenant = Tenant.FoodDrink;
  f.tenantAt = -1;
  return f;
}

function person(w: World, x: number, y: number, leisure = false): number {
  const p = w.people;
  const i = p.alloc();
  p.x[i] = x + 0.5;
  p.y[i] = y + 0.5;
  p.state[i] = PState.Walking;
  p.goalKey[i] = "exit:A";
  p.targetKey[i] = "facility:1";
  p.deadline[i] = w.minute + 600;
  p.leisure[i] = leisure ? 1 : 0;
  return i;
}

function tileOf(w: World, i: number): number {
  return w.grid.idx(Math.floor(w.people.x[i]!), Math.floor(w.people.y[i]!));
}

/** Steps the world until `pid` has been served and is walking again. */
function serveThrough(w: World, pid: number): void {
  for (let n = 0; n < 20000 && w.people.state[pid] !== PState.Walking; n++) step(w, SIM_DT);
  expect(w.people.state[pid]).toBe(PState.Walking);
}

test("a new retail unit is to let, then a tenant moves in", () => {
  const w = islandWorld();
  const f = createFacility(w, FacilityKind.Retail, UNIT);
  expect(f.tenant).toBe(Tenant.None);
  expect(f.tenantAt).toBe(w.minute + TENANT_DELAY_MIN);
  expect(f.capacity).toBe(1);
  expect(w.facilities.get(f.id)).toBe(f);
  expect(w.grid.zone(UNIT.x, UNIT.y)).toBe(Zone.Retail);
  expect(w.grid.zoneOwner[w.grid.idx(UNIT.x, UNIT.y)]).toBe(f.id);
  runMinutes(w, 41);
  expect(f.tenant).not.toBe(Tenant.None);
  expect(f.tenantAt).toBe(-1);
});

test("leisure customers spend more", () => {
  const w = islandWorld();
  foodUnit(w);
  const f = w.facilities.get(1)!;
  const commuter = person(w, 64, 36);
  expect(arriveAtFacility(w, f, commuter)).toBe(true);
  serveThrough(w, commuter);
  const commuterRent = w.ledger.today.rent;
  const leisure = person(w, 64, 36, true);
  expect(arriveAtFacility(w, f, leisure)).toBe(true);
  serveThrough(w, leisure);
  const leisureRent = w.ledger.today.rent - commuterRent;
  expect(commuterRent).toBeCloseTo(TENANTS[Tenant.FoodDrink].spend * RENT_SHARE);
  expect(leisureRent).toBeCloseTo(LEISURE_SPEND_MUL * commuterRent);
  expect(f.takingsToday).toBeCloseTo(TENANTS[Tenant.FoodDrink].spend * (1 + LEISURE_SPEND_MUL));
});

test("leisure footfall favours electronics", () => {
  const w = islandWorld();
  const f = createFacility(w, FacilityKind.Retail, UNIT);
  f.footfall = { commuter: 0, leisure: 50 };
  const rng = new Rng(7);
  const counts = new Map<Tenant, number>();
  for (let n = 0; n < 10000; n++) {
    const t = chooseTenant(f, rng);
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const most = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
  expect(most).toBe(Tenant.Electronics);
});

test("queue forms on the floor and serves in order", () => {
  const w = islandWorld();
  const f = foodUnit(w);
  expect(f.capacity).toBe(1);
  const ids = Array.from({ length: 6 }, (_, k) => person(w, 62 + k, 32));
  for (const id of ids) expect(arriveAtFacility(w, f, id)).toBe(true);
  expect(f.queue).toEqual(ids);
  ids.forEach((id, k) => {
    expect(w.people.state[id]).toBe(PState.InQueue);
    expect(w.people.targetKey[id]).toBe(`spot:${f.queueTiles[k]}`);
  });
  // Walk them (movement only, nobody served yet): each stands on their own queue tile.
  for (let n = 0; n < 600; n++) {
    w.crowd.rebuild(w.people, w.grid);
    stepMovement(w.grid, w.fields, (key) => fieldTargets(w, key), w.people, w.crowd, SIM_DT);
  }
  ids.forEach((id, k) => expect(tileOf(w, id)).toBe(f.queueTiles[k]));

  // Six four-minute services outlast QUEUE_GIVE_UP_MIN, so the back of the queue may give up.
  const served: number[] = [];
  for (let n = 0; n < 40000 && f.queue.length + f.serving.length > 0; n++) {
    step(w, SIM_DT);
    for (const s of f.serving) if (!served.includes(s.pid)) served.push(s.pid);
  }
  expect(served.length).toBeGreaterThanOrEqual(4);
  expect(served).toEqual(ids.slice(0, served.length));
});

test("people refuse a full queue", () => {
  const w = islandWorld();
  const f = foodUnit(w);
  const max = TENANTS[Tenant.FoodDrink].maxQueue;
  expect(f.queueTiles.length).toBeGreaterThan(max);
  for (let k = 0; k < max; k++) expect(tryJoin(w, f, person(w, 61 + k, 31))).toBe(true);
  const ninth = person(w, 61, 33);
  expect(tryJoin(w, f, ninth)).toBe(false);
  expect(w.people.state[ninth]).toBe(PState.Walking);
});

test("a served customer pays rent and loses their hunger", () => {
  const w = islandWorld();
  const f = foodUnit(w);
  const pid = person(w, 64, 36);
  w.people.needs[pid * NEED_COUNT + Need.Hunger] = 0.8;
  w.people.needs[pid * NEED_COUNT + Need.Thirst] = 0.6;
  w.people.needs[pid * NEED_COUNT + Need.Tired] = 0.5;
  w.people.errand[pid] = Need.Hunger;
  w.people.errandFacility[pid] = f.id;
  expect(arriveAtFacility(w, f, pid)).toBe(true);
  serveThrough(w, pid);
  expect(w.ledger.today.rent).toBeCloseTo(6 * 0.2);
  expect(w.people.needs[pid * NEED_COUNT + Need.Hunger]).toBe(0);
  expect(w.people.needs[pid * NEED_COUNT + Need.Thirst]).toBe(0);
  // Untouched by the meal; it has only risen while they queued.
  expect(w.people.needs[pid * NEED_COUNT + Need.Tired]).toBeGreaterThanOrEqual(0.5);
  expect(w.people.targetKey[pid]).toBe("exit:A");
  expect(w.people.errand[pid]).toBe(-1);
  expect(w.people.errandFacility[pid]).toBe(-1);
  expect(f.serving).toHaveLength(0);
});

test("eviction costs the fee and empties the unit for two hours", () => {
  const w = islandWorld();
  const f = foodUnit(w);
  const ids = [person(w, 62, 32), person(w, 63, 32), person(w, 64, 32)];
  for (const id of ids) tryJoin(w, f, id);
  const before = w.ledger.balance;
  expect(evictTenant(w, f.id)).toBe(true);
  expect(w.ledger.balance).toBe(before - PRICES.evict);
  expect(w.ledger.today.evictions).toBe(PRICES.evict);
  expect(f.tenant).toBe(Tenant.None);
  expect(f.tenantAt).toBe(w.minute + EMPTY_AFTER_EVICT_MIN);
  expect(f.queue).toHaveLength(0);
  for (const id of ids) {
    expect(w.people.state[id]).toBe(PState.Walking);
    expect(w.people.targetKey[id]).toBe("exit:A");
  }
  expect(tryJoin(w, f, person(w, 65, 32))).toBe(false);
});

test("eviction is refused when the fee cannot be paid", () => {
  const w = islandWorld();
  const f = foodUnit(w);
  w.ledger.balance = PRICES.evict - 1;
  expect(evictTenant(w, f.id)).toBe(false);
  expect(f.tenant).toBe(Tenant.FoodDrink);
});

test("a to-let unit counts each passer-by once", () => {
  const w = islandWorld();
  const f = createFacility(w, FacilityKind.Retail, UNIT);
  const near = person(w, 66, 39, true);
  person(w, 61, 31); // too far away
  w.people.targetKey[near] = "";
  for (let n = 0; n < 5; n++) stepFacilities(w, 1);
  expect(f.footfall).toEqual({ commuter: 0, leisure: 1 });
});

test("queue tiles run as a line of plain floor away from the unit", () => {
  const w = islandWorld();
  const f = foodUnit(w);
  expect(f.queueTiles.length).toBe(12);
  expect(f.serviceTiles).toContain(f.queueTiles[0]);
  for (let k = 0; k < f.queueTiles.length; k++) {
    const [x, y] = w.grid.xy(f.queueTiles[k]!);
    expect(w.grid.isWalkable(x, y)).toBe(true);
    expect(w.grid.zone(x, y)).toBe(Zone.None);
    if (k > 0) {
      const [px, py] = w.grid.xy(f.queueTiles[k - 1]!);
      expect(Math.abs(x - px) + Math.abs(y - py)).toBe(1);
    }
  }
  expect(fieldTargets(w, `facility:${f.id}`)).toEqual(f.queueTiles);
});

test("a seat holds area x 2 people, then they stand rested", () => {
  const w = islandWorld();
  const seats = createFacility(w, FacilityKind.Seating, { x: 62, y: 44, w: 1, h: 1 });
  expect(seats.capacity).toBe(2);
  expect(fieldTargets(w, `seat:${seats.id}`)).toEqual([w.grid.idx(62, 44)]);
  const a = person(w, 62, 44);
  const b = person(w, 62, 44);
  const c = person(w, 62, 44);
  w.people.needs[a * NEED_COUNT + Need.Tired] = 0.9;
  expect(arriveAtFacility(w, seats, a)).toBe(true);
  expect(arriveAtFacility(w, seats, b)).toBe(true);
  expect(arriveAtFacility(w, seats, c)).toBe(false);
  expect(w.people.state[a]).toBe(PState.Seated);
  w.minute += 29;
  stepFacilities(w, 29);
  expect(w.people.state[a]).toBe(PState.Seated);
  w.minute += 1.5;
  stepFacilities(w, 1.5);
  expect(w.people.state[a]).toBe(PState.Walking);
  expect(w.people.needs[a * NEED_COUNT + Need.Tired]).toBe(0);
  expect(w.people.targetKey[a]).toBe("exit:A");
  expect(seats.serving).toHaveLength(0);
});

test("a seated person stands in time to make their deadline", () => {
  const w = createWorld(1);
  const seats = createFacility(w, FacilityKind.Seating, { x: 10, y: 70, w: 1, h: 1 });
  const p = w.people;
  const a = p.alloc();
  p.x[a] = 10.5;
  p.y[a] = 70.5;
  p.state[a] = PState.Walking;
  p.goalKey[a] = "exit:A";
  // About 9 tiles from Harbour Road: roughly 8.6 minutes' walk, so they stand by deadline - 13.6.
  p.deadline[a] = w.minute + 20;
  expect(arriveAtFacility(w, seats, a)).toBe(true);
  w.minute += 4;
  stepFacilities(w, 4);
  expect(p.state[a]).toBe(PState.Seated);
  w.minute += 3;
  stepFacilities(w, 3);
  expect(p.state[a]).toBe(PState.Walking);
});

test("takings reset at the day rollover", () => {
  const w = islandWorld();
  const f = foodUnit(w);
  f.takingsToday = 50;
  w.minute = 1440 - 0.01;
  w.trainsUpTo = w.minute;
  step(w, SIM_DT);
  expect(f.takingsToday).toBe(0);
});

test("a person arriving from behind the unit walks round to the queue and is served", () => {
  const w = islandWorld();
  const f = foodUnit(w);
  const [, qy] = w.grid.xy(f.queueTiles[0]!);
  expect(qy).toBeLessThan(UNIT.y); // the line runs north, so south is behind the unit
  const pid = person(w, 68, 46);
  let joined = false;
  let served = false;
  const until = w.minute + 15;
  while (w.minute < until && !served) {
    step(w, SIM_DT);
    if (!joined && f.queueTiles.includes(tileOf(w, pid))) joined = arriveAtFacility(w, f, pid);
    if (w.people.state[pid] === PState.InFacility) served = true;
  }
  expect(joined).toBe(true);
  expect(served).toBe(true);
});

test("a queuer gives up after QUEUE_GIVE_UP_MIN, need unmet", () => {
  const w = islandWorld();
  const f = foodUnit(w);
  const a = person(w, 62, 32);
  const b = person(w, 63, 32);
  w.people.needs[b * NEED_COUNT + Need.Hunger] = 0.7;
  w.people.errand[b] = Need.Hunger;
  w.people.errandFacility[b] = f.id;
  tryJoin(w, f, a);
  tryJoin(w, f, b);
  // Nobody walks here, so the front never reaches the counter and the queue never moves.
  for (let m = 0; m < QUEUE_GIVE_UP_MIN; m++) {
    w.minute += 1;
    stepFacilities(w, 1);
  }
  expect(w.people.state[b]).toBe(PState.InQueue);
  w.minute += 1;
  stepFacilities(w, 1);
  expect(f.queue).toHaveLength(0);
  expect(w.people.state[b]).toBe(PState.Walking);
  expect(w.people.targetKey[b]).toBe("exit:A");
  expect(w.people.errand[b]).toBe(-1);
  expect(w.people.errandFacility[b]).toBe(-1);
  expect(w.people.needs[b * NEED_COUNT + Need.Hunger]).toBeCloseTo(0.7);
});

test("a queuer leaves to make their deadline", () => {
  const w = createWorld(1);
  const f = createFacility(w, FacilityKind.Toilet, { x: 12, y: 66, w: 1, h: 2 });
  const p = w.people;
  const a = p.alloc();
  p.x[a] = 10.5;
  p.y[a] = 70.5;
  p.state[a] = PState.Walking;
  p.goalKey[a] = "exit:A";
  // About 8.6 minutes' walk to Harbour Road: they need to go once fewer than 13.6 minutes remain.
  p.deadline[a] = w.minute + 15;
  expect(tryJoin(w, f, a)).toBe(true);
  stepFacilities(w, SIM_DT);
  expect(p.state[a]).toBe(PState.InQueue);
  w.minute += 2;
  stepFacilities(w, 2);
  expect(p.state[a]).toBe(PState.Walking);
  expect(p.targetKey[a]).toBe("exit:A");
});
