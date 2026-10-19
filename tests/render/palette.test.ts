import { expect, test } from "vitest";
import { ALERT, FLOOR, GROUND, INK, INK_2, WALL, contrastRatio } from "../../src/render/palette";

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
