import {
  ABANDON_MARGIN_MIN,
  DESPERATE_AFTER_MIN,
  DESPERATE_SPEED_MUL,
  SEARCH_INTERVAL_MIN,
  SIGHT_RADIUS,
  SIGN_RADIUS,
} from "./constants";
import type { Facility } from "./facilities";
import { FacilityKind, Tenant } from "./facilityKinds";
import { NEED_COUNT, Need, PState } from "./people";
import { fieldFor, spareMinutes, tileOf } from "./walk";
import type { World } from "./world";

export const NEED_RATE_PER_MIN: Record<Need, number> = {
  [Need.Hunger]: 1 / 240,
  [Need.Thirst]: 1 / 150,
  [Need.Tired]: 1 / 200,
  [Need.Toilet]: 1 / 180,
  [Need.Browse]: 1 / 300,
  [Need.Charge]: 1 / 400,
};

/** The facility kind that meets each need and, for retail, the tenants that do. */
export const NEED_TO_FACILITY: Record<Need, { kind: FacilityKind; tenants: readonly Tenant[] }> = {
  [Need.Hunger]: { kind: FacilityKind.Retail, tenants: [Tenant.FoodDrink] },
  [Need.Thirst]: { kind: FacilityKind.Retail, tenants: [Tenant.FoodDrink] },
  [Need.Tired]: { kind: FacilityKind.Seating, tenants: [] },
  [Need.Toilet]: { kind: FacilityKind.Toilet, tenants: [] },
  [Need.Browse]: { kind: FacilityKind.Retail, tenants: [Tenant.Newsagent, Tenant.Electronics] },
  [Need.Charge]: { kind: FacilityKind.Retail, tenants: [Tenant.PhoneCharging] },
};

export interface Sign {
  id: number;
  tile: number;
  kind: "toilets" | "seating" | "shops";
  /** Nearest facility of its kind by walk from the sign, or -1. */
  pointsTo: number;
}

const NEEDS: readonly Need[] = [Need.Hunger, Need.Thirst, Need.Tired, Need.Toilet, Need.Browse, Need.Charge];

/** Field key a person walks to for facility `f`. */
export function facilityKey(f: Facility): string {
  return f.kind === FacilityKind.Seating ? `seat:${f.id}` : `facility:${f.id}`;
}

/** True if `f` is open and meets `need`; a to-let unit meets nothing. */
export function meetsNeed(f: Facility, need: Need): boolean {
  const m = NEED_TO_FACILITY[need];
  if (f.kind !== m.kind) return false;
  return f.kind !== FacilityKind.Retail || m.tenants.includes(f.tenant);
}

function signShows(kind: Sign["kind"], f: Facility): boolean {
  if (kind === "toilets") return f.kind === FacilityKind.Toilet;
  if (kind === "seating") return f.kind === FacilityKind.Seating;
  return f.kind === FacilityKind.Retail && f.tenant !== Tenant.None;
}

function fieldOf(w: World, f: Facility): Float32Array {
  return fieldFor(w, facilityKey(f));
}

/** Points every sign at the nearest facility it shows, by walk from the sign's tile. */
export function refreshSigns(w: World): void {
  for (const s of w.signs) {
    let best = -1;
    let bestDist = Infinity;
    for (const f of w.facilities.values()) {
      if (!signShows(s.kind, f)) continue;
      const d = fieldOf(w, f)[s.tile]!;
      if (d < bestDist) {
        bestDist = d;
        best = f.id;
      }
    }
    s.pointsTo = best;
  }
}

/** Puts up a sign on `tile`, pointing at the nearest facility it shows. */
export function addSign(w: World, tile: number, kind: Sign["kind"]): Sign {
  const s: Sign = { id: w.nextId++, tile, kind, pointsTo: -1 };
  w.signs.push(s);
  refreshSigns(w);
  return s;
}

function knownFacility(w: World, pid: number, need: Need): Facility | undefined {
  const slot = pid * NEED_COUNT + need;
  const id = w.people.known[slot]!;
  if (id < 0) return undefined;
  const f = w.facilities.get(id);
  if (f && meetsNeed(f, need)) return f;
  w.people.known[slot] = -1;
  return undefined;
}

/** Learns of a facility for `need` in sight, else from a sign in reach; the facility, if any. */
function lookAround(w: World, pid: number, need: Need, candidates: readonly Candidate[]): Facility | undefined {
  const tile = tileOf(w, pid);
  let found: Facility | undefined;
  let bestDist = SIGHT_RADIUS;
  for (const c of candidates) {
    const d = c.field[tile]!;
    if (d <= bestDist) {
      bestDist = d;
      found = c.f;
    }
  }
  if (!found) {
    const px = w.people.x[pid]!;
    const py = w.people.y[pid]!;
    for (const s of w.signs) {
      if (s.pointsTo < 0) continue;
      const sx = (s.tile % w.grid.w) + 0.5;
      const sy = Math.floor(s.tile / w.grid.w) + 0.5;
      if ((sx - px) ** 2 + (sy - py) ** 2 > SIGN_RADIUS * SIGN_RADIUS) continue;
      const f = w.facilities.get(s.pointsTo);
      if (f && meetsNeed(f, need)) {
        found = f;
        break;
      }
    }
  }
  if (found) w.people.known[pid * NEED_COUNT + need] = found.id;
  return found;
}

