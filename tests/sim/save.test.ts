import { expect, test } from "vitest";
import { applyPlacement, previewPlacement, type BuildOpts, type ToolId } from "../../src/sim/build";
import { START_MINUTE } from "../../src/sim/clock";
import { startDisruption } from "../../src/sim/disruptions";
import { FacilityKind, Tenant } from "../../src/sim/facilities";
import { Dir, type Rect } from "../../src/sim/grid";
import { PState } from "../../src/sim/people";
import { SAVE_VERSION, deserialise, serialise } from "../../src/sim/save";
import { trainPhase } from "../../src/sim/timetable";
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
