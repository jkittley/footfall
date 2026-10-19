import { FacilityKind, type Facility } from "../sim/facilities";
import { Dir, Tile, Zone, type Grid, type Rect } from "../sim/grid";
import type { World } from "../sim/world";
import { futurePairLabel, platformLabelVariants, retailLabel, type Run } from "./labels";
import { CIRCLE, DOT, FLOOR, GROUND, INK, INK_2, SQUARE, TRACK, WALL } from "./palette";
import { clamp, drawRuns, runsWidth, uiFont, wrapWords } from "./text";
import { rectInView, snap, sx, sy, type View } from "./view";

const DOT_SPACING = 20;
const HATCH_SPACING = 7;
/** Share of a platform that shows through while it is closed. */
const CLOSED_OPACITY = 0.35;

/** Inside the building (walls run round it), outside it, or neither (openings and track). */
const enum Side {
  Out = 0,
  In = 1,
  Open = 2,
}

function sideOf(g: Grid, x: number, y: number): Side {
  if (!g.inBounds(x, y)) return Side.Out;
  const t = g.tiles[g.idx(x, y)] as Tile;
  if (t === Tile.Floor || t === Tile.Platform || t === Tile.Rail || t === Tile.Wall) return Side.In;
  if (t === Tile.Entrance || t === Tile.Track) return Side.Open;
  return Side.Out;
}

/** Lines that scale with zoom but never go thinner than `min` px. */
function lw(v: View, px: number, min = 1): number {
  return Math.max(min, px * v.cam.zoom);
}

function rectPx(v: View, r: Rect): [number, number, number, number] {
  return [sx(v, r.x), sy(v, r.y), r.w * v.s, r.h * v.s];
}

/**
 * Everything that only changes with the grid: ground and its dot grid, obstacles, floor, track,
 * platform edges, future islands, walls, rails, facility bodies, travelators and entrances.
 */
export function drawStatic(ctx: CanvasRenderingContext2D, w: World, v: View): void {
  ctx.fillStyle = GROUND;
  ctx.fillRect(0, 0, v.cssW, v.cssH);
  drawDots(ctx, v);
  drawObstacles(ctx, w, v);
  drawFloor(ctx, w.grid, v);
  drawTrack(ctx, w.grid, v);
  drawPlatformEdges(ctx, w.grid, v);
  drawFutureIslands(ctx, w, v);
  drawFacilityBodies(ctx, w, v);
  drawTravelators(ctx, w.grid, v);
  drawEdges(ctx, w.grid, v);
  drawWallTiles(ctx, w.grid, v);
  drawRails(ctx, w.grid, v);
  drawEntrances(ctx, w, v);
}

function drawDots(ctx: CanvasRenderingContext2D, v: View): void {
  const offX = ((v.ox % DOT_SPACING) + DOT_SPACING) % DOT_SPACING;
  const offY = ((v.oy % DOT_SPACING) + DOT_SPACING) % DOT_SPACING;
  ctx.beginPath();
  for (let y = offY; y < v.cssH; y += DOT_SPACING) for (let x = offX; x < v.cssW; x += DOT_SPACING) ctx.rect(x - 1, y - 1, 2, 2);
  ctx.fillStyle = DOT;
  ctx.fill();
}

