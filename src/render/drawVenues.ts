import type { CityShape } from "../sim/maps/city";
import { ALERT, CIRCLE, DIAMOND, FLOOR, HEXAGON, KERB, PARK, SHORE, SQUARE, TRACK, TRIANGLE, WALL } from "./palette";
import { sx, sy, type View } from "./view";

/** How strongly a locked venue's silhouette shows through its haze. */
export const VENUE_ALPHA = 0.5;

type Box = { x0: number; y0: number; x1: number; y1: number };

/** Draws in tile coordinates. */
class Pen {
  constructor(
    private readonly ctx: CanvasRenderingContext2D,
    private readonly v: View,
  ) {}

  rect(x: number, y: number, w: number, h: number, fill: string | null, stroke: string | null = null, lineTiles = 0.4, r = 0.6): void {
    const { ctx, v } = this;
    ctx.beginPath();
    ctx.roundRect(sx(v, x), sy(v, y), w * v.s, h * v.s, Math.min(r * v.s, (w * v.s) / 2, (h * v.s) / 2));
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = Math.max(1, lineTiles * v.s);
      ctx.stroke();
    }
  }

  line(x0: number, y0: number, x1: number, y1: number, colour: string, lineTiles: number, dash: number[] = []): void {
    const { ctx, v } = this;
    ctx.save();
    ctx.setLineDash(dash.map((d) => Math.max(2, d * v.s)));
    ctx.beginPath();
    ctx.moveTo(sx(v, x0), sy(v, y0));
    ctx.lineTo(sx(v, x1), sy(v, y1));
    ctx.strokeStyle = colour;
    ctx.lineWidth = Math.max(1, lineTiles * v.s);
    ctx.lineCap = "butt";
    ctx.stroke();
    ctx.restore();
  }

  hexagon(cx: number, cy: number, r: number, fill: string): void {
    const { ctx, v } = this;
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = Math.PI / 6 + (k * Math.PI) / 3;
      const X = sx(v, cx + r * Math.cos(a));
      const Y = sy(v, cy + r * Math.sin(a));
      if (k === 0) ctx.moveTo(X, Y);
      else ctx.lineTo(X, Y);
    }
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, fill: string | null, stroke: string | null, lineTiles: number): void {
    const { ctx, v } = this;
    ctx.beginPath();
    ctx.ellipse(sx(v, cx), sy(v, cy), rx * v.s, ry * v.s, 0, 0, Math.PI * 2);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = Math.max(1, lineTiles * v.s);
      ctx.stroke();
    }
  }
}

/**
 * A locked venue as a faded drawing of what will open there, after the city mockup: drawn at
 * VENUE_ALPHA over its haze, inside the shape's bounds `b` (tiles).
 */
export function drawVenue(ctx: CanvasRenderingContext2D, v: View, s: CityShape, b: Box): void {
  if (!s.venue) return;
  const pen = new Pen(ctx, v);
  ctx.save();
  ctx.globalAlpha = VENUE_ALPHA;
  const w = b.x1 - b.x0;
  const h = b.y1 - b.y0;
  switch (s.venue) {
    case "airport":
      airport(pen, b.x0, b.y0, w, h);
      break;
    case "exhibition":
      exhibition(pen, b.x0, b.y0, w, h);
      break;
    case "mall":
      mall(pen, b.x0, b.y0, w, h);
      break;
    case "stadium":
      stadium(pen, b.x0, b.y0, w, h);
      break;
    case "depot":
      depot(pen, b.x0, b.y0, w, h);
      break;
    case "carpark":
      carPark(pen, b.x0, b.y0, w, h);
      break;
  }
  ctx.restore();
}

/** The terminal (check-in desks, the red security line), its pier with hexagon gates, the apron and the runway. */
function airport(pen: Pen, x: number, y: number, w: number, h: number): void {
  const runwayW = w * 0.16;
  const runwayX = x + w - runwayW - 4;
  pen.rect(runwayX, y + 4, runwayW, h - 8, TRACK, null, 0, 1);
  pen.line(runwayX + runwayW / 2, y + 8, runwayX + runwayW / 2, y + h - 8, SHORE, 0.6, [6, 5]);
  const apronX = x + w * 0.56;
  pen.rect(apronX, y + h * 0.28, runwayX - apronX - 4, h * 0.66, KERB, null, 0, 1.5);
  const termW = w * 0.45;
  const termY = y + h * 0.4;
  const termH = h * 0.56;
  pen.rect(x + 3, termY, termW, termH, FLOOR, WALL, 0.6, 1.5);
  pen.line(x + 3 + termW / 2, termY + 1, x + 3 + termW / 2, termY + termH - 1, ALERT, 0.5, [1.2, 1]);
  for (let k = 0; k < 3; k++) pen.rect(x + 7, termY + 6 + k * 7, termW * 0.25, 2, WALL, null, 0, 0.6);
  const pierX = x + 3 + termW;
  pen.rect(pierX, termY + 5, 6, termH - 10, FLOOR, WALL, 0.6, 0.4);
  for (let k = 0; k < 4; k++) pen.hexagon(pierX + 12, termY + 10 + (k * (termH - 20)) / 3, 2.4, HEXAGON);
}

