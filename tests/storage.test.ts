import { afterEach, expect, test, vi } from "vitest";
import { clearSave, loadSave, stashCorruptSave, writeSave } from "../src/ui/storage";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("writes, reads back and clears the save under its key", () => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  expect(loadSave()).toBeNull();
  expect(writeSave("{}")).toBe(true);
  expect(store.get("footfall.save.v1")).toBe("{}");
  expect(loadSave()).toBe("{}");
  clearSave();
  expect(loadSave()).toBeNull();
});

test("a browser that refuses storage loses the save, not the game", () => {
  const refuse = (): never => {
    throw new DOMException("denied", "SecurityError");
  };
  vi.stubGlobal("localStorage", { getItem: refuse, setItem: refuse, removeItem: refuse });
  expect(loadSave()).toBeNull();
  expect(writeSave("{}")).toBe(false);
  expect(() => clearSave()).not.toThrow();
});

test("a corrupt save is moved aside under its own key", () => {
  const store = new Map<string, string>([["footfall.save.v1", "{bad"]]);
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  stashCorruptSave("{bad");
  expect(store.get("footfall.save.corrupt")).toBe("{bad");
  expect(store.has("footfall.save.v1")).toBe(false);
});
