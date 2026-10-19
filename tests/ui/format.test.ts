import { expect, test } from "vitest";
import type { PlacementPreview } from "../../src/sim/build";
import type { DaySummary } from "../../src/sim/economy";
import {
  daySummaryText,
  formatCount,
  formatMoney,
  formatSignedMoney,
  holidayLine,
  isNegativeMoney,
  placementTooltip,
  toastForEvent,
} from "../../src/ui/format";

const DAY = 1440;
const WEEK = 7 * DAY;

test("money has thousands separators and no pence, rounded at display", () => {
  expect(formatMoney(12450)).toBe("£12,450");
  expect(formatMoney(1234567.6)).toBe("£1,234,568");
  expect(formatMoney(0)).toBe("£0");
  expect(formatMoney(999.4)).toBe("£999");
});

test("negative money uses the minus sign, not a hyphen", () => {
  expect(formatMoney(-340)).toBe("−£340");
  expect(formatMoney(-12450.2)).toBe("−£12,450");
  expect(formatMoney(-0.4)).toBe("£0");
  expect(isNegativeMoney(-340)).toBe(true);
  expect(isNegativeMoney(-0.4)).toBe(false);
  expect(isNegativeMoney(5)).toBe(false);
});

test("signed money shows a plus for income", () => {
  expect(formatSignedMoney(3410)).toBe("+£3,410");
  expect(formatSignedMoney(-340)).toBe("−£340");
  expect(formatSignedMoney(0.2)).toBe("£0");
});

test("counts have thousands separators", () => {
  expect(formatCount(4920)).toBe("4,920");
  expect(formatCount(12)).toBe("12");
});

test("holiday line counts weeks, then next week, then days, then now", () => {
  // Summer starts at week 4.
  expect(holidayLine(4 * WEEK - 14 * DAY)).toBe("Summer holidays in 2 weeks");
  expect(holidayLine(4 * WEEK - 20 * DAY)).toBe("Summer holidays in 2 weeks");
  expect(holidayLine(4 * WEEK - 21 * DAY)).toBe("Summer holidays in 3 weeks");
  expect(holidayLine(4 * WEEK - 7 * DAY)).toBe("Summer holidays next week");
  expect(holidayLine(4 * WEEK - 3 * DAY)).toBe("Summer holidays in 3 days");
  expect(holidayLine(4 * WEEK - 600)).toBe("Summer holidays tomorrow");
  expect(holidayLine(4 * WEEK)).toBe("Summer holidays now");
  expect(holidayLine(5 * WEEK + 100)).toBe("Summer holidays now");
  // Christmas starts at day 3 of week 9.
  expect(holidayLine(9 * WEEK + 3 * DAY - 8 * DAY)).toBe("Christmas next week");
  expect(holidayLine(9 * WEEK + 4 * DAY)).toBe("Christmas now");
});

function summary(over: Partial<DaySummary>): DaySummary {
  return { day: 0, moved: 4920, onTime: 4800, missed: 200, income: 5000, costs: 1590, balance: 20000, ...over };
}

test("end-of-day toast names the day that ended", () => {
  expect(daySummaryText(summary({}))).toBe("Monday: 4,920 moved, 96% on time, +£3,410");
  expect(daySummaryText(summary({ day: 6, income: 100, costs: 440 }))).toBe("Sunday: 4,920 moved, 96% on time, −£340");
  expect(daySummaryText(summary({ day: 8 }))).toBe("Tuesday: 4,920 moved, 96% on time, +£3,410");
});

test("a day with no timed journeys leaves out the on-time share", () => {
  expect(daySummaryText(summary({ moved: 0, onTime: 0, missed: 0, income: 0, costs: 120 }))).toBe("Monday: 0 moved, −£120");
});

function pv(over: Partial<PlacementPreview>): PlacementPreview {
  return { tool: "floor", rect: { x: 0, y: 0, w: 8, h: 11 }, tiles: [], blocked: [], cost: 0, valid: true, reason: null, ...over };
}

const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

test("floor tooltip reads tiles, cost and balance", () => {
  const t = placementTooltip(pv({ tiles: range(88), cost: 8800 }), 12450);
  expect(t).toEqual({ text: "New floor · 88 tiles · £8,800 · you have £12,450", reason: null });
});

test("other tools use their names", () => {
  expect(placementTooltip(pv({ tool: "retail", rect: { x: 0, y: 0, w: 3, h: 2 }, tiles: range(6), cost: 1500 }), 20000).text).toBe(
    "Shop · 6 tiles · £1,500 · you have £20,000",
  );
  expect(placementTooltip(pv({ tool: "sign", rect: { x: 0, y: 0, w: 1, h: 1 }, tiles: [3], cost: 150 }), -50).text).toBe(
    "Sign · 1 tile · £150 · you have −£50",
  );
  const names = { seating: "Seating", toilet: "Toilets", wall: "Wall", rail: "Queue rail", travelator: "Travelator" } as const;
  for (const [tool, name] of Object.entries(names)) {
    const t = placementTooltip(pv({ tool: tool as PlacementPreview["tool"], rect: { x: 0, y: 0, w: 1, h: 2 }, tiles: [1, 2], cost: 40 }), 100);
    expect(t.text).toBe(`${name} · 2 tiles · £40 · you have £100`);
  }
});

test("a facility counts its whole rect even where blocked", () => {
  const t = placementTooltip(pv({ tool: "toilet", rect: { x: 0, y: 0, w: 2, h: 3 }, tiles: [1, 2], blocked: [3, 4, 5, 6], cost: 2400, valid: false, reason: "Must be on plain floor" }), 9000);
  expect(t).toEqual({ text: "Toilets · 6 tiles · £2,400 · you have £9,000", reason: "Must be on plain floor" });
});

test("remove shows the refund", () => {
  expect(placementTooltip(pv({ tool: "remove", tiles: range(6), cost: -300 }), 100)).toEqual({ text: "Remove · 6 tiles · +£300", reason: null });
});

test("an invalid preview carries its reason", () => {
  const t = placementTooltip(pv({ tiles: range(4), cost: 400, valid: false, reason: "Must join existing floor" }), 12450);
  expect(t.reason).toBe("Must join existing floor");
});

test("events become toasts; outcomes and autosaves do not", () => {
  expect(toastForEvent({ kind: "toast", text: "Platform 5 opens" })).toEqual({ text: "Platform 5 opens", style: "note" });
  expect(toastForEvent({ kind: "dayEnd", summary: summary({}) })).toEqual({ text: "Monday: 4,920 moved, 96% on time, +£3,410", style: "day" });
  expect(toastForEvent({ kind: "outcome", personId: 1, onTime: true, excluded: false })).toBeNull();
  expect(toastForEvent({ kind: "autosave" })).toBeNull();
});

test("a toast that repeats the disruption banner is skipped", () => {
  const text = "Signal failure at Ashby: Platform 2 closed until 11:20";
  expect(toastForEvent({ kind: "toast", text }, text)).toBeNull();
  expect(toastForEvent({ kind: "toast", text: "Platform 2 reopens" }, text)).toEqual({ text: "Platform 2 reopens", style: "note" });
  expect(toastForEvent({ kind: "toast", text }, null)).toEqual({ text, style: "note" });
});
