import { expect, test } from "vitest";
import { GAME_MIN_PER_REAL_SEC, MIN_SLACK_MINUTES, SIM_DT, WALK_TILES_PER_SEC } from "../../src/sim/constants";
import { Tile, type Grid } from "../../src/sim/grid";
import { HARBOUR_STREET, buildGrid } from "../../src/sim/maps/harbourStreet";
import { Journey, PState } from "../../src/sim/people";
import { Rng } from "../../src/sim/rng";
import { computeField } from "../../src/sim/routeField";
import { onTrainArrived, reachableEntrances, sampleSlack } from "../../src/sim/spawner";
import { stepTrains } from "../../src/sim/trains";
import { createWorld, fieldTargets, step, type World } from "../../src/sim/world";
import { OY, OX, entranceTiles, openEveryGate, platformTiles, runMinutes, type XY } from "./helpers";

// Fields computed here from scratch, per grid and layout version, never through the world's cache.
const fieldMemo = new WeakMap<Grid, Map<string, Float32Array>>();

function freshField(grid: Grid, key: string, targets: readonly number[]): Float32Array {
  let byKey = fieldMemo.get(grid);
  if (!byKey) fieldMemo.set(grid, (byKey = new Map()));
  const k = `${key}@${grid.version}`;
  let f = byKey.get(k);
  if (!f) byKey.set(k, (f = computeField(grid, targets)));
  return f;
}

/** Unimpeded walk minutes, Float32-rounded, from a tile to a goal on `grid` as it stands. */
function walkFrom(grid: Grid, w: World, goalKey: string, tile: number): number {
  const field = freshField(grid, goalKey, fieldTargets(w, goalKey));
  return Math.fround((field[tile]! / WALK_TILES_PER_SEC) * GAME_MIN_PER_REAL_SEC);
}

function tileOf(w: World, i: number): number {
  return w.grid.idx(Math.floor(w.people.x[i]!), Math.floor(w.people.y[i]!));
}

/**
 * Checks person `i` on the step they spawn: spawnWalk is their real unimpeded walk on the layout
 * as it stands, measured from where they stand, and the deadline leaves it plus MIN_SLACK_MINUTES.
 */
function expectFair(w: World, i: number): void {
  const p = w.people;
  const walk = walkFrom(w.grid, w, p.goalKey[i]!, tileOf(w, i));
  expect(Number.isFinite(walk)).toBe(true);
  expect(p.spawnWalk[i]).toBe(walk);
  if (p.journey[i] === Journey.Connecting) expect(p.spawnWalk[i]).toBeGreaterThan(0);
  expect(p.deadline[i]! - p.spawnedAt[i]!).toBeGreaterThanOrEqual(p.spawnWalk[i]! + MIN_SLACK_MINUTES - 1e-6);
}

function inTiles(tiles: XY[], x: number, y: number): boolean {
  return tiles.some(([tx, ty]) => tx === Math.floor(x) && ty === Math.floor(y));
}

function isWalkableAt(w: World, x: number, y: number): boolean {
  return w.grid.isWalkable(Math.floor(x), Math.floor(y));
}

test("sampleSlack stays within 3 to 120 minutes, in the stated proportions", () => {
  const rng = new Rng(11);
  const n = 20000;
  let short = 0;
  let long = 0;
  for (let k = 0; k < n; k++) {
    const s = sampleSlack(rng);
    expect(s).toBeGreaterThanOrEqual(MIN_SLACK_MINUTES);
    expect(s).toBeLessThanOrEqual(120);
    if (s < 10) short++;
    if (s >= 45) long++;
  }
  expect(short / n).toBeCloseTo(0.25, 1);
  expect(long / n).toBeCloseTo(0.25, 1);
});

test("every spawned person has a fair deadline", () => {
  const w = createWorld(3);
  const until = w.minute + 8 * 60; // through the morning peak
  const seen = new Set<Journey>();
  let checked = 0;
  while (w.minute < until) {
    step(w, SIM_DT);
    w.people.forEachAlive((i) => {
      if (w.people.spawnedAt[i] !== w.minute) return;
      expectFair(w, i);
      seen.add(w.people.journey[i]!);
      checked++;
    });
  }
  expect(checked).toBeGreaterThan(200);
  expect([...seen].sort()).toEqual([Journey.Departing, Journey.Arriving, Journey.Connecting]);
});

