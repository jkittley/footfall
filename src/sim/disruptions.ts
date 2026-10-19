import { minuteOfDay } from "./clock";
import { DISRUPTIONS_PER_DAY, DISRUPTION_MAX_MIN, DISRUPTION_MIN_MIN, MIN_SLACK_MINUTES } from "./constants";
import { fairWalk, rebook, sendToExit, type RebookContext } from "./spawner";
import { DESTINATIONS, type Service } from "./timetable";
import { activePlatformIds, fieldTargets, recordOutcome, type World } from "./world";

/** The running disruption plus this many of the most recent ended ones are kept for the UI. */
const HISTORY = 5;
/** Share of the people on a cancelled train who are rebooked at once; the rest wait it out. */
const REBOOK_SHARE = 0.5;

export interface Disruption {
  id: number;
  kind: "line-closure";
  platforms: number[];
  startsAt: number;
  endsAt: number;
  text: string;
  /** Set once the end has been announced. */
  ended: boolean;
}

function hhmm(m: number): string {
  const mod = minuteOfDay(m);
  return `${String(Math.floor(mod / 60)).padStart(2, "0")}:${String(mod % 60).padStart(2, "0")}`;
}

function platformList(platforms: readonly number[]): string {
  if (platforms.length === 1) return `Platform ${platforms[0]}`;
  const head = platforms.slice(0, -1).join(", ");
  return `Platforms ${head} and ${platforms[platforms.length - 1]}`;
}

/** Closes platforms for `durationMin` from now; cancels their services in the window and settles the people booked on them. */
export function startDisruption(w: World, platforms: readonly number[], durationMin: number): Disruption {
  const sorted = [...platforms].sort((a, b) => a - b);
  const startsAt = w.minute;
  const endsAt = startsAt + durationMin;
  const town = w.rng.pick(DESTINATIONS);
  const d: Disruption = {
    id: w.nextId++,
    kind: "line-closure",
    platforms: sorted,
    startsAt,
    endsAt,
    text: `Signal failure at ${town}: ${platformList(sorted)} closed until ${hhmm(endsAt)}`,
    ended: false,
  };
  w.disruptions.push(d);
  const ended = w.disruptions.filter((x) => x.ended);
  for (const old of ended.slice(0, Math.max(0, ended.length - HISTORY))) {
    w.disruptions.splice(w.disruptions.indexOf(old), 1);
  }
  w.events.push({ kind: "toast", text: d.text });
  cancelServices(w, d);
  return d;
}

/**
 * Cancels the closed platforms' services departing in the disruption's window that are not yet
 * cancelled (new ones as the timetable's horizon grows), settling anyone booked on them. The
 * outcome is recorded before any rebooking, so the train guard never rebooks someone uncounted.
 */
function cancelServices(w: World, d: Disruption): void {
  const closed = new Set(d.platforms);
  const cancelled = new Map<number, Service>();
  for (const s of w.timetable.services.values()) {
    if (s.cancelled || !closed.has(s.platformId) || s.arriveAt <= d.startsAt || s.departAt > d.endsAt) continue;
    s.cancelled = true;
    s.cancelReason = "disruption";
    cancelled.set(s.id, s);
  }
  if (cancelled.size === 0) return;

  const p = w.people;
  let ctx: RebookContext | null = null;
  for (let i = 0, end = p.end; i < end; i++) {
    if (!p.isAlive(i)) continue;
    const s = cancelled.get(p.serviceId[i]!);
    if (!s) continue;
    recordOutcome(w, i, false, true);
    ctx ??= openContext(w, closed);
    if (w.rng.next() < REBOOK_SHARE) rebook(w, i, ctx);
    else waitForReopening(w, i, s.platformId, d.endsAt, ctx);
  }
}

/** Rebooking options that leave out the closed platforms. */
function openContext(w: World, closed: ReadonlySet<number>): RebookContext {
  const fields = new Map<number, Float32Array>();
  for (const id of activePlatformIds(w)) {
    if (!closed.has(id)) fields.set(id, w.fields.get(`platform:${id}`, () => fieldTargets(w, `platform:${id}`)));
  }
  return { fields, departures: w.timetable.departuresAfter(w.minute).filter((s) => fields.has(s.platformId)) };
}

/** Books someone onto their platform's first service after the closure they can make from where they stand; else rebooks them. */
function waitForReopening(w: World, i: number, platformId: number, endsAt: number, ctx: RebookContext): void {
  const p = w.people;
  const tile = Math.floor(p.y[i]!) * w.grid.w + Math.floor(p.x[i]!);
  const field = w.fields.get(`platform:${platformId}`, () => fieldTargets(w, `platform:${platformId}`));
  const next = w.timetable
    .upcoming(platformId, endsAt)
    .find((s) => fairWalk(w, s, field, tile, MIN_SLACK_MINUTES) !== null);
  if (next) {
    p.serviceId[i] = next.id;
    p.deadline[i] = next.departAt;
    return;
  }
  if (ctx.departures.length > 0) rebook(w, i, ctx);
  else sendToExit(w, i);
}

/** Starts a disruption now and then, and ends the running one when its time is up. */
export function stepDisruptions(w: World, dtMin: number): void {
  const running = w.disruptions.find((d) => !d.ended);
  if (running) {
    if (w.minute >= running.endsAt) {
      running.ended = true;
      const open = running.platforms.filter((id) => w.platformActive[id - 1]);
      if (open.length > 0) {
        const verb = open.length === 1 ? "reopens" : "reopen";
        w.events.push({ kind: "toast", text: `${platformList(open)} ${verb}` });
      }
    } else {
      cancelServices(w, running);
    }
    return;
  }
  if (w.rng.next() >= (DISRUPTIONS_PER_DAY / 1440) * dtMin) return;
  const active = activePlatformIds(w);
  if (active.length < 2) return;
  const count = Math.min(active.length - 1, Math.max(1, Math.floor(active.length / 3)));
  const chosen: number[] = [];
  const pool = [...active];
  for (let k = 0; k < count; k++) chosen.push(...pool.splice(w.rng.int(0, pool.length - 1), 1));
  startDisruption(w, chosen, w.rng.int(DISRUPTION_MIN_MIN, DISRUPTION_MAX_MIN));
}
