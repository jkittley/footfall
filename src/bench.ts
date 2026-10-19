import { BenchScenario, BENCH_H, BENCH_W } from "./benchScenario";
import { Camera } from "./render/camera";
import { drawPeople } from "./render/drawPeople";
import { MAX_STEPS_PER_FRAME, SIM_DT, TILE_PX } from "./sim/constants";
import { FLOOR, GROUND, TRACK, WALL } from "./render/palette";

const SPEED = 3;
const REPORT_MS = 1000;

interface BenchResult {
  fpsMean: number;
  /** Frame rate of the 95th-percentile slowest frame, i.e. the worst 5% of frames run at or below this. */
  fpsP5: number;
  simMs: number;
  drawMs: number;
  zoom: number;
  frames: number;
}
interface BenchNumbers {
  fps: number;
  simMs: number;
  drawMs: number;
  people: number;
}
declare global {
  interface Window {
    __bench?: BenchNumbers;
    __benchResult?: BenchResult;
  }
}

const canvas = document.getElementById("game") as HTMLCanvasElement;
const ctx = canvas.getContext("2d");
const overlay = document.getElementById("overlay");
if (!ctx || !overlay) throw new Error("bench page is missing its canvas or overlay");

const sc = new BenchScenario(1);
const cam = new Camera();
const params = new URLSearchParams(location.search);
const zoomParam = Number(params.get("zoom"));
const auto = params.get("auto") === "1";
const WARMUP_MS = 5000;
const RECORD_MS = 15000;
const rec = { frame: [] as number[], sim: [] as number[], draw: [] as number[] };
const startedAt = performance.now();
let finished = false;
const layer = document.createElement("canvas");
let dpr = 1;

function resize(): void {
  dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  cam.zoom = zoomParam > 0 ? zoomParam : Math.min(window.innerWidth / (BENCH_W * TILE_PX), window.innerHeight / (BENCH_H * TILE_PX));
  layer.width = canvas.width;
  layer.height = canvas.height;
  const lc = layer.getContext("2d");
  if (!lc) throw new Error("2d context unavailable");
  lc.setTransform(dpr, 0, 0, dpr, 0, 0);
  lc.fillStyle = GROUND;
  lc.fillRect(0, 0, window.innerWidth, window.innerHeight);
  drawWorld(lc);
}
function drawWorld(c: CanvasRenderingContext2D): void {
  const [x0, y0] = cam.worldToScreen(0, 0);
  const s = TILE_PX * cam.zoom;
  c.fillStyle = FLOOR;
  c.fillRect(x0, y0, BENCH_W * s, BENCH_H * s);
  c.fillStyle = WALL;
  for (const r of sc.obstacles) c.fillRect(x0 + r.x * s, y0 + r.y * s, r.w * s, r.h * s);
  c.fillStyle = TRACK;
  for (const r of sc.targetAreas) c.fillRect(x0 + r.x * s, y0 + r.y * s, r.w * s, r.h * s);
}

resize();
window.addEventListener("resize", resize);

function finish(): void {
  finished = true;
  const n = rec.frame.length;
  const mean = (a: number[]): number => a.reduce((p, c) => p + c, 0) / a.length;
  const sorted = [...rec.frame].sort((a, b) => a - b);
  const p95 = sorted[Math.min(n - 1, Math.floor(n * 0.95))]!;
  window.__benchResult = {
    fpsMean: 1000 / mean(rec.frame),
    fpsP5: 1000 / p95,
    simMs: mean(rec.sim),
    drawMs: mean(rec.draw),
    zoom: cam.zoom,
    frames: n,
  };
  overlay!.textContent += "\nauto run done: window.__benchResult";
}

let last = performance.now();
let acc = 0;
let sumFrame = 0;
let sumSim = 0;
let sumDraw = 0;
let frames = 0;
let lastReport = last;

function frame(now: number): void {
  const rawMs = now - last;
  const dt = Math.min(rawMs, 100) / 1000;
  last = now;
  acc += dt * SPEED;

  const t0 = performance.now();
  let steps = 0;
  while (acc >= SIM_DT && steps < MAX_STEPS_PER_FRAME) {
    sc.step();
    acc -= SIM_DT;
    steps++;
  }
  if (steps === MAX_STEPS_PER_FRAME) acc = 0;
  const t1 = performance.now();

  ctx!.setTransform(1, 0, 0, 1, 0, 0);
  ctx!.drawImage(layer, 0, 0);
  drawPeople(ctx!, cam, sc.people, dpr);
  const t2 = performance.now();

  sumSim += t1 - t0;
  sumDraw += t2 - t1;
  sumFrame += rawMs;
  frames++;
  if (now - lastReport >= REPORT_MS && frames > 0) {
    const nums: BenchNumbers = {
      fps: (frames * 1000) / sumFrame,
      simMs: sumSim / frames,
      drawMs: sumDraw / frames,
      people: sc.people.count,
    };
    window.__bench = nums;
    overlay!.textContent = `fps  ${nums.fps.toFixed(1)}\nsim  ${nums.simMs.toFixed(2)} ms\ndraw ${nums.drawMs.toFixed(2)} ms\npeople ${nums.people}`;
    sumFrame = sumSim = sumDraw = 0;
    frames = 0;
    lastReport = now;
  }
  if (auto && !finished) {
    const since = now - startedAt;
    if (since >= WARMUP_MS && since < WARMUP_MS + RECORD_MS) {
      rec.frame.push(rawMs);
      rec.sim.push(t1 - t0);
      rec.draw.push(t2 - t1);
    } else if (since >= WARMUP_MS + RECORD_MS && rec.frame.length > 0) {
      finish();
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
