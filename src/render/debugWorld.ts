// Dev only: a world that shows every piece the renderer draws, for index.html?debug=render.
import { applyPlacement, previewPlacement, type BuildOpts, type ToolId } from "../sim/build";
import { SIM_DT, GAME_MIN_PER_REAL_SEC } from "../sim/constants";
import { startDisruption } from "../sim/disruptions";
import { FacilityKind, Tenant, tryJoin, type Facility } from "../sim/facilities";
import { Dir, type Rect } from "../sim/grid";
import { addPlatform, deactivatePlatform } from "../sim/growth";
import { refreshSigns } from "../sim/needs";
import { PState } from "../sim/people";
import { CITY } from "../sim/maps/city";
import { createWorld, step, type World } from "../sim/world";

const [OX, OY] = CITY.station.origin;

/** A rect in the station's own coordinates, placed in the city. */
function at(x: number, y: number, w: number, h: number): Rect {
  return { x: OX + x, y: OY + y, w, h };
}

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
  build(w, "floor", at(16, 56, 12, 4));
  build(w, "floor", at(14, 60, 14, 2));
  build(w, "retail", at(20, 60, 3, 2));
  build(w, "toilet", at(26, 60, 2, 2));
  build(w, "seating", at(15, 61, 4, 1));
  build(w, "sign", at(7, 58, 1, 1), { signKind: "toilets" });
  build(w, "sign", at(13, 56, 1, 1), { signKind: "shops" });
  build(w, "travelator", at(10, 63, 1, 6), { dir: Dir.N });
  build(w, "wall", at(18, 57, 3, 1));
  build(w, "rail", at(22, 58, 4, 1));

  const shop = facilityAt(w, OX + 20, OY + 60);
  shop.tenant = Tenant.FoodDrink;
  shop.tenantAt = -1;
  refreshSigns(w);
  stepMinutes(w, 25);
  build(w, "retail", at(24, 60, 2, 2));
  stepMinutes(w, 5);

  queueUp(w, shop, 5);
  standAt(w, at(8, 54, 4, 2), 40);
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
