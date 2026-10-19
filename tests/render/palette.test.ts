import { expect, test } from "vitest";
import { ALERT, FLOOR, GROUND, HAZE, INK, INK_2, PARK, ROAD, SHORE, WALL, WATER, WATER_INK, contrastRatio } from "../../src/render/palette";

test("contrast ratio follows WCAG relative luminance", () => {
  expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 6);
  expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 6);
  expect(contrastRatio(INK, FLOOR)).toBeCloseTo(contrastRatio(FLOOR, INK), 9);
});

// Every text-on-fill pair the HUD stylesheet uses must reach 4.5:1.
test.each([
  ["filled buttons (Start again, card buttons): Floor on Ink", FLOOR, INK],
  ["selected tool, pressed speed and chips: Floor on Ink", FLOOR, INK],
  ["Floor on Wall", FLOOR, WALL],
  ["dark tooltip and toasts: Ground on Ink", GROUND, INK],
  ["disruption banner: Floor on Alert", FLOOR, ALERT],
  ["panel text: Ink on Floor", INK, FLOOR],
  ["secondary text: Ink 2 on Floor", INK_2, FLOOR],
  ["negative money: Alert on Floor", ALERT, FLOOR],
])("%s reaches 4.5:1", (_name, fg, bg) => {
  expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
});

// Every name the city map writes, on the fill it is written on.
test.each([
  ["a locked site's name: Ink on Haze", INK, HAZE],
  ["a locked site's opening line: Ink 2 on Haze", INK_2, HAZE],
  ["park names: Ink 2 on Park", INK_2, PARK],
  ["river names: Water ink on Water", WATER_INK, WATER],
  ["road names: Ink 2 on Road", INK_2, ROAD],
  ["the subway's name: Ink on Shore", INK, SHORE],
  ["the subway's opening line: Ink 2 on Shore", INK_2, SHORE],
])("%s reaches 4.5:1", (_name, fg, bg) => {
  expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
});
