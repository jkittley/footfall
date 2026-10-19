import { expect, test } from "vitest";
import { applyPlacement, previewPlacement, type BuildOpts, type ToolId } from "../../src/sim/build";
import { START_MINUTE } from "../../src/sim/clock";
import { startDisruption } from "../../src/sim/disruptions";
import { FacilityKind, Tenant } from "../../src/sim/facilities";
import { Dir, type Rect } from "../../src/sim/grid";
import { PState } from "../../src/sim/people";
import { SAVE_VERSION, deserialise, serialise } from "../../src/sim/save";
import { trainPhase } from "../../src/sim/timetable";
import { Ledger } from "../../src/sim/economy";
import { Grid } from "../../src/sim/grid";
import { ServiceMeter } from "../../src/sim/growth";
import { Timetable } from "../../src/sim/timetable";
import { createWorld, step, type World } from "../../src/sim/world";
import { runMinutes } from "./helpers";

const MON_0815 = 8 * 60 + 15;
const MON_0840 = 8 * 60 + 40;

function build(w: World, tool: ToolId, rect: Rect, opts: BuildOpts = {}): void {
  const p = previewPlacement(w, tool, rect, opts);
  expect(p.reason).toBeNull();
  expect(applyPlacement(w, p)).toBe(true);
}

/**
 * Harbour Street with a shop unit, a toilet and a sign on new floor east of the concourse. The shop
 * is let to food and drink, or with `tenantAt` still to let until then.
 */
function furnishedWorld(seed: number, tenantAt = -1): World {
  const w = createWorld(seed);
  build(w, "floor", { x: 16, y: 56, w: 10, h: 6 });
  build(w, "retail", { x: 18, y: 59, w: 2, h: 2 });
  build(w, "toilet", { x: 22, y: 59, w: 2, h: 2 });
  build(w, "sign", { x: 15, y: 57, w: 1, h: 1 }, { signKind: "toilets" });
  for (const f of w.facilities.values()) {
    if (f.kind !== FacilityKind.Retail) continue;
    f.tenant = tenantAt < 0 ? Tenant.FoodDrink : Tenant.None;
    f.tenantAt = tenantAt;
  }
  return w;
}

test("a world saved mid-rush steps identically after loading", () => {
  const a = furnishedWorld(9);
  runMinutes(a, MON_0815 - START_MINUTE); // Mon 08:15, people waiting for the trains due in the next 30 minutes
  expect(a.people.count).toBeGreaterThan(0);
  const b = deserialise(serialise(a));
  runMinutes(a, 30);
  runMinutes(b, 30);
  expect(serialise(b)).toBe(serialise(a));
});

test("a world saved mid-disruption with a travelator steps identically after loading", () => {
  // The shop stays to let, counting footfall, past the end of the run after loading.
  const a = furnishedWorld(9, MON_0840 + 60);
  build(a, "travelator", { x: 12, y: 62, w: 1, h: 6 }, { dir: Dir.S });
  runMinutes(a, MON_0840 - 35 - START_MINUTE);
  startDisruption(a, [1], 45);
  runMinutes(a, 35); // Mon 08:40, platform 1 closed, a train dwelling at platform 2
  expect(a.disruptions.some((d) => !d.ended)).toBe(true);
  expect([...a.timetable.services.values()].some((s) => trainPhase(s, a.minute) === "dwelling")).toBe(true);
  expect([...a.facilities.values()].some((f) => f.footfallSeen.size > 0)).toBe(true);
  const b = deserialise(serialise(a));
  runMinutes(a, 30);
  runMinutes(b, 30);
  expect(serialise(b)).toBe(serialise(a));
});

test("a world saved just after people were moved between steps steps identically after loading", () => {
  const a = furnishedWorld(9);
  runMinutes(a, MON_0815 - START_MINUTE);
  // As a build or a platform opening does: everyone walking joins the first walker's tile.
  const p = a.people;
  let first = -1;
  p.forEachAlive((i) => {
    if (p.state[i] !== PState.Walking) return;
    if (first < 0) first = i;
    p.x[i] = p.x[first]!;
    p.y[i] = p.y[first]!;
  });
  expect(first).toBeGreaterThanOrEqual(0);
  const b = deserialise(serialise(a));
  runMinutes(a, 30);
  runMinutes(b, 30);
  expect(serialise(b)).toBe(serialise(a));
});

test("saving a loaded world gives back the same save", () => {
  const a = furnishedWorld(3);
  runMinutes(a, 90);
  const json = serialise(a);
  expect(serialise(deserialise(json))).toBe(json);
});

test("refuses an unknown version", () => {
  const save = JSON.parse(serialise(createWorld(1))) as Record<string, unknown>;
  expect(save.version).toBe(SAVE_VERSION);
  expect(() => deserialise(JSON.stringify({ ...save, version: 99 }))).toThrow("Unsupported save version");
});

