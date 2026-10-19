import { describe, expect, it } from "vitest";
import { StaticLayerCache, staticLayerKey } from "../../src/render/staticCache";
import { Grid } from "../../src/sim/grid";

describe("staticLayerKey", () => {
  const base = { version: 7, x: 1.5, y: -2, zoom: 1, width: 800, height: 600, dpr: 2, fonts: 0 };
  it("is stable for the same inputs and changes when any of them does", () => {
    expect(staticLayerKey(base)).toBe(staticLayerKey({ ...base }));
    for (const k of Object.keys(base) as (keyof typeof base)[]) {
      expect(staticLayerKey({ ...base, [k]: base[k] + 1 })).not.toBe(staticLayerKey(base));
    }
  });
});

describe("StaticLayerCache", () => {
  it("redraws for a new key, not for the same one", () => {
    const c = new StaticLayerCache();
    const g = new Grid(4, 4);
    expect(c.update(g, "a")).toEqual({ redraw: true, newGrid: true });
    expect(c.update(g, "a")).toEqual({ redraw: false, newGrid: false });
    expect(c.update(g, "b")).toEqual({ redraw: true, newGrid: false });
  });

  it("redraws, and reports a new grid, when the world is swapped at an equal version and key", () => {
    const c = new StaticLayerCache();
    const a = new Grid(4, 4);
    const b = new Grid(4, 4);
    a.version = b.version = 9;
    c.update(a, "k");
    expect(c.update(b, "k")).toEqual({ redraw: true, newGrid: true });
    expect(c.update(b, "k")).toEqual({ redraw: false, newGrid: false });
  });

  it("redraws after invalidate", () => {
    const c = new StaticLayerCache();
    const g = new Grid(4, 4);
    c.update(g, "k");
    c.invalidate();
    expect(c.update(g, "k").redraw).toBe(true);
  });
});
