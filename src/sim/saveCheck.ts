import { METER_WINDOW_MIN } from "./constants";
import { LEDGER_LINES } from "./economy";
import { FacilityKind } from "./facilityKinds";

// Shape checks for a parsed save, so a corrupt one fails at load (where the UI can start a new
// game) rather than loading into a world that misbehaves or throws later inside step.

type Obj = Record<string, unknown>;

function need(cond: boolean, field: string): asserts cond {
  if (!cond) throw new Error(`Corrupt save: ${field}`);
}

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function obj(v: unknown, field: string): Obj {
  need(isObj(v), field);
  return v;
}

function list(v: unknown, field: string, len?: number): unknown[] {
  need(Array.isArray(v) && (len === undefined || v.length === len), field);
  return v;
}

function nums(o: Obj, keys: readonly string[], at: string): void {
  for (const k of keys) need(finite(o[k]), at + k);
}

function numList(v: unknown, field: string, len?: number): void {
  need(list(v, field, len).every(finite), field);
}

function objects(v: unknown, field: string, check: (o: Obj, at: string) => void): void {
  list(v, field).forEach((x, i) => check(obj(x, `${field}[${i}]`), `${field}[${i}].`));
}

function service(o: Obj, at: string): void {
  nums(o, ["id", "platformId", "arriveAt", "departAt", "alighting"], at);
  need(typeof o.destination === "string", at + "destination");
  need(typeof o.cancelled === "boolean", at + "cancelled");
  need(o.cancelReason === null || o.cancelReason === "inactive" || o.cancelReason === "disruption", at + "cancelReason");
}

function facility(o: Obj, at: string): void {
  nums(o, ["id", "tenant", "tenantAt", "capacity", "takingsToday", "builtPrice"], at);
  need(Object.values(FacilityKind).some((k) => k === o.kind), at + "kind");
  nums(obj(o.rect, at + "rect"), ["x", "y", "w", "h"], at + "rect.");
  nums(obj(o.footfall, at + "footfall"), ["commuter", "leisure"], at + "footfall.");
  for (const k of ["serviceTiles", "queueTiles", "footfallSeen", "queue"]) numList(o[k], at + k);
  objects(o.serving, at + "serving", (s, sat) => nums(s, ["pid", "until"], sat));
}

function sign(o: Obj, at: string): void {
  nums(o, ["id", "tile", "pointsTo"], at);
  need(o.kind === "toilets" || o.kind === "seating" || o.kind === "shops", at + "kind");
}

function disruption(o: Obj, at: string): void {
  nums(o, ["id", "startsAt", "endsAt"], at);
  need(o.kind === "line-closure", at + "kind");
  numList(o.platforms, at + "platforms");
  need(typeof o.text === "string", at + "text");
  need(typeof o.ended === "boolean", at + "ended");
}

/**
 * Throws `Corrupt save: <field>` on the first field missing or of the wrong shape. Typed-array
 * contents and the people store are checked as they are decoded.
 */
export function checkSave(save: unknown, slotCount: number): void {
  const s = obj(save, "save");
  nums(
    s,
    ["seed", "rng", "minute", "day", "trainsUpTo", "growthUpTo", "autosaveHour", "searchClock", "nextId", "platformsAdded"],
    "",
  );
  need(list(s.platformActive, "platformActive", slotCount).every((b) => typeof b === "boolean"), "platformActive");
  need(typeof obj(s.stagesUnlocked, "stagesUnlocked").subway === "boolean", "stagesUnlocked.subway");
  nums(obj(s.stats, "stats"), ["movedToday", "onTimeToday", "missedToday"], "stats.");

  const ledger = obj(s.ledger, "ledger");
  need(finite(ledger.balance), "ledger.balance");
  nums(obj(ledger.today, "ledger.today"), LEDGER_LINES, "ledger.today.");

  const meter = obj(s.meter, "meter");
  for (const k of ["minutes", "total", "onTime"]) numList(meter[k], `meter.${k}`, METER_WINDOW_MIN);

  const growth = obj(s.growth, "growth");
  for (const k of ["goodSince", "badSince"]) need(growth[k] === null || finite(growth[k]), `growth.${k}`);
  need(finite(growth.cooldownUntil), "growth.cooldownUntil");

  need(finite(obj(s.grid, "grid").version), "grid.version");
  const t = obj(s.turnstiles, "turnstiles");
  nums(t, ["clock", "step"], "turnstiles.");
  list(t.gates, "turnstiles.gates").forEach((e, i) => numList(e, `turnstiles.gates[${i}]`, 2));
  list(t.waiting, "turnstiles.waiting").forEach((e, i) => numList(e, `turnstiles.waiting[${i}]`, 4));
  obj(s.people, "people");

  const timetable = obj(s.timetable, "timetable");
  need(finite(timetable.nextId), "timetable.nextId");
  objects(timetable.services, "timetable.services", service);
  list(timetable.lastDepart, "timetable.lastDepart").forEach((e, i) =>
    numList(e, `timetable.lastDepart[${i}]`, 2),
  );

  objects(s.facilities, "facilities", facility);
  objects(s.signs, "signs", sign);
  objects(s.disruptions, "disruptions", disruption);
}
