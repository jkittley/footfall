import { expect, test } from "vitest";
import { GAME_MIN_PER_REAL_SEC, GATE_INTERVAL_SEC, SIM_DT } from "../../src/sim/constants";
import { CrowdGrid } from "../../src/sim/crowd";
import { Tile, type Grid } from "../../src/sim/grid";
import { HARBOUR_STREET, buildGrid } from "../../src/sim/maps/harbourStreet";
import { stepMovement } from "../../src/sim/movement";
import { PState, PeopleStore } from "../../src/sim/people";
import { FieldCache } from "../../src/sim/routeField";
import { createWorld, fieldTargets, waitingSpots } from "../../src/sim/world";
import { openFloor, runMinutes, tilesOf } from "./helpers";

const GATE_ROW = 10;

/** 9 x 40 floor cut by a gate line on row 10: open gates at `open`, the rest closed off. */
function gateHall(open: number[]): Grid {
  const g = openFloor(9, 40);
  for (let x = 0; x < g.w; x++) g.setTile(x, GATE_ROW, open.includes(x) ? Tile.Gate : Tile.GateClosed);
  return g;
}

interface Hall {
  grid: Grid;
  fields: FieldCache;
  people: PeopleStore;
  crowd: CrowdGrid;
  top: number[];
}

function hall(open: number[], walkers: number): Hall {
  const grid = gateHall(open);
  const people = new PeopleStore(walkers);
  for (let n = 0; n < walkers; n++) {
    const i = people.alloc();
    people.x[i] = (n % grid.w) + 0.5;
    people.y[i] = GATE_ROW + 2 + Math.floor(n / grid.w) * 0.5 + 0.25;
    people.state[i] = PState.Walking;
    people.targetKey[i] = "top";
    people.goalKey[i] = "top";
  }
  const top: number[] = [];
  for (let x = 0; x < grid.w; x++) top.push(grid.idx(x, 0));
  return { grid, fields: new FieldCache(grid), people, crowd: new CrowdGrid(grid.w, grid.h), top };
}

/** One step; arrivals leave. Returns how many arrived. */
function stepHall(h: Hall, dt: number): number {
  h.crowd.rebuild(h.people, h.grid);
  const arrived = stepMovement(h.grid, h.fields, () => h.top, h.people, h.crowd, dt);
  for (const i of arrived) h.people.free(i);
  return arrived.length;
}

test("a gate admits at most one person per interval, even at a large dt", () => {
  const dt = 0.5;
  const h = hall([4], 60);
  // Everyone starts below the gate line and walks north; reaching its row is passing the gate.
  const passed = new Set<number>();
  const perStep: number[] = [];
  for (let k = 0; k < 400 && h.people.count > 0; k++) {
    const alive = new Set<number>();
    h.people.forEachAlive((i) => alive.add(i));
    stepHall(h, dt);
    let n = 0;
    for (const i of alive) {
      if (passed.has(i)) continue;
      if (!h.people.isAlive(i) || h.people.y[i]! < GATE_ROW + 1) {
        passed.add(i);
        n++;
      }
    }
    perStep.push(n);
  }
  expect(passed.size).toBe(60);
  // Each step is a half-open window of dt, so it holds at most dt / interval entries.
  for (const n of perStep) expect(n).toBeLessThanOrEqual(Math.ceil(dt / GATE_INTERVAL_SEC - 1e-9));
  let busy = 0;
  perStep.forEach((n, k) => {
    if (n > 0) busy = k + 1;
  });
  expect(passed.size).toBeLessThanOrEqual((busy * dt) / GATE_INTERVAL_SEC + 1);
  expect(Math.max(...perStep)).toBe(2);
});

