import { expect, test } from "vitest";
import { START_MINUTE } from "../../src/sim/clock";
import { createWorld } from "../../src/sim/world";
import { Timetable, trainPhase, type Service } from "../../src/sim/timetable";
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
    expect(list[list.length - 1]!.departAt).toBeGreaterThanOrEqual(START_MINUTE + 240 - 120);
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
