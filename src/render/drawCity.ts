import { CITY, flatten, shapePath, type City, type CityShape, type Point, type SmoothPath } from "../sim/maps/city";
import type { StationMap } from "../sim/maps/harbourStreet";
import {
  HAZE,
  INK,
  INK_2,
  KERB,
  PARK,
  ROAD,
  SHORE,
  TRACK,
  TREE,
  TREE_LIGHT,
  TREE_SHADOW,
  TRIANGLE,
  WALL,
  WATER,
  WATER_GRID,
  WATER_INK,
} from "./palette";
import { drawVenue } from "./drawVenues";
import { clamp, uiFont } from "./text";
import { sx, sy, type View } from "./view";

/** Tiles between the lines of the grid on the water. */
const WATER_GRID_TILES = 8;
/** How far the pale shore band reaches onto the land (tiles). */
const SHORE_TILES = 1.2;
/** Tiles between trees in a park, before jitter. */
const TREE_SPACING = 9;
const TREE_R = 1.7;

/** A shape's bounds in tiles, for culling. */
const boundsCache = new WeakMap<CityShape, { x0: number; y0: number; x1: number; y1: number }>();

function shapeBounds(s: CityShape): { x0: number; y0: number; x1: number; y1: number } {
  let b = boundsCache.get(s);
  if (!b) {
    const pad = (s.width ?? 0) / 2 + 2;
    b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (const [x, y] of s.points) {
      b.x0 = Math.min(b.x0, x - pad);
      b.y0 = Math.min(b.y0, y - pad);
      b.x1 = Math.max(b.x1, x + pad);
      b.y1 = Math.max(b.y1, y + pad);
    }
    boundsCache.set(s, b);
  }
  return b;
}

function inView(v: View, s: CityShape): boolean {
  const b = shapeBounds(s);
  return b.x0 < v.x1 && b.x1 > v.x0 && b.y0 < v.y1 && b.y1 > v.y0;
}

/** The smooth path in screen px. */
function screenPath(v: View, path: SmoothPath, closed: boolean): Path2D {
  const p = new Path2D();
  p.moveTo(sx(v, path.start[0]), sy(v, path.start[1]));
  for (const [c, e] of path.curves) p.quadraticCurveTo(sx(v, c[0]), sy(v, c[1]), sx(v, e[0]), sy(v, e[1]));
  if (closed) p.closePath();
  return p;
}

function pathOf(v: View, s: CityShape): Path2D {
  return screenPath(v, shapePath(s), s.kind !== "road");
}

/**
 * The city under the station: water with its shore band and grid, parks with their trees, roads
 * (and where they cross water, bridges), pavements and the footbridge, the rail throat north of
 * the station, and each later stage's site under a haze with its name and when it opens.
 */
export function drawCity(ctx: CanvasRenderingContext2D, v: View, map: StationMap, city: City = CITY): void {
  const shown = city.shapes.filter((s) => inView(v, s));
  const water = shown.filter((s) => s.kind === "water");
  const waterPaths = water.map((s) => pathOf(v, s));

  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (const p of waterPaths) {
    ctx.strokeStyle = SHORE;
    ctx.lineWidth = 2 * SHORE_TILES * v.s;
    ctx.stroke(p);
  }
  for (const s of shown) if (s.kind === "park") drawPark(ctx, v, s);
  for (const p of waterPaths) {
    ctx.fillStyle = WATER;
    ctx.fill(p);
    drawWaterGrid(ctx, v, p);
  }

  drawRailThroat(ctx, v, map, city);
  const roads = shown.filter((s) => s.kind === "road");
  for (const s of roads) drawBridge(ctx, v, s, waterPaths);
  for (const s of roads) strokeRoad(ctx, v, s, KERB, (s.width ?? 1) * v.s + Math.max(2, 0.6 * v.s));
  for (const s of roads) strokeRoad(ctx, v, s, ROAD, (s.width ?? 1) * v.s);
  for (const s of roads) drawCentreLine(ctx, v, s);
  for (const s of shown) if (s.kind === "pavement") drawPavement(ctx, v, s, waterPaths);
  for (const s of shown) if (s.kind === "locked") drawLocked(ctx, v, s);
}

