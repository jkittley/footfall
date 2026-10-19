import type { Grid } from "./grid";
import { CALM_DENSITY, JAM_DENSITY, MIN_SPEED_FACTOR } from "./constants";
import { PState, type PeopleStore } from "./people";

/** People per tile, counting everyone standing or walking on the floor (not those inside facilities). */
export class CrowdGrid {
  readonly w: number;
  readonly h: number;
  counts: Uint16Array;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.counts = new Uint16Array(w * h);
  }

  rebuild(people: PeopleStore, grid: Grid): void {
    if (grid.w !== this.w || grid.h !== this.h) throw new Error("CrowdGrid size does not match grid");
    const counts = this.counts;
    counts.fill(0);
    const { x, y, state } = people;
    for (let i = 0, end = people.end; i < end; i++) {
      if (!people.isAlive(i)) continue;
      const s = state[i]!;
      if (s !== PState.Walking && s !== PState.Waiting && s !== PState.InQueue && s !== PState.Seated) continue;
      const tx = Math.floor(x[i]!);
      const ty = Math.floor(y[i]!);
      if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) continue;
      const t = ty * this.w + tx;
      if (counts[t]! < 0xffff) counts[t] = counts[t]! + 1;
    }
  }

  at(i: number): number {
    return this.counts[i]!;
  }

  /** Mean count over the 3x3 block centred on tile (tx, ty), floored; tiles off the grid count as empty. */
  density(tx: number, ty: number): number {
    const cx = Math.floor(tx);
    const cy = Math.floor(ty);
    let sum = 0;
    for (let yy = cy - 1; yy <= cy + 1; yy++) {
      if (yy < 0 || yy >= this.h) continue;
      for (let xx = cx - 1; xx <= cx + 1; xx++) {
        if (xx < 0 || xx >= this.w) continue;
        sum += this.counts[yy * this.w + xx]!;
      }
    }
    return sum / 9;
  }
}

/** Walking speed multiplier for a local crowd density. */
export function speedFactor(density: number): number {
  if (density <= CALM_DENSITY) return 1;
  if (density >= JAM_DENSITY) return MIN_SPEED_FACTOR;
  return 1 - ((density - CALM_DENSITY) / (JAM_DENSITY - CALM_DENSITY)) * (1 - MIN_SPEED_FACTOR);
}
