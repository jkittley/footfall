import { expect, test } from "vitest";
import { dayIndex } from "../../src/sim/clock";
import { SIM_DT } from "../../src/sim/constants";
import {
  DISRUPTION_REFUND_FACTOR,
  FARE_BONUS,
  Ledger,
  REFUND,
  STARTING_CASH,
  UPKEEP_PER_DAY,
  dailyUpkeep,
} from "../../src/sim/economy";
import { Tile, Zone } from "../../src/sim/grid";
import { Journey } from "../../src/sim/people";
import { createWorld, recordOutcome, step, type World } from "../../src/sim/world";

function outcomeFor(w: World, journey: Journey, onTime: boolean, excluded = false): void {
  const i = w.people.alloc();
  w.people.journey[i] = journey;
  recordOutcome(w, i, onTime, excluded);
}

test("canAfford refuses a build that would go below zero", () => {
  const l = new Ledger(100);
  expect(l.canAfford(100)).toBe(true);
  expect(l.canAfford(101)).toBe(false);
});

test("blocks building while negative but keeps crediting", () => {
  const l = new Ledger(10);
  l.debit("refunds", 50);
  expect(l.canAfford(1)).toBe(false);
  l.credit("rent", 100);
  expect(l.balance).toBe(60);
  expect(l.canAfford(60)).toBe(true);
});

test("upkeep on the starting map is charged once at midnight", () => {
  const w = createWorld(1);
  const upkeep = dailyUpkeep(w);
  expect(upkeep).toBeGreaterThan(0);
  w.minute = 1440 - 0.01;
  w.trainsUpTo = w.minute;
  const before = w.ledger.balance;
  step(w, SIM_DT);
  expect(dayIndex(w.minute)).toBe(1);
  const ends = w.events.flatMap((e) => (e.kind === "dayEnd" ? [e.summary] : []));
  expect(ends).toHaveLength(1);
  expect(ends[0]!.day).toBe(0);
  expect(ends[0]!.costs).toBe(upkeep);
  expect(w.ledger.balance).toBe(before - upkeep);
  expect(w.ledger.today.maintenance).toBe(0);
  expect(w.stats).toEqual({ movedToday: 0, onTimeToday: 0, missedToday: 0 });
  step(w, SIM_DT);
  expect(w.events.filter((e) => e.kind === "dayEnd")).toHaveLength(1);
});

test("a huge step closes each day once", () => {
  const w = createWorld(1);
  w.minute = 3 * 1440 + 10;
  w.trainsUpTo = w.minute;
  w.timetable.ensureHorizon(w.minute, [1], w.rng);
  const before = w.ledger.balance;
  step(w, SIM_DT);
  const days = w.events.flatMap((e) => (e.kind === "dayEnd" ? [e.summary.day] : []));
  expect(days).toEqual([0, 1, 2]);
  expect(w.ledger.balance).toBe(before - 3 * dailyUpkeep(w));
});

test("a zoned tile pays its zone rate instead of the floor rate", () => {
  const w = createWorld(1);
  const base = dailyUpkeep(w);
  let target = -1;
  for (let i = 0; i < w.grid.tiles.length && target < 0; i++) {
    if (w.grid.tiles[i] === Tile.Floor && w.grid.zones[i] === Zone.None) target = i;
  }
  const [x, y] = w.grid.xy(target);
  w.grid.setZone(x, y, Zone.Toilet, 0);
  expect(dailyUpkeep(w)).toBe(base - UPKEEP_PER_DAY.floor + UPKEEP_PER_DAY.toilet);
});

test("on-time departure pays the fare bonus, a miss costs a refund", () => {
  const w = createWorld(1);
  outcomeFor(w, Journey.Departing, true);
  outcomeFor(w, Journey.Connecting, true);
  expect(w.ledger.today.fares).toBe(2 * FARE_BONUS);
  outcomeFor(w, Journey.Arriving, true);
  expect(w.ledger.today.fares).toBe(2 * FARE_BONUS);
  outcomeFor(w, Journey.Departing, false);
  outcomeFor(w, Journey.Arriving, false);
  expect(w.ledger.today.refunds).toBe(2 * REFUND);
  expect(w.ledger.balance).toBe(STARTING_CASH + 2 * FARE_BONUS - 2 * REFUND);
});

test("an excluded miss refunds at the disruption factor and leaves the rates alone", () => {
  const w = createWorld(1);
  outcomeFor(w, Journey.Departing, false, true);
  expect(w.ledger.today.refunds).toBeCloseTo(REFUND * DISRUPTION_REFUND_FACTOR);
  expect(w.stats).toEqual({ movedToday: 1, onTimeToday: 0, missedToday: 0 });
  outcomeFor(w, Journey.Departing, false);
  outcomeFor(w, Journey.Departing, true);
  expect(w.stats).toEqual({ movedToday: 3, onTimeToday: 1, missedToday: 1 });
});

test("an outcome is paid once per person", () => {
  const w = createWorld(1);
  const i = w.people.alloc();
  recordOutcome(w, i, false, false);
  recordOutcome(w, i, false, false);
  expect(w.ledger.today.refunds).toBe(REFUND);
});
