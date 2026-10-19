import type { Camera } from "./camera";
import { Journey, Mode, PState, type PeopleStore } from "../sim/people";
import { FLOOR, MODE_COLOURS } from "./palette";
import { CIRCLE_R, leftHalf, POLYS, type Pt } from "./shapes";

const STROKE_PX = 2;
const ROUND = 4; // path points are rounded to 1/ROUND px to keep the batched paths small
const MODES = [Mode.Train, Mode.Subway, Mode.Flight, Mode.Street] as const;

/** Left halves of the polygon shapes; the circle's is drawn as an arc. */
const HALF_POLYS: Record<Mode, readonly Pt[]> = {
  [Mode.Train]: [],
  [Mode.Subway]: leftHalf(POLYS[Mode.Subway]),
  [Mode.Flight]: leftHalf(POLYS[Mode.Flight]),
  [Mode.Street]: leftHalf(POLYS[Mode.Street]),
};

function addShape(p: Path2D, m: Mode, half: boolean, sx: number, sy: number, k: number): void {
  if (m === Mode.Train) {
    const r = CIRCLE_R * k;
    if (half) {
      p.moveTo(sx, sy - r);
      p.arc(sx, sy, r, -Math.PI / 2, Math.PI / 2, true);
    } else {
      p.moveTo(sx + r, sy);
      p.arc(sx, sy, r, 0, Math.PI * 2);
    }
    p.closePath();
    return;
  }
  const poly = half ? HALF_POLYS[m] : POLYS[m];
  for (let v = 0; v < poly.length; v++) {
    const [px, py] = poly[v]!;
    const x = sx + px * k;
    const y = sy + py * k;
    if (v === 0) p.moveTo(x, y);
    else p.lineTo(x, y);
  }
  p.closePath();
}

/** Alive and not being served inside a facility (drawn at its counter, they would cover the next in its queue). */
export function isDrawn(people: PeopleStore, i: number): boolean {
  return people.isAlive(i) && people.state[i] !== PState.InFacility;
}

// Rebuilt each frame: one full-shape path and one left-half path per (mode, journey).
const full: Path2D[] = [];
const half: Path2D[] = [];

/** Canvas 2D twin of drawPeople, under the same contract (see drawPeople). */
export function drawPeople2d(ctx: CanvasRenderingContext2D, cam: Camera, people: PeopleStore, dpr: number): void {
  full.length = 0;
  half.length = 0;
  for (let c = 0; c < 12; c++) {
    full.push(new Path2D());
    half.push(new Path2D());
  }
  const k = cam.zoom;
  const { x, y, mode, journey } = people;
  const [ox, oy] = cam.worldToScreen(0, 0);
  const scale = cam.scale;
  for (let i = 0, end = people.end; i < end; i++) {
    if (!isDrawn(people, i)) continue;
    const sx = Math.round((ox + x[i]! * scale) * ROUND) / ROUND;
    const sy = Math.round((oy + y[i]! * scale) * ROUND) / ROUND;
    const m = mode[i]! as Mode;
    const j = journey[i]!;
    const slot = m * 3 + j;
    addShape(full[slot]!, m, false, sx, sy, k);
    if (j === Journey.Connecting) addShape(half[slot]!, m, true, sx, sy, k);
  }
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineWidth = STROKE_PX;
  ctx.lineJoin = "round";
  for (const m of MODES) {
    const colour = MODE_COLOURS[m];
    ctx.fillStyle = colour;
    ctx.fill(full[m * 3 + Journey.Departing]!);

    ctx.fillStyle = FLOOR;
    ctx.strokeStyle = colour;
    ctx.fill(full[m * 3 + Journey.Arriving]!);
    ctx.stroke(full[m * 3 + Journey.Arriving]!);

    ctx.fillStyle = FLOOR;
    ctx.fill(full[m * 3 + Journey.Connecting]!);
    ctx.fillStyle = colour;
    ctx.fill(half[m * 3 + Journey.Connecting]!);
    ctx.stroke(full[m * 3 + Journey.Connecting]!);
  }
  ctx.restore();
}
