import { expect, test } from "vitest";
import { DISRUPTION_REFUND_FACTOR, REFUND } from "../../src/sim/economy";
import { startDisruption, stepDisruptions } from "../../src/sim/disruptions";
import { PState } from "../../src/sim/people";
import { createWorld, step, type World } from "../../src/sim/world";
import { platformTiles, runMinutes } from "./helpers";

function booked(w: World, platformId: number, serviceId: number, n = 1): number[] {
  const ids: number[] = [];
  for (let k = 0; k < n; k++) {
    const [tx, ty] = platformTiles(platformId)[k % 10]!;
    const i = w.people.alloc();
    w.people.x[i] = tx + 0.5;
    w.people.y[i] = ty + 0.5;
    w.people.state[i] = PState.Waiting;
    w.people.goalKey[i] = `platform:${platformId}`;
    w.people.serviceId[i] = serviceId;
    ids.push(i);
  }
  return ids;
}

function toasts(w: World): string[] {
  return w.events.flatMap((e) => (e.kind === "toast" ? [e.text] : []));
}

test("a disruption closes platforms and cancels their services in the window", () => {
  const w = createWorld(5);
  const d = startDisruption(w, [2], 90);
  expect(d.endsAt).toBe(w.minute + 90);
  expect(d.text).toMatch(/^Signal failure at .+: Platform 2 closed until \d\d:\d\d$/);
  let inWindow = 0;
  for (const s of w.timetable.services.values()) {
    const inside = s.departAt >= d.startsAt && s.departAt <= d.endsAt;
    if (s.platformId === 2 && inside) {
      inWindow++;
      expect(s.cancelled).toBe(true);
      expect(s.cancelReason).toBe("disruption");
    } else if (s.platformId !== 2) expect(s.cancelled).toBe(false);
  }
  expect(inWindow).toBeGreaterThan(0);
  expect(toasts(w)).toEqual([d.text]);

  // Services the horizon adds while it runs are cancelled too, and the end is announced once.
  runMinutes(w, 100);
  for (const s of w.timetable.services.values()) {
    if (s.platformId === 2 && s.departAt >= d.startsAt && s.departAt <= d.endsAt) expect(s.cancelled).toBe(true);
  }
  expect(toasts(w).filter((t) => t === "Platform 2 reopens")).toHaveLength(1);
});

test("text lists two and three platforms", () => {
  const w = createWorld(5);
  expect(startDisruption(w, [4, 3], 60).text).toMatch(/Platforms 3 and 4 closed until/);
  const w2 = createWorld(5);
  expect(startDisruption(w2, [3, 4, 5], 60).text).toMatch(/Platforms 3, 4 and 5 closed until/);
});

test("disruption misses are excluded from the meter and refunded at the lower rate", () => {
  const w = createWorld(6);
  const s = w.timetable.upcoming(2, w.minute)[0]!;
  const ids = booked(w, 2, s.id, 20);
  const before = w.ledger.today.refunds;
  startDisruption(w, [2], 90);
  const outs = w.events.filter((e) => e.kind === "outcome");
  expect(outs).toHaveLength(20);
  for (const o of outs) expect(o).toMatchObject({ onTime: false, excluded: true });
  expect(w.meter.total.reduce((a, b) => a + b, 0)).toBe(0);
  expect(w.stats.missedToday).toBe(0);
  expect(w.ledger.today.refunds - before).toBeCloseTo(20 * REFUND * DISRUPTION_REFUND_FACTOR);
  // Nothing more is recorded for them, by the guard or on a later boarding.
  step(w, 1 / 30);
  expect(w.events.filter((e) => e.kind === "outcome")).toHaveLength(20);
  for (const i of ids) if (w.people.isAlive(i)) expect(w.people.counted[i]).toBe(1);
});

test("services resume after the disruption ends", () => {
  const w = createWorld(7);
  const s = w.timetable.upcoming(2, w.minute)[0]!;
  const ids = booked(w, 2, s.id, 30);
  const d = startDisruption(w, [2], 90);
  // Those who wait are booked onto a service after the closure, on the same platform.
  const waiting = ids.filter((i) => w.people.isAlive(i) && w.people.goalKey[i] === "platform:2");
  expect(waiting.length).toBeGreaterThan(0);
  for (const i of waiting) {
    const next = w.timetable.services.get(w.people.serviceId[i]!)!;
    expect(next.platformId).toBe(2);
    expect(next.cancelled).toBe(false);
    expect(next.departAt).toBeGreaterThan(d.endsAt);
  }
  // The rest were rebooked onto the open platform.
  for (const i of ids) {
    if (!w.people.isAlive(i)) continue;
    expect(w.timetable.services.get(w.people.serviceId[i]!)?.cancelled ?? false).toBe(false);
  }
  runMinutes(w, 95);
  expect(w.timetable.upcoming(2, w.minute).length).toBeGreaterThan(0);
});

test("only one disruption runs at a time and at least one platform stays open", () => {
  const w = createWorld(8);
  w.rng.next = () => 0; // always below the start probability
  stepDisruptions(w, 1);
  expect(w.disruptions).toHaveLength(1);
  expect(w.disruptions[0]!.platforms).toHaveLength(1);
  stepDisruptions(w, 1);
  expect(w.disruptions).toHaveLength(1);
});
