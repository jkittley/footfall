import { expect, test } from "vitest";
import { ServiceMeter, addPlatform, deactivatePlatform, stepGrowth } from "../../src/sim/growth";
import { Tile } from "../../src/sim/grid";
import { PState } from "../../src/sim/people";
import { activePlatformIds, createWorld, recordOutcome, type World } from "../../src/sim/world";
import { platformTiles } from "./helpers";

function toasts(w: World): string[] {
  return w.events.flatMap((e) => (e.kind === "toast" ? [e.text] : []));
}

/** Each game minute for `minutes`: `perMin` outcomes, the first `onTimePerMin` of them on time, then a growth step. */
function feed(w: World, minutes: number, perMin: number, onTimePerMin: number): void {
  const start = Math.floor(w.minute);
  for (let m = 1; m <= minutes; m++) {
    w.minute = start + m;
    for (let k = 0; k < perMin; k++) w.meter.record(w.minute, k < onTimePerMin);
    stepGrowth(w);
  }
}

function slotHasPlatformTiles(w: World, slotId: number): boolean {
  return platformTiles(slotId).every(([x, y]) => w.grid.tile(x, y) === Tile.Platform);
}

test("meter rate over the window", () => {
  const m = new ServiceMeter();
  for (let t = 0; t < 40; t++) m.record(t, true);
  for (let t = 40; t < 50; t++) m.record(t, false);
  expect(m.rate(50)).toBeCloseTo(0.8);
  expect(m.rate(200)).toBeNull();
});

test("meter is null with too few samples", () => {
  const m = new ServiceMeter();
  for (let t = 0; t < 29; t++) m.record(t, true);
  expect(m.rate(30)).toBeNull();
});

test("sustained good service adds platform 3", () => {
  const w = createWorld(1);
  expect(slotHasPlatformTiles(w, 3)).toBe(false);
  feed(w, 190, 5, 5);
  expect(w.platformsAdded).toBe(3);
  expect(w.platformActive[2]).toBe(true);
  expect(slotHasPlatformTiles(w, 3)).toBe(true);
  expect(toasts(w)).toEqual(["Platform 3 opens"]);
});

test("sustained poor service deactivates a platform but never below 2 or removes tiles", () => {
  const w = createWorld(1);
  addPlatform(w, 3);
  feed(w, 190, 4, 2);
  expect(w.platformActive[2]).toBe(false);
  expect(w.platformsAdded).toBe(3);
  expect(slotHasPlatformTiles(w, 3)).toBe(true);
  expect(toasts(w)).toContain("Platform 3 is closed: too many people missed their trains");
  feed(w, 360, 4, 2);
  expect(w.platformActive[0]).toBe(true);
  expect(w.platformActive[1]).toBe(true);
  expect(activePlatformIds(w)).toEqual([1, 2]);
});

test("reactivates before adding", () => {
  const w = createWorld(1);
  addPlatform(w, 3);
  deactivatePlatform(w, 3);
  feed(w, 190, 5, 5);
  expect(w.platformActive[2]).toBe(true);
  expect(w.platformsAdded).toBe(3);
  expect(toasts(w)).toContain("Platform 3 reopens");
  // The timetable picks it up again from now, first service within the stagger cap.
  w.timetable.ensureHorizon(w.minute, activePlatformIds(w), w.rng);
  const first = w.timetable.upcoming(3, w.minute)[0]!;
  expect(first.arriveAt).toBeGreaterThan(w.minute);
  expect(first.arriveAt).toBeLessThanOrEqual(w.minute + 31);
});

test("rebooks passengers when a platform goes inactive", () => {
  const w = createWorld(5);
  addPlatform(w, 3);
  w.timetable.ensureHorizon(w.minute, activePlatformIds(w), w.rng);
  const booked = w.timetable.upcoming(3, w.minute)[0]!;
  const i = w.people.alloc();
  w.people.x[i] = 10.5;
  w.people.y[i] = 57.5;
  w.people.state[i] = PState.Walking;
  w.people.serviceId[i] = booked.id;
  w.people.goalKey[i] = "platform:3";
  w.people.targetKey[i] = "platform:3";

  deactivatePlatform(w, 3);

  expect(booked.cancelled).toBe(true);
  expect(booked.cancelReason).toBe("inactive");
  expect(w.timetable.upcoming(3, w.minute)).toEqual([]);
  const next = w.timetable.services.get(w.people.serviceId[i]!)!;
  expect(next.platformId).not.toBe(3);
  expect(next.cancelled).toBe(false);
  expect(w.people.goalKey[i]).toBe(`platform:${next.platformId}`);
  expect(w.people.targetKey[i]).toBe(`platform:${next.platformId}`);
  expect(w.people.isAlive(i)).toBe(true);
  expect(w.events.filter((e) => e.kind === "outcome")).toEqual([]);
  expect(slotHasPlatformTiles(w, 3)).toBe(true);
});

test("tenth platform unlocks the subway flag", () => {
  const w = createWorld(1);
  expect(w.stagesUnlocked.subway).toBe(false);
  for (let id = 3; id <= 10; id++) addPlatform(w, id);
  expect(w.platformsAdded).toBe(10);
  expect(w.stagesUnlocked.subway).toBe(true);
  addPlatform(w, 11);
  expect(toasts(w).filter((t) => t === "The subway is coming")).toHaveLength(1);
});

test("outcomes feed the meter unless excluded", () => {
  const w = createWorld(1);
  for (let k = 0; k < 40; k++) {
    const i = w.people.alloc();
    w.people.state[i] = PState.Walking;
    recordOutcome(w, i, k % 4 !== 0, k >= 30);
  }
  // 30 counted (22 on time of the first 30), 10 excluded.
  expect(w.meter.rate(w.minute)).toBeCloseTo(22 / 30);
});

