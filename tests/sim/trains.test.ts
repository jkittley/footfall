import { expect, test } from "vitest";
import { createWorld, waitingSpots, walkableTargets, type World } from "../../src/sim/world";
import { deactivatePlatform } from "../../src/sim/growth";
import { stepTrains } from "../../src/sim/trains";
import { applyPlacement, previewPlacement } from "../../src/sim/build";
import { PState } from "../../src/sim/people";
import { OY, OX, platformTiles, runMinutes } from "./helpers";

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
  w.people.x[i] = OX + 10.5;
  w.people.y[i] = OY + 70.5;
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
  w.people.x[i] = OX + 10.5;
  w.people.y[i] = OY + 57.5;
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

function waitingAt(w: World, platformId: number, [tx, ty]: [number, number]): number {
  const i = w.people.alloc();
  w.people.x[i] = tx + 0.5;
  w.people.y[i] = ty + 0.5;
  w.people.state[i] = PState.Waiting;
  w.people.serviceId[i] = firstService(w, platformId).id;
  return i;
}

test("a platform-2 passenger waits on the right half and boards from it", () => {
  const w = createWorld(2);
  // Its half of the walkway, less the gate row at the foot.
  const gateY = w.map.islands[0]!.gateLine.y;
  const right = new Set(platformTiles(2).filter(([, y]) => y !== gateY).map(([x, y]) => w.grid.idx(x, y)));
  const spots = walkableTargets(w, "platform:2");
  expect(spots.length).toBe(right.size);
  for (const t of spots) expect(right.has(t)).toBe(true);
  // On platform 1's half of the same walkway, a platform-2 passenger is not on their platform.
  const wrongHalf = waitingAt(w, 2, platformTiles(1)[10]!);
  const rightHalf = waitingAt(w, 2, platformTiles(2)[10]!);
  w.minute = firstService(w, 2).arriveAt + 1;
  stepTrains(w);
  expect(w.people.isAlive(rightHalf)).toBe(false);
  expect(w.people.isAlive(wrongHalf)).toBe(true);
});

test("nobody boards from a seat built on their half of the island", () => {
  const w = createWorld(2);
  const x0 = w.map.islands[0]!.leftTrack.x;
  const seat = previewPlacement(w, "seating", { x: x0 + 2, y: OY + 30, w: 1, h: 2 });
  expect(applyPlacement(w, seat)).toBe(true);
  const onSeat = waitingAt(w, 1, [x0 + 2, OY + 30]);
  const onEdge = waitingAt(w, 1, [x0 + 1, OY + 30]);
  w.minute = firstService(w, 1).arriveAt + 1;
  stepTrains(w);
  expect(w.people.isAlive(onEdge)).toBe(false);
  expect(w.people.isAlive(onSeat)).toBe(true);
});

test("waiting passengers stand on the track edge of their own platform's half", () => {
  const w = createWorld(8);
  runMinutes(w, 120);
  let checked = 0;
  for (let i = 0; i < w.people.end; i++) {
    if (!w.people.isAlive(i) || w.people.state[i] !== PState.Waiting) continue;
    const key = w.people.targetKey[i]!;
    const s = w.timetable.services.get(w.people.serviceId[i]!);
    if (!key.startsWith("spot:") || !s) continue;
    const slot = w.map.slots[s.platformId - 1]!;
    const edge = slot.side === "left" ? slot.platform.x : slot.platform.x + slot.platform.w - 1;
    const [x, y] = w.grid.xy(Number(key.slice(5)));
    expect(x).toBe(edge);
    expect(y).toBeGreaterThanOrEqual(slot.platform.y);
    expect(y).toBeLessThan(slot.platform.y + slot.platform.h);
    checked++;
  }
  expect(checked).toBeGreaterThan(0);
});

test("waiting spots are the walkable outer column beside each platform's track", () => {
  const w = createWorld(2);
  for (const id of [1, 2]) {
    const slot = w.map.slots[id - 1]!;
    const spots = waitingSpots(w, `platform:${id}`).map((t) => w.grid.xy(t));
    // Every row of its half but the gate row at the foot.
    expect(spots).toHaveLength(slot.platform.h - 1);
    for (const [, y] of spots) expect(y).not.toBe(w.map.islands[0]!.gateLine.y);
    // Each spot is one step from the platform's own track.
    for (const [x] of spots) expect(Math.abs(x - slot.track.x)).toBe(1);
  }
});

test("deactivating platform 2 leaves platform 1 boarding normally", () => {
  const w = createWorld(2);
  deactivatePlatform(w, 2);
  expect(w.timetable.upcoming(1, w.minute).length).toBeGreaterThan(0);
  const i = waitingAt(w, 1, platformTiles(1)[10]!);
  w.minute = firstService(w, 1).arriveAt + 1;
  stepTrains(w);
  expect(w.people.isAlive(i)).toBe(false);
  expect(outcomes(w)).toEqual([{ kind: "outcome", personId: i, onTime: true, excluded: false }]);
});
