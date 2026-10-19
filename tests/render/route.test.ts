import { describe, expect, it } from "vitest";
import { trainOffset } from "../../src/render/drawTrains";
import { routeOf } from "../../src/render/route";
import { SIM_DT } from "../../src/sim/constants";
import { PState } from "../../src/sim/people";
import { APPROACH_MIN, LEAVE_MIN, type Service } from "../../src/sim/timetable";
import { fieldFor } from "../../src/sim/walk";
import { createWorld, step } from "../../src/sim/world";

describe("routeOf", () => {
  it("follows the walking route step by step to a field target, then on to the goal", () => {
    const w = createWorld(5);
    let pid = -1;
    for (let k = 0; k < 6000 && pid < 0; k++) {
      step(w, SIM_DT);
      const p = w.people;
      for (let i = 0; i < p.end; i++) {
        if (p.isAlive(i) && p.state[i] === PState.Walking && !p.targetKey[i]!.startsWith("spot:") && p.targetKey[i] !== "") {
          pid = i;
          break;
        }
      }
    }
    expect(pid).toBeGreaterThanOrEqual(0);
    const r = routeOf(w, pid);
    expect(r.toTarget.length).toBeGreaterThan(1);
    for (let k = 2; k < r.toTarget.length; k++) {
      const [ax, ay] = r.toTarget[k - 1]!;
      const [bx, by] = r.toTarget[k]!;
      expect(Math.max(Math.abs(ax - bx), Math.abs(ay - by))).toBe(1);
    }
    const [ex, ey] = r.toTarget[r.toTarget.length - 1]!;
    const field = fieldFor(w, w.people.targetKey[pid]!);
    expect(field[Math.floor(ey) * w.grid.w + Math.floor(ex)]).toBe(0);
    if (w.people.goalKey[pid] === w.people.targetKey[pid]) expect(r.toGoal).toEqual([]);
  });

  it("goes straight to a spot target, then follows the goal's field", () => {
    const w = createWorld(5);
    const p = w.people;
    const i = p.alloc();
    p.x[i] = 10.5;
    p.y[i] = 57.5;
    p.state[i] = PState.Walking;
    const spot = 58 * w.grid.w + 14;
    p.targetKey[i] = `spot:${spot}`;
    p.goalKey[i] = "platform:1";
    const r = routeOf(w, i);
    expect(r.toTarget).toEqual([[10.5, 57.5], [14.5, 58.5]]);
    expect(r.toGoal[0]).toEqual([14.5, 58.5]);
    const [ex, ey] = r.toGoal[r.toGoal.length - 1]!;
    expect(fieldFor(w, "platform:1")[Math.floor(ey) * w.grid.w + Math.floor(ex)]).toBe(0);
  });
});

describe("trainOffset", () => {
  const s: Service = { id: 1, platformId: 1, destination: "Ashby", arriveAt: 100, departAt: 112, alighting: 0, cancelled: false, cancelReason: null };
  it("runs in from `travel` tiles out, stands at 0, and runs back out", () => {
    expect(trainOffset(s, 100 - APPROACH_MIN - 0.01, 30)).toBeNull();
    expect(trainOffset(s, 100 - APPROACH_MIN, 30)).toBeCloseTo(30, 9);
    const mid = trainOffset(s, 100 - APPROACH_MIN / 2, 30)!;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(30);
    expect(trainOffset(s, 105, 30)).toBe(0);
    expect(trainOffset(s, 112, 30)).toBeCloseTo(0, 9);
    expect(trainOffset(s, 112 + LEAVE_MIN / 2, 30)!).toBeGreaterThan(0);
    expect(trainOffset(s, 112 + LEAVE_MIN, 30)).toBeNull();
    expect(trainOffset({ ...s, cancelled: true }, 105, 30)).toBeNull();
  });
});
