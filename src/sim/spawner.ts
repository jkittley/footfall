import { dayOfWeek, demand, leisureShare, minuteOfDay } from "./clock";
import { CONNECT_SHARE, MIN_SLACK_MINUTES, SPAWN_PER_MIN_PER_PLATFORM } from "./constants";
import { DestLabel, Journey, Mode, NEED_COUNT, PState } from "./people";
import type { Rng } from "./rng";
import { walkMinutes } from "./routeField";
import type { Service } from "./timetable";
import { activePlatformIds, fieldTargets, walkableTargets, type World } from "./world";

/** A passenger is booked onto one of the first this-many services that fit their deadline. */
const SERVICE_CHOICES = 3;
const MAX_START_NEED = 0.7;
/** Chance of the favoured destination when one is favoured; the other two share the rest. */
const FAVOURED_LABEL_SHARE = 0.6;
const WORK_UNTIL_MINUTE = 10 * 60;
const HOME_FROM_MINUTE = 16 * 60;

function uniform(rng: Rng, lo: number, hi: number): number {
  return lo + (hi - lo) * rng.next();
}

/** Spare minutes a passenger allows over their walk: mostly 10 to 45, never under MIN_SLACK_MINUTES. */
export function sampleSlack(rng: Rng): number {
  const r = rng.next();
  if (r < 0.25) return uniform(rng, MIN_SLACK_MINUTES, 10);
  if (r < 0.75) return uniform(rng, 10, 45);
  return uniform(rng, 45, 120);
}

function fieldFor(w: World, key: string): Float32Array {
  return w.fields.get(key, () => fieldTargets(w, key));
}

/** Route field per active platform id. */
function platformFields(w: World, active: readonly number[]): Map<number, Float32Array> {
  const out = new Map<number, Float32Array>();
  for (const id of active) out.set(id, fieldFor(w, `platform:${id}`));
  return out;
}

/**
 * A service on an active platform (other than `notPlatform`) that a passenger at `tile` reaches
 * with `slack` to spare walking unimpeded: random among the first SERVICE_CHOICES to depart.
 * `departures` must be soonest first. The walk is Float32-rounded, as spawnWalk stores it.
 */
function pickService(
  w: World,
  departures: readonly Service[],
  fields: ReadonlyMap<number, Float32Array>,
  tile: number,
  slack: number,
  notPlatform: number,
): { service: Service; walk: number } | null {
  const fits: { service: Service; walk: number }[] = [];
  for (const s of departures) {
    if (s.platformId === notPlatform) continue;
    const field = fields.get(s.platformId);
    if (!field) continue;
    const walk = Math.fround(walkMinutes(field, tile));
    if (!Number.isFinite(walk) || s.departAt < w.minute + walk + slack) continue;
    fits.push({ service: s, walk });
    if (fits.length === SERVICE_CHOICES) break;
  }
  return fits.length > 0 ? w.rng.pick(fits) : null;
}

/** Allocates a walking train passenger at a random point of `tile`. */
function spawn(w: World, tile: number, journey: Journey, goalKey: string, walk: number, deadline: number): number {
  const { people: p, rng } = w;
  const i = p.alloc();
  const tx = tile % w.grid.w;
  const ty = (tile - tx) / w.grid.w;
  p.x[i] = tx + uniform(rng, 0.25, 0.75);
  p.y[i] = ty + uniform(rng, 0.25, 0.75);
  p.state[i] = PState.Walking;
  p.mode[i] = Mode.Train;
  p.journey[i] = journey;
  p.goalKey[i] = goalKey;
  p.targetKey[i] = goalKey;
  p.spawnedAt[i] = w.minute;
  p.spawnWalk[i] = walk;
  p.deadline[i] = deadline;
  p.leisure[i] = rng.next() < leisureShare(w.minute) ? 1 : 0;
  for (let n = 0; n < NEED_COUNT; n++) p.needs[i * NEED_COUNT + n] = uniform(rng, 0, MAX_START_NEED);
  return i;
}

