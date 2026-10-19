import { expect, test } from "vitest";
import { createWorld, type World } from "../../src/sim/world";
import { stepTrains } from "../../src/sim/trains";
import { PState } from "../../src/sim/people";
import { platformTiles, runMinutes } from "./helpers";

function firstService(w: World, platformId: number) {
  const s = w.timetable.upcoming(platformId, w.minute)[0];
  if (!s) throw new Error("no service");
  return s;
}

function outcomes(w: World) {
  return w.events.filter((e) => e.kind === "outcome");
}

test("a waiting booked passenger boards and is on time", () => {
  const w = createWorld(2);
  const s = firstService(w, 1);
  const [tx, ty] = platformTiles(1)[10]!;
  const i = w.people.alloc();
  w.people.x[i] = tx + 0.5;
  w.people.y[i] = ty + 0.5;
  w.people.state[i] = PState.Waiting;
  w.people.serviceId[i] = s.id;
  w.minute = s.arriveAt + 1;
  stepTrains(w);
  expect(w.people.isAlive(i)).toBe(false);
  expect(outcomes(w)).toEqual([{ kind: "outcome", personId: i, onTime: true, excluded: false }]);
  expect(w.stats.onTimeToday).toBe(1);
});

test("a passenger not on the platform at departure misses once and is rebooked", () => {
  const w = createWorld(3);
  const s = firstService(w, 1);
  const i = w.people.alloc();
  w.people.x[i] = 10.5;
  w.people.y[i] = 70.5;
  w.people.state[i] = PState.Walking;
  w.people.serviceId[i] = s.id;

  w.minute = s.departAt + 0.01;
  stepTrains(w);
  const next = w.timetable.upcoming(1, s.departAt)[0]!;
  expect(w.people.serviceId[i]).toBe(next.id);
  expect(w.people.counted[i]).toBe(1);

  w.minute = next.departAt + 0.01;
  stepTrains(w);
  expect(w.people.serviceId[i]).not.toBe(next.id);
  expect(w.people.isAlive(i)).toBe(true);
  expect(outcomes(w)).toEqual([{ kind: "outcome", personId: i, onTime: false, excluded: false }]);
  expect(w.stats.missedToday).toBe(1);
});

test("stepping the world runs the trains and keeps the timetable ahead", () => {
  const w = createWorld(4);
  const start = w.minute;
  runMinutes(w, 180);
  expect(w.minute).toBeGreaterThanOrEqual(start + 180);
  expect(w.trainsUpTo).toBe(w.minute);
  for (const p of [1, 2]) expect(w.timetable.upcoming(p, w.minute + 200).length).toBeGreaterThan(0);
  for (const s of w.timetable.services.values()) expect(s.departAt).toBeGreaterThanOrEqual(w.minute - 60);
});

test("a passenger booked on a cancelled service is rebooked, not left dangling", () => {
  const w = createWorld(6);
  const s = firstService(w, 1);
  const i = w.people.alloc();
  w.people.x[i] = 10.5;
  w.people.y[i] = 57.5;
  w.people.state[i] = PState.Walking;
  w.people.serviceId[i] = s.id;
  w.people.goalKey[i] = "platform:1";
  w.people.targetKey[i] = "platform:1";
  s.cancelled = true;
  s.cancelReason = "disruption";
  w.minute += 0.5;
  stepTrains(w);
  const next = w.timetable.services.get(w.people.serviceId[i]!);
  expect(next).toBeDefined();
  expect(next!.cancelled).toBe(false);
  expect(w.people.goalKey[i]).toBe(`platform:${next!.platformId}`);
  expect(outcomes(w)).toEqual([]);
});