test("the world asks for an autosave once per game hour crossed", () => {
  const w = createWorld(1);
  const autosaves = (): number => w.events.splice(0).filter((e) => e.kind === "autosave").length;
  runMinutes(w, 59 - (w.minute % 60));
  expect(autosaves()).toBe(0);
  runMinutes(w, 2);
  expect(autosaves()).toBe(1);
  runMinutes(w, 30);
  expect(autosaves()).toBe(0);
  // One big step across several hours still asks once, not once per hour.
  step(w, 200);
  expect(autosaves()).toBe(1);
});

test("every world field is saved or rebuilt on load", () => {
  // A new World field fails this until serialise and deserialise carry it (or it is rebuilt).
  const saved = [
    "seed", "rng", "grid", "people", "minute", "timetable", "trainsUpTo", "platformsAdded", "platformActive",
    "meter", "growth", "growthUpTo", "stagesUnlocked", "stats", "ledger", "day", "facilities", "disruptions",
    "signs", "searchClock", "nextId", "autosaveHour",
  ];
  const rebuilt = ["map", "fields", "crowd", "events"];
  expect(Object.keys(createWorld(1)).sort()).toEqual([...saved, ...rebuilt].sort());
});

test("each class the save takes apart has only the fields it handles", () => {
  // A new field on one of these fails here until serialise and deserialise carry it.
  expect(Object.keys(new Ledger(0)).sort()).toEqual(["balance", "today"]);
  expect(Object.keys(new Timetable()).sort()).toEqual(["lastDepart", "nextId", "services"]);
  expect(Object.keys(new ServiceMeter()).sort()).toEqual(["minutes", "onTime", "total"]);
  expect(Object.keys(new Grid(1, 1)).sort()).toEqual(["dir", "h", "tiles", "version", "w", "zoneOwner", "zones"]);
});

test("a world saved and loaded every half hour across a day keeps stepping like the original", () => {
  const a = furnishedWorld(9);
  build(a, "travelator", { x: 12, y: 62, w: 1, h: 6 }, { dir: Dir.S });
  let queued = 0;
  let served = 0;
  for (let k = 0; k < 34; k++) {
    if (k === 14) startDisruption(a, [1], 45);
    for (const f of a.facilities.values()) {
      if (f.queue.length > 0) queued++;
      if (f.serving.length > 0) served++;
    }
    const b = deserialise(serialise(a));
    runMinutes(a, 5);
    runMinutes(b, 5);
    expect(serialise(b), `loaded at ${Math.round(a.minute - 5)}`).toBe(serialise(a));
    runMinutes(a, 25);
  }
  expect(queued).toBeGreaterThan(0);
  expect(served).toBeGreaterThan(0);
});

const CORRUPTIONS: [string, (s: Record<string, any>) => void, string][] = [
  ["no minute", (s) => delete s.minute, "minute"],
  ["a minute that is not a number", (s) => (s.minute = "08:15"), "minute"],
  ["no signs", (s) => delete s.signs, "signs"],
  ["no stats", (s) => delete s.stats, "stats"],
  ["a short meter", (s) => (s.meter.minutes = []), "meter.minutes"],
  ["no lastDepart", (s) => delete s.timetable.lastDepart, "timetable.lastDepart"],
  ["no platforms", (s) => (s.platformActive = []), "platformActive"],
  ["no facilities", (s) => delete s.facilities, "facilities"],
  ["no ledger.today", (s) => delete s.ledger.today, "ledger.today"],
  ["a missing ledger line", (s) => delete s.ledger.today.refunds, "ledger.today.refunds"],
  ["grid tiles that are not base64", (s) => (s.grid.tiles = "!!!"), "grid.tiles"],
  ["short grid tiles", (s) => (s.grid.tiles = btoa("ab")), "grid.tiles"],
  ["more people than slots", (s) => (s.people.count = 99999), "people.count"],
  ["a missing people array", (s) => delete s.people.arrays.deadline, "people.deadline"],
  ["a service with no departure", (s) => delete s.timetable.services[0].departAt, "timetable.services[0].departAt"],
  ["a facility with no queue", (s) => delete s.facilities[0].queue, "facilities[0].queue"],
  ["a sign of no kind", (s) => (s.signs[0].kind = "bins"), "signs[0].kind"],
  ["a disruption with no end", (s) => delete s.disruptions[0].endsAt, "disruptions[0].endsAt"],
];

test.each(CORRUPTIONS)("refuses a save with %s at load", (_name, corrupt, field) => {
  const w = furnishedWorld(1);
  startDisruption(w, [1], 30);
  const save = JSON.parse(serialise(w));
  corrupt(save);
  expect(() => deserialise(JSON.stringify(save))).toThrow(`Corrupt save: ${field}`);
});

test("refuses a cut-off save at load", () => {
  expect(() => deserialise(serialise(createWorld(1)).slice(0, 500))).toThrow();
});