function spawnBooked(w: World, tile: number, journey: Journey, booking: { service: Service; walk: number }): void {
  const s = booking.service;
  const i = spawn(w, tile, journey, `platform:${s.platformId}`, booking.walk, s.departAt);
  w.people.serviceId[i] = s.id;
}

/**
 * Entrances departing passengers can come in by: each with its tiles that route to some active
 * platform. An entrance with none is left out, so its share of passengers goes to the others.
 */
export function reachableEntrances(
  w: World,
  fields: ReadonlyMap<number, Float32Array> = platformFields(w, activePlatformIds(w)),
): { id: string; tiles: number[]; weight: number }[] {
  const out: { id: string; tiles: number[]; weight: number }[] = [];
  for (const e of w.map.entrances) {
    const tiles = walkableTargets(w, `exit:${e.id}`).filter((t) => {
      for (const f of fields.values()) if (Number.isFinite(f[t]!)) return true;
      return false;
    });
    if (tiles.length > 0) out.push({ id: e.id, tiles, weight: e.weight });
  }
  return out;
}

/** Departing passengers come in from the street at reachable entrances, booked onto a train they can make. */
export function stepSpawner(w: World, dtMin: number): void {
  const active = activePlatformIds(w);
  if (active.length === 0) return;
  const { rng, people } = w;
  const n = rng.poisson(SPAWN_PER_MIN_PER_PLATFORM * active.length * demand(w.minute) * dtMin);
  if (n === 0) return;

  const fields = platformFields(w, active);
  const entrances = reachableEntrances(w, fields).map((e) => ({ item: e.tiles, w: e.weight }));
  if (entrances.length === 0) return;
  // Once per call: the timetable scan sorts every service.
  const departures = w.timetable.departuresAfter(w.minute);

  for (let k = 0; k < n && people.count < people.cap; k++) {
    const tile = rng.pick(rng.weighted(entrances));
    const booking = pickService(w, departures, fields, tile, sampleSlack(rng), -1);
    if (booking) spawnBooked(w, tile, Journey.Departing, booking);
  }
}

function arrivalLabel(w: World): DestLabel {
  const m = minuteOfDay(w.minute);
  let favoured: DestLabel | null = null;
  if (dayOfWeek(w.minute) < 5 && m < WORK_UNTIL_MINUTE) favoured = DestLabel.Work;
  else if (m >= HOME_FROM_MINUTE) favoured = DestLabel.Home;
  const labels = [DestLabel.Home, DestLabel.Hotel, DestLabel.Work];
  if (favoured === null) return w.rng.pick(labels);
  const other = (1 - FAVOURED_LABEL_SHARE) / 2;
  return w.rng.weighted(labels.map((l) => ({ item: l, w: l === favoured ? FAVOURED_LABEL_SHARE : other })));
}

/**
 * Called once as a service starts dwelling: its alighting passengers step off at random platform
 * tiles. CONNECT_SHARE of them connect to a train on another platform when one fits; the rest
 * leave by an exit they can reach.
 */
export function onTrainArrived(w: World, s: Service): void {
  const { rng, people } = w;
  const platform = walkableTargets(w, `platform:${s.platformId}`);
  if (platform.length === 0) return;
  const exits = exitFields(w);
  let fields: Map<number, Float32Array> | null = null;
  let departures: Service[] | null = null;

  for (let k = 0; k < s.alighting && people.count < people.cap; k++) {
    const tile = rng.pick(platform);
    if (rng.next() < CONNECT_SHARE) {
      fields ??= platformFields(w, activePlatformIds(w));
      departures ??= w.timetable.departuresAfter(w.minute);
      const booking = pickService(w, departures, fields, tile, sampleSlack(rng), s.platformId);
      if (booking) {
        spawnBooked(w, tile, Journey.Connecting, booking);
        continue;
      }
    }
    const exit = pickExit(w, exits, tile);
    // Unreachable in play: a build that cuts a platform off from every exit is refused (Task 12).
    if (!exit) continue;
    const i = spawn(w, tile, Journey.Arriving, `exit:${exit.id}`, exit.walk, w.minute + exit.walk + sampleSlack(rng));
    people.destLabel[i] = arrivalLabel(w);
  }
}

