import { minuteOfDay } from "../sim/clock";
import { TENANTS, type Facility } from "../sim/facilities";
import { Tenant } from "../sim/facilityKinds";
import type { World } from "../sim/world";

/** A piece of a label: numbers and times are set in mono, the rest in the UI face. */
export interface Run {
  text: string;
  mono?: boolean;
  strong?: boolean;
  muted?: boolean;
}

const SEP: Run = { text: " · ", muted: true };

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** "08:51": the time of day at game minute `m`. */
export function clockTime(m: number): string {
  const mod = minuteOfDay(m);
  return `${pad(Math.floor(mod / 60))}:${pad(mod % 60)}`;
}

/** "0:18": game minutes left as H:MM, rounded up, never below zero. */
export function countdown(minutes: number): string {
  const m = Math.max(0, Math.ceil(minutes - 1e-9));
  return `${Math.floor(m / 60)}:${pad(m % 60)}`;
}

export function runsText(runs: readonly Run[]): string {
  return runs.map((r) => r.text).join("");
}

/**
 * "Platform 1 · 08:51 Ashby · 0:18" (the next departure and the game minutes to it), "Platform 2 ·
 * Closed" when inactive, "Platform 3 · Closed until 11:20" while a disruption holds it.
 */
export function platformLabel(w: World, slotId: number): Run[] {
  return platformLabelVariants(w, slotId)[0]!;
}

/**
 * The platform label, longest first, then shorter ones for a cramped view: without the
 * destination, then without the time, then the name alone. The countdown is only ever dropped
 * whole, with everything else.
 */
export function platformLabelVariants(w: World, slotId: number): Run[][] {
  const head: Run = { text: `Platform ${slotId}`, strong: true };
  if (!w.platformActive[slotId - 1]) return [[head, SEP, { text: "Closed" }], [head]];
  const d = w.disruptions.find((x) => !x.ended && x.platforms.includes(slotId));
  if (d) return [[head, SEP, { text: "Closed until " }, { text: clockTime(d.endsAt), mono: true }], [head]];
  const next = w.timetable.upcoming(slotId, w.minute)[0];
  if (!next) return [[head, SEP, { text: "No trains", muted: true }], [head]];
  const time: Run = { text: clockTime(next.departAt), mono: true };
  const left: Run = { text: countdown(next.departAt - w.minute), mono: true };
  return [
    [head, SEP, time, { text: ` ${next.destination}` }, SEP, left],
    [head, SEP, time, SEP, left],
    [head, SEP, left],
    [head],
  ];
}

/** "Future platforms 5 and 6": the dashed outline of island `islandId` before either opens. */
export function futurePairLabel(islandId: number): string {
  return `Future platforms ${2 * islandId - 1} and ${2 * islandId}`;
}

/** The tenant's name, or "To let · tenant in 0:40" until one moves in. */
export function retailLabel(f: Facility, minute: number): Run[] {
  if (f.tenant !== Tenant.None) return [{ text: TENANTS[f.tenant].name, strong: true }];
  if (f.tenantAt < 0) return [{ text: "To let", strong: true }];
  return [{ text: "To let", strong: true }, SEP, { text: "tenant in ", muted: true }, { text: countdown(f.tenantAt - minute), mono: true, muted: true }];
}
