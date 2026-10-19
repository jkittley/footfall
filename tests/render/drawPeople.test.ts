import { describe, expect, it, vi } from "vitest";
import { isDrawn } from "../../src/render/drawPeople2d";
import { tryCreate } from "../../src/render/rendererChoice";
import { PState, PeopleStore } from "../../src/sim/people";
import { inset, POLYS, RING_PX } from "../../src/render/shapes";

describe("tryCreate", () => {
  it("returns the renderer when creation works", () => {
    const warn = vi.fn();
    expect(tryCreate(() => 42, warn)).toBe(42);
    expect(warn).not.toHaveBeenCalled();
  });

  it("returns null and warns once when creation throws", () => {
    const warn = vi.fn();
    expect(
      tryCreate(() => {
        throw new Error("no webgl");
      }, warn),
    ).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("inset", () => {
  it("keeps every edge exactly RING_PX from its outer edge", () => {
    for (const poly of Object.values(POLYS)) {
      const inner = inset(poly, RING_PX);
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i]!;
        const q = poly[(i + 1) % poly.length]!;
        const a = inner[i]!;
        const b = inner[(i + 1) % poly.length]!;
        const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
        const dist = (pt: readonly [number, number]): number =>
          Math.abs((q[0] - p[0]) * (p[1] - pt[1]) - (p[0] - pt[0]) * (q[1] - p[1])) / len;
        expect(dist(a)).toBeCloseTo(RING_PX, 6);
        expect(dist(b)).toBeCloseTo(RING_PX, 6);
      }
    }
  });
});

describe("isDrawn", () => {
  it("leaves out people being served inside a facility, so they don't cover the next in its queue", () => {
    const p = new PeopleStore(4);
    const shown = [PState.Walking, PState.InQueue, PState.Seated, PState.InFacility].map((st) => {
      const i = p.alloc();
      p.state[i] = st;
      return isDrawn(p, i);
    });
    expect(shown).toEqual([true, true, true, false]);
    p.free(0);
    expect(isDrawn(p, 0)).toBe(false);
  });
});
