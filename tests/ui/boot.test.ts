import { expect, test } from "vitest";
import { createWorld } from "../../src/sim/world";
import { serialise } from "../../src/sim/save";
import { CORRUPT_SAVE_NOTICE, bootWorld } from "../../src/ui/boot";

function fakeStore(initial: Record<string, string>) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    load: () => store.get("footfall.save.v1") ?? null,
    stashCorrupt: (json: string) => {
      store.set("footfall.save.corrupt", json);
      store.delete("footfall.save.v1");
    },
  };
}

test("no save starts a new world quietly", () => {
  const s = fakeStore({});
  const { world, notice } = bootWorld({ load: s.load, stashCorrupt: s.stashCorrupt, newSeed: () => 11 });
  expect(world.seed).toBe(11);
  expect(notice).toBeNull();
  expect(s.store.size).toBe(0);
});

test("a good save is loaded", () => {
  const w = createWorld(5);
  w.minute += 123;
  w.ledger.balance = 777;
  const s = fakeStore({ "footfall.save.v1": serialise(w) });
  const { world, notice } = bootWorld({ load: s.load, stashCorrupt: s.stashCorrupt, newSeed: () => 11 });
  expect(notice).toBeNull();
  expect(world.seed).toBe(5);
  expect(world.minute).toBe(w.minute);
  expect(world.ledger.balance).toBe(777);
  expect(s.store.get("footfall.save.v1")).toBeDefined();
});

test("a corrupt save is moved aside, not deleted, and a new world starts with a notice", () => {
  const s = fakeStore({ "footfall.save.v1": "{not json" });
  const { world, notice } = bootWorld({ load: s.load, stashCorrupt: s.stashCorrupt, newSeed: () => 11 });
  expect(world.seed).toBe(11);
  expect(notice).toBe(CORRUPT_SAVE_NOTICE);
  expect(CORRUPT_SAVE_NOTICE).toBe("Your saved game couldn't be loaded, so a new one has started");
  expect(s.store.get("footfall.save.corrupt")).toBe("{not json");
  expect(s.store.has("footfall.save.v1")).toBe(false);
});

test("a save that parses but fails its checks is treated as corrupt", () => {
  const s = fakeStore({ "footfall.save.v1": JSON.stringify({ version: 1, map: "harbour-street" }) });
  const { notice } = bootWorld({ load: s.load, stashCorrupt: s.stashCorrupt, newSeed: () => 3 });
  expect(notice).toBe(CORRUPT_SAVE_NOTICE);
  expect(s.store.has("footfall.save.corrupt")).toBe(true);
});
