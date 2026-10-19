import { expect, test } from "vitest";
import { Rng } from "../../src/sim/rng";

test("same seed gives same sequence", () => {
  const a = new Rng(42), b = new Rng(42);
  expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
});
test("state round-trips", () => {
  const a = new Rng(7); a.next(); const b = Rng.fromState(a.state());
  expect(b.next()).toBe(a.next());
});
test("poisson mean is about right", () => {
  const r = new Rng(1); let s = 0; for (let i = 0; i < 20000; i++) s += r.poisson(3);
  expect(s / 20000).toBeCloseTo(3, 1);
});
