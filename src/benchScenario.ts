import { Grid, Tile, type Rect } from "./sim/grid";
import { CrowdGrid } from "./sim/crowd";
import { PeopleStore, PState } from "./sim/people";
import { FieldCache } from "./sim/routeField";
import { createTurnstiles, stepMovement } from "./sim/movement";
import { Rng } from "./sim/rng";
import { SIM_DT } from "./sim/constants";
import { CITY } from "./sim/maps/city";

export const BENCH_W = 200;
export const BENCH_H = 120;
export const BENCH_PEOPLE = 5000;
const OBSTACLES = 60;
const TARGET_KEYS = ["t0", "t1", "t2", "t3"];

/** Where the floor sits in the city-sized grid: the station's corner, so the grid costs what the game's does. */
export const BENCH_ORIGIN: readonly [number, number] = CITY.station.origin;

/**
 * Seeded, deterministic 200x120 floor with obstacles, four target areas and walkers, inside a
 * grid the size of the city (everything else locked), so per-step work that grows with the grid
 * shows up here. Rects and tiles are in grid coordinates.
 */
export class BenchScenario {
  readonly grid = new Grid(CITY.w, CITY.h);
  readonly crowd = new CrowdGrid(CITY.w, CITY.h);
  readonly people = new PeopleStore(BENCH_PEOPLE);
  readonly turnstiles = createTurnstiles(CITY.w * CITY.h, BENCH_PEOPLE);
  readonly fields = new FieldCache(this.grid);
  readonly obstacles: Rect[] = [];
  readonly targetAreas: Rect[] = [];
  private readonly targets = new Map<string, number[]>();
  private readonly rng: Rng;

  constructor(seed = 1) {
    this.rng = new Rng(seed);
    const { grid, rng } = this;
    const [ox, oy] = BENCH_ORIGIN;
    grid.tiles.fill(Tile.Locked);
    for (let y = oy; y < oy + BENCH_H; y++) for (let x = ox; x < ox + BENCH_W; x++) grid.tiles[y * grid.w + x] = Tile.Floor;
    const corners: [number, number][] = [
      [ox + BENCH_W / 4, oy + BENCH_H / 4],
      [ox + (3 * BENCH_W) / 4, oy + BENCH_H / 4],
      [ox + BENCH_W / 4, oy + (3 * BENCH_H) / 4],
      [ox + (3 * BENCH_W) / 4, oy + (3 * BENCH_H) / 4],
    ];
    TARGET_KEYS.forEach((key, k) => {
      const [cx, cy] = corners[k]!;
      const area = { x: cx - 3, y: cy - 3, w: 6, h: 6 };
      this.targetAreas.push(area);
      const tiles: number[] = [];
      for (let y = area.y; y < area.y + area.h; y++) for (let x = area.x; x < area.x + area.w; x++) tiles.push(y * grid.w + x);
      this.targets.set(key, tiles);
    });
    while (this.obstacles.length < OBSTACLES) {
      const r = { x: ox + rng.int(3, BENCH_W - 14), y: oy + rng.int(3, BENCH_H - 14), w: rng.int(2, 10), h: rng.int(2, 10) };
      if (this.targetAreas.some((a) => overlaps(r, a, 2))) continue;
      this.obstacles.push(r);
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) grid.tiles[y * grid.w + x] = Tile.Obstacle;
    }
    for (let n = 0; n < BENCH_PEOPLE; n++) {
      const i = this.people.alloc();
      this.people.mode[i] = rng.int(0, 3);
      this.people.journey[i] = rng.int(0, 2);
      this.people.state[i] = PState.Walking;
      this.respawn(i, true);
    }
  }

  readonly fieldTargets = (key: string): readonly number[] => this.targets.get(key) ?? [];

  /** Puts walker `i` on a random edge tile (anywhere, when `anywhere`) heading for a random target. */
  private respawn(i: number, anywhere = false): void {
    const { rng, people } = this;
    const [ox, oy] = BENCH_ORIGIN;
    const key = rng.pick(TARGET_KEYS);
    let x: number;
    let y: number;
    do {
      if (anywhere) {
        x = rng.int(0, BENCH_W - 1);
        y = rng.int(0, BENCH_H - 1);
      } else if (rng.next() < 0.5) {
        x = rng.next() < 0.5 ? 0 : BENCH_W - 1;
        y = rng.int(0, BENCH_H - 1);
      } else {
        x = rng.int(0, BENCH_W - 1);
        y = rng.next() < 0.5 ? 0 : BENCH_H - 1;
      }
    } while (!this.grid.isWalkable(ox + x, oy + y));
    people.x[i] = ox + x + rng.next();
    people.y[i] = oy + y + rng.next();
    people.targetKey[i] = key;
    people.goalKey[i] = key;
  }

  /** One SIM_DT of simulation. */
  step(): void {
    const { people } = this;
    this.crowd.rebuild(people, this.grid);
    const arrived = stepMovement(this.grid, this.fields, this.fieldTargets, people, this.crowd, this.turnstiles, SIM_DT);
    for (const i of arrived) this.respawn(i);
  }
}

function overlaps(a: Rect, b: Rect, pad: number): boolean {
  return a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
}
