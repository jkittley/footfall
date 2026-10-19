import { START_MINUTE, dayIndex } from "./clock";
import { GAME_MIN_PER_REAL_SEC, MAX_PEOPLE } from "./constants";
import { CrowdGrid } from "./crowd";
import {
  DISRUPTION_REFUND_FACTOR,
  FARE_BONUS,
  Ledger,
  REFUND,
  STARTING_CASH,
  dailyUpkeep,
  type DayStats,
  type DaySummary,
} from "./economy";
import { FacilityKind, stepFacilities, type Facility } from "./facilities";
import type { Grid, Rect } from "./grid";
import { HARBOUR_STREET, buildGrid, type StationMap } from "./maps/harbourStreet";
import { stepMovement } from "./movement";
import { Journey, PState, PeopleStore } from "./people";
import { Rng } from "./rng";
import { FieldCache } from "./routeField";
import { stepSpawner } from "./spawner";
import { Timetable } from "./timetable";
import { stepTrains } from "./trains";

/** Services that departed this long ago are dropped from the timetable. */
const PRUNE_AFTER_MIN = 60;

export type GameEvent =
  | { kind: "toast"; text: string }
  | { kind: "outcome"; personId: number; onTime: boolean; excluded: boolean }
  | { kind: "dayEnd"; summary: DaySummary }
  | { kind: "autosave" };

export interface World {
  seed: number;
  rng: Rng;
  map: StationMap;
  grid: Grid;
  fields: FieldCache;
  people: PeopleStore;
  crowd: CrowdGrid;
  minute: number;
  timetable: Timetable;
  /** Train events (arrivals, boarding, departures) have been run up to this minute. */
  trainsUpTo: number;
  platformsAdded: number;
  /** Index = slot id - 1. */
  platformActive: boolean[];
  events: GameEvent[];
  stats: DayStats;
  ledger: Ledger;
  /** The game day now in progress; closed (once each) when the clock passes into the next. */
  day: number;
  /** Keyed by id, in creation order. */
  facilities: Map<number, Facility>;
  nextId: number;
}

export function createWorld(seed: number): World {
  const map = HARBOUR_STREET;
  const grid = buildGrid(map, map.startingPlatforms);
  const w: World = {
    seed,
    rng: new Rng(seed),
    map,
    grid,
    fields: new FieldCache(grid),
    people: new PeopleStore(MAX_PEOPLE),
    crowd: new CrowdGrid(grid.w, grid.h),
    minute: START_MINUTE,
    timetable: new Timetable(),
    trainsUpTo: START_MINUTE,
    platformsAdded: map.startingPlatforms,
    platformActive: map.slots.map((s) => s.id <= map.startingPlatforms),
    events: [],
    stats: { movedToday: 0, onTimeToday: 0, missedToday: 0 },
    ledger: new Ledger(STARTING_CASH),
    day: dayIndex(START_MINUTE),
    facilities: new Map(),
    nextId: 1,
  };
  w.timetable.ensureHorizon(w.minute, activePlatformIds(w), w.rng);
  return w;
}

export function activePlatformIds(w: World): number[] {
  const ids: number[] = [];
  for (let id = 1; id <= w.platformsAdded; id++) if (w.platformActive[id - 1]) ids.push(id);
  return ids;
}

function rectTiles(grid: Grid, r: Rect): number[] {
  const out: number[] = [];
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) out.push(grid.idx(x, y));
  return out;
}

/**
 * Target tiles for a field key: `platform:<id>`, `exit:<A|B|C>`, `spot:<tileIdx>`, `facility:<id>`
 * (its service tiles) or `seat:<id>` (a seating block's own tiles); [] for anything else.
 */
export function fieldTargets(w: World, key: string): readonly number[] {
  const colon = key.indexOf(":");
  const kind = key.slice(0, colon);
  const arg = key.slice(colon + 1);
  if (kind === "platform") {
    const slot = w.map.slots.find((s) => String(s.id) === arg);
    return slot ? rectTiles(w.grid, slot.platform) : [];
  }
  if (kind === "exit") {
    const e = w.map.entrances.find((en) => en.id === arg);
    return e ? rectTiles(w.grid, e.tiles) : [];
  }
  if (kind === "spot") {
    const t = Number(arg);
    return arg !== "" && Number.isInteger(t) && t >= 0 && t < w.grid.w * w.grid.h ? [t] : [];
  }
  if (kind === "facility" || kind === "seat") {
    const f = w.facilities.get(Number(arg));
    if (!f) return [];
    if (kind === "facility") return f.serviceTiles;
    return f.kind === FacilityKind.Seating ? rectTiles(w.grid, f.rect) : [];
  }
  return [];
}

