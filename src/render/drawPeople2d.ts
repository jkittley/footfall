import type { Camera } from "./camera";
import { Journey, Mode, type PeopleStore } from "../sim/people";

const FLOOR = "#F8F6F2";
const COLOURS = ["#2F6FDB", "#E8772E", "#7B5CD6", "#E5B72A"]; // indexed by Mode: train, subway, flight, street
const STROKE_PX = 2;
const ROUND = 4; // path points are rounded to 1/ROUND px to keep the batched paths small

type Pt = readonly [number, number];

/** Outline of each shape at zoom 1, centred on the origin (px). A circle is null (drawn as an arc). */
const POLYS: Record<Mode, readonly Pt[] | null> = {
  [Mode.Train]: null,
  [Mode.Subway]: [[0, -5.5], [6, 5.5], [-6, 5.5]],
  [Mode.Flight]: [0, 1, 2, 3, 4, 5].map((k): Pt => [6 * Math.cos((k * Math.PI) / 3), 6 * Math.sin((k * Math.PI) / 3)]),
  [Mode.Street]: [[0, -5.5], [5.5, 0], [0, 5.5], [-5.5, 0]],
};
const CIRCLE_R = 5;

/** Sutherland-Hodgman clip of a convex polygon to x <= 0. */
function leftHalf(poly: readonly Pt[]): Pt[] {
  const out: Pt[] = [];
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k]!;
    const b = poly[(k + 1) % poly.length]!;
    const aIn = a[0] <= 0;
    const bIn = b[0] <= 0;
    if (aIn) out.push(a);
    if (aIn !== bIn) out.push([0, a[1] + ((b[1] - a[1]) * (0 - a[0])) / (b[0] - a[0])]);
  }
  return out;
}

const HALF_POLYS: Record<Mode, readonly Pt[] | null> = {
  [Mode.Train]: null,
  [Mode.Subway]: leftHalf(POLYS[Mode.Subway]!),
  [Mode.Flight]: leftHalf(POLYS[Mode.Flight]!),
  [Mode.Street]: leftHalf(POLYS[Mode.Street]!),
};

function addShape(p: Path2D, poly: readonly Pt[] | null, half: boolean, sx: number, sy: number, k: number): void {
  if (poly === null) {
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
  for (let v = 0; v < poly.length; v++) {
    const [px, py] = poly[v]!;
    const x = sx + px * k;
    const y = sy + py * k;
    if (v === 0) p.moveTo(x, y);
    else p.lineTo(x, y);
  }
  p.closePath();
}

// Rebuilt each frame: one full-shape path and one left-half path per (mode, journey).
const full: Path2D[] = [];
const half: Path2D[] = [];

/** Draws every person as its mode's shape and colour; fill is solid (departing), outline (arriving) or half (connecting). */
export function drawPeople2d(ctx: CanvasRenderingContext2D, cam: Camera, people: PeopleStore): void {
  full.length = 0;
  half.length = 0;
  for (let c = 0; c < 12; c++) {
    full.push(new Path2D());
    half.push(new Path2D());
  }
  const k = cam.zoom;
  const { x, y, mode, journey } = people;
  const sx0 = cam.worldToScreen(0, 0);
  const scale = cam.worldToScreen(1, 0)[0] - sx0[0];
  for (let i = 0, end = people.end; i < end; i++) {
    if (!people.isAlive(i)) continue;
    const sx = Math.round((sx0[0] + x[i]! * scale) * ROUND) / ROUND;
    const sy = Math.round((sx0[1] + y[i]! * scale) * ROUND) / ROUND;
    const m = mode[i]! as Mode;
    const j = journey[i]!;
    const slot = m * 3 + j;
    addShape(full[slot]!, POLYS[m], false, sx, sy, k);
    if (j === Journey.Connecting) addShape(half[slot]!, HALF_POLYS[m], true, sx, sy, k);
  }
  ctx.lineWidth = STROKE_PX;
  ctx.lineJoin = "round";
  for (let m = 0; m < 4; m++) {
    const colour = COLOURS[m]!;
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
}
