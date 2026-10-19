import {
  COOLDOWN_MIN,
  GROW_RATE,
  METER_WINDOW_MIN,
  MIN_SAMPLES,
  SHRINK_DAYS,
  SHRINK_RATE,
  SUSTAIN_MIN,
} from "./constants";
import { refreshAccess } from "./facilities";
import { paintSlot } from "./maps/harbourStreet";
import { nudgeToWalkable } from "./movement";
import { refreshSigns } from "./needs";
import { rebook, rebookContext } from "./spawner";
import { activePlatformIds, type World } from "./world";

/** Platforms added at which the subway stage unlocks. */
const SUBWAY_AT_PLATFORMS = 10;

/** Long before any game minute (finite, so it survives JSON): an empty bucket, or no cooldown. */
const EMPTY = Number.MIN_SAFE_INTEGER;

/**
 * On-time share of journeys over the last METER_WINDOW_MIN game minutes, kept as one bucket per
 * minute in a ring (plain arrays, so it serialises as it is).
 */
export class ServiceMeter {
  /** The game minute each bucket holds, or EMPTY. */
  minutes: number[] = new Array<number>(METER_WINDOW_MIN).fill(EMPTY);
  total: number[] = new Array<number>(METER_WINDOW_MIN).fill(0);
  onTime: number[] = new Array<number>(METER_WINDOW_MIN).fill(0);

  record(minute: number, onTime: boolean): void {
    const m = Math.floor(minute);
    const b = ((m % METER_WINDOW_MIN) + METER_WINDOW_MIN) % METER_WINDOW_MIN;
    if (this.minutes[b] !== m) {
      this.minutes[b] = m;
      this.total[b] = 0;
      this.onTime[b] = 0;
    }
    this.total[b]!++;
    if (onTime) this.onTime[b]!++;
  }

  /** On-time share of the outcomes in (now - METER_WINDOW_MIN, now]; null on fewer than MIN_SAMPLES. */
  rate(now: number): number | null {
    let total = 0;
    let onTime = 0;
    for (let b = 0; b < METER_WINDOW_MIN; b++) {
      const m = this.minutes[b]!;
      if (m <= now - METER_WINDOW_MIN || m > now) continue;
      total += this.total[b]!;
      onTime += this.onTime[b]!;
    }
    return total < MIN_SAMPLES ? null : onTime / total;
  }
}

export interface GrowthState {
  /** Game minute since which the rate has held at or above GROW_RATE, or null. */
  goodSince: number | null;
  /** Game minute since which the rate has held below SHRINK_RATE, or null. */
  badSince: number | null;
  /** No platform opens or closes before this game minute. */
  cooldownUntil: number;
  /** The last closed day's on-time rate, or null (no day closed yet, or too few journeys in it). */
  lastDayRate: number | null;
  /** Closed days in a row whose on-time rate was below SHRINK_RATE. */
  badDays: number;
}

export function newGrowthState(): GrowthState {
  return { goodSince: null, badSince: null, cooldownUntil: EMPTY, lastDayRate: null, badDays: 0 };
}

/**
 * At each day's close, with its counted (not excluded) journeys: SHRINK_DAYS days in a row below
 * SHRINK_RATE close a platform, cooldown or not, since a weekday that fails at the peaks rarely
 * stays below it for SUSTAIN_MIN at a stretch. The day's rate also gates growth (see growthMinute).
 */
export function closeGrowthDay(w: World, onTime: number, missed: number, endMinute: number): void {
  const g = w.growth;
  const counted = onTime + missed;
  g.lastDayRate = counted < MIN_SAMPLES ? null : onTime / counted;
  if (g.lastDayRate === null || g.lastDayRate >= SHRINK_RATE) {
    g.badDays = 0;
    return;
  }
  g.badDays++;
  if (g.badDays >= SHRINK_DAYS && shrink(w)) {
    g.badDays = 0;
    startCooldown(g, endMinute);
  }
}

/**
 * Once for each game minute boundary the clock has crossed: a rate held at or above GROW_RATE for
 * SUSTAIN_MIN, after a closed day that was also at or above it, reopens the lowest inactive
 * platform, else adds the next; one held below SHRINK_RATE closes the highest active platform above
 * the starting ones. Either starts a cooldown.
 */
export function stepGrowth(w: World): void {
  const now = Math.floor(w.minute);
  while (w.growthUpTo < now) {
    w.growthUpTo++;
    growthMinute(w, w.growthUpTo);
  }
}