function drawObstacles(ctx: CanvasRenderingContext2D, w: World, v: View): void {
  const shown = w.map.obstacles.filter((o) => rectInView(v, o.rect.x, o.rect.y, o.rect.w, o.rect.h));
  if (shown.length === 0) return;
  const outline = new Path2D();
  let bx0 = Infinity;
  let by0 = Infinity;
  let bx1 = -Infinity;
  let by1 = -Infinity;
  for (const o of shown) {
    const [x, y, ww, hh] = rectPx(v, o.rect);
    outline.rect(x, y, ww, hh);
    bx0 = Math.min(bx0, x);
    by0 = Math.min(by0, y);
    bx1 = Math.max(bx1, x + ww);
    by1 = Math.max(by1, y + hh);
  }
  bx0 = Math.max(bx0, 0);
  by0 = Math.max(by0, 0);
  bx1 = Math.min(bx1, v.cssW);
  by1 = Math.min(by1, v.cssH);
  ctx.save();
  ctx.clip(outline);
  ctx.beginPath();
  // Lines x + y = c, anchored to the world so the hatching pans with it.
  const anchor = v.ox + v.oy;
  const k0 = Math.ceil((bx0 + by0 - anchor) / HATCH_SPACING);
  const k1 = Math.floor((bx1 + by1 - anchor) / HATCH_SPACING);
  for (let k = k0; k <= k1; k++) {
    const c = anchor + k * HATCH_SPACING;
    ctx.moveTo(c - by0, by0);
    ctx.lineTo(c - by1, by1);
  }
  ctx.strokeStyle = TRACK;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = TRACK;
  ctx.lineWidth = 1.5;
  ctx.stroke(outline);

  const size = clamp(11 * v.cam.zoom, 9, 13);
  ctx.font = uiFont(size, 500);
  for (const o of shown) drawBoxedName(ctx, o.name, rectPx(v, o.rect), size);
}

/** An obstacle's name on a ground-coloured pad: across, else up its long side, else wrapped, else left off. */
function drawBoxedName(ctx: CanvasRenderingContext2D, name: string, [x, y, w, h]: [number, number, number, number], size: number): void {
  const pad = 3;
  const tw = ctx.measureText(name).width;
  const cx = x + w / 2;
  const cy = y + h / 2;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const label = (lines: string[], rotate: boolean): void => {
    const lh = size * 1.25;
    const bw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + pad * 2;
    const bh = lines.length * lh + pad;
    ctx.save();
    ctx.translate(cx, cy);
    if (rotate) ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = GROUND;
    ctx.fillRect(-bw / 2, -bh / 2, bw, bh);
    ctx.fillStyle = INK_2;
    lines.forEach((l, i) => ctx.fillText(l, 0, (i - (lines.length - 1) / 2) * lh));
    ctx.restore();
  };
  if (tw + pad * 4 <= w && size + pad * 2 <= h) return label([name], false);
  if (h > w && tw + pad * 4 <= h && size + pad * 2 <= w) return label([name], true);
  const lines = wrapWords(ctx, name, w - pad * 4);
  if (lines && lines.length * size * 1.25 + pad * 2 <= h) label(lines, false);
}

/** Row runs of tiles matching `pick`, merged into one path. */
function tileRuns(g: Grid, v: View, pick: (t: Tile, i: number) => boolean): Path2D {
  const p = new Path2D();
  for (let y = v.y0; y < v.y1; y++) {
    let start = -1;
    for (let x = v.x0; x <= v.x1; x++) {
      const i = y * g.w + x;
      const on = x < v.x1 && pick(g.tiles[i] as Tile, i);
      if (on && start < 0) start = x;
      if (!on && start >= 0) {
        const X0 = snap(v, sx(v, start));
        const Y0 = snap(v, sy(v, y));
        p.rect(X0, Y0, snap(v, sx(v, x)) - X0, snap(v, sy(v, y + 1)) - Y0);
        start = -1;
      }
    }
  }
  return p;
}

function drawFloor(ctx: CanvasRenderingContext2D, g: Grid, v: View): void {
  ctx.fillStyle = FLOOR;
  ctx.fill(tileRuns(g, v, (t) => t === Tile.Floor || t === Tile.Platform || t === Tile.Entrance || t === Tile.Rail || t === Tile.Wall));
}

