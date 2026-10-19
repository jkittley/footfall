import { demand } from "./clock";
import type { Rng } from "./rng";

export const TIMETABLE_HORIZON_MIN = 240;
export const BASE_INTERVAL_MIN = 50;
export const MIN_INTERVAL_MIN = 20;
export const MAX_INTERVAL_MIN = 60;
export const DWELL_MIN = 12;
export const ALIGHT_BASE = 6;
export const APPROACH_MIN = 3;
export const LEAVE_MIN = 3;
/** A platform's first service arrives within this many minutes, however sparse the timetable then is. */
export const FIRST_STAGGER_MAX_MIN = 30;

export const DESTINATIONS = [
  "Ashby", "Leeds Road", "Kingsmoor", "Brackenford", "Saltcote", "Hollin Bridge",
  "Fernleigh", "Cradley Moss", "Westwold", "Thornbury Cross", "Redmarsh", "Ellingthorpe",
] as const;

export interface Service {
  id: number;
  platformId: number;
  destination: string;
  arriveAt: number;
  departAt: number;
  alighting: number;
  cancelled: boolean;
  cancelReason: "inactive" | "disruption" | null;
}

export type TrainPhase = "approaching" | "dwelling" | "leaving";

export function trainPhase(s: Service, now: number): TrainPhase | null {
  if (s.cancelled) return null;
  if (now < s.arriveAt - APPROACH_MIN || now >= s.departAt + LEAVE_MIN) return null;
  if (now < s.arriveAt) return "approaching";
  if (now < s.departAt) return "dwelling";
  return "leaving";
}

function interval(t: number): number {
  return Math.min(MAX_INTERVAL_MIN, Math.max(MIN_INTERVAL_MIN, Math.round(BASE_INTERVAL_MIN / demand(t))));
}

const byDepart = (a: Service, b: Service): number => a.departAt - b.departAt;

export class Timetable {
  services = new Map<number, Service>();
  nextId = 1;
  /** Departure of the last service scheduled on each platform. */
  lastDepart = new Map<number, number>();

  /** Schedules services on every active platform until its last one departs at or after now + horizon. */
  ensureHorizon(now: number, activePlatforms: readonly number[], rng: Rng): void {
    const until = now + TIMETABLE_HORIZON_MIN;
    for (const platformId of activePlatforms) {
      let last = this.lastDepart.get(platformId);
      if (last === undefined || last < now) {
        // A platform with no running service starts with a staggered first arrival.
        const first = Math.floor(now) + 1 + rng.int(0, Math.min(FIRST_STAGGER_MAX_MIN, interval(now)) - 1);
        last = this.add(platformId, first, rng);
      }
      while (last < until) last = this.add(platformId, last + interval(last), rng);
      this.lastDepart.set(platformId, last);
    }
  }

  private add(platformId: number, arriveAt: number, rng: Rng): number {
    const s: Service = {
      id: this.nextId++,
      platformId,
      destination: rng.pick(DESTINATIONS),
      arriveAt,
      departAt: arriveAt + DWELL_MIN,
      alighting: Math.round(ALIGHT_BASE * demand(arriveAt) * (0.6 + 0.8 * rng.next())),
      cancelled: false,
      cancelReason: null,
    };
    this.services.set(s.id, s);
    return s.departAt;
  }

  /** Non-cancelled services on a platform departing strictly after `after`, soonest first. */
  upcoming(platformId: number, after: number): Service[] {
    const out: Service[] = [];
    for (const s of this.services.values()) {
      if (s.platformId === platformId && !s.cancelled && s.departAt > after) out.push(s);
    }
    return out.sort(byDepart);
  }

  /** Non-cancelled services on any platform departing strictly after `t`, soonest first. */
  departuresAfter(t: number): Service[] {
    const out: Service[] = [];
    for (const s of this.services.values()) if (!s.cancelled && s.departAt > t) out.push(s);
    return out.sort(byDepart);
  }

  /** Forgets services that departed before `before`. */
  prune(before: number): void {
    for (const [id, s] of this.services) if (s.departAt < before) this.services.delete(id);
  }
}