test("spawn walks are measured on the layout as built at spawn", () => {
  const plain = buildGrid(HARBOUR_STREET, HARBOUR_STREET.startingPlatforms);
  const w = createWorld(10);
  const s = w.timetable.upcoming(1, w.minute)[0]!;
  w.minute = s.arriveAt;
  s.alighting = 20;
  onTrainArrived(w, s); // warms the world's field cache on the open layout
  // A wall across the concourse leaves one gap at its east end: the way to Harbour Road gets longer.
  for (let x = 6; x <= 14; x++) w.grid.setTile(OX + x, OY + 58, Tile.Wall);
  w.minute += 1;
  s.alighting = 120;
  onTrainArrived(w, s);
  let detoured = 0;
  w.people.forEachAlive((i) => {
    if (w.people.spawnedAt[i] !== w.minute) return;
    expectFair(w, i);
    if (w.people.goalKey[i] !== "exit:A") return;
    expect(w.people.spawnWalk[i]).toBeGreaterThan(walkFrom(plain, w, "exit:A", tileOf(w, i)) + 1);
    detoured++;
  });
  expect(detoured).toBeGreaterThan(20);
});

test("an unobstructed station has a very high on-time rate", () => {
  const w = createWorld(5);
  // All 5 gates: the 2 a station opens with are a deliberate bottleneck (tests/sim/gates.test.ts).
  openEveryGate(w);
  runMinutes(w, 6 * 60);
  let onTime = 0;
  let all = 0;
  for (const e of w.events) {
    // A line closure's cancellations are refunded and kept out of the meter; they are not misses.
    if (e.kind !== "outcome" || e.excluded) continue;
    all++;
    if (e.onTime) onTime++;
  }
  expect(all).toBeGreaterThan(200);
  expect(onTime / all).toBeGreaterThanOrEqual(0.97);
});

test("arrivals and connections appear when a train arrives", () => {
  const w = createWorld(6);
  const s = w.timetable.upcoming(1, w.minute)[0]!;
  s.alighting = 200;
  w.minute = s.arriveAt;
  const before = w.people.count;
  onTrainArrived(w, s);
  expect(w.people.count - before).toBe(200);

  const platform = platformTiles(1);
  let connecting = 0;
  let arriving = 0;
  w.people.forEachAlive((i) => {
    const p = w.people;
    expect(inTiles(platform, p.x[i]!, p.y[i]!)).toBe(true);
    expect(p.spawnedAt[i]).toBe(w.minute);
    expectFair(w, i);
    if (p.journey[i] === Journey.Connecting) {
      connecting++;
      expect(p.goalKey[i]).toBe("platform:2");
      const booked = w.timetable.services.get(p.serviceId[i]!)!;
      expect(booked.platformId).toBe(2);
      expect(p.deadline[i]).toBe(booked.departAt);
    } else {
      arriving++;
      expect(p.journey[i]).toBe(Journey.Arriving);
      expect(p.goalKey[i]).toMatch(/^exit:[AB]$/);
      expect(p.serviceId[i]).toBe(-1);
    }
    expect(p.targetKey[i]).toBe(p.goalKey[i]);
    expect(p.state[i]).toBe(PState.Walking);
  });
  expect(connecting).toBeGreaterThan(10);
  expect(arriving).toBeGreaterThan(130);
});

test("arriving passengers leave by an exit with an outcome; departing ones wait on their platform", () => {
  const w = createWorld(7);
  runMinutes(w, 120);
  const outcomes = w.events.filter((e) => e.kind === "outcome");
  expect(outcomes.length).toBeGreaterThan(0);
  expect(w.stats.movedToday).toBe(outcomes.length);
  let waiting = 0;
  w.people.forEachAlive((i) => {
    if (w.people.state[i] !== PState.Waiting) return;
    waiting++;
    const id = Number(w.people.goalKey[i]!.slice("platform:".length));
    expect(inTiles(platformTiles(id), w.people.x[i]!, w.people.y[i]!)).toBe(true);
  });
  expect(waiting).toBeGreaterThan(0);
});

test("only entrances with a route to a platform take departing passengers", () => {
  const w = createWorld(8);
  // The footbridge has no floor to it yet.
  expect(reachableEntrances(w).map((e) => e.id)).toEqual(["A", "B"]);
  for (let y = 55; y < 58; y++) w.grid.setTile(OX + 1, OY + y, Tile.Wall);
  expect(reachableEntrances(w).map((e) => e.id)).toEqual(["A"]);
});

test("no spawns from an unreachable entrance", () => {
  const w = createWorld(8);
  // Wall the strip of floor leading in from Market Street.
  for (let y = 55; y < 58; y++) w.grid.setTile(OX + 1, OY + y, Tile.Wall);
  const b = entranceTiles("B");
  let spawned = 0;
  const until = w.minute + 60;
  while (w.minute < until) {
    step(w, SIM_DT);
    w.people.forEachAlive((i) => {
      if (w.people.spawnedAt[i] !== w.minute) return;
      spawned++;
      expect(inTiles(b, w.people.x[i]!, w.people.y[i]!)).toBe(false);
    });
  }
  expect(spawned).toBeGreaterThan(0);
});