test("one gate is a bottleneck and opening a second roughly doubles throughput", () => {
  // Crossings in 60 game minutes.
  const seconds = 60 / GAME_MIN_PER_REAL_SEC;
  const through = (open: number[]): number => {
    const h = hall(open, 300);
    let n = 0;
    for (let t = 0; t < seconds; t += SIM_DT) n += stepHall(h, SIM_DT);
    return n;
  };
  const one = through([4]);
  const two = through([2, 6]);
  expect(one).toBeGreaterThan(10);
  expect(two).toBeLessThan(300);
  expect(two).toBeGreaterThanOrEqual(1.7 * one);
});

test("a turnstile admits nobody sooner than its cadence after the last entry", () => {
  const h = hall([4], 30);
  // Brisk walkers clear the tile faster than the cadence, so the cadence is what holds them back.
  h.people.forEachAlive((i) => (h.people.speedMul[i] = 4));
  const gate = h.grid.idx(4, GATE_ROW);
  const entries: number[] = [];
  let last = -1;
  let t = 0;
  for (let k = 0; k < 2000 && h.people.count > 0; k++) {
    stepHall(h, SIM_DT);
    t += SIM_DT;
    let who = -1;
    h.people.forEachAlive((i) => {
      if (h.grid.idx(Math.floor(h.people.x[i]!), Math.floor(h.people.y[i]!)) === gate) who = i;
    });
    if (who >= 0 && who !== last) entries.push(t);
    last = who;
  }
  expect(entries.length).toBeGreaterThan(20);
  // Entries are seen at step ends, so two can look up to one step closer than they were.
  for (let k = 1; k < entries.length; k++) expect(entries[k]! - entries[k - 1]!).toBeGreaterThanOrEqual(GATE_INTERVAL_SEC - SIM_DT - 1e-9);
  const span = entries[entries.length - 1]! - entries[0]!;
  expect(entries.length - 1).toBeLessThanOrEqual((span + SIM_DT) / GATE_INTERVAL_SEC + 1e-9);
  // The cadence, not the walk, sets the pace: close to one entry per interval.
  expect(entries.length - 1).toBeGreaterThanOrEqual(0.8 * (span / GATE_INTERVAL_SEC));
});

test("each island's foot gets a gate line of 4: the 2 middle open, the 2 outer closed", () => {
  const g = buildGrid(HARBOUR_STREET, 2);
  const isl = HARBOUR_STREET.islands[0]!;
  expect(isl.gateLine).toEqual({ x: isl.walkway.x, y: isl.walkway.y + isl.walkway.h - 1, w: 4, h: 1 });
  expect(tilesOf(isl.gateLine).map(([x, y]) => g.tile(x, y))).toEqual([Tile.GateClosed, Tile.Gate, Tile.Gate, Tile.GateClosed]);
  expect(g.isWalkable(isl.gateLine.x + 1, isl.gateLine.y)).toBe(true);
  expect(g.isWalkable(isl.gateLine.x, isl.gateLine.y)).toBe(false);
  for (const later of HARBOUR_STREET.islands.slice(1))
    for (const [x, y] of tilesOf(later.gateLine)) expect(g.tile(x, y)).toBe(Tile.Ground);
});

test("nobody boards, waits or alights on the gate row", () => {
  const w = createWorld(1);
  const gateY = w.map.islands[0]!.gateLine.y;
  for (const key of ["platform:1", "platform:2"]) {
    const rows = (tiles: readonly number[]) => tiles.map((t) => Math.floor(t / w.grid.w));
    expect(rows(fieldTargets(w, key))).not.toContain(gateY);
    expect(rows(waitingSpots(w, key))).not.toContain(gateY);
    expect(fieldTargets(w, key).every((t) => w.grid.tiles[t] === Tile.Platform)).toBe(true);
  }
});

test("an unobstructed station still has a high on-time rate with 2 gates per island", () => {
  const w = createWorld(5);
  runMinutes(w, 6 * 60);
  let onTime = 0;
  let all = 0;
  for (const e of w.events) {
    if (e.kind !== "outcome" || e.excluded) continue;
    all++;
    if (e.onTime) onTime++;
  }
  expect(all).toBeGreaterThan(200);
  expect(onTime / all).toBeGreaterThanOrEqual(0.9);
});