/** Names on the water, parks and roads, drawn over everything else. */
export function drawCityLabels(ctx: CanvasRenderingContext2D, v: View, city: City = CITY): void {
  for (const s of city.shapes) {
    if (!s.name || !s.label || !inView(v, s)) continue;
    if (s.kind === "water") waterName(ctx, v, s.name, s.label.at, s.label.angle ?? 0);
    else if (s.kind === "park") parkName(ctx, v, s.name, s.label.at, s.label.angle ?? 0);
    else if (s.kind === "road") roadName(ctx, v, s.name, s.width ?? 1, s.label.at, s.label.angle ?? 0);
  }
  for (const n of city.waterNames) waterName(ctx, v, n.name, n.at, n.angle ?? 0);
}

function drawWaterGrid(ctx: CanvasRenderingContext2D, v: View, clip: Path2D): void {
  const step = WATER_GRID_TILES * v.s;
  if (step < 12) return;
  ctx.save();
  ctx.clip(clip);
  const p = new Path2D();
  const offX = ((v.ox % step) + step) % step;
  const offY = ((v.oy % step) + step) % step;
  for (let x = offX; x < v.cssW; x += step) (p.moveTo(x, 0), p.lineTo(x, v.cssH));
  for (let y = offY; y < v.cssH; y += step) (p.moveTo(0, y), p.lineTo(v.cssW, y));
  ctx.strokeStyle = WATER_GRID;
  ctx.lineWidth = 1;
  ctx.stroke(p);
  ctx.restore();
}

/** Deterministic tree spots inside a park, kept clear of its edge. */
const treeCache = new WeakMap<CityShape, Point[]>();

function treesOf(s: CityShape): Point[] {
  let trees = treeCache.get(s);
  if (trees) return trees;
  trees = [];
  const outline = flatten(shapePath(s));
  const b = shapeBounds(s);
  let k = 0;
  for (let y = b.y0 + TREE_SPACING / 2; y < b.y1; y += TREE_SPACING) {
    for (let x = b.x0 + TREE_SPACING / 2; x < b.x1; x += TREE_SPACING) {
      k++;
      // A fixed jitter from the spot's own number, so trees don't stand in rows.
      const jx = x + ((k * 37) % 7) - 3;
      const jy = y + ((k * 53) % 7) - 3;
      const clear = 2.5;
      if ([[0, 0], [clear, 0], [-clear, 0], [0, clear], [0, -clear]].every(([dx, dy]) => insidePoly(outline, jx + dx!, jy + dy!))) trees.push([jx, jy]);
    }
  }
  treeCache.set(s, trees);
  return trees;
}

