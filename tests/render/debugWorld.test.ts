import { describe, expect, it } from "vitest";
import { buildDebugWorld } from "../../src/render/debugWorld";
import { FacilityKind, Tenant } from "../../src/sim/facilities";
import { Zone } from "../../src/sim/grid";

describe("buildDebugWorld", () => {
  it("builds every piece the debug page shows", () => {
    const w = buildDebugWorld();
    expect(w.platformsAdded).toBe(5);
    expect(w.platformActive[4]).toBe(false);
    expect(w.disruptions.some((d) => !d.ended && d.platforms.includes(2))).toBe(true);
    const fs = [...w.facilities.values()];
    expect(fs.some((f) => f.kind === FacilityKind.Retail && f.tenant !== Tenant.None && f.queue.length > 0)).toBe(true);
    expect(fs.some((f) => f.kind === FacilityKind.Retail && f.tenant === Tenant.None && f.tenantAt > w.minute)).toBe(true);
    expect(fs.some((f) => f.kind === FacilityKind.Toilet)).toBe(true);
    expect(fs.some((f) => f.kind === FacilityKind.Seating)).toBe(true);
    expect(w.signs).toHaveLength(2);
    expect(w.grid.zones.includes(Zone.Travelator)).toBe(true);
  });
});
