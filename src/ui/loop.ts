import { MAX_STEPS_PER_FRAME, SIM_DT } from "../sim/constants";

/** Speeds the player can pick: paused, normal and fast. */
export type Speed = 0 | 1 | 3;

/**
 * How many SIM_DT steps this frame runs and the sim time carried to the next: real seconds times
 * speed are banked, at most MAX_STEPS_PER_FRAME steps are taken, and anything owed beyond that is
 * dropped so a slow frame or a backgrounded tab never snowballs.
 */
export function planFrame(acc: number, realDt: number, speed: Speed): { steps: number; acc: number } {
  let bank = acc + realDt * speed;
  let steps = 0;
  while (bank >= SIM_DT && steps < MAX_STEPS_PER_FRAME) {
    bank -= SIM_DT;
    steps++;
  }
  if (bank >= SIM_DT) bank = 0;
  return { steps, acc: bank };
}
