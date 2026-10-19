import { BenchScenario, BENCH_H, BENCH_W } from "./benchScenario";
import { Camera } from "./render/camera";
import { drawPeople } from "./render/drawPeople";
import { MAX_STEPS_PER_FRAME, SIM_DT, TILE_PX } from "./sim/constants";

const SPEED = 3;
const REPORT_MS = 1000;

interface BenchNumbers {
  fps: number;
  simMs: number;
  drawMs: number;
  people: number;
}
declare global {
  interface Window {
    __bench?: BenchNumbers;
  }
}

const canvas = document.getElementById("game") as HTMLCanvasElement;
const ctx = canvas.getContext("2d");
const overlay = document.getElementById("overlay");
if (!ctx || !overlay) throw new Error("bench page is missing its canvas or overlay");

const sc = new BenchScenario(1);
const cam = new Camera();
const zoomParam = Number(new URLSearchParams(location.search).get("zoom"));
let dpr = 1;

function resize(): void {
  dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  cam.zoom = zoomParam > 0 ? zoomParam : Math.min(window.innerWidth / (BENCH_W * TILE_PX), window.innerHeight / (BENCH_H * TILE_PX));
}
resize();
window.addEventListener("resize", resize);

function drawWorld(c: CanvasRenderingContext2D): void {
  const [x0, y0] = cam.worldToScreen(0, 0);
  const s = TILE_PX * cam.zoom;
  c.fillStyle = "#F8F6F2";
  c.fillRect(x0, y0, BENCH_W * s, BENCH_H * s);
  c.fillStyle = "#23262B";
  for (const r of sc.obstacles) c.fillRect(x0 + r.x * s, y0 + r.y * s, r.w * s, r.h * s);
  c.fillStyle = "#CBC5BA";
  for (const r of sc.targetAreas) c.fillRect(x0 + r.x * s, y0 + r.y * s, r.w * s, r.h * s);
}

let last = performance.now();
let acc = 0;
let sumFrame = 0;
let sumSim = 0;
let sumDraw = 0;
let frames = 0;
let lastReport = last;

function frame(now: number): void {
  const dt = Math.min(now - last, 100) / 1000;
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

  ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx!.fillStyle = "#ECE8E1";
  ctx!.fillRect(0, 0, window.innerWidth, window.innerHeight);
  drawWorld(ctx!);
  drawPeople(ctx!, cam, sc.people);
  const t2 = performance.now();

  sumSim += t1 - t0;
  sumDraw += t2 - t1;
  sumFrame += dt * 1000;
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
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
