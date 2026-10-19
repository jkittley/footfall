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
  const head: Run = { text: `Platform ${slotId}`, strong: true };
  if (!w.platformActive[slotId - 1]) return [head, SEP, { text: "Closed" }];
  const d = w.disruptions.find((x) => !x.ended && x.platforms.includes(slotId));
  if (d) return [head, SEP, { text: "Closed until " }, { text: clockTime(d.endsAt), mono: true }];
  const next = w.timetable.upcoming(slotId, w.minute)[0];
  if (!next) return [head, SEP, { text: "No trains", muted: true }];
  return [
    head,
    SEP,
    { text: clockTime(next.departAt), mono: true },
    { text: ` ${next.destination}` },
    SEP,
    { text: countdown(next.departAt - w.minute), mono: true },
  ];
}

/** The tenant's name, or "To let · tenant in 0:40" until one moves in. */
export function retailLabel(f: Facility, minute: number): Run[] {
  if (f.tenant !== Tenant.None) return [{ text: TENANTS[f.tenant].name, strong: true }];
  if (f.tenantAt < 0) return [{ text: "To let", strong: true }];
  return [{ text: "To let", strong: true }, SEP, { text: "tenant in ", muted: true }, { text: countdown(f.tenantAt - minute), mono: true, muted: true }];
}

export interface StaticLayerInputs {
  /** Grid.version: every tile, zone and direction change bumps it, facilities included. */
  version: number;
  x: number;
  y: number;
  zoom: number;
  /** Backing store size in device px. */
  width: number;
  height: number;
  dpr: number;
  /** Bumped when the web fonts finish loading, so labels first drawn in a fallback face are redrawn. */
  fonts: number;
}

/** The static layer is redrawn exactly when this changes. */
export function staticLayerKey(k: StaticLayerInputs): string {
  return `${k.version}|${k.x}|${k.y}|${k.zoom}|${k.width}|${k.height}|${k.dpr}|${k.fonts}`;
}
