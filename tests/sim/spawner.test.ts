import { expect, test } from "vitest";
import { MIN_SLACK_MINUTES } from "../../src/sim/constants";
import { Tile } from "../../src/sim/grid";
import { Journey, PState } from "../../src/sim/people";
import { Rng } from "../../src/sim/rng";
import { onTrainArrived, sampleSlack } from "../../src/sim/spawner";
import { createWorld, step, type World } from "../../src/sim/world";
import { SIM_DT } from "../../src/sim/constants";
import { entranceTiles, platformTiles, runMinutes, type XY } from "./helpers";

function expectFair(w: World, i: number): void {
  const p = w.people;
  expect(p.deadline[i]! - p.spawnedAt[i]!).toBeGreaterThanOrEqual(p.spawnWalk[i]! + MIN_SLACK_MINUTES - 1e-6);
}

function inTiles(tiles: XY[], x: number, y: number): boolean {
  return tiles.some(([tx, ty]) => tx === Math.floor(x) && ty === Math.floor(y));
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
  runMinutes(w, 8 * 60); // through the morning peak
  let checked = 0;
  w.people.forEachAlive((i) => {
    expectFair(w, i);
    checked++;
  });
  expect(checked).toBeGreaterThan(50);
});

test("an unobstructed station has a very high on-time rate", () => {
  const w = createWorld(5);
  runMinutes(w, 6 * 60);
  let onTime = 0;
  let all = 0;
  for (const e of w.events) {
    if (e.kind !== "outcome") continue;
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

test("no spawns from an unreachable entrance", () => {
  const w = createWorld(8);
  // Wall the strip of floor leading in from Market Place.
  for (let y = 55; y < 58; y++) w.grid.setTile(1, y, Tile.Wall);
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