/** Halls either side of a wide corridor. */
function exhibition(pen: Pen, x: number, y: number, w: number, h: number): void {
  pen.rect(x + 1, y + 1, w - 2, h - 2, FLOOR, WALL, 0.6, 1.5);
  const corridorH = h * 0.18;
  pen.rect(x + 1, y + (h - corridorH) / 2, w - 2, corridorH, SHORE, null, 0, 0);
  const halls = 4;
  const gap = 3;
  const hallW = (w - 8 - gap * (halls - 1)) / halls;
  const hallH = (h - corridorH) / 2 - 5;
  for (let k = 0; k < halls; k++) {
    const hx = x + 4 + k * (hallW + gap);
    pen.rect(hx, y + 4, hallW, hallH, KERB, null, 0, 1.2);
    pen.rect(hx, y + h - 4 - hallH, hallW, hallH, KERB, null, 0, 1.2);
  }
}

/** Two floors' outline with an anchor store at each end and small units between. */
function mall(pen: Pen, x: number, y: number, w: number, h: number): void {
  pen.rect(x + 1, y + 1, w - 2, h - 2, FLOOR, WALL, 0.6, 1.5);
  const anchorW = w * 0.2;
  const anchorH = h * 0.42;
  pen.rect(x + 4, y + (h - anchorH) / 2, anchorW, anchorH, SQUARE, null, 0, 1);
  pen.rect(x + w - 4 - anchorW, y + (h - anchorH) / 2, anchorW, anchorH, SQUARE, null, 0, 1);
  const unitW = 6;
  const from = x + 8 + anchorW;
  const units = Math.floor((w - 2 * anchorW - 16) / (unitW + 2));
  for (let k = 0; k < units; k++) {
    pen.rect(from + k * (unitW + 2), y + 4, unitW, 5, TRACK, null, 0, 0.6);
    pen.rect(from + k * (unitW + 2), y + h - 9, unitW, 5, TRACK, null, 0, 0.6);
  }
}

/** An oval stand round a pitch, with a gate post at each compass point. */
function stadium(pen: Pen, x: number, y: number, w: number, h: number): void {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rx = w / 2 - 2;
  const ry = h / 2 - 2;
  pen.ellipse(cx, cy, rx, ry, FLOOR, WALL, 0.9);
  pen.rect(cx - rx * 0.5, cy - ry * 0.42, rx, ry * 0.84, PARK, SHORE, 0.3, 0.8);
  for (const [gx, gy, gw, gh] of [
    [cx - 1.5, cy - ry - 1, 3, 2],
    [cx - 1.5, cy + ry - 1, 3, 2],
    [cx - rx - 1, cy - 1.5, 2, 3],
    [cx + rx - 1, cy - 1.5, 2, 3],
  ] as const)
    pen.rect(gx, gy, gw, gh, WALL, null, 0, 0.2);
}

/** Bus bays in two rows, a few with a bus standing in them. */
function depot(pen: Pen, x: number, y: number, w: number, h: number): void {
  const bayW = 7;
  const bays = Math.floor((w - 8) / bayW);
  const rowH = h * 0.32;
  for (const top of [y + 5, y + h - 5 - rowH]) {
    for (let k = 0; k <= bays; k++) pen.line(x + 4 + k * bayW, top, x + 4 + k * bayW, top + rowH, WALL, 0.3);
    for (const k of [1, 2, 5, 8]) if (k < bays) pen.rect(x + 5.5 + k * bayW, top + 2, bayW - 3, rowH - 4, TRIANGLE, null, 0, 0.8);
  }
}

/** Bays marked in rows across the longer side, with a few cars parked. */
function carPark(pen: Pen, x: number, y: number, w: number, h: number): void {
  const across = w >= h;
  const bay = 5;
  const len = across ? w : h;
  const depth = (across ? h : w) / 2 - 3;
  const bays = Math.floor((len - 6) / bay);
  const cars = [CIRCLE, DIAMOND, TRIANGLE];
  for (let row = 0; row < 2; row++) {
    for (let k = 0; k <= bays; k++) {
      const a = 3 + k * bay;
      const b0 = 2 + row * (depth + 2);
      if (across) pen.line(x + a, y + b0, x + a, y + b0 + depth, SHORE, 0.35);
      else pen.line(x + b0, y + a, x + b0 + depth, y + a, SHORE, 0.35);
      if (k < bays && (k * 7 + row * 3) % 5 === 0) {
        const colour = cars[(k + row) % cars.length]!;
        if (across) pen.rect(x + a + 1, y + b0 + 1, bay - 2, depth - 2, colour, null, 0, 0.6);
        else pen.rect(x + b0 + 1, y + a + 1, depth - 2, bay - 2, colour, null, 0, 0.6);
      }
    }
  }
}