function insidePoly(poly: readonly Point[], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

function drawPark(ctx: CanvasRenderingContext2D, v: View, s: CityShape): void {
  ctx.fillStyle = PARK;
  ctx.fill(pathOf(v, s));
  const r = TREE_R * v.s;
  if (r < 1.5) return;
  const shadow = new Path2D();
  const dark = new Path2D();
  const light = new Path2D();
  for (const [x, y] of treesOf(s)) {
    const X = sx(v, x);
    const Y = sy(v, y);
    shadow.moveTo(X + 0.35 * r + r, Y + 0.8 * r);
    shadow.arc(X + 0.35 * r, Y + 0.8 * r, r, 0, Math.PI * 2);
    dark.moveTo(X + r, Y);
    dark.arc(X, Y, r, 0, Math.PI * 2);
    light.moveTo(X + 0.65 * r + 0.72 * r, Y + 0.55 * r);
    light.arc(X + 0.65 * r, Y + 0.55 * r, 0.72 * r, 0, Math.PI * 2);
  }
  ctx.fillStyle = TREE_SHADOW;
  ctx.fill(shadow);
  ctx.fillStyle = TREE;
  ctx.fill(dark);
  ctx.fillStyle = TREE_LIGHT;
  ctx.fill(light);
}

function strokeRoad(ctx: CanvasRenderingContext2D, v: View, s: CityShape, colour: string, width: number): void {
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.lineCap = "butt";
  ctx.stroke(pathOf(v, s));
}

function drawCentreLine(ctx: CanvasRenderingContext2D, v: View, s: CityShape): void {
  if ((s.width ?? 0) < 6) return;
  const dash = Math.max(4, 0.6 * v.s);
  ctx.save();
  ctx.setLineDash([dash, dash]);
  ctx.strokeStyle = TRACK;
  ctx.lineWidth = 1.5;
  ctx.lineCap = "butt";
  ctx.stroke(pathOf(v, s));
  ctx.restore();
}

/** Where a road crosses water: a pavement either side of the carriageway, between dark parapets. */
function drawBridge(ctx: CanvasRenderingContext2D, v: View, s: CityShape, water: readonly Path2D[]): void {
  const w = (s.width ?? 1) + 2;
  for (const clip of water) {
    ctx.save();
    ctx.clip(clip);
    strokeRoad(ctx, v, s, WALL, w * v.s + Math.max(3, 0.35 * v.s));
    strokeRoad(ctx, v, s, SHORE, w * v.s);
    ctx.restore();
  }
}

/** A pavement (pale with a kerb line); over water, the footbridge's parapets. */
function drawPavement(ctx: CanvasRenderingContext2D, v: View, s: CityShape, water: readonly Path2D[]): void {
  const p = pathOf(v, s);
  ctx.fillStyle = SHORE;
  ctx.fill(p);
  ctx.strokeStyle = KERB;
  ctx.lineWidth = 1.5;
  ctx.stroke(p);
  for (const clip of water) {
    ctx.save();
    ctx.clip(clip);
    ctx.strokeStyle = WALL;
    ctx.lineWidth = Math.max(2, 0.3 * v.s);
    ctx.stroke(p);
    ctx.restore();
  }
}

/** A later stage's site: hazed, a faded drawing of the venue to come, its name and when it opens. */
function drawLocked(ctx: CanvasRenderingContext2D, v: View, s: CityShape): void {
  const p = pathOf(v, s);
  ctx.fillStyle = HAZE;
  ctx.fill(p);
  const pts = s.points;
  const box = {
    x0: Math.min(...pts.map((q) => q[0])),
    y0: Math.min(...pts.map((q) => q[1])),
    x1: Math.max(...pts.map((q) => q[0])),
    y1: Math.max(...pts.map((q) => q[1])),
  };
  ctx.save();
  ctx.clip(p);
  drawVenue(ctx, v, s, box);
  ctx.restore();
  ctx.save();
  ctx.setLineDash([6, 5]);
  ctx.strokeStyle = TRACK;
  ctx.lineWidth = 1.5;
  ctx.stroke(p);
  ctx.restore();
  if (s.name) lockedLabel(ctx, v, s.name, s.area, box);
}

/** The name and opening line, on a haze pad over the venue's drawing; left off where they do not fit. */
function lockedLabel(ctx: CanvasRenderingContext2D, v: View, name: string, area: string | undefined, b: { x0: number; y0: number; x1: number; y1: number }): void {
  const w = (b.x1 - b.x0) * v.s;
  const h = (b.y1 - b.y0) * v.s;
  const size = clamp(1.2 * v.s, 11, 18);
  const small = Math.max(10, size * 0.8);
  ctx.font = uiFont(size, 700);
  const nameW = ctx.measureText(name).width;
  ctx.font = uiFont(small, 500);
  const lineW = area ? ctx.measureText(area).width : 0;
  const padW = Math.max(nameW, lineW) + 16;
  const padH = area ? size + small * 1.4 + 10 : size + 10;
  if (padW + 4 > w || padH + 4 > h) return;
  const cx = sx(v, (b.x0 + b.x1) / 2);
  const cy = sy(v, (b.y0 + b.y1) / 2);
  ctx.beginPath();
  ctx.roundRect(cx - padW / 2, cy - padH / 2, padW, padH, 6);
  ctx.fillStyle = HAZE;
  ctx.fill();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = uiFont(size, 700);
  ctx.fillStyle = INK;
  ctx.fillText(name, cx, area ? cy - small * 0.7 : cy);
  if (area) {
    ctx.font = uiFont(small, 500);
    ctx.fillStyle = INK_2;
    ctx.fillText(area, cx, cy + size * 0.7);
  }
}

/**
 * The station's tracks running north out of it, fanning into the four main lines: straight over
 * the track bed, then curving to whichever line starts nearest.
 */
function drawRailThroat(ctx: CanvasRenderingContext2D, v: View, map: StationMap, city: City): void {
  const top = map.grounds.y;
  if (top < v.y0 - 2 && city.railLines.every((l) => l.every(([, y]) => y < v.y0))) return;
  const fan = new Path2D();
  const tracks = map.islands.flatMap((isl) => [isl.leftTrack, isl.rightTrack]);
  for (const t of tracks) {
    const x = t.x + 0.5;
    const line = city.railLines.reduce((best, l) => (Math.abs(l[0]![0] - x) < Math.abs(best[0]![0] - x) ? l : best));
    const [lx, ly] = line[0]!;
    fan.moveTo(sx(v, x), sy(v, t.y));
    fan.lineTo(sx(v, x), sy(v, top));
    fan.bezierCurveTo(sx(v, x), sy(v, (top + ly) / 2), sx(v, lx), sy(v, (top + ly) / 2 + 6), sx(v, lx), sy(v, ly));
  }
  ctx.lineCap = "round";
  ctx.strokeStyle = TRACK;
  ctx.lineWidth = Math.max(1.5, 0.3 * v.s);
  ctx.stroke(fan);
  ctx.strokeStyle = KERB;
  ctx.lineWidth = Math.max(2.5, 0.55 * v.s);
  for (const l of city.railLines) ctx.stroke(screenPath(v, { start: l[0]!, curves: smoothCurves(l) }, false));
}

function smoothCurves(l: readonly Point[]): [Point, Point][] {
  const out: [Point, Point][] = [];
  for (let i = 1; i < l.length; i++) out.push([l[i]!, l[i]!]);
  return out;
}

/** The subway to come: a dashed outline under the station, its tunnels, and its name. */
export function drawSubway(ctx: CanvasRenderingContext2D, v: View, city: City = CITY): void {
  const sub = city.subway;
  ctx.save();
  ctx.globalAlpha = 0.7;
  ctx.setLineDash([Math.max(5, 0.6 * v.s), Math.max(4, 0.45 * v.s)]);
  ctx.strokeStyle = TRIANGLE;
  ctx.lineWidth = Math.max(2, 0.2 * v.s);
  ctx.lineCap = "butt";
  ctx.stroke(screenPath(v, shapePath({ kind: "locked", points: sub.outline }), true));
  for (const t of sub.tunnels) ctx.stroke(screenPath(v, shapePath({ kind: "road", points: t }), false));
  ctx.restore();

  const size = clamp(1.0 * v.s, 10, 14);
  const small = Math.max(10, size * 0.85);
  ctx.font = uiFont(size, 700);
  const nameW = ctx.measureText(sub.name).width;
  ctx.font = uiFont(small, 500);
  const w = Math.max(nameW, ctx.measureText(sub.area).width) + 16;
  const h = size + small * 1.3 + 10;
  const [ax, ay] = sub.outline.reduce(([mx, my], [x, y]) => [Math.max(mx, x), Math.max(my, y)], [-Infinity, -Infinity]);
  const right = sx(v, ax) - 6;
  const bottom = sy(v, ay) - 6;
  if (right - w < sx(v, ax - 40)) return;
  ctx.beginPath();
  ctx.roundRect(right - w, bottom - h, w, h, 6);
  ctx.fillStyle = SHORE;
  ctx.fill();
  ctx.strokeStyle = TRIANGLE;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = uiFont(size, 700);
  ctx.fillStyle = INK;
  ctx.fillText(sub.name, right - w + 8, bottom - h + 5 + size / 2);
  ctx.font = uiFont(small, 500);
  ctx.fillStyle = INK_2;
  ctx.fillText(sub.area, right - w + 8, bottom - 5 - small * 0.6);
}

function spaced(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, angle: number, spacing: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.letterSpacing = spacing;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

function waterName(ctx: CanvasRenderingContext2D, v: View, name: string, [x, y]: Point, angle: number): void {
  const size = clamp(1.1 * v.s, 10, 16);
  ctx.font = uiFont(size, 600);
  ctx.fillStyle = WATER_INK;
  spaced(ctx, name.toUpperCase(), sx(v, x), sy(v, y), angle, `${(size * 0.35).toFixed(1)}px`);
}

function parkName(ctx: CanvasRenderingContext2D, v: View, name: string, [x, y]: Point, angle: number): void {
  const size = clamp(0.9 * v.s, 10, 14);
  ctx.font = uiFont(size, 500);
  ctx.fillStyle = INK_2;
  spaced(ctx, name, sx(v, x), sy(v, y), angle, "0px");
}

function roadName(ctx: CanvasRenderingContext2D, v: View, name: string, width: number, [x, y]: Point, angle: number): void {
  const size = clamp(0.7 * v.s, 9, 12);
  if (size > width * v.s - 2) return;
  ctx.font = uiFont(size, 600);
  ctx.fillStyle = INK_2;
  spaced(ctx, name.toUpperCase(), sx(v, x), sy(v, y), angle, `${(size * 0.12).toFixed(1)}px`);
}
