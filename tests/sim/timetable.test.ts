import { expect, test } from "vitest";
import { START_MINUTE } from "../../src/sim/clock";
import { createWorld } from "../../src/sim/world";
import { FIRST_STAGGER_MAX_MIN, MAX_INTERVAL_MIN, MIN_INTERVAL_MIN, Timetable, trainPhase, type Service } from "../../src/sim/timetable";
import { Rng } from "../../src/sim/rng";

function onPlatform(t: Timetable, platformId: number): Service[] {
  return [...t.services.values()].filter((s) => s.platformId === platformId).sort((a, b) => a.arriveAt - b.arriveAt);
}

test("services cover the horizon for each active platform without overlap", () => {
  const w = createWorld(1);
  w.timetable.ensureHorizon(START_MINUTE, [1, 2], w.rng);
  for (const p of [1, 2]) {
    const list = onPlatform(w.timetable, p);
    expect(list.length).toBeGreaterThan(0);
    for (let k = 1; k < list.length; k++) expect(list[k]!.arriveAt).toBeGreaterThanOrEqual(list[k - 1]!.departAt);
    expect(list[list.length - 1]!.departAt).toBeGreaterThanOrEqual(START_MINUTE + 240);
  }
});

test("peak hours get more services than midday", () => {
  const t = new Timetable();
  const rng = new Rng(7);
  for (let now = START_MINUTE; now <= 14 * 60; now += 10) t.ensureHorizon(now, [1], rng);
  const count = (from: number, to: number) =>
    onPlatform(t, 1).filter((s) => s.arriveAt >= from * 60 && s.arriveAt < to * 60).length;
  expect(count(7, 10)).toBeGreaterThan(count(11, 14));
});

test("train phases", () => {
  const s: Service = {
    id: 1, platformId: 1, destination: "Ashby", arriveAt: 100, departAt: 112, alighting: 0, cancelled: false, cancelReason: null,
  };
  expect(trainPhase(s, 96)).toBeNull();
  expect(trainPhase(s, 98)).toBe("approaching");
  expect(trainPhase(s, 105)).toBe("dwelling");
  expect(trainPhase(s, 113)).toBe("leaving");
  expect(trainPhase(s, 116)).toBeNull();
});

test("each platform's first service arrives within 30 minutes, even in the sparse early morning", () => {
  for (let seed = 1; seed <= 20; seed++) {
    const t = new Timetable();
    t.ensureHorizon(START_MINUTE, [1, 2, 3], new Rng(seed));
    for (const p of [1, 2, 3]) {
      const first = onPlatform(t, p)[0]!;
      expect(first.arriveAt).toBeGreaterThan(START_MINUTE);
      expect(first.arriveAt).toBeLessThanOrEqual(START_MINUTE + FIRST_STAGGER_MAX_MIN);
    }
  }
});

test("later services keep the demand-driven interval", () => {
  const t = new Timetable();
  t.ensureHorizon(START_MINUTE, [1], new Rng(5));
  const [a, b] = onPlatform(t, 1);
  // At 05:00 demand is at its floor, so the interval is the 60-minute maximum.
  expect(b!.arriveAt - a!.departAt).toBe(MAX_INTERVAL_MIN);
});

test("services on a platform are never more than 60 minutes apart, nor less than 20", () => {
  const t = new Timetable();
  const rng = new Rng(9);
  for (let now = START_MINUTE; now <= START_MINUTE + 2 * 1440; now += 10) t.ensureHorizon(now, [1], rng);
  const list = onPlatform(t, 1);
  for (let k = 1; k < list.length; k++) {
    const gap = list[k]!.arriveAt - list[k - 1]!.departAt;
    expect(gap).toBeGreaterThanOrEqual(MIN_INTERVAL_MIN);
    expect(gap).toBeLessThanOrEqual(MAX_INTERVAL_MIN);
  }
  expect(MAX_INTERVAL_MIN).toBe(60);
});
