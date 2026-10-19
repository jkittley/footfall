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
import { Grid, Tile, Zone } from "../../src/sim/grid";
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
  w.stats = { movedToday: 5, onTimeToday: 3, missedToday: 2 };
  w.ledger.credit("fares", 40);
  const before = w.ledger.balance;
  step(w, SIM_DT);
  const sums = w.events.flatMap((e) => (e.kind === "dayEnd" ? [e.summary] : []));
  expect(sums.map((s) => s.day)).toEqual([0, 1, 2]);
  expect(sums[0]).toMatchObject({ moved: 5, onTime: 3, missed: 2, income: 40 });
  for (const s of sums.slice(1)) {
    expect(s).toMatchObject({ moved: 0, onTime: 0, missed: 0, income: 0, costs: dailyUpkeep(w) });
  }
  expect(w.stats).toEqual({ movedToday: 0, onTimeToday: 0, missedToday: 0 });
  expect(w.ledger.today.maintenance).toBe(0);
  expect(w.ledger.today.fares).toBe(0);
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

test("dailyUpkeep totals a hand-built grid from the rates", () => {
  const w = createWorld(1);
  const g = new Grid(5, 2);
  w.grid = g;
  const row = [Tile.Floor, Tile.Platform, Tile.Entrance, Tile.Wall, Tile.Rail];
  row.forEach((t, x) => g.setTile(x, 0, t));
  g.setTile(0, 1, Tile.Track);
  g.setTile(1, 1, Tile.Floor);
  g.setZone(1, 1, Zone.Retail, 0);
  g.setTile(2, 1, Tile.Floor);
  g.setZone(2, 1, Zone.Seating, 1);
  g.setTile(3, 1, Tile.Floor);
  g.setZone(3, 1, Zone.Toilet, 2);
  g.setTile(4, 1, Tile.Floor);
  g.setZone(4, 1, Zone.Travelator, 3);
  const U = UPKEEP_PER_DAY;
  expect(dailyUpkeep(w)).toBe(3 * U.floor + U.wall + U.rail + U.retail + U.seating + U.toilet + U.travelator);
  expect(dailyUpkeep(w)).toBe(6 + 0.5 + 0.5 + 3 + 2 + 12 + 20);
});

test("closeDay sums income and costs, reports the balance and resets today", () => {
  const l = new Ledger(1000);
  l.credit("rent", 100);
  l.credit("fares", 20);
  l.debit("refunds", 12);
  l.debit("build", 300);
  const s = l.closeDay(4, { movedToday: 7, onTimeToday: 5, missedToday: 2 });
  expect(s).toEqual({ day: 4, moved: 7, onTime: 5, missed: 2, income: 120, costs: 312, balance: 808 });
  expect(Object.values(l.today).every((v) => v === 0)).toBe(true);
  expect(l.balance).toBe(808);
});

test("closeDay counts removal refunds as income", () => {
  const l = new Ledger(1000);
  l.debit("build", 80);
  l.credit("removals", 40);
  const s = l.closeDay(0, { movedToday: 0, onTimeToday: 0, missedToday: 0 });
  expect(s.income).toBe(40);
  expect(s.costs).toBe(80);
  expect(s.balance).toBe(960);
});

test("an excluded on-time outcome still earns the fare", () => {
  const w = createWorld(1);
  outcomeFor(w, Journey.Departing, true, true);
  expect(w.ledger.today.fares).toBe(FARE_BONUS);
  expect(w.stats).toEqual({ movedToday: 1, onTimeToday: 0, missedToday: 0 });
});

test("each sign adds its daily upkeep", () => {
  const w = createWorld(1);
  const base = dailyUpkeep(w);
  w.signs.push({ id: 900, tile: 0, kind: "toilets", pointsTo: -1 }, { id: 901, tile: 1, kind: "shops", pointsTo: -1 });
  expect(dailyUpkeep(w)).toBe(base + 2 * UPKEEP_PER_DAY.sign);
});

test("todayTotals sums income and cost lines without closing the day", () => {
  const l = new Ledger(1000);
  l.credit("rent", 50);
  l.credit("removals", 10);
  l.debit("build", 300);
  l.debit("refunds", 12);
  expect(l.todayTotals()).toEqual({ income: 60, costs: 312 });
  expect(l.today.build).toBe(300);
});

test("gate upkeep is counted", () => {
  const w = createWorld(1);
  const g = new Grid(3, 1);
  w.grid = g;
  g.setTile(0, 0, Tile.Gate);
  g.setTile(1, 0, Tile.Gate);
  g.setTile(2, 0, Tile.GateClosed);
  expect(UPKEEP_PER_DAY.gate).toBe(15);
  expect(dailyUpkeep(w)).toBe(2 * UPKEEP_PER_DAY.gate);
});
