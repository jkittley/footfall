import { describe, expect, test } from "vitest";
import { Tile, type Grid } from "../../src/sim/grid";
import { GAME_MIN_PER_REAL_SEC } from "../../src/sim/constants";
import { FieldCache, computeField, walkMinutes } from "../../src/sim/routeField";
import { PState, PeopleStore } from "../../src/sim/people";
import { CrowdGrid, speedFactor } from "../../src/sim/crowd";
import { createTurnstiles, nudgeToWalkable, stepMovement, type Turnstiles } from "../../src/sim/movement";
import { Rng } from "../../src/sim/rng";
import { openFloor } from "./helpers";

interface Sim {
  grid: Grid;
  fields: FieldCache;
  targets: Map<string, number[]>;
  people: PeopleStore;
  crowd: CrowdGrid;
  turnstiles: Turnstiles;
}

function sim(grid: Grid, targets: Record<string, number[]>, cap = 1000): Sim {
  return {
    grid,
    fields: new FieldCache(grid),
    targets: new Map(Object.entries(targets)),
    people: new PeopleStore(cap),
    crowd: new CrowdGrid(grid.w, grid.h),
    turnstiles: createTurnstiles(grid.w * grid.h, cap),
  };
}

function addPerson(s: Sim, x: number, y: number, key: string, state = PState.Walking): number {
  const i = s.people.alloc();
  s.people.x[i] = x;
  s.people.y[i] = y;
  s.people.state[i] = state;
  s.people.targetKey[i] = key;
  s.people.goalKey[i] = key;
  return i;
}

function step(s: Sim, dt: number): number[] {
  s.crowd.rebuild(s.people, s.grid);
  return stepMovement(s.grid, s.fields, (k) => s.targets.get(k) ?? [], s.people, s.crowd, s.turnstiles, dt);
}

/** Steps until person `i` arrives; returns elapsed real seconds, or Infinity after `limit`. */
function timeToArrive(s: Sim, i: number, dt: number, limit: number): number {
  for (let t = 0; t < limit; t += dt) {
    if (step(s, dt).includes(i)) return t + dt;
  }
  return Infinity;
}

