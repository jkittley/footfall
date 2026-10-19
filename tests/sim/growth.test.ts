import { expect, test } from "vitest";
import { ServiceMeter, addPlatform, deactivatePlatform, stepGrowth } from "../../src/sim/growth";
import { FacilityKind, createFacility } from "../../src/sim/facilities";
import { Tile, Zone } from "../../src/sim/grid";
import { PState } from "../../src/sim/people";
import { activePlatformIds, createWorld, recordOutcome, type World } from "../../src/sim/world";
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

/** Advances the clock `minutes` whole minutes, one growth step each. */
function tick(w: World, minutes: number): void {
  for (let k = 0; k < minutes; k++) {
    w.minute = Math.floor(w.minute) + 1;
    stepGrowth(w);
  }
}

test("growth acts at exactly SUSTAIN_MIN of good service, not a minute before", () => {
  const w = createWorld(1);
  fixedMeter(w).value = 0.95;
  tick(w, 180);
  expect(w.platformsAdded).toBe(2);
  tick(w, 1);
  expect(w.platformsAdded).toBe(3);
});

test("a rate in the dead band resets the sustain timer", () => {
  const w = createWorld(1);
  const m = fixedMeter(w);
  m.value = 0.95;
  tick(w, 100);
  m.value = 0.8;
  tick(w, 1);
  expect(w.growth.goodSince).toBeNull();
  expect(w.growth.badSince).toBeNull();
  m.value = 0.95;
  tick(w, 180);
  expect(w.platformsAdded).toBe(2);
  tick(w, 1);
  expect(w.platformsAdded).toBe(3);
});

test("cooldown blocks a second action for COOLDOWN_MIN", () => {
  const w = createWorld(1);
  fixedMeter(w).value = 1;
  tick(w, 181);
  expect(w.platformsAdded).toBe(3);
  // 240 minutes of cooldown, then a fresh 180 of sustain.
  tick(w, 419);
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

test("a platform opening over an old build clears the zone and frees its people", () => {
  const w = createWorld(1);
  const foot = w.map.slots[2]!.foot;
  for (let y = foot.y; y < foot.y + foot.h; y++) for (let x = foot.x; x < foot.x + foot.w; x++) w.grid.setTile(x, y, Tile.Floor);
  const shop = createFacility(w, FacilityKind.Seating, { x: foot.x, y: foot.y, w: 2, h: 2 });
  const i = w.people.alloc();
  w.people.x[i] = foot.x + 0.5;
  w.people.y[i] = foot.y + 0.5;
  w.people.state[i] = PState.Seated;
  w.people.goalKey[i] = "platform:1";
  shop.serving.push({ pid: i, until: w.minute + 10 });

  addPlatform(w, 3);

  expect(w.facilities.has(shop.id)).toBe(false);
  expect(w.grid.zone(foot.x, foot.y)).toBe(Zone.None);
  expect(w.people.state[i]).toBe(PState.Walking);
  expect(w.people.targetKey[i]).toBe("platform:1");
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

test("opening an island clears old builds across its whole footprint", () => {
  const w = createWorld(1);
  const island = w.map.islands[1]!;
  // The gap column at the island's right sits in its foot but in neither slot's half.
  const x = island.foot.x + 6;
  for (const [tx, ty] of tilesOf(island.foot)) w.grid.setTile(tx, ty, Tile.Floor);
  const seat = createFacility(w, FacilityKind.Seating, { x, y: island.foot.y, w: 1, h: 2 });
  addPlatform(w, 3);
  expect(w.facilities.has(seat.id)).toBe(false);
  expect(w.grid.zone(x, island.foot.y)).toBe(Zone.None);
});