function growthMinute(w: World, minute: number): void {
  const g = w.growth;
  const rate = minute < g.cooldownUntil ? null : w.meter.rate(minute);
  // A day that fell short holds growth back until a whole day has gone well.
  const dayOk = g.lastDayRate === null || g.lastDayRate >= GROW_RATE;
  if (rate !== null && rate >= GROW_RATE && dayOk) {
    g.badSince = null;
    g.goodSince ??= minute;
    if (minute - g.goodSince >= SUSTAIN_MIN && grow(w)) startCooldown(g, minute);
  } else if (rate !== null && rate < SHRINK_RATE) {
    g.goodSince = null;
    g.badSince ??= minute;
    if (minute - g.badSince >= SUSTAIN_MIN && shrink(w)) startCooldown(g, minute);
  } else {
    g.goodSince = null;
    g.badSince = null;
  }
}

function startCooldown(g: GrowthState, minute: number): void {
  g.goodSince = null;
  g.badSince = null;
  g.cooldownUntil = minute + COOLDOWN_MIN;
}

/** Reopens the lowest inactive platform, else adds the next slot; false if every slot is open. */
function grow(w: World): boolean {
  for (let id = 1; id <= w.platformsAdded; id++) {
    if (!w.platformActive[id - 1]) {
      reactivatePlatform(w, id);
      return true;
    }
  }
  if (w.platformsAdded >= w.map.slots.length) return false;
  addPlatform(w, w.platformsAdded + 1);
  return true;
}

/** Closes the highest active platform above the starting ones; false if there is none. */
export function shrink(w: World): boolean {
  for (let id = w.platformsAdded; id > w.map.startingPlatforms; id--) {
    if (w.platformActive[id - 1]) {
      if (!staysOpen(w, id)) return false;
      deactivatePlatform(w, id);
      w.events.push({ kind: "toast", text: `Platform ${id} is closed: too many people missed their trains` });
      return true;
    }
  }
  return false;
}

/** True if some other active platform would remain outside the running disruption. */
function staysOpen(w: World, closing: number): boolean {
  const running = w.disruptions.find((d) => !d.ended && w.minute < d.endsAt);
  return activePlatformIds(w).some((id) => id !== closing && !running?.platforms.includes(id));
}

/**
 * Opens the next slot, painting its island (walkway, both tracks, foot) if its partner has not
 * already. It may stand unconnected until the player builds floor to its foot. Anyone on a tile
 * that is no longer walkable steps off it.
 */
export function addPlatform(w: World, slotId: number): void {
  const slot = w.map.slots[slotId - 1];
  if (!slot || slotId !== w.platformsAdded + 1) throw new RangeError(`slot ${slotId} is not the next platform`);
  paintSlot(w.grid, slot);
  w.platformsAdded++;
  w.platformActive[slotId - 1] = true;
  settleOffBlocked(w);
  for (const f of w.facilities.values()) refreshAccess(w, f);
  refreshSigns(w);
  w.events.push({ kind: "toast", text: `Platform ${slotId} opens` });
  if (w.platformsAdded === SUBWAY_AT_PLATFORMS && !w.stagesUnlocked.subway) {
    w.stagesUnlocked.subway = true;
    w.events.push({ kind: "toast", text: "The subway is coming" });
  }
}

function settleOffBlocked(w: World): void {
  const { grid: g, people: p } = w;
  for (let i = 0, end = p.end; i < end; i++) {
    if (p.isAlive(i) && !g.isWalkable(Math.floor(p.x[i]!), Math.floor(p.y[i]!))) nudgeToWalkable(g, p, i);
  }
}

/** Reopens an added platform; the timetable schedules it afresh from now. */
export function reactivatePlatform(w: World, slotId: number): void {
  w.platformActive[slotId - 1] = true;
  w.events.push({ kind: "toast", text: `Platform ${slotId} reopens` });
}

/**
 * Closes an added platform (its tiles stay): its services yet to arrive are cancelled, and everyone
 * booked on them is rebooked from where they stand, or leaves. A train already standing at the
 * platform still departs. No outcome is recorded.
 */
export function deactivatePlatform(w: World, slotId: number): void {
  w.platformActive[slotId - 1] = false;
  const cancelled = new Set<number>();
  for (const s of w.timetable.services.values()) {
    if (s.platformId !== slotId || s.cancelled || s.arriveAt <= w.minute) continue;
    s.cancelled = true;
    s.cancelReason = "inactive";
    cancelled.add(s.id);
  }
  // Reopening then starts a fresh timetable from that moment.
  w.timetable.lastDepart.delete(slotId);
  if (cancelled.size === 0) return;
  const p = w.people;
  const ctx = rebookContext(w);
  for (let i = 0, end = p.end; i < end; i++) {
    if (p.isAlive(i) && cancelled.has(p.serviceId[i]!)) rebook(w, i, ctx);
  }
}