describe("movement", () => {
  test("a walker reaches the target across open floor", () => {
    const g = openFloor(20, 5);
    const s = sim(g, { exit: [g.idx(19, 2)] });
    const i = addPerson(s, 0.5, 0.5, "exit");
    const t = timeToArrive(s, i, 1 / 30, 30);
    expect(t).toBeLessThan(30);
    expect(Math.floor(s.people.x[i]!)).toBe(19);
    expect(Math.floor(s.people.y[i]!)).toBe(2);
  });

  test("arrival time matches walkMinutes on an empty floor within 15%", () => {
    const g = openFloor(20, 5);
    const target = g.idx(19, 2);
    const s = sim(g, { exit: [target] });
    const i = addPerson(s, 0.5, 2.5, "exit");
    const elapsed = timeToArrive(s, i, 1 / 30, 30);
    const expected = walkMinutes(computeField(g, [target]), g.idx(0, 2));
    const actual = elapsed * GAME_MIN_PER_REAL_SEC;
    expect(Math.abs(actual - expected) / expected).toBeLessThan(0.15);
  });

  test("never enters a non-walkable tile with a large dt", () => {
    // 20x9 floor, wall line at x=10 with one gap at y=4.
    const g = openFloor(20, 9);
    for (let y = 0; y < 9; y++) if (y !== 4) g.setTile(10, y, Tile.Wall);
    const exit: number[] = [];
    for (let y = 0; y < 9; y++) exit.push(g.idx(19, y));
    const s = sim(g, { exit });
    const rng = new Rng(42);
    for (let n = 0; n < 200; n++) {
      const x = rng.next() * 10;
      const y = rng.next() * 9;
      // A quarter steer straight at a spot behind the wall, so they have to slide along it.
      const key = n % 4 === 0 ? `spot:${g.idx(15, rng.int(0, 8))}` : "exit";
      addPerson(s, x, y, key);
    }
    expect(s.people.count).toBe(200);
    let checked = 0;
    for (let k = 0; k < 60; k++) {
      step(s, 0.5);
      s.people.forEachAlive((i) => {
        const tx = Math.floor(s.people.x[i]!);
        const ty = Math.floor(s.people.y[i]!);
        expect(g.isWalkable(tx, ty), `person ${i} at (${s.people.x[i]}, ${s.people.y[i]}) after step ${k}`).toBe(true);
        checked++;
      });
    }
    expect(checked).toBe(200 * 60);
    // They actually moved: most route-field walkers made it through the gap.
    let through = 0;
    s.people.forEachAlive((i) => {
      if (s.people.x[i]! >= 11) through++;
    });
    expect(through).toBeGreaterThan(100);
  });

  test("crowding slows people down", () => {
    const build = (withCrowd: boolean): number => {
      const g = openFloor(30, 3);
      const s = sim(g, { exit: [g.idx(29, 0), g.idx(29, 1), g.idx(29, 2)] });
      if (withCrowd) {
        for (let n = 0; n < 40; n++) {
          // A standing queue: InQueue with no spot to walk to.
          addPerson(s, 12.5 + (n % 6), 0.5 + (Math.floor(n / 6) % 3), "", PState.InQueue);
        }
      }
      const i = addPerson(s, 0.5, 1.5, "exit");
      return timeToArrive(s, i, 1 / 30, 60);
    };
    const alone = build(false);
    const crowded = build(true);
    expect(alone).toBeLessThan(60);
    expect(crowded).toBeLessThan(60);
    expect(crowded).toBeGreaterThan(alone * 1.2);
  });

  test("a Waiting person walks to a spot on the platform; one with no target stands still", () => {
    const g = openFloor(10, 3);
    const s = sim(g, {});
    const walker = addPerson(s, 0.5, 1.5, `spot:${g.idx(8, 1)}`, PState.Waiting);
    const stander = addPerson(s, 0.5, 0.5, "", PState.Waiting);
    const t = timeToArrive(s, walker, 1 / 30, 10);
    expect(t).toBeLessThan(10);
    expect(Math.floor(s.people.x[walker]!)).toBe(8);
    expect(s.people.x[stander]).toBe(0.5);
    expect(s.people.state[walker]).toBe(PState.Waiting);
  });

  test("speedFactor bounds", () => {
    expect(speedFactor(0)).toBe(1);
    expect(speedFactor(10)).toBe(0.25);
  });

  test("nudgeToWalkable moves someone off a wall", () => {
    const g = openFloor(9, 9);
    for (let y = 2; y <= 6; y++) for (let x = 2; x <= 6; x++) g.setTile(x, y, Tile.Wall);
    const people = new PeopleStore(4);
    const i = people.alloc();
    people.x[i] = 4.5;
    people.y[i] = 4.5;
    nudgeToWalkable(g, people, i);
    const tx = Math.floor(people.x[i]!);
    const ty = Math.floor(people.y[i]!);
    expect(g.isWalkable(tx, ty)).toBe(true);
    // Nearest walkable tile from the middle of a 5x5 block is 3 tiles out.
    expect(Math.max(Math.abs(tx - 4), Math.abs(ty - 4))).toBe(3);
  });
});

describe("people store", () => {
  test("free slots are reused and alloc throws at cap", () => {
    const p = new PeopleStore(2);
    const a = p.alloc();
    const b = p.alloc();
    expect(() => p.alloc()).toThrow(RangeError);
    p.free(a);
    expect(p.count).toBe(1);
    expect(p.alloc()).toBe(a);
    const seen: number[] = [];
    p.forEachAlive((i) => seen.push(i));
    expect(seen.sort()).toEqual([a, b].sort());
  });
});