/** Two rails along each track and sleepers across it. */
function drawTrack(ctx: CanvasRenderingContext2D, g: Grid, v: View): void {
  const sleepers = new Path2D();
  const rails = new Path2D();
  const isTrack = (x: number, y: number): boolean => g.inBounds(x, y) && g.tile(x, y) === Tile.Track;
  for (let y = v.y0; y < v.y1; y++) {
    for (let x = v.x0; x < v.x1; x++) {
      if (!isTrack(x, y)) continue;
      const vertical = isTrack(x, y - 1) || isTrack(x, y + 1) || !(isTrack(x - 1, y) || isTrack(x + 1, y));
      const X = sx(v, x);
      const Y = sy(v, y);
      const s = v.s;
      if (vertical) {
        for (const f of [0.25, 0.75]) {
          sleepers.moveTo(X + 0.1 * s, Y + f * s);
          sleepers.lineTo(X + 0.9 * s, Y + f * s);
        }
        for (const f of [0.28, 0.72]) {
          rails.moveTo(X + f * s, Y);
          rails.lineTo(X + f * s, Y + s);
        }
      } else {
        for (const f of [0.25, 0.75]) {
          sleepers.moveTo(X + f * s, Y + 0.1 * s);
          sleepers.lineTo(X + f * s, Y + 0.9 * s);
        }
        for (const f of [0.28, 0.72]) {
          rails.moveTo(X, Y + f * s);
          rails.lineTo(X + s, Y + f * s);
        }
      }
    }
  }
  ctx.lineCap = "butt";
  ctx.strokeStyle = TRACK;
  ctx.lineWidth = Math.max(1.5, 0.16 * v.s);
  ctx.stroke(sleepers);
  ctx.strokeStyle = INK_2;
  ctx.lineWidth = lw(v, 1.25);
  ctx.stroke(rails);
}

/** A 2px line along every platform edge that faces track. */
function drawPlatformEdges(ctx: CanvasRenderingContext2D, g: Grid, v: View): void {
  const p = new Path2D();
  const inset = 1;
  for (let y = v.y0; y < v.y1; y++) {
    for (let x = v.x0; x < v.x1; x++) {
      if (g.tile(x, y) !== Tile.Platform) continue;
      const X0 = sx(v, x);
      const Y0 = sy(v, y);
      const X1 = sx(v, x + 1);
      const Y1 = sy(v, y + 1);
      const track = (dx: number, dy: number): boolean => g.inBounds(x + dx, y + dy) && g.tile(x + dx, y + dy) === Tile.Track;
      if (track(-1, 0)) {
        p.moveTo(X0 + inset, Y0);
        p.lineTo(X0 + inset, Y1);
      }
      if (track(1, 0)) {
        p.moveTo(X1 - inset, Y0);
        p.lineTo(X1 - inset, Y1);
      }
      if (track(0, -1)) {
        p.moveTo(X0, Y0 + inset);
        p.lineTo(X1, Y0 + inset);
      }
      if (track(0, 1)) {
        p.moveTo(X0, Y1 - inset);
        p.lineTo(X1, Y1 - inset);
      }
    }
  }
  ctx.strokeStyle = CIRCLE;
  ctx.lineWidth = 2;
  ctx.lineCap = "butt";
  ctx.stroke(p);
}

/** Dashed outline style shared by future islands and future platforms. */
function futureStyle(ctx: CanvasRenderingContext2D, v: View): number {
  const size = clamp(11 * v.cam.zoom, 9, 13);
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1;
  ctx.strokeStyle = INK_2;
  ctx.font = uiFont(size, 500);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  return size;
}