/** The walkable tiles among a field key's targets: where a person can actually be put or sent. */
export function walkableTargets(w: World, key: string): number[] {
  const g = w.grid;
  return fieldTargets(w, key).filter((t) => g.isWalkable(t % g.w, Math.floor(t / g.w)));
}

/**
 * The one place a journey's outcome is recorded; every outcome goes through here.
 * At most once per person: a counted person is ignored.
 */
export function recordOutcome(w: World, personId: number, onTime: boolean, excluded: boolean): void {
  const p = w.people;
  if (!p.isAlive(personId) || p.counted[personId]) return;
  p.counted[personId] = 1;
  w.events.push({ kind: "outcome", personId, onTime, excluded });
  w.stats.movedToday++;
  if (!excluded) {
    if (onTime) w.stats.onTimeToday++;
    else w.stats.missedToday++;
  }
  if (!onTime) w.ledger.debit("refunds", excluded ? REFUND * DISRUPTION_REFUND_FACTOR : REFUND);
  else if (p.journey[personId] !== Journey.Arriving) w.ledger.credit("fares", FARE_BONUS);
  // Task 13: service meter sample.
}

/**
 * Reacts to walkers at their target, changing each one's state or target (or freeing them) so the
 * next step does not report them again: at an exit an arriving passenger leaves, on time if within
 * their deadline; on their platform a passenger waits, strolling to a random spot along it; a
 * queuer at their queue spot stands there.
 */
function handleArrivals(w: World, arrived: readonly number[]): void {
  const p = w.people;
  for (const i of arrived) {
    const key = p.targetKey[i]!;
    if (p.state[i] === PState.Waiting || p.state[i] === PState.InQueue) {
      p.targetKey[i] = "";
    } else if (key.startsWith("exit:")) {
      recordOutcome(w, i, w.minute <= p.deadline[i]!, false);
      p.free(i);
    } else if (key.startsWith("platform:")) {
      const tiles = walkableTargets(w, key);
      p.state[i] = PState.Waiting;
      p.targetKey[i] = tiles.length > 0 ? `spot:${w.rng.pick(tiles)}` : "";
    }
  }
}

/** Advances the world by `dtReal` real seconds at x1. */
export function step(w: World, dtReal: number): void {
  w.minute += dtReal * GAME_MIN_PER_REAL_SEC;
  w.timetable.ensureHorizon(w.minute, activePlatformIds(w), w.rng);
  w.timetable.prune(w.minute - PRUNE_AFTER_MIN);
  // Order of the step functions as later tasks slot in:
  //   disruptions (Task 14) -> trains -> spawner (Task 8) -> needs (Task 11) -> facilities (Task 10)
  //   -> movement -> crowd -> growth (Task 13) -> economy day rollover (Task 9)
  stepTrains(w);
  stepSpawner(w, dtReal * GAME_MIN_PER_REAL_SEC);
  stepFacilities(w, dtReal * GAME_MIN_PER_REAL_SEC);
  const arrived = stepMovement(w.grid, w.fields, (key) => fieldTargets(w, key), w.people, w.crowd, dtReal);
  handleArrivals(w, arrived);
  w.crowd.rebuild(w.people, w.grid);
  rollDays(w);
}

/** Closes each day the clock has passed (several, after a huge step): upkeep, summary, fresh stats and takings. */
function rollDays(w: World): void {
  const today = dayIndex(w.minute);
  while (w.day < today) {
    w.ledger.debit("maintenance", dailyUpkeep(w));
    w.events.push({ kind: "dayEnd", summary: w.ledger.closeDay(w.day, w.stats) });
    w.stats = { movedToday: 0, onTimeToday: 0, missedToday: 0 };
    for (const f of w.facilities.values()) f.takingsToday = 0;
    w.day++;
  }
}
