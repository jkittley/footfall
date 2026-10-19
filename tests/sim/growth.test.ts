import { expect, test } from "vitest";
import { COOLDOWN_MIN, GROW_RATE, MIN_SAMPLES, SHRINK_DAYS, SHRINK_RATE, SUSTAIN_MIN } from "../../src/sim/constants";
import { ServiceMeter, addPlatform, closeGrowthDay, deactivatePlatform, stepGrowth } from "../../src/sim/growth";
import { Tile } from "../../src/sim/grid";
import { PState } from "../../src/sim/people";
import { activePlatformIds, createWorld, recordOutcome, step, type World } from "../../src/sim/world";
import { OY, OX, platformTiles, tilesOf } from "./helpers";

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

/** Every tile of the slot's half is Platform, but for the gate row at its foot. */
function slotHasPlatformTiles(w: World, slotId: number): boolean {
  const gateY = w.map.islands[w.map.slots[slotId - 1]!.island - 1]!.gateLine.y;
  return platformTiles(slotId).every(([x, y]) => y === gateY || w.grid.tile(x, y) === Tile.Platform);
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
  feed(w, SUSTAIN_MIN + 10, 5, 5);
  expect(w.platformsAdded).toBe(3);
  expect(w.platformActive[2]).toBe(true);
  expect(slotHasPlatformTiles(w, 3)).toBe(true);
  expect(toasts(w)).toEqual(["Platform 3 opens"]);
});

test("sustained poor service deactivates a platform but never below 2 or removes tiles", () => {
  const w = createWorld(1);
  addPlatform(w, 3);
  feed(w, SUSTAIN_MIN + 10, 4, 2);
  expect(w.platformActive[2]).toBe(false);
  expect(w.platformsAdded).toBe(3);
  expect(slotHasPlatformTiles(w, 3)).toBe(true);
  expect(toasts(w)).toContain("Platform 3 is closed: too many people missed their trains");
  // Long enough for the cooldown and another full stretch of poor service.
  feed(w, COOLDOWN_MIN + SUSTAIN_MIN + 10, 4, 2);
  expect(w.platformActive[0]).toBe(true);
  expect(w.platformActive[1]).toBe(true);
  expect(activePlatformIds(w)).toEqual([1, 2]);
});