/** A faint dashed outline of `r` with `text` running up its middle, where it fits. */
function drawFutureOutline(ctx: CanvasRenderingContext2D, v: View, r: Rect, text: string, size: number): void {
  if (!rectInView(v, r.x, r.y, r.w, r.h)) return;
  const [x, y, ww, hh] = rectPx(v, r);
  ctx.globalAlpha = 0.45;
  ctx.strokeRect(x + 0.5, y + 0.5, ww - 1, hh - 1);
  if (ctx.measureText(text).width + 8 > hh || size + 4 > ww) return;
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = INK_2;
  ctx.save();
  ctx.translate(x + ww / 2, y + hh / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

/** Each island with no platform opened yet (so none painted), as one dashed outline naming its pair. */
function drawFutureIslands(ctx: CanvasRenderingContext2D, w: World, v: View): void {
  ctx.save();
  const size = futureStyle(ctx, v);
  for (const isl of w.map.islands) {
    if (2 * isl.id - 1 <= w.platformsAdded) continue;
    drawFutureOutline(ctx, v, union(isl.leftTrack, isl.rightTrack), futurePairLabel(isl.id), size);
  }
  ctx.restore();
}

/**
 * The unopened partner on an island already painted: its track and half as a dashed outline. Drawn
 * with the dynamic layer, since opening it changes no tiles.
 */
function drawFuturePartners(ctx: CanvasRenderingContext2D, w: World, v: View): void {
  ctx.save();
  const size = futureStyle(ctx, v);
  for (const slot of w.map.slots.slice(w.platformsAdded)) {
    if (2 * slot.island - 1 > w.platformsAdded) continue;
    drawFutureOutline(ctx, v, union(slot.track, slot.platform), `Future platform ${slot.id}`, size);
  }
  ctx.restore();
}

function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
}

/** Retail units (teal outline), toilets (dark outline and "WC") and seating (bench strokes). */
function drawFacilityBodies(ctx: CanvasRenderingContext2D, w: World, v: View): void {
  for (const f of w.facilities.values()) {
    if (!rectInView(v, f.rect.x, f.rect.y, f.rect.w, f.rect.h)) continue;
    const [x, y, ww, hh] = rectPx(v, f.rect);
    const ins = Math.max(1.5, 0.12 * v.s);
    if (f.kind === FacilityKind.Seating) {
      drawBenches(ctx, f, v);
      continue;
    }
    roundRect(ctx, x + ins, y + ins, ww - 2 * ins, hh - 2 * ins, 0.35 * v.s);
    ctx.fillStyle = FLOOR;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = f.kind === FacilityKind.Retail ? SQUARE : WALL;
    ctx.stroke();
    if (f.kind === FacilityKind.Toilet) {
      const size = clamp(0.8 * v.s, 8, 16);
      ctx.font = uiFont(size, 700);
      if (ctx.measureText("WC").width + 6 <= ww) {
        ctx.fillStyle = INK;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("WC", x + ww / 2, y + hh / 2);
      }
    }
  }
}

function drawBenches(ctx: CanvasRenderingContext2D, f: Facility, v: View): void {
  const r = f.rect;
  const across = r.w >= r.h;
  const p = new Path2D();
  const rows = across ? r.h : r.w;
  for (let k = 0; k < rows; k++) {
    if (across) {
      const Y = sy(v, r.y + k + 0.5);
      p.moveTo(sx(v, r.x + 0.25), Y);
      p.lineTo(sx(v, r.x + r.w - 0.25), Y);
    } else {
      const X = sx(v, r.x + k + 0.5);
      p.moveTo(X, sy(v, r.y + 0.25));
      p.lineTo(X, sy(v, r.y + r.h - 0.25));
    }
  }
  ctx.lineCap = "round";
  ctx.strokeStyle = WALL;
  ctx.lineWidth = Math.max(2, 0.22 * v.s);
  ctx.stroke(p);
  // The seat back: a thin line along one side of each bench.
  ctx.lineWidth = Math.max(1, 0.08 * v.s);
  ctx.strokeStyle = INK_2;
  const back = new Path2D();
  for (let k = 0; k < rows; k++) {
    if (across) {
      const Y = sy(v, r.y + k + 0.18);
      back.moveTo(sx(v, r.x + 0.25), Y);
      back.lineTo(sx(v, r.x + r.w - 0.25), Y);
    } else {
      const X = sx(v, r.x + k + 0.18);
      back.moveTo(X, sy(v, r.y + 0.25));
      back.lineTo(X, sy(v, r.y + r.h - 0.25));
    }
  }
  ctx.stroke(back);
}

const DIR_V: Record<Exclude<Dir, Dir.None>, [number, number]> = {
  [Dir.N]: [0, -1],
  [Dir.E]: [1, 0],
  [Dir.S]: [0, 1],
  [Dir.W]: [-1, 0],
};

/** Each travelator (tiles sharing an owner) as a bounding rect and its direction. */
function travelators(g: Grid, v: View): { rect: Rect; dir: Dir }[] {
  const byOwner = new Map<number, { x0: number; y0: number; x1: number; y1: number; dir: Dir }>();
  const out: { rect: Rect; dir: Dir }[] = [];
  for (let y = v.y0; y < v.y1; y++) {
    for (let x = v.x0; x < v.x1; x++) {
      const i = y * g.w + x;
      if (g.zones[i] !== Zone.Travelator) continue;
      const owner = g.zoneOwner[i]!;
      const dir = g.dir[i]! as Dir;
      if (owner < 0) {
        out.push({ rect: { x, y, w: 1, h: 1 }, dir });
        continue;
      }
      const b = byOwner.get(owner);
      if (!b) byOwner.set(owner, { x0: x, y0: y, x1: x + 1, y1: y + 1, dir });
      else {
        b.x0 = Math.min(b.x0, x);
        b.y0 = Math.min(b.y0, y);
        b.x1 = Math.max(b.x1, x + 1);
        b.y1 = Math.max(b.y1, y + 1);
      }
    }
  }
  for (const b of byOwner.values()) out.push({ rect: { x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 }, dir: b.dir });
  return out;
}

/** Tread lines between two dark sides, with chevrons pointing the way it runs. */
function drawTravelators(ctx: CanvasRenderingContext2D, g: Grid, v: View): void {
  for (const { rect: r, dir } of travelators(g, v)) {
    const [x, y, ww, hh] = rectPx(v, r);
    const alongX = dir === Dir.E || dir === Dir.W || (dir === Dir.None && r.w > r.h);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, ww, hh);
    ctx.clip();
    const treads = new Path2D();
    const step = Math.max(3, 0.32 * v.s);
    if (alongX) for (let t = x + step / 2; t < x + ww; t += step) (treads.moveTo(t, y), treads.lineTo(t, y + hh));
    else for (let t = y + step / 2; t < y + hh; t += step) (treads.moveTo(x, t), treads.lineTo(x + ww, t));
    ctx.strokeStyle = TRACK;
    ctx.lineWidth = Math.max(1, 0.12 * v.s);
    ctx.lineCap = "butt";
    ctx.stroke(treads);
    ctx.restore();

    const sides = new Path2D();
    const side = Math.max(2, 0.2 * v.s);
    if (alongX) {
      sides.moveTo(x, y + side / 2);
      sides.lineTo(x + ww, y + side / 2);
      sides.moveTo(x, y + hh - side / 2);
      sides.lineTo(x + ww, y + hh - side / 2);
    } else {
      sides.moveTo(x + side / 2, y);
      sides.lineTo(x + side / 2, y + hh);
      sides.moveTo(x + ww - side / 2, y);
      sides.lineTo(x + ww - side / 2, y + hh);
    }
    ctx.strokeStyle = WALL;
    ctx.lineWidth = side;
    ctx.stroke(sides);

    if (dir === Dir.None) continue;
    const [dx, dy] = DIR_V[dir];
    const len = alongX ? r.w : r.h;
    const chev = new Path2D();
    const c = 0.22 * v.s;
    for (let t = 1; t < len; t += 2) {
      const cxw = alongX ? r.x + t + (len % 2 === 0 ? 0 : 0.5) : r.x + r.w / 2;
      const cyw = alongX ? r.y + r.h / 2 : r.y + t + (len % 2 === 0 ? 0 : 0.5);
      const X = sx(v, cxw);
      const Y = sy(v, cyw);
      // A ">" pointing along (dx, dy).
      chev.moveTo(X - dx * c - dy * c, Y - dy * c - dx * c);
      chev.lineTo(X + dx * c, Y + dy * c);
      chev.moveTo(X - dx * c + dy * c, Y - dy * c + dx * c);
      chev.lineTo(X + dx * c, Y + dy * c);
    }
    ctx.strokeStyle = WALL;
    ctx.lineWidth = Math.max(1.5, 0.12 * v.s);
    ctx.lineCap = "round";
    ctx.stroke(chev);
  }
}

