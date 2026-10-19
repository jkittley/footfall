import { expect, test } from "vitest";
import { DISRUPTION_REFUND_FACTOR, REFUND } from "../../src/sim/economy";
import { startDisruption, stepDisruptions } from "../../src/sim/disruptions";
import { addPlatform, deactivatePlatform, reactivatePlatform, shrink } from "../../src/sim/growth";
import { PState } from "../../src/sim/people";
import { activePlatformIds, createWorld, step, type World } from "../../src/sim/world";
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

  runMinutes(w, 100);
  expect(toasts(w).filter((t) => t === "Platform 2 reopens")).toHaveLength(1);
});

test("services the horizon adds while it runs are cancelled too", () => {
  const w = createWorld(5);
  const d = startDisruption(w, [2], 90);
  deactivatePlatform(w, 2);
  reactivatePlatform(w, 2);
  const firstNew = w.timetable.nextId;
  step(w, 1 / 30);
  const fresh = [...w.timetable.services.values()].filter((s) => s.id >= firstNew && s.platformId === 2);
  const inWindow = fresh.filter((s) => s.departAt <= d.endsAt);
  expect(inWindow.length).toBeGreaterThan(0);
  for (const s of inWindow) {
    expect(s.cancelled).toBe(true);
    expect(s.cancelReason).toBe("disruption");
  }
});

test("a train already standing at the platform leaves on time", () => {
  const w = createWorld(9);
  const s = w.timetable.upcoming(2, w.minute)[0]!;
  w.minute = s.arriveAt + 1;
  const [who] = booked(w, 2, s.id);
  startDisruption(w, [2], 90);
  expect(s.cancelled).toBe(false);
  expect(w.events.filter((e) => e.kind === "outcome")).toHaveLength(0);
  expect(w.people.serviceId[who!]).toBe(s.id);
});

test("the end toast names only platforms still active", () => {
  const w = createWorld(10);
  const d = startDisruption(w, [1, 2], 60);
  deactivatePlatform(w, 2);
  w.events.length = 0;
  w.minute = d.endsAt;
  stepDisruptions(w, 0);
  expect(toasts(w)).toEqual(["Platform 1 reopens"]);
  const w2 = createWorld(10);
  const d2 = startDisruption(w2, [2], 60);
  deactivatePlatform(w2, 2);
  w2.events.length = 0;
  w2.minute = d2.endsAt;
  stepDisruptions(w2, 0);
  expect(toasts(w2)).toEqual([]);
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
  const waiting = ids.filter((i) => w.people.goalKey[i] === "platform:2" && w.timetable.services.get(w.people.serviceId[i]!)?.platformId === 2);
  expect(waiting.length).toBeGreaterThan(0);
  expect(waiting.length).toBeLessThan(ids.length);
  const services = new Set(waiting.map((i) => w.people.serviceId[i]!));
  for (const id of services) {
    const next = w.timetable.services.get(id)!;
    expect(next.cancelled).toBe(false);
    expect(next.departAt).toBeGreaterThan(d.endsAt);
  }
  const lastDepart = Math.max(...[...services].map((id) => w.timetable.services.get(id)!.departAt));
  // Track each waiter until it leaves the store, counting the outcomes it emits meanwhile.
  const outcomes = new Map<number, number>();
  const tracked = new Set(waiting);
  const freed = new Set<number>();
  let seen = w.events.length;
  while (w.minute < lastDepart + 2) {
    step(w, 1 / 30);
    for (; seen < w.events.length; seen++) {
      const e = w.events[seen]!;
      if (e.kind === "outcome" && tracked.has(e.personId)) outcomes.set(e.personId, (outcomes.get(e.personId) ?? 0) + 1);
    }
    for (const i of tracked) if (!w.people.isAlive(i)) { tracked.delete(i); freed.add(i); }
  }
  // The excluded outcome came at the start (before tracking); boarding or missing adds nothing.
  for (const i of waiting) expect(outcomes.get(i) ?? 0).toBe(0);
  expect(freed.size).toBe(waiting.length);
  expect(w.timetable.upcoming(2, w.minute).length).toBeGreaterThan(0);
});

test("growth will not close the last platform outside the disruption", () => {
  const w = createWorld(11);
  addPlatform(w, 3);
  addPlatform(w, 4);
  startDisruption(w, [1, 2, 3], 60);
  expect(shrink(w)).toBe(false);
  expect(w.platformActive[3]).toBe(true);
});

test("with three or more active platforms at least one stays open", () => {
  const w = createWorld(12);
  addPlatform(w, 3);
  addPlatform(w, 4);
  addPlatform(w, 5);
  w.rng.next = () => 0;
  stepDisruptions(w, 1);
  const d = w.disruptions[0]!;
  expect(d.platforms.length).toBe(1);
  expect(activePlatformIds(w).filter((id) => !d.platforms.includes(id)).length).toBeGreaterThanOrEqual(1);
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
