import { decodeBytesInto, encodeBytes } from "./base64";
import { MAX_PEOPLE } from "./constants";
import type { Disruption } from "./disruptions";
import { Ledger, type DayStats, type LedgerLine } from "./economy";
import type { Facility } from "./facilities";
import type { Grid, Rect } from "./grid";
import type { GrowthState } from "./growth";
import { HARBOUR_STREET } from "./maps/harbourStreet";
import { restoreTurnstiles, saveTurnstiles, type TurnstileSave } from "./movement";
import type { Sign } from "./needs";
import { PeopleStore, type PeopleSave } from "./people";
import { Rng } from "./rng";
import { checkSave } from "./saveCheck";
import { Timetable, type Service } from "./timetable";
import { createWorld, type World } from "./world";

export const SAVE_VERSION = 4;
/** The only map so far; its layout is constant data, so a save names it rather than storing it. */
const MAP_ID = "harbour-street";

type RentFields = "footfallToday" | "footfallYesterday" | "rentMul" | "builtAt";
type FacilitySave = Omit<Facility, "footfallSeen" | "passedSeen" | RentFields> &
  Partial<Pick<Facility, RentFields>> & { footfallSeen: number[]; passedSeen?: number[] };

/**
 * Everything that decides future steps. Not saved: the route fields and crowd counts (rebuilt from
 * the grid and people on load) and the pending events (UI notices, drained every frame).
 */
interface SaveFile {
  version: number;
  map: string;
  seed: number;
  rng: number;
  minute: number;
  day: number;
  trainsUpTo: number;
  growthUpTo: number;
  autosaveHour: number;
  searchClock: number;
  nextId: number;
  platformsAdded: number;
  platformActive: boolean[];
  stagesUnlocked: { subway: boolean };
  stats: DayStats;
  ledger: { balance: number; today: Record<LedgerLine, number> };
  meter: { minutes: number[]; total: number[]; onTime: number[] };
  growth: GrowthState;
  /** The station grounds' tiles, row by row: the rest of the city is constant and rebuilt on load. */
  grid: { version: number; tiles: string; zones: string; zoneOwner: string; dir: string };
  /** The ticket gates' cadence and queues. */
  turnstiles: TurnstileSave;
  people: PeopleSave;
  /** Services in id order, which is the order the timetable's map hands them out. */
  timetable: { nextId: number; services: Service[]; lastDepart: [number, number][] };
  /** In id (creation) order, likewise. */
  facilities: FacilitySave[];
  signs: Sign[];
  disruptions: Disruption[];
}

/**
 * Hands the world's live objects (stats, signs, the meter's arrays, …) straight to JSON.stringify
 * within this call rather than copying them first; nothing here may hold on to one afterwards.
 * deserialise likewise adopts the parsed objects as the new world's own.
 */
export function serialise(w: World): string {
  const g = w.grid;
  const save: SaveFile = {
    version: SAVE_VERSION,
    map: MAP_ID,
    seed: w.seed,
    rng: w.rng.state(),
    minute: w.minute,
    day: w.day,
    trainsUpTo: w.trainsUpTo,
    growthUpTo: w.growthUpTo,
    autosaveHour: w.autosaveHour,
    searchClock: w.searchClock,
    nextId: w.nextId,
    platformsAdded: w.platformsAdded,
    platformActive: w.platformActive,
    stagesUnlocked: w.stagesUnlocked,
    stats: w.stats,
    ledger: { balance: w.ledger.balance, today: w.ledger.today },
    meter: { minutes: w.meter.minutes, total: w.meter.total, onTime: w.meter.onTime },
    growth: w.growth,
    grid: {
      version: g.version,
      tiles: encodeBytes(cut(g, g.tiles, w.map.grounds)),
      zones: encodeBytes(cut(g, g.zones, w.map.grounds)),
      zoneOwner: encodeBytes(cut(g, g.zoneOwner, w.map.grounds)),
      dir: encodeBytes(cut(g, g.dir, w.map.grounds)),
    },
    turnstiles: saveTurnstiles(w.turnstiles, g),
    people: w.people.toSave(),
    timetable: {
      nextId: w.timetable.nextId,
      services: [...w.timetable.services.values()],
      lastDepart: [...w.timetable.lastDepart],
    },
    facilities: [...w.facilities.values()].map((f) => ({ ...f, footfallSeen: [...f.footfallSeen], passedSeen: [...f.passedSeen] })),
    signs: w.signs,
    disruptions: w.disruptions,
  };
  return JSON.stringify(save);
}