/** 4px walls wherever the inside of the station meets the outside, merged into straight runs. */
function drawEdges(ctx: CanvasRenderingContext2D, g: Grid, v: View): void {
  const p = new Path2D();
  const edge = (a: Side, b: Side): boolean => (a === Side.In && b === Side.Out) || (a === Side.Out && b === Side.In);
  // Horizontal edges along the top of row y.
  for (let y = v.y0; y <= v.y1; y++) {
    let start = -1;
    for (let x = v.x0; x <= v.x1; x++) {
      const on = x < v.x1 && edge(sideOf(g, x, y - 1), sideOf(g, x, y));
      if (on && start < 0) start = x;
      if (!on && start >= 0) {
        p.moveTo(sx(v, start), sy(v, y));
        p.lineTo(sx(v, x), sy(v, y));
        start = -1;
      }
    }
  }
  // Vertical edges along the left of column x.
  for (let x = v.x0; x <= v.x1; x++) {
    let start = -1;
    for (let y = v.y0; y <= v.y1; y++) {
      const on = y < v.y1 && edge(sideOf(g, x - 1, y), sideOf(g, x, y));
      if (on && start < 0) start = y;
      if (!on && start >= 0) {
        p.moveTo(sx(v, x), sy(v, start));
        p.lineTo(sx(v, x), sy(v, y));
        start = -1;
      }
    }
  }
  ctx.strokeStyle = WALL;
  ctx.lineWidth = lw(v, 4, 2);
  ctx.lineCap = "square";
  ctx.stroke(p);
}

