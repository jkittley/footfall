import { BenchScenario, BENCH_PEOPLE } from "../src/benchScenario";

const FRAMES = 600;
const STEPS_PER_FRAME = 3;
const WARMUP = 30;

const sc = new BenchScenario(1);
const times: number[] = [];
for (let f = 0; f < FRAMES + WARMUP; f++) {
  const t0 = performance.now();
  for (let s = 0; s < STEPS_PER_FRAME; s++) sc.step();
  const dt = performance.now() - t0;
  if (f >= WARMUP) times.push(dt);
}
const mean = times.reduce((a, b) => a + b, 0) / times.length;
const sorted = [...times].sort((a, b) => a - b);
const p95 = sorted[Math.floor(sorted.length * 0.95)]!;
console.log(`people=${BENCH_PEOPLE} frames=${FRAMES} steps/frame=${STEPS_PER_FRAME}`);
console.log(`sim ms/frame mean=${mean.toFixed(2)} p95=${p95.toFixed(2)} max=${sorted[sorted.length - 1]!.toFixed(2)}`);
