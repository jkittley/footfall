import { describe, expect, it } from "vitest";
import { clockTime, countdown, platformLabel, platformLabelVariants, retailLabel, runsText } from "../../src/render/labels";
import { startDisruption } from "../../src/sim/disruptions";
import { FacilityKind, Tenant, createFacility } from "../../src/sim/facilities";
import { deactivatePlatform } from "../../src/sim/growth";
import { createWorld } from "../../src/sim/world";

describe("label formatting", () => {
  it("writes clock times as HH:MM within the day", () => {
    expect(clockTime(300)).toBe("05:00");
    expect(clockTime(1440 + 8 * 60 + 51.7)).toBe("08:51");
  });

  it("writes countdowns as H:MM, rounding up and never below zero", () => {
    expect(countdown(18)).toBe("0:18");
    expect(countdown(17.2)).toBe("0:18");
    expect(countdown(75)).toBe("1:15");
    expect(countdown(-3)).toBe("0:00");
  });

  it("names the next departure on a platform with its countdown", () => {
    const w = createWorld(3);
    const next = w.timetable.upcoming(1, w.minute)[0]!;
    expect(runsText(platformLabel(w, 1))).toBe(
      `Platform 1 · ${clockTime(next.departAt)} ${next.destination} · ${countdown(next.departAt - w.minute)}`,
    );
  });

  it("says Closed on an inactive platform and Closed until on a disrupted one", () => {
    const w = createWorld(3);
    deactivatePlatform(w, 2);
    expect(runsText(platformLabel(w, 2))).toBe("Platform 2 · Closed");
    const w2 = createWorld(3);
    const d = startDisruption(w2, [1], 120);
    expect(runsText(platformLabel(w2, 1))).toBe(`Platform 1 · Closed until ${clockTime(d.endsAt)}`);
  });

  it("offers shorter labels that drop the destination, then the time, keeping the countdown whole", () => {
    const w = createWorld(3);
    const next = w.timetable.upcoming(1, w.minute)[0]!;
    const cd = countdown(next.departAt - w.minute);
    expect(platformLabelVariants(w, 1).map(runsText)).toEqual([
      `Platform 1 · ${clockTime(next.departAt)} ${next.destination} · ${cd}`,
      `Platform 1 · ${clockTime(next.departAt)} · ${cd}`,
      `Platform 1 · ${cd}`,
      "Platform 1",
    ]);
    deactivatePlatform(w, 2);
    expect(platformLabelVariants(w, 2).map(runsText)).toEqual(["Platform 2 · Closed", "Platform 2"]);
  });

  it("puts numbers and times in mono runs", () => {
    const w = createWorld(3);
    const runs = platformLabel(w, 1);
    const mono = runs.filter((r) => r.mono).map((r) => r.text);
    expect(mono).toHaveLength(2);
    for (const t of mono) expect(t).toMatch(/^\d+:\d\d$/);
  });

  it("names a let unit's tenant, or counts down to one moving in", () => {
    const w = createWorld(3);
    const f = createFacility(w, FacilityKind.Retail, { x: 7, y: 57, w: 2, h: 2 });
    expect(runsText(retailLabel(f, w.minute))).toBe("To let · tenant in 0:40");
    expect(runsText(retailLabel(f, w.minute + 30))).toBe("To let · tenant in 0:10");
    f.tenant = Tenant.FoodDrink;
    f.tenantAt = -1;
    expect(runsText(retailLabel(f, w.minute))).toBe("Food and drink");
  });

  it("has no em-dashes in any label", () => {
    const w = createWorld(3);
    const f = createFacility(w, FacilityKind.Retail, { x: 7, y: 57, w: 2, h: 2 });
    for (const runs of [platformLabel(w, 1), platformLabel(w, 2), retailLabel(f, w.minute)])
      expect(runsText(runs)).not.toContain("—");
  });
});
