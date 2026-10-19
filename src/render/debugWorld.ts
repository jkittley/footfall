// Dev only: a world that shows every piece the renderer draws, for index.html?debug=render.
import { applyPlacement, previewPlacement, type BuildOpts, type ToolId } from "../sim/build";
import { SIM_DT, GAME_MIN_PER_REAL_SEC } from "../sim/constants";
import { startDisruption } from "../sim/disruptions";
import { FacilityKind, Tenant, tryJoin, type Facility } from "../sim/facilities";
import { Dir, type Rect } from "../sim/grid";
import { addPlatform, deactivatePlatform } from "../sim/growth";
import { refreshSigns } from "../sim/needs";
import { PState } from "../sim/people";
import { createWorld, step, type World } from "../sim/world";

function stepMinutes(w: World, minutes: number): void {
  const steps = Math.ceil(minutes / (SIM_DT * GAME_MIN_PER_REAL_SEC));
  for (let k = 0; k < steps; k++) step(w, SIM_DT);
  w.events.length = 0;
}

function build(w: World, tool: ToolId, rect: Rect, opts: BuildOpts = {}): void {
  const pv = previewPlacement(w, tool, rect, opts);
  if (!pv.valid || !applyPlacement(w, pv)) throw new Error(`debug world: ${tool} at ${JSON.stringify(rect)}: ${pv.reason}`);
}

function facilityAt(w: World, x: number, y: number): Facility {
  for (const f of w.facilities.values()) if (x >= f.rect.x && y >= f.rect.y && x < f.rect.x + f.rect.w && y < f.rect.y + f.rect.h) return f;
  throw new Error(`debug world: no facility at ${x},${y}`);
}

/**
 * Harbour Street grown to five platforms (one closed, one held by a disruption), with a let shop, a
 * shop still to let, a toilet, seating, signs, a travelator, a wall, a rail, a queue, and a knot of
 * people standing at the foot of Platform 1 so a jam builds there.
 */
export function buildDebugWorld(seed = 7): World {
  const w = createWorld(seed);
  stepMinutes(w, 20);
  for (const id of [3, 4, 5]) {
    addPlatform(w, id);
    stepMinutes(w, 5);
  }
  build(w, "floor", { x: 16, y: 56, w: 12, h: 4 });
  build(w, "floor", { x: 14, y: 60, w: 14, h: 2 });
  build(w, "retail", { x: 20, y: 60, w: 3, h: 2 });
  build(w, "toilet", { x: 26, y: 60, w: 2, h: 2 });
  build(w, "seating", { x: 15, y: 61, w: 4, h: 1 });
  build(w, "sign", { x: 7, y: 58, w: 1, h: 1 }, { signKind: "toilets" });
  build(w, "sign", { x: 13, y: 56, w: 1, h: 1 }, { signKind: "shops" });
  build(w, "travelator", { x: 10, y: 63, w: 1, h: 6 }, { dir: Dir.N });
  build(w, "wall", { x: 18, y: 57, w: 3, h: 1 });
  build(w, "rail", { x: 22, y: 58, w: 4, h: 1 });

  const shop = facilityAt(w, 20, 60);
  shop.tenant = Tenant.FoodDrink;
  shop.tenantAt = -1;
  refreshSigns(w);
  stepMinutes(w, 25);
  build(w, "retail", { x: 24, y: 60, w: 2, h: 2 });
  stepMinutes(w, 5);

  queueUp(w, shop, 5);
  standAt(w, { x: 8, y: 54, w: 4, h: 2 }, 40);
  deactivatePlatform(w, 5);
  startDisruption(w, [2], 120);
  w.events.length = 0;
  return w;
}

/** Sends up to `n` walkers to the shop's queue. */
function queueUp(w: World, f: Facility, n: number): void {
  const p = w.people;
  let joined = 0;
  for (let i = 0; i < p.end && joined < n; i++) {
    if (p.isAlive(i) && p.state[i] === PState.Walking && p.errand[i] === -1 && f.kind === FacilityKind.Retail && tryJoin(w, f, i)) joined++;
  }
}

/** `n` people standing still in `r` with nowhere to be (never counted, never boarding). */
function standAt(w: World, r: Rect, n: number): void {
  const p = w.people;
  for (let k = 0; k < n; k++) {
    const i = p.alloc();
    p.x[i] = r.x + 0.2 + w.rng.next() * (r.w - 0.4);
    p.y[i] = r.y + 0.2 + w.rng.next() * (r.h - 0.4);
    p.state[i] = PState.Waiting;
    p.mode[i] = w.rng.int(0, 3);
    p.journey[i] = w.rng.int(0, 2);
  }
}
