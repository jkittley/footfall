import { walkMinutes } from "./routeField";
import { fieldTargets, type World } from "./world";

// One shared thunk for FieldCache.get, so a lookup allocates no closure per call.
let thunkWorld: World | null = null;
let thunkKey = "";
const targetsThunk = (): readonly number[] => fieldTargets(thunkWorld!, thunkKey);

/** The cached route field for a field key. */
export function fieldFor(w: World, key: string): Float32Array {
  thunkWorld = w;
  thunkKey = key;
  return w.fields.get(key, targetsThunk);
}

/** Index of the tile person `pid` stands on. */
export function tileOf(w: World, pid: number): number {
  return w.grid.idx(Math.floor(w.people.x[pid]!), Math.floor(w.people.y[pid]!));
}

/**
 * Minutes left over after walking from here to their goal. Someone who cannot reach their goal
 * from here loses nothing by staying, so an unreachable goal counts as no walk.
 */
export function spareMinutes(w: World, pid: number): number {
  const p = w.people;
  const walk = walkMinutes(fieldFor(w, p.goalKey[pid]!), tileOf(w, pid));
  return p.deadline[pid]! - w.minute - (Number.isFinite(walk) ? walk : 0);
}