/** Centre-to-centre strokes joining each matching tile to its east and south neighbours; a lone tile gets a short stub. */
function linkTiles(g: Grid, v: View, t: Tile, stub: number): Path2D {
  const p = new Path2D();
  const is = (x: number, y: number): boolean => g.inBounds(x, y) && g.tile(x, y) === t;
  for (let y = v.y0; y < v.y1; y++) {
    for (let x = v.x0; x < v.x1; x++) {
      if (!is(x, y)) continue;
      const X = sx(v, x + 0.5);
      const Y = sy(v, y + 0.5);
      const e = is(x + 1, y);
      const s = is(x, y + 1);
      if (e) (p.moveTo(X, Y), p.lineTo(sx(v, x + 1.5), Y));
      if (s) (p.moveTo(X, Y), p.lineTo(X, sy(v, y + 1.5)));
      if (!e && !s && !is(x - 1, y) && !is(x, y - 1)) (p.moveTo(X - stub * v.s, Y), p.lineTo(X + stub * v.s, Y));
    }
  }
  return p;
}

/** Placed walls: thick dark bars. */
function drawWallTiles(ctx: CanvasRenderingContext2D, g: Grid, v: View): void {
  ctx.strokeStyle = WALL;
  ctx.lineWidth = lw(v, 8, 3);
  ctx.lineCap = "round";
  ctx.stroke(linkTiles(g, v, Tile.Wall, 0.3));
}

/** Rails: a dotted line. */
function drawRails(ctx: CanvasRenderingContext2D, g: Grid, v: View): void {
  const width = lw(v, 4, 2);
  ctx.save();
  ctx.strokeStyle = WALL;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.setLineDash([0, width * 2]);
  ctx.stroke(linkTiles(g, v, Tile.Rail, 0.01));
  ctx.restore();
}

/** A pill outside each entrance: "Entrance A · Harbour Road". */
function drawEntrances(ctx: CanvasRenderingContext2D, w: World, v: View): void {
  const g = w.grid;
  const size = 12;
  const h = 26;
  for (const e of w.map.entrances) {
    const r = e.tiles;
    const runs: Run[] = [{ text: `Entrance ${e.id}`, strong: true }, { text: " · ", muted: true }, { text: e.name }];
    const tw = runsWidth(ctx, runs, size) + 24;
    let cx: number;
    let cy: number;
    if (r.x === 0 || r.x + r.w === g.w) {
      // On a side of the map: just outside it, level with the opening.
      cx = r.x === 0 ? sx(v, 0) - 0.6 * v.s - tw / 2 : sx(v, g.w) + 0.6 * v.s + tw / 2;
      cy = sy(v, r.y + r.h / 2);
    } else {
      const outBelow = sideOf(g, r.x, r.y + r.h) !== Side.In;
      const gap = 0.6 * v.s + h / 2;
      cx = sx(v, r.x + r.w / 2);
      cy = outBelow ? sy(v, r.y + r.h) + gap : sy(v, r.y) - gap;
    }
    if (cx + tw / 2 < 0 || cx - tw / 2 > v.cssW || cy + h < 0 || cy - h > v.cssH) continue;
    roundRect(ctx, cx - tw / 2, cy - h / 2, tw, h, h / 2);
    ctx.fillStyle = FLOOR;
    ctx.fill();
    ctx.strokeStyle = WALL;
    ctx.lineWidth = 2;
    ctx.stroke();
    drawRuns(ctx, runs, cx - tw / 2 + 12, cy, size);
  }
}

