import { expect, test } from "vitest";
import {
  START_MINUTE, currentHoliday, dayOfWeek, demand, formatClock, leisureShare, minuteOfDay, month, nextHoliday, periodLabel,
} from "../../src/sim/clock";

const WEEK = 7 * 1440;

test("formats the first morning", () => expect(formatClock(START_MINUTE)).toBe("Mon 05:00 · March"));
test("week 4 is July", () => expect(month(4 * WEEK)).toBe(6));
test("weekday shape", () => {
  const mon = (h: number) => demand(h * 60);
  expect(mon(8.25)).toBeGreaterThan(mon(12));
  expect(mon(12)).toBeGreaterThan(mon(3));
});
test("Friday evening is the busiest moment of a March week", () => {
  let best = 0, at = 0;
  for (let m = 0; m < WEEK; m += 5) if (demand(m) > best) { best = demand(m); at = m; }
  expect(dayOfWeek(at)).toBe(4);
  expect(minuteOfDay(at)).toBeGreaterThan(16 * 60);
});
test("Saturday morning is quieter than Monday morning", () =>
  expect(demand(5 * 1440 + 8 * 60)).toBeLessThan(demand(8 * 60)));
test("summer midday beats March midday", () =>
  expect(demand(4 * WEEK + 12 * 60)).toBeGreaterThan(demand(12 * 60)));
test("leisure share is higher at weekends", () =>
  expect(leisureShare(5 * 1440 + 12 * 60)).toBeGreaterThan(leisureShare(12 * 60)));

test("period labels and holiday suffixes", () => {
  expect(periodLabel(8 * 60)).toBe("Morning peak");
  expect(periodLabel(3 * 60)).toBe("Night");
  expect(periodLabel(6 * 60)).toBe("Early morning");
  expect(periodLabel(12 * 60)).toBe("Midday");
  expect(periodLabel(17 * 60)).toBe("Evening peak");
  expect(periodLabel(21 * 60)).toBe("Evening");
  expect(periodLabel(5 * 1440 + 12 * 60)).toBe("Weekend");
  expect(periodLabel(4 * WEEK + 12 * 60)).toBe("Midday · Summer holidays");
  expect(periodLabel(9 * WEEK + 3 * 1440 + 8 * 60)).toBe("Morning peak · Christmas");
  expect(periodLabel(9 * WEEK + 2 * 1440 + 8 * 60)).toBe("Morning peak");
});

test("demand is continuous within a week and never below the floor", () => {
  for (let m = 0; m < WEEK - 1; m++) {
    expect(Math.abs(demand(m + 1) - demand(m))).toBeLessThan(0.1);
    expect(demand(m)).toBeGreaterThanOrEqual(0.05);
  }
});

test("nextHoliday finds the next start", () => {
  expect(nextHoliday(0)).toEqual({ name: "Summer holidays", startsAt: 4 * WEEK });
  expect(nextHoliday(4 * WEEK)).toEqual({ name: "Summer holidays", startsAt: 4 * WEEK });
  expect(nextHoliday(4 * WEEK + 1)).toEqual({ name: "Christmas", startsAt: 9 * WEEK + 3 * 1440 });
  expect(nextHoliday(9 * WEEK + 3 * 1440 + 1)).toEqual({ name: "Summer holidays", startsAt: 16 * WEEK });
});

test("currentHoliday names the holiday running now", () => {
  expect(currentHoliday(0)).toBeNull();
  expect(currentHoliday(4 * WEEK)).toBe("Summer holidays");
  expect(currentHoliday(6 * WEEK - 1)).toBe("Summer holidays");
  expect(currentHoliday(6 * WEEK)).toBeNull();
  expect(currentHoliday(9 * WEEK + 3 * 1440)).toBe("Christmas");
  expect(currentHoliday(9 * WEEK + 2 * 1440)).toBeNull();
});