test("people are only put on, and sent to, walkable platform tiles", () => {
  const w = createWorld(11);
  // Something built over the far end of platform 1.
  for (const [x, y] of platformTiles(1)) if (y < 44) w.grid.setTile(x, y, Tile.Wall);
  const s = w.timetable.upcoming(1, w.minute)[0]!;
  w.minute = s.arriveAt;
  s.alighting = 100;
  const before = w.people.count;
  onTrainArrived(w, s);
  // Everyone gets off: nobody is dropped for having been put on a tile they cannot walk from.
  expect(w.people.count - before).toBe(100);
  w.people.forEachAlive((i) => expect(isWalkableAt(w, w.people.x[i]!, w.people.y[i]!)).toBe(true));

  const walkers: number[] = [];
  for (let n = 0; n < 30; n++) {
    const i = w.people.alloc();
    w.people.x[i] = OX + 9.5;
    w.people.y[i] = OY + 53.5;
    w.people.state[i] = PState.Walking;
    w.people.goalKey[i] = "platform:1";
    w.people.targetKey[i] = "platform:1";
    walkers.push(i);
  }
  step(w, SIM_DT);
  for (const i of walkers) {
    expect(w.people.state[i]).toBe(PState.Waiting);
    const spot = Number(w.people.targetKey[i]!.slice("spot:".length));
    expect(w.grid.isWalkable(spot % w.grid.w, Math.floor(spot / w.grid.w))).toBe(true);
  }
});

test("a passenger who misses the last service heads for an exit, counted once", () => {
  const w = createWorld(12);
  const s = w.timetable.upcoming(1, w.minute)[0]!;
  for (const [id, other] of w.timetable.services) if (other.platformId === 1 && other.departAt > s.departAt) w.timetable.services.delete(id);
  const i = w.people.alloc();
  w.people.x[i] = OX + 10.5;
  w.people.y[i] = OY + 70.5;
  w.people.state[i] = PState.Walking;
  w.people.journey[i] = Journey.Departing;
  w.people.goalKey[i] = "platform:1";
  w.people.targetKey[i] = "platform:1";
  w.people.serviceId[i] = s.id;
  w.minute = s.departAt + 0.01;
  w.trainsUpTo = s.departAt - 0.01;
  stepTrains(w);

  const p = w.people;
  expect(p.isAlive(i)).toBe(true);
  expect(p.counted[i]).toBe(1);
  expect(p.journey[i]).toBe(Journey.Arriving);
  expect(p.state[i]).toBe(PState.Walking);
  expect(p.serviceId[i]).toBe(-1);
  expect(p.goalKey[i]).toMatch(/^exit:[AB]$/);
  expect(p.targetKey[i]).toBe(p.goalKey[i]);
  const walk = walkFrom(w.grid, w, p.goalKey[i]!, tileOf(w, i));
  expect(p.deadline[i]! - w.minute).toBeGreaterThanOrEqual(walk + MIN_SLACK_MINUTES - 1e-6);

  const mine = () => w.events.filter((e) => e.kind === "outcome" && e.personId === i).length;
  expect(mine()).toBe(1);
  const until = w.minute + 120;
  while (p.isAlive(i) && w.minute < until) step(w, SIM_DT);
  expect(p.isAlive(i)).toBe(false);
  expect(mine()).toBe(1);
});

/** On-time rate of each of seeds 1..8 over 6 hours, `setup` run on each new world first. */
function seedRates(setup: (w: World) => void = () => {}): number[] {
  const rates: number[] = [];
  for (let seed = 1; seed <= 8; seed++) {
    const w = createWorld(seed);
    setup(w);
    runMinutes(w, 6 * 60);
    let onTime = 0;
    let all = 0;
    for (const e of w.events) {
      if (e.kind !== "outcome" || e.excluded) continue;
      all++;
      if (e.onTime) onTime++;
    }
    rates.push(onTime / all);
  }
  return rates;
}

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

test("across seeds, the starting station (2 gates per island) stays mostly on time", () => {
  const rates = seedRates();
  for (const r of rates) expect(r).toBeGreaterThanOrEqual(0.9);
  expect(mean(rates)).toBeGreaterThanOrEqual(0.93);
});

test("across seeds, an unobstructed station stays on time (shared island walkways included, all gates open)", () => {
  const rates = seedRates(openEveryGate);
  for (const r of rates) expect(r).toBeGreaterThanOrEqual(0.965);
  expect(mean(rates)).toBeGreaterThanOrEqual(0.98);
});