/**
 * The parts of the plan that change without the grid: closed platforms dimmed, the unopened half
 * of a painted island, platform labels,
 * retail tenants and countdowns, and signs (they re-point as tenants come and go).
 */
export function drawPlanDynamic(ctx: CanvasRenderingContext2D, w: World, v: View): void {
  drawClosedPlatforms(ctx, w, v);
  drawFuturePartners(ctx, w, v);
  drawPlatformLabels(ctx, w, v);
  drawRetailLabels(ctx, w, v);
  drawSigns(ctx, w, v);
}

function isClosed(w: World, id: number): boolean {
  return !w.platformActive[id - 1] || w.disruptions.some((d) => !d.ended && d.platforms.includes(id));
}

/** A closed platform (and its track) shows through at CLOSED_OPACITY: a ground veil over the rest. */
function drawClosedPlatforms(ctx: CanvasRenderingContext2D, w: World, v: View): void {
  ctx.fillStyle = GROUND;
  ctx.globalAlpha = 1 - CLOSED_OPACITY;
  for (const slot of w.map.slots.slice(0, w.platformsAdded)) {
    if (!isClosed(w, slot.id)) continue;
    const r = union(slot.track, slot.platform);
    if (!rectInView(v, r.x, r.y, r.w, r.h)) continue;
    const [x, y, ww, hh] = rectPx(v, r);
    // Inset past the half of a boundary wall that lies inside, so the walls keep their full ink.
    const inset = lw(v, 4, 2) / 2;
    ctx.fillRect(x + inset, y + inset, ww - 2 * inset, hh - 2 * inset);
  }
  ctx.globalAlpha = 1;
}

/** Each platform's label, reading up the platform from its concourse end, after a marker of its line. */
function drawPlatformLabels(ctx: CanvasRenderingContext2D, w: World, v: View): void {
  const size = clamp(13 * v.cam.zoom, 10, 15);
  for (const slot of w.map.slots.slice(0, w.platformsAdded)) {
    const r = slot.platform;
    if (!rectInView(v, r.x, r.y, r.w, r.h)) continue;
    const [x, y, ww, hh] = rectPx(v, r);
    if (ww < size + 2) continue;
    const marker = size * 0.4;
    const start = 0.5 * v.s;
    const room = hh - start - marker * 2 - size * 0.5 - 4;
    const runs = platformLabelVariants(w, slot.id).find((r) => runsWidth(ctx, r, size) <= room);
    if (!runs) continue;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, ww, hh);
    ctx.clip();
    ctx.translate(x + ww / 2, y + hh - start);
    ctx.rotate(-Math.PI / 2);
    ctx.globalAlpha = isClosed(w, slot.id) ? 0.85 : 1;
    ctx.beginPath();
    ctx.arc(marker, 0, marker, 0, Math.PI * 2);
    ctx.fillStyle = CIRCLE;
    ctx.fill();
    drawRuns(ctx, runs, marker * 2 + size * 0.5, 0, size);
    ctx.restore();
  }
}

/** The smallest a retail label is drawn (CSS px). */
const RETAIL_MIN_FONT_PX = 11;

