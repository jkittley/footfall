import { START_MINUTE } from "./clock";
import { GAME_MIN_PER_REAL_SEC, MAX_PEOPLE } from "./constants";
import { CrowdGrid } from "./crowd";
import type { Grid, Rect } from "./grid";
import { HARBOUR_STREET, buildGrid, type StationMap } from "./maps/harbourStreet";
import { stepMovement } from "./movement";
import { PeopleStore } from "./people";
import { Rng } from "./rng";
import { FieldCache } from "./routeField";
import { Timetable, type Service } from "./timetable";
import { stepTrains } from "./trains";

/** Services that departed this long ago are dropped from the timetable. */
const PRUNE_AFTER_MIN = 60;

export type GameEvent =
  | { kind: "toast"; text: string }
  | { kind: "outcome"; personId: number; onTime: boolean; excluded: boolean }
  // DaySummary arrives with the economy (Task 9).
  | { kind: "dayEnd"; summary: unknown }
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
  stats: { movedToday: number; onTimeToday: number; missedToday: number };
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

/** Target tiles for a field key: `platform:<id>`, `exit:<A|B|C>`, `spot:<tileIdx>`; [] for anything else. */
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
  // Task 10 adds facility:<id> and seat:<id>.
  return [];
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
  if (onTime) w.stats.onTimeToday++;
  else w.stats.missedToday++;
  // Task 9: fares and refunds. Task 13: service meter sample.
}

/** Called once as a service starts dwelling. Task 8 spawns its alighting passengers here. */
export function onTrainArrived(_w: World, _s: Service): void {}

/** Advances the world by `dtReal` real seconds at x1. */
export function step(w: World, dtReal: number): void {
  w.minute += dtReal * GAME_MIN_PER_REAL_SEC;
  w.timetable.ensureHorizon(w.minute, activePlatformIds(w), w.rng);
  w.timetable.prune(w.minute - PRUNE_AFTER_MIN);
  // Order of the step functions as later tasks slot in:
  //   disruptions (Task 14) -> trains -> spawner (Task 8) -> needs (Task 11) -> facilities (Task 10)
  //   -> movement -> crowd -> growth (Task 13) -> economy day rollover (Task 9)
  stepTrains(w);
  // Arrivals are level-triggered (re-reported each step until state/targetKey changes); Task 8 reacts.
  const arrived = stepMovement(w.grid, w.fields, (key) => fieldTargets(w, key), w.people, w.crowd, dtReal);
  void arrived;
  w.crowd.rebuild(w.people, w.grid);
}
