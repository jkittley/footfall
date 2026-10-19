import { expect, test } from "vitest";
import { dragRect } from "../../src/ui/drag";

test("a rect tool spans both corners, whichever way it was dragged", () => {
  expect(dragRect("floor", [10, 8], [4, 12])).toEqual({ x: 4, y: 8, w: 7, h: 5 });
  expect(dragRect("retail", [3, 3], [3, 3])).toEqual({ x: 3, y: 3, w: 1, h: 1 });
});

test("line tools snap to the drag's longer axis", () => {
  expect(dragRect("wall", [5, 5], [12, 7])).toEqual({ x: 5, y: 5, w: 8, h: 1 });
  expect(dragRect("rail", [5, 5], [6, 1])).toEqual({ x: 5, y: 1, w: 1, h: 5 });
  expect(dragRect("travelator", [5, 5], [1, 5])).toEqual({ x: 1, y: 5, w: 5, h: 1 });
});

test("a sign is the one tile under the cursor", () => {
  expect(dragRect("sign", [5, 5], [9, 2])).toEqual({ x: 9, y: 2, w: 1, h: 1 });
});
