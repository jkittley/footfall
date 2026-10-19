import type { PlacementPreview } from "../sim/build";
import { Mode } from "../sim/people";
import type { World } from "../sim/world";
import { CELL_TILES, CrowdClass, type JamTracker } from "./jamCells";
import { ALERT, CIRCLE, GLOW_CROWDED, GLOW_JAM, INK, MODE_COLOURS, RING_BACK, rgba, type Rgba } from "./palette";
import { routeOf, type Pt } from "./route";
import { sx, sy, type View } from "./view";

/** Glow radii (tiles), from the Style board's 100px and 112px glows at 16px a tile, halved as CSS sizes them. */
const CROWDED_GLOW_R = 3.1;
const JAM_GLOW_R = 3.5;
/** The jam ring's radius and stroke (tiles and px), from the Style board's 60px ring. */
const RING_R = 1.6;
const RING_STROKE = 4;
/** The jam glow breathes like the gameplay board's halo. */
const PULSE_MS = 1600;

/** Orange glows on crowded cells; red glows and filling rings on jammed ones. Drawn under people. */
export function drawCrowding(ctx: CanvasRenderingContext2D, jam: JamTracker, v: View, nowMs: number): void {
  const pulse = 0.94 + 0.06 * Math.sin((nowMs / PULSE_MS) * 2 * Math.PI);
  const rings: [number, number, number][] = [];
  for (let cy = 0; cy < jam.ch; cy++) {
    const ty = (cy + 0.5) * CELL_TILES;
    if (ty + JAM_GLOW_R < v.y0 || ty - JAM_GLOW_R > v.y1) continue;
    for (let cx = 0; cx < jam.cw; cx++) {
      const tx = (cx + 0.5) * CELL_TILES;
      if (tx + JAM_GLOW_R < v.x0 || tx - JAM_GLOW_R > v.x1) continue;
      const c = cy * jam.cw + cx;
      const cls = jam.classOf(c);
      if (cls === CrowdClass.Crowded) glow(ctx, sx(v, tx), sy(v, ty), CROWDED_GLOW_R * v.s, GLOW_CROWDED);
      else if (cls === CrowdClass.Jam) {
        glow(ctx, sx(v, tx), sy(v, ty), JAM_GLOW_R * v.s * pulse, GLOW_JAM);
        rings.push([tx, ty, jam.ringFill(c)]);
      }
    }
  }
  const stroke = Math.max(2.5, RING_STROKE * v.cam.zoom);
  ctx.lineWidth = stroke;
  ctx.lineCap = "round";
  for (const [tx, ty, fill] of rings) {
    const X = sx(v, tx);
    const Y = sy(v, ty);
    const r = RING_R * v.s;
    ctx.beginPath();
    ctx.arc(X, Y, r, 0, Math.PI * 2);
    ctx.strokeStyle = RING_BACK;
    ctx.stroke();
    if (fill <= 0) continue;
    ctx.beginPath();
    ctx.arc(X, Y, r, -Math.PI / 2, -Math.PI / 2 + fill * Math.PI * 2);
    ctx.strokeStyle = ALERT;
    ctx.stroke();
  }
}

function glow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, colour: Rgba): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(colour));
  g.addColorStop(1, rgba(colour, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

export interface UiOverlayState {
  preview: PlacementPreview | null;
  selectedPerson: number | null;
  hoverTile: number | null;
}

/** Hover outline, the drag preview, and the selected person's route. Drawn over people. */
export function drawUi(ctx: CanvasRenderingContext2D, w: World, ui: UiOverlayState, v: View): void {
  if (ui.hoverTile !== null && ui.preview === null) drawHover(ctx, w, ui.hoverTile, v);
  if (ui.preview) drawPreview(ctx, w, ui.preview, v);
  if (ui.selectedPerson !== null && w.people.isAlive(ui.selectedPerson)) drawSelected(ctx, w, ui.selectedPerson, v);
}

function drawHover(ctx: CanvasRenderingContext2D, w: World, tile: number, v: View): void {
  const [tx, ty] = w.grid.xy(tile);
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1;
  ctx.strokeRect(sx(v, tx) + 0.5, sy(v, ty) + 0.5, v.s - 1, v.s - 1);
  ctx.globalAlpha = 1;
}

function tilePath(w: World, tiles: readonly number[], v: View): Path2D {
  const p = new Path2D();
  for (const t of tiles) {
    const [tx, ty] = w.grid.xy(t);
    p.rect(sx(v, tx), sy(v, ty), v.s, v.s);
  }
  return p;
}

/** The changing tiles tinted in the preview's colour, blocked ones in Alert, inside a dashed rect. */
function drawPreview(ctx: CanvasRenderingContext2D, w: World, pv: PlacementPreview, v: View): void {
  const colour = pv.valid ? CIRCLE : ALERT;
  ctx.fillStyle = colour;
  ctx.globalAlpha = 0.14;
  ctx.fill(tilePath(w, pv.tiles, v));
  ctx.fillStyle = ALERT;
  ctx.globalAlpha = 0.3;
  ctx.fill(tilePath(w, pv.blocked, v));
  ctx.globalAlpha = 1;
  const r = pv.rect;
  if (r.w <= 0 || r.h <= 0) return;
  ctx.save();
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = colour;
  ctx.strokeRect(sx(v, r.x), sy(v, r.y), r.w * v.s, r.h * v.s);
  ctx.restore();
}

function polyline(ctx: CanvasRenderingContext2D, pts: readonly Pt[], v: View): void {
  ctx.beginPath();
  pts.forEach(([x, y], k) => (k === 0 ? ctx.moveTo(sx(v, x), sy(v, y)) : ctx.lineTo(sx(v, x), sy(v, y))));
  ctx.stroke();
}

/** The route to their current target as a solid line, on to their goal dashed, and a ring round them. */
function drawSelected(ctx: CanvasRenderingContext2D, w: World, pid: number, v: View): void {
  const colour = MODE_COLOURS[w.people.mode[pid]! as Mode];
  const route = routeOf(w, pid);
  ctx.save();
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = colour;
  polyline(ctx, route.toTarget, v);
  if (route.toGoal.length > 1) {
    ctx.setLineDash([5, 5]);
    ctx.globalAlpha = 0.6;
    polyline(ctx, route.toGoal, v);
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(sx(v, w.people.x[pid]!), sy(v, w.people.y[pid]!), Math.max(8, 10 * v.cam.zoom), 0, Math.PI * 2);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.stroke();
}