type ExitField = { id: string; weight: number; field: Float32Array };

function exitFields(w: World): ExitField[] {
  return w.map.entrances.map((e) => ({ id: e.id, weight: e.weight, field: fieldFor(w, `exit:${e.id}`) }));
}

/** An exit reachable from `tile`, chosen by weight, with the Float32-rounded walk to it. */
function pickExit(w: World, exits: readonly ExitField[], tile: number): { id: string; walk: number } | null {
  const reachable = exits.filter((e) => Number.isFinite(e.field[tile]!));
  if (reachable.length === 0) return null;
  const exit = w.rng.weighted(reachable.map((e) => ({ item: e, w: e.weight })));
  return { id: exit.id, walk: Math.fround(walkMinutes(exit.field, tile)) };
}

/** What rebook needs, gathered once for a batch: the active platforms' fields and the departures to come. */
export interface RebookContext {
  fields: Map<number, Float32Array>;
  departures: Service[];
}

export function rebookContext(w: World): RebookContext {
  return { fields: platformFields(w, activePlatformIds(w)), departures: w.timetable.departuresAfter(w.minute) };
}

/**
 * A passenger whose service will not run is booked onto one they can make from where they stand,
 * on the fair rule with MIN_SLACK_MINUTES to spare, and heads for its platform; with none that
 * fits they leave by an exit. Records no outcome.
 */
export function rebook(w: World, i: number, ctx: RebookContext = rebookContext(w)): void {
  const p = w.people;
  const tile = Math.floor(p.y[i]!) * w.grid.w + Math.floor(p.x[i]!);
  const booking = pickService(w, ctx.departures, ctx.fields, tile, MIN_SLACK_MINUTES, -1);
  if (!booking) {
    sendToExit(w, i);
    return;
  }
  const oldGoal = p.goalKey[i]!;
  const goal = `platform:${booking.service.platformId}`;
  p.serviceId[i] = booking.service.id;
  // A new booking gets a new fair deadline from here; only rebuilds never move a deadline.
  p.deadline[i] = booking.service.departAt;
  p.goalKey[i] = goal;
  // Someone mid-errand keeps at it; resuming takes them to the new goal.
  if (p.state[i] === PState.Waiting) {
    p.state[i] = PState.Walking;
    p.targetKey[i] = goal;
  } else if (p.state[i] === PState.Walking && p.targetKey[i] === oldGoal) {
    p.targetKey[i] = goal;
  }
}

/**
 * A passenger who missed their train and has no later service to take leaves instead: they walk
 * to an exit as an arriving passenger would, with a fair deadline from here. Their journey was
 * already counted, so this records nothing.
 */
export function sendToExit(w: World, i: number): void {
  const p = w.people;
  const tile = Math.floor(p.y[i]!) * w.grid.w + Math.floor(p.x[i]!);
  const exit = pickExit(w, exitFields(w), tile);
  if (!exit) {
    // Unreachable in play (Task 12 refuses builds that strand people); nowhere to go, so they leave.
    p.free(i);
    return;
  }
  p.journey[i] = Journey.Arriving;
  p.state[i] = PState.Walking;
  p.serviceId[i] = -1;
  p.goalKey[i] = `exit:${exit.id}`;
  p.targetKey[i] = p.goalKey[i]!;
  p.deadline[i] = w.minute + exit.walk + sampleSlack(w.rng);
  p.destLabel[i] = arrivalLabel(w);
}