type TileArray = Uint8Array | Int32Array;

/** The rect's part of a per-tile array, row by row. */
function cut<T extends TileArray>(g: Grid, a: T, r: Rect): T {
  const out = a.slice(0, r.w * r.h) as T;
  for (let y = 0; y < r.h; y++) out.set(a.subarray((r.y + y) * g.w + r.x, (r.y + y) * g.w + r.x + r.w), y * r.w);
  return out;
}

/** Writes a saved rect of a per-tile array back into place. */
function restoreRect<T extends TileArray>(g: Grid, a: T, r: Rect, b64: string, name: string): void {
  const part = a.slice(0, r.w * r.h) as T;
  if (decodeBytesInto(part, b64) !== part.byteLength) throw new Error(`Corrupt save: ${name}`);
  for (let y = 0; y < r.h; y++) a.set(part.subarray(y * r.w, (y + 1) * r.w), (r.y + y) * g.w + r.x);
}

/**
 * Builds a fresh world (so the route fields and crowd grid belong to it) and overwrites its state
 * with the save's.
 */
export function deserialise(json: string): World {
  const s: SaveFile = JSON.parse(json);
  if (typeof s !== "object" || s === null || s.version !== SAVE_VERSION) throw new Error("Unsupported save version");
  if (s.map !== MAP_ID) throw new Error(`Unknown map ${s.map}`);
  checkSave(s, HARBOUR_STREET.slots.length);

  const w = createWorld(s.seed);
  w.rng = Rng.fromState(s.rng);
  w.minute = s.minute;
  w.day = s.day;
  w.trainsUpTo = s.trainsUpTo;
  w.growthUpTo = s.growthUpTo;
  w.autosaveHour = s.autosaveHour;
  w.searchClock = s.searchClock;
  w.nextId = s.nextId;
  w.platformsAdded = s.platformsAdded;
  w.platformActive = s.platformActive;
  w.stagesUnlocked = s.stagesUnlocked;
  w.stats = s.stats;
  w.ledger = new Ledger(s.ledger.balance);
  w.ledger.today = s.ledger.today;
  w.meter.minutes = s.meter.minutes;
  w.meter.total = s.meter.total;
  w.meter.onTime = s.meter.onTime;
  w.growth = s.growth;

  const g = w.grid;
  const r = w.map.grounds;
  restoreRect(g, g.tiles, r, s.grid.tiles, "grid.tiles");
  restoreRect(g, g.zones, r, s.grid.zones, "grid.zones");
  restoreRect(g, g.zoneOwner, r, s.grid.zoneOwner, "grid.zoneOwner");
  restoreRect(g, g.dir, r, s.grid.dir, "grid.dir");
  g.version = s.grid.version;
  restoreTurnstiles(w.turnstiles, s.turnstiles);

  w.people = PeopleStore.fromSave(MAX_PEOPLE, s.people);

  w.timetable = new Timetable();
  w.timetable.nextId = s.timetable.nextId;
  for (const svc of s.timetable.services) w.timetable.services.set(svc.id, svc);
  w.timetable.lastDepart = new Map(s.timetable.lastDepart);

  w.facilities = new Map();
  for (const f of s.facilities) w.facilities.set(f.id, {
      ...f,
      footfallSeen: new Set(f.footfallSeen),
      passedSeen: new Set(f.passedSeen ?? []),
      footfallToday: f.footfallToday ?? 0,
      builtAt: f.builtAt ?? 0,
      footfallYesterday: f.footfallYesterday ?? -1,
      rentMul: f.rentMul ?? 1,
    });
  w.signs = s.signs;
  w.disruptions = s.disruptions;
  w.events = [];

  w.crowd.rebuild(w.people, w.grid);
  return w;
}