/** A teal marker and the tenant's name (or the to-let countdown), wrapped onto lines as the unit allows. */
function drawRetailLabels(ctx: CanvasRenderingContext2D, w: World, v: View): void {
  // Never below RETAIL_MIN_FONT_PX: a unit too small on screen for that keeps only its marker.
  const size = clamp(12 * v.cam.zoom, RETAIL_MIN_FONT_PX, 14);
  const lh = size * 1.3;
  const mark = size * 0.7;
  for (const f of w.facilities.values()) {
    if (f.kind !== FacilityKind.Retail || !rectInView(v, f.rect.x, f.rect.y, f.rect.w, f.rect.h)) continue;
    const [x, y, ww, hh] = rectPx(v, f.rect);
    const runs = retailLabel(f, w.minute);
    const room = ww - Math.max(1.5, 0.12 * v.s) * 2 - 8;
    const lines = splitRuns(ctx, runs, size, room);
    if (lines !== null && lines.length * lh + size <= hh - 6) {
      const top = y + hh / 2 - ((lines.length * lh + mark + 3) / 2);
      ctx.fillStyle = SQUARE;
      ctx.fillRect(x + ww / 2 - mark / 2, top, mark, mark);
      lines.forEach((line, i) => {
        const lwid = runsWidth(ctx, line, size);
        drawRuns(ctx, line, x + ww / 2 - lwid / 2, top + mark + 3 + lh * (i + 0.5), size);
      });
    } else {
      const dot = clamp(0.5 * v.s, 4, 10);
      ctx.fillStyle = SQUARE;
      ctx.fillRect(x + ww / 2 - dot / 2, y + hh / 2 - dot / 2, dot, dot);
    }
  }
}

/** The runs on one line if they fit, else broken at their " · " separators, else at spaces in a lone run; null if no fit. */
function splitRuns(ctx: CanvasRenderingContext2D, runs: readonly Run[], size: number, maxW: number): Run[][] | null {
  if (runsWidth(ctx, runs, size) <= maxW) return [[...runs]];
  const lines: Run[][] = [[]];
  for (const r of runs) {
    if (r.text === " · ") lines.push([]);
    else lines[lines.length - 1]!.push(r);
  }
  if (lines.length > 1) return lines.every((l) => runsWidth(ctx, l, size) <= maxW) ? lines : null;
  const only = runs[0];
  if (runs.length !== 1 || !only) return null;
  ctx.font = uiFont(size, only.strong ? 600 : 400);
  const words = wrapWords(ctx, only.text, maxW);
  return words ? words.map((t) => [{ ...only, text: t }]) : null;
}

/** A dark rounded square with an arrow towards the facility it names (a bar when it names none). */
function drawSigns(ctx: CanvasRenderingContext2D, w: World, v: View): void {
  const g = w.grid;
  const size = Math.max(14, 1.25 * v.s);
  for (const s of w.signs) {
    const [tx, ty] = g.xy(s.tile);
    if (!rectInView(v, tx - 1, ty - 1, 3, 3)) continue;
    const X = sx(v, tx + 0.5);
    const Y = sy(v, ty + 0.5);
    roundRect(ctx, X - size / 2, Y - size / 2, size, size, size * 0.2);
    ctx.fillStyle = WALL;
    ctx.fill();
    const target = w.facilities.get(s.pointsTo);
    const a = size * 0.3;
    ctx.save();
    ctx.translate(X, Y);
    ctx.strokeStyle = FLOOR;
    ctx.lineWidth = Math.max(1.5, size * 0.11);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    if (target) {
      const fx = target.rect.x + target.rect.w / 2 - (tx + 0.5);
      const fy = target.rect.y + target.rect.h / 2 - (ty + 0.5);
      ctx.rotate(Math.atan2(fy, fx));
      ctx.moveTo(-a, 0);
      ctx.lineTo(a, 0);
      ctx.moveTo(a * 0.2, -a * 0.8);
      ctx.lineTo(a, 0);
      ctx.lineTo(a * 0.2, a * 0.8);
    } else {
      ctx.moveTo(-a * 0.6, 0);
      ctx.lineTo(a * 0.6, 0);
    }
    ctx.stroke();
    ctx.restore();
  }
}