test("reactivates before adding", () => {
  const w = createWorld(1);
  addPlatform(w, 3);
  deactivatePlatform(w, 3);
  feed(w, SUSTAIN_MIN + 10, 5, 5);
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
  w.people.x[i] = OX + 10.5;
  w.people.y[i] = OY + 57.5;
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


/** A meter that reads whatever rate it is set to. */
class FixedMeter extends ServiceMeter {
  value: number | null = null;
  override rate(): number | null {
    return this.value;
  }
}

function fixedMeter(w: World): FixedMeter {
  const m = new FixedMeter();
  w.meter = m;
  return m;
}

/** A rate that counts as good service, and one in the dead band between poor and good. */
const GOOD = (GROW_RATE + 1) / 2;
const DEAD_BAND = (SHRINK_RATE + GROW_RATE) / 2;

/** Advances the clock `minutes` whole minutes, one growth step each. */
function tick(w: World, minutes: number): void {
  for (let k = 0; k < minutes; k++) {
    w.minute = Math.floor(w.minute) + 1;
    stepGrowth(w);
  }
}

test("growth acts at exactly SUSTAIN_MIN of good service, not a minute before", () => {
  const w = createWorld(1);
  fixedMeter(w).value = GOOD;
  tick(w, SUSTAIN_MIN);
  expect(w.platformsAdded).toBe(2);
  tick(w, 1);
  expect(w.platformsAdded).toBe(3);
});

test("a rate in the dead band resets the sustain timer", () => {
  const w = createWorld(1);
  const m = fixedMeter(w);
  m.value = GOOD;
  tick(w, SUSTAIN_MIN - 1);
  m.value = DEAD_BAND;
  tick(w, 1);
  expect(w.growth.goodSince).toBeNull();
  expect(w.growth.badSince).toBeNull();
  m.value = GOOD;
  tick(w, SUSTAIN_MIN);
  expect(w.platformsAdded).toBe(2);
  tick(w, 1);
  expect(w.platformsAdded).toBe(3);
});

test("cooldown blocks a second action for COOLDOWN_MIN", () => {
  const w = createWorld(1);
  fixedMeter(w).value = 1;
  tick(w, SUSTAIN_MIN + 1);
  expect(w.platformsAdded).toBe(3);
  // COOLDOWN_MIN of cooldown, then a fresh SUSTAIN_MIN of good service.
  tick(w, COOLDOWN_MIN + SUSTAIN_MIN - 1);
  expect(w.platformsAdded).toBe(3);
  tick(w, 1);
  expect(w.platformsAdded).toBe(4);
});

test("growth state round-trips through JSON", () => {
  const w = createWorld(1);
  feed(w, 10, 5, 4);
  expect(JSON.parse(JSON.stringify(w.growth))).toEqual(w.growth);
  const meter = Object.assign(new ServiceMeter(), JSON.parse(JSON.stringify(w.meter)));
  expect(meter.rate(w.minute)).toBe(w.meter.rate(w.minute));
});

test("opening platform 3 paints island 2; opening platform 4 changes no tiles", () => {
  const w = createWorld(1);
  const island = w.map.islands[1]!;
  addPlatform(w, 3);
  const gateY = island.gateLine.y;
  for (const [r, t] of [
    [island.walkway, Tile.Platform],
    [island.leftTrack, Tile.Track],
    [island.rightTrack, Tile.Track],
    [island.foot, Tile.Floor],
  ] as const)
    for (const [x, y] of tilesOf(r)) if (r !== island.walkway || y !== gateY) expect(w.grid.tile(x, y)).toBe(t);
  expect(tilesOf(island.gateLine).map(([x, y]) => w.grid.tile(x, y))).toEqual([
    Tile.GateClosed,
    Tile.Gate,
    Tile.GateClosed,
    Tile.Gate,
    Tile.GateClosed,
  ]);
  const v = w.grid.version;
  w.events.length = 0;
  addPlatform(w, 4);
  expect(w.grid.version).toBe(v);
  expect(w.platformsAdded).toBe(4);
  expect(w.platformActive[3]).toBe(true);
  expect(toasts(w)).toEqual(["Platform 4 opens"]);
});

/** Closes a day of 100 counted journeys at `rate` on time. */
function closeDay(w: World, rate: number): void {
  closeGrowthDay(w, Math.round(rate * 100), 100 - Math.round(rate * 100), Math.floor(w.minute));
}

test("SHRINK_DAYS closed days in a row below SHRINK_RATE close a platform, cooldown or not", () => {
  const w = createWorld(1);
  addPlatform(w, 3);
  addPlatform(w, 4);
  w.growth.cooldownUntil = w.minute + 10 * COOLDOWN_MIN;
  for (let d = 1; d < SHRINK_DAYS; d++) closeDay(w, SHRINK_RATE - 0.1);
  expect(activePlatformIds(w)).toEqual([1, 2, 3, 4]);
  closeDay(w, SHRINK_RATE - 0.1);
  expect(activePlatformIds(w)).toEqual([1, 2, 3]);
  expect(toasts(w)).toContain("Platform 4 is closed: too many people missed their trains");
  expect(w.growth.badDays).toBe(0);
  expect(w.growth.cooldownUntil).toBe(Math.floor(w.minute) + COOLDOWN_MIN);
});

test("a day at or above SHRINK_RATE, or with too few journeys, closes nothing and clears the run of bad days", () => {
  const w = createWorld(1);
  addPlatform(w, 3);
  closeDay(w, SHRINK_RATE);
  closeGrowthDay(w, 0, MIN_SAMPLES - 1, Math.floor(w.minute));
  expect(w.growth.lastDayRate).toBeNull();
  expect(w.growth.badDays).toBe(0);
  expect(activePlatformIds(w)).toEqual([1, 2, 3]);
});

test("no growth after a closed day below GROW_RATE, however good the meter", () => {
  const w = createWorld(1);
  fixedMeter(w).value = GOOD;
  closeDay(w, GROW_RATE - 0.05);
  tick(w, SUSTAIN_MIN + 60);
  expect(w.platformsAdded).toBe(2);
  closeDay(w, GROW_RATE);
  tick(w, SUSTAIN_MIN + 1);
  expect(w.platformsAdded).toBe(3);
});

test("each day's close feeds its counted journeys to the daily rule", () => {
  const w = createWorld(1);
  addPlatform(w, 3);
  w.minute = 1440 - 0.01;
  w.stats = { movedToday: 140, onTimeToday: 60, missedToday: 40 };
  step(w, 0.01);
  expect(w.growth.lastDayRate).toBeCloseTo(0.6);
  expect(activePlatformIds(w)).toEqual([1, 2]);
});

test("closing a platform leaves a train standing at it to depart", () => {
  const w = createWorld(5);
  addPlatform(w, 3);
  w.timetable.ensureHorizon(w.minute, activePlatformIds(w), w.rng);
  const [standing, later] = w.timetable.upcoming(3, w.minute);
  w.minute = standing!.arriveAt + 0.5;
  deactivatePlatform(w, 3);
  expect(standing!.cancelled).toBe(false);
  expect(later!.cancelled).toBe(true);
});