function goTo(w: World, pid: number, f: Facility): void {
  const p = w.people;
  p.errandFacility[pid] = f.id;
  p.targetKey[pid] = facilityKey(f);
  p.state[pid] = PState.Walking;
}

/** Errand over with the need unmet: back to the goal (or still waiting) at full speed. */
export function dropErrand(w: World, pid: number): void {
  const p = w.people;
  p.endErrand(pid);
  if (p.state[pid] === PState.Walking) p.targetKey[pid] = p.goalKey[pid]!;
}

function highestNeed(w: World, pid: number): Need | -1 {
  const base = pid * NEED_COUNT;
  let best: Need | -1 = -1;
  let bestLevel = 1;
  for (const n of NEEDS) {
    const level = w.people.needs[base + n]!;
    if (level >= bestLevel) {
      bestLevel = level;
      best = n;
    }
  }
  return best;
}

function hasTime(w: World, pid: number): boolean {
  return spareMinutes(w, pid) >= ABANDON_MARGIN_MIN;
}

/** True while the train this person is booked on stands at its platform. */
function trainIn(w: World, pid: number): boolean {
  const id = w.people.serviceId[pid]!;
  if (id < 0) return false;
  const s = w.timetable.services.get(id);
  return s !== undefined && !s.cancelled && s.arriveAt <= w.minute;
}

type Candidate = { f: Facility; field: Float32Array };

/** Open facilities meeting each need with their fields, resolved once per search. */
function candidatesByNeed(w: World): Candidate[][] {
  const out: Candidate[][] = NEEDS.map(() => []);
  for (const f of w.facilities.values()) {
    let field: Float32Array | null = null;
    for (const n of NEEDS) if (meetsNeed(f, n)) out[n]!.push({ f, field: (field ??= fieldOf(w, f)) });
  }
  return out;
}

const RATES = NEEDS.map((n) => NEED_RATE_PER_MIN[n]);
const rise = new Float64Array(NEED_COUNT);

/**
 * Advances needs by `dtMin` game minutes. Walking or waiting people take up their highest need at
 * or over 1 as an errand when they have time for it and their train is not in, look round for a facility for it every
 * SEARCH_INTERVAL_MIN (in sight, or named by a nearby sign), and walk to one they know; anyone
 * whose goal is getting close drops the errand, need unmet. Someone who has gone DESPERATE_AFTER_MIN
 * without finding a toilet slows down and wanders.
 */
export function stepNeeds(w: World, dtMin: number): void {
  w.searchClock += dtMin;
  const search = w.searchClock >= SEARCH_INTERVAL_MIN;
  if (search) w.searchClock %= SEARCH_INTERVAL_MIN;
  let candidates: Candidate[][] | null = null;
  const p = w.people;
  const { needs, state, leisure } = p;
  // Locals for the hot loop: imported bindings can cost a getter call each in some builds.
  const count = NEED_COUNT;
  const walking = PState.Walking;
  const waiting = PState.Waiting;
  const tired = Need.Tired;
  const browse = Need.Browse;
  for (let n = 0; n < count; n++) rise[n] = RATES[n]! * dtMin;

  for (let i = 0, end = p.end; i < end; i++) {
    if (!p.isAlive(i)) continue;
    const st = state[i]!;
    const base = i * count;
    for (let n = 0; n < count; n++) needs[base + n] = needs[base + n]! + rise[n]!;
    if (st === waiting) needs[base + tired] = needs[base + tired]! + rise[tired]!;
    if (leisure[i]) needs[base + browse] = needs[base + browse]! + rise[browse]!;
    if (st !== walking && st !== waiting) continue;

    let errand = p.errand[i]!;
    if (errand < 0) {
      if (p.errandCooldown[i]! > 0) {
        p.errandCooldown[i] = p.errandCooldown[i]! - dtMin;
        continue;
      }
      const n = highestNeed(w, i);
      if (n < 0) continue;
      if (!hasTime(w, i) || trainIn(w, i)) {
        p.errandCooldown[i] = SEARCH_INTERVAL_MIN;
        continue;
      }
      errand = n;
      p.errand[i] = n;
      p.seekMin[i] = 0;
    } else if ((search || p.errandFacility[i]! >= 0) && !hasTime(w, i)) {
      // Someone with no facility in mind is walking to their goal anyway: once a search will do.
      dropErrand(w, i);
      continue;
    }
    const need: Need = errand;

    const going = p.errandFacility[i]!;
    if (going >= 0) {
      const f = w.facilities.get(going);
      if (f && meetsNeed(f, need)) continue;
      // Gone, or no longer meets it: forget it and carry on towards the goal while looking.
      p.errandFacility[i] = -1;
      p.known[base + need] = -1;
      p.targetKey[i] = p.goalKey[i]!;
    }

    let f = knownFacility(w, i, need);
    if (!f && search) f = lookAround(w, i, need, (candidates ??= candidatesByNeed(w))[need]!);
    if (f) {
      goTo(w, i, f);
      continue;
    }
    p.seekMin[i] = p.seekMin[i]! + dtMin;
    if (need === Need.Toilet && p.seekMin[i]! > DESPERATE_AFTER_MIN) p.speedMul[i] = DESPERATE_SPEED_MUL;
  }
}
