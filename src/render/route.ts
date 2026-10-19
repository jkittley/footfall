import { nextStep } from "../sim/routeField";
import { fieldFor } from "../sim/walk";
import type { World } from "../sim/world";

export type Pt = [number, number];

export interface Route {
  /** From where the person stands to their current target. */
  toTarget: Pt[];
  /** From there on to their end goal; empty when the target is the goal. */
  toGoal: Pt[];
}

const SPOT = "spot:";

/**
 * The way a person will walk, as world points (tile centres): `spot:` targets straight at the spot,
 * as movement steers them, and field targets along nextStep with the same crowd weighting movement
 * uses, so the line drawn is the one they follow (as the crowd stands now).
 */
export function routeOf(w: World, pid: number, maxSteps = w.grid.w * w.grid.h): Route {
  const p = w.people;
  const start: Pt = [p.x[pid]!, p.y[pid]!];
  const target = p.targetKey[pid]!;
  const goal = p.goalKey[pid]!;
  const toTarget = target === "" ? [] : leg(w, target, start, maxSteps);
  const from = toTarget[toTarget.length - 1] ?? start;
  const toGoal = goal === "" || goal === target ? [] : leg(w, goal, from, maxSteps);
  return { toTarget, toGoal };
}

function leg(w: World, key: string, from: Pt, maxSteps: number): Pt[] {
  const g = w.grid;
  if (key.startsWith(SPOT)) {
    const t = Number(key.slice(SPOT.length));
    return [from, [(t % g.w) + 0.5, Math.floor(t / g.w) + 0.5]];
  }
  const field = fieldFor(w, key);
  const counts = w.crowd.counts;
  const crowdAt = (n: number): number => counts[n]!;
  const out: Pt[] = [from];
  let x = Math.floor(from[0]);
  let y = Math.floor(from[1]);
  if (!g.inBounds(x, y)) return out;
  const seen = new Set<number>();
  for (let k = 0; k < maxSteps; k++) {
    const here = y * g.w + x;
    if (field[here] === 0 || seen.has(here)) break;
    seen.add(here);
    const n = nextStep(g, field, x, y, crowdAt);
    if (n < 0) break;
    x = n % g.w;
    y = (n - x) / g.w;
    out.push([x + 0.5, y + 0.5]);
  }
  return out;
}
