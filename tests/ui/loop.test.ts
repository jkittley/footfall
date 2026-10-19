import { expect, test } from "vitest";
import { MAX_STEPS_PER_FRAME, SIM_DT } from "../../src/sim/constants";
import { planFrame } from "../../src/ui/loop";

test("paused runs no steps and keeps no time", () => {
  expect(planFrame(0, 0.5, 0)).toEqual({ steps: 0, acc: 0 });
});

test("accumulates real time times speed", () => {
  const a = planFrame(0, SIM_DT * 0.6, 1);
  expect(a.steps).toBe(0);
  const b = planFrame(a.acc, SIM_DT * 0.6, 1);
  expect(b.steps).toBe(1);
  expect(b.acc).toBeCloseTo(SIM_DT * 0.2, 9);
  const c = planFrame(0, SIM_DT, 3);
  expect(c.steps).toBe(3);
});

test("time beyond the frame's step cap is dropped", () => {
  const r = planFrame(0, 5, 3);
  expect(r).toEqual({ steps: MAX_STEPS_PER_FRAME, acc: 0 });
});
