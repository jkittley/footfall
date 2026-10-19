import { expect, test } from "vitest";
import { GATE_QUEUE_LONG, createAutoplay, gateQueue, playDays, roomyStation } from "../../src/sim/autoplay";
import { applyPlacement, previewPlacement } from "../../src/sim/build";
import { SIM_DT } from "../../src/sim/constants";
import { Tile } from "../../src/sim/grid";
import { addPlatform } from "../../src/sim/growth";
import { PState } from "../../src/sim/people";
import { createWorld, step, type World } from "../../src/sim/world";
import { openEveryGate, tilesOf } from "./helpers";

// Fast checks only (at most 2 game days each). The multi-day targets (growth pace, money, rent,
// the whole-day needs check) are in `npm run balance`.

function withPlatforms(seed: number, platforms: number): World {
  const w = createWorld(seed);
  while (w.platformsAdded < platforms) addPlatform(w, w.platformsAdded + 1);
  return w;
}

/** Steps until the clock reaches `until`, calling `each` after every step; drains events. */
function runTo(w: World, until: number, each: () => void = () => {}): void {
  while (w.minute < until) {
    step(w, SIM_DT);
    each();
    w.events.length = 0;
  }
}

test("an idle player on the starting map grows to at most 3 platforms and never errors over 2 game days", () => {
  const w = createWorld(1);
  const rows = playDays(w, 2, null);
  expect(rows).toHaveLength(2);
  expect(w.platformsAdded).toBeLessThanOrEqual(3);
  for (const r of rows) expect(r.moved).toBeGreaterThan(0);
});

test("the autoplay player builds and stays in money over its first 2 game days, growing no faster than the idle one", () => {
  const w = createWorld(1);
  const rows = playDays(w, 2, createAutoplay(w));
  expect(w.facilities.size).toBeGreaterThan(0);
  expect(w.signs.length).toBeGreaterThan(0);
  expect(w.platformsAdded).toBeLessThanOrEqual(3);
  for (const r of rows) expect(r.balance).toBeGreaterThan(0);
});

test("with 2 gates a queue forms at the busiest island at the morning peak, and opening its gates cuts it", () => {
  const peaks = (open: number | null): number[] => {
    const w = withPlatforms(1, 6);
    if (open !== null) {
      const line = w.map.islands[open]!.gateLine;
      for (const [x, y] of tilesOf(line)) if (w.grid.tile(x, y) === Tile.GateClosed) applyPlacement(w, previewPlacement(w, "gate", { x, y, w: 1, h: 1 }));
    }
    const islands = w.map.islands.slice(0, 3);
    const peak = islands.map(() => 0);
    let minute = -1;
    runTo(w, 10 * 60, () => {
      if (Math.floor(w.minute) === minute) return;
      minute = Math.floor(w.minute);
      islands.forEach((isl, k) => (peak[k] = Math.max(peak[k]!, gateQueue(w, isl))));
    });
    return peak;
  };
  const shut = peaks(null);
  const busiest = shut.indexOf(Math.max(...shut));
  expect(shut[busiest]).toBeGreaterThan(GATE_QUEUE_LONG);
  const opened = peaks(busiest);
  expect(opened[busiest]).toBeLessThan(shut[busiest]!);
});

test("desperate passengers miss more often than other passengers with the same spare time", () => {
  const w = withPlatforms(1, 6);
  openEveryGate(w);
  const p = w.people;
  // Outcomes arrive after the step that freed the person, so each slot's state is kept from before it.
  const desperate = new Uint8Array(p.cap);
  const slack = new Float64Array(p.cap);
  const tally = { desperate: { all: 0, missed: 0 }, other: { all: 0, missed: 0 } };
  while (w.minute < 5 * 60 + 10 * 60) {
    for (let i = 0; i < p.end; i++) {
      if (!p.isAlive(i)) continue;
      desperate[i] = p.desperate[i]!;
      slack[i] = p.deadline[i]! - p.spawnedAt[i]! - p.spawnWalk[i]!;
    }
    step(w, SIM_DT);
    for (const e of w.events) {
      if (e.kind !== "outcome" || e.excluded || slack[e.personId]! < 10 || slack[e.personId]! > 45) continue;
      const t = desperate[e.personId] ? tally.desperate : tally.other;
      t.all++;
      if (!e.onTime) t.missed++;
    }
    w.events.length = 0;
  }
  expect(tally.desperate.all).toBeGreaterThan(30);
  expect(tally.desperate.missed / tally.desperate.all).toBeGreaterThan(2 * (tally.other.missed / tally.other.all));
});

test("toilets cut desperate walking person-minutes by at least a quarter", () => {
  const desperateMinutes = (restrooms: boolean): number => {
    const w = createWorld(1);
    w.ledger.balance = 1e6;
    roomyStation(w, restrooms);
    let n = 0;
    let minute = -1;
    runTo(w, 5 * 60 + 8 * 60, () => {
      if (Math.floor(w.minute) === minute) return;
      minute = Math.floor(w.minute);
      w.people.forEachAlive((i) => {
        if (w.people.desperate[i] && w.people.state[i] === PState.Walking) n++;
      });
    });
    return n;
  };
  const without = desperateMinutes(false);
  expect(without).toBeGreaterThan(0);
  expect(desperateMinutes(true)).toBeLessThanOrEqual(0.75 * without);
});
