import { Grid, Tile, type Rect } from "../grid";

export type Point = [number, number];

/**
 * One feature of the city, in tile coordinates. Water, parks and locked areas are closed outlines,
 * roads centre-lines with a width, pavements straight-sided outlines. Outlines and centre-lines are
 * smoothed (see smoothPath) except pavements; a point given twice in a row is a sharp corner.
 */
export interface CityShape {
  kind: "water" | "park" | "road" | "pavement" | "locked";
  name?: string;
  points: Point[];
  /** Roads: carriageway width in tiles. */
  width?: number;
  /** Locked: the line saying when it opens. */
  area?: string;
  /** Where its name is written (tile coordinates) and at what angle (radians); unnamed on the map if absent. */
  label?: { at: Point; angle?: number };
}

export interface City {
  w: number;
  h: number;
  shapes: CityShape[];
  station: {
    origin: Point;
    /** The station's own ground: the only place floor may be built. */
    grounds: Rect;
  };
  /** The subway, dug under the station later: drawn as a dashed outline and its tunnels. */
  subway: { outline: Point[]; tunnels: Point[][]; name: string; area: string };
  /** The four main lines north of the rail throat (decoration). */
  railLines: Point[][];
  /** Names written on the water beyond its own shape's name. */
  waterNames: { name: string; at: Point; angle?: number }[];
}

function rounded(x: number, y: number, w: number, h: number, r: number): Point[] {
  const x1 = x + w;
  const y1 = y + h;
  return [
    [x + r, y], [x + r, y], [x1 - r, y], [x1 - r, y], [x1, y],
    [x1, y + r], [x1, y + r], [x1, y1 - r], [x1, y1 - r], [x1, y1],
    [x1 - r, y1], [x1 - r, y1], [x + r, y1], [x + r, y1], [x, y1],
    [x, y1 - r], [x, y1 - r], [x, y + r], [x, y + r], [x, y],
  ];
}

function box(x: number, y: number, w: number, h: number): Point[] {
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
}

function ellipse(cx: number, cy: number, rx: number, ry: number, n = 24): Point[] {
  return Array.from({ length: n }, (_, k): Point => [cx + rx * Math.cos((2 * Math.PI * k) / n), cy + ry * Math.sin((2 * Math.PI * k) / n)]);
}

const STATION_ORIGIN: Point = [140, 100];

/**
 * The city at tile scale, after docs/design/city-layout.html (about 3 mockup px per tile, the east
 * bank drawn in closer): the Ashby River down the east side bending in to the station, parks, roads,
 * the footbridge and road bridge, and every later stage's site, locked until it opens.
 */
export const CITY: City = {
  w: 500,
  h: 320,
  station: { origin: STATION_ORIGIN, grounds: { x: STATION_ORIGIN[0], y: STATION_ORIGIN[1], w: 120, h: 90 } },
  shapes: [
    {
      kind: "water",
      name: "Ashby River",
      label: { at: [291, 46], angle: Math.PI / 2 },
      points: [
        [276, 0], [276, 0], [280, 30], [274, 60], [258, 84], [242, 96],
        // The bend against the station's east side: straight banks, so its narrow neck and the
        // footbridge landing are exact.
        [236, 110], [236, 110], [236, 156], [236, 156], [242, 156], [242, 156], [242, 153], [242, 153],
        [264, 153], [264, 153], [264, 178],
        [266, 195], [272, 212], [286, 232], [296, 250], [292, 268], [270, 284], [240, 298], [205, 312], [190, 320], [190, 320],
        [500, 320], [500, 320], [500, 298], [500, 298],
        [452, 296], [405, 290], [368, 282], [342, 268], [326, 248], [316, 222], [312, 200], [310, 186],
        [306, 160], [302, 130], [304, 100], [310, 70], [312, 40], [306, 0], [306, 0],
      ],
    },
    {
      kind: "park",
      name: "St Mary's churchyard",
      label: { at: [62, 160] },
      points: [[22, 124], [60, 114], [96, 120], [108, 140], [102, 166], [74, 176], [36, 172], [18, 150]],
    },
    {
      kind: "park",
      name: "Riverside Gardens",
      label: { at: [242, 171], angle: -Math.PI / 2 },
      points: [[236, 160], [236, 160], [256, 160], [262, 163], [263, 170], [262, 178], [256, 182], [236, 182], [236, 182]],
    },
    {
      kind: "park",
      name: "Harbour Park",
      label: { at: [168, 300] },
      points: [[140, 266], [176, 260], [198, 270], [200, 290], [186, 306], [176, 320], [176, 320], [138, 320], [138, 320], [134, 292]],
    },
    {
      kind: "park",
      points: [[348, 212], [395, 206], [436, 212], [444, 240], [440, 276], [410, 292], [370, 292], [344, 278], [338, 245]],
    },
    {
      kind: "road",
      name: "Harbour Road",
      label: { at: [60, 185.5] },
      width: 7,
      points: [[0, 185.5], [238, 185.5], [254, 187], [264, 196], [274, 205.5], [312, 205.5]],
    },
    {
      kind: "road",
      name: "Quay Lane",
      label: { at: [420, 186.5] },
      width: 7,
      points: [[312, 205.5], [330, 198], [350, 188], [372, 186.5], [500, 186.5]],
    },
    { kind: "road", name: "Airport Road", label: { at: [323.5, 70], angle: Math.PI / 2 }, width: 7, points: [[346, 189], [330, 178], [323.5, 160], [323.5, 0]] },
    { kind: "road", name: "Market Street", label: { at: [128.5, 130], angle: Math.PI / 2 }, width: 7, points: [[128.5, 76], [128.5, 320]] },
    { kind: "road", name: "Exhibition Way", label: { at: [100, 78.5] }, width: 5, points: [[70, 78.5], [128.5, 78.5]] },
    { kind: "road", width: 5, points: [[66.5, 186], [66.5, 200]] },
    { kind: "road", width: 5, points: [[468.5, 187], [468.5, 212]] },
    // Pavements from the roads to Entrances A and B, and the footbridge from Entrance C.
    { kind: "pavement", points: box(149, 180, 4, 2) },
    { kind: "pavement", points: box(132, 155, 8, 3) },
    { kind: "pavement", name: "Footbridge", points: box(260, 155, 72, 4) },
    { kind: "locked", name: "Airport", area: "Opens at 18 + 6", points: rounded(332, 16, 140, 164, 6) },
    { kind: "locked", name: "Exhibition centre", area: "Opens at 24 gates", points: rounded(14, 8, 104, 62, 5) },
    { kind: "locked", name: "Exhibition car park", area: "Opens at 24 gates", points: rounded(14, 84, 70, 28, 4) },
    { kind: "locked", name: "Shopping mall", area: "Opens at 36 gates", points: rounded(24, 200, 82, 56, 5) },
    { kind: "locked", name: "Bus depot", area: "Opens at 6 platforms", points: rounded(140, 196, 80, 48, 5) },
    { kind: "locked", name: "Stadium", area: "Opens at 48 gates", points: ellipse(398, 246, 40, 28) },
    { kind: "locked", name: "Stadium car park", area: "Opens at 48 gates", points: rounded(446, 212, 46, 74, 4) },
  ],
  subway: {
    name: "Subway (below)",
    area: "Opens at 10 platforms",
    outline: rounded(157, 141, 86, 38, 4),
    tunnels: [
      [[243, 160], [290, 150], [332, 140]],
      [[236, 179], [290, 220], [358, 240]],
    ],
  },
  waterNames: [{ name: "Harbour Mouth", at: [420, 309] }],
  railLines: [
    [[170, 62], [166, 30], [160, 0]],
    [[185, 62], [184, 30], [182, 0]],
    [[200, 62], [204, 30], [208, 0]],
    [[215, 62], [224, 30], [232, 0]],
  ],
};

const CURVE_STEPS = 8;

function mid(a: Point, b: Point): Point {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

/** One smooth path's pieces: a start, then quadratic curves (control, end). Straight runs have the control on the line. */
export interface SmoothPath {
  start: Point;
  curves: [Point, Point][];
}

/**
 * Rounds a polyline through the midpoints of its edges, each original point the control of a
 * quadratic curve; a point repeated is a sharp corner, and points on a line stay a straight run.
 * Open paths start and end at their first and last points.
 */
export function smoothPath(points: readonly Point[], closed: boolean): SmoothPath {
  const n = points.length;
  if (n < 3) return { start: points[0] ?? [0, 0], curves: n === 2 ? [[points[0]!, points[1]!]] : [] };
  if (!closed) {
    const curves: [Point, Point][] = [[points[0]!, mid(points[0]!, points[1]!)]];
    for (let i = 1; i < n - 1; i++) curves.push([points[i]!, mid(points[i]!, points[i + 1]!)]);
    curves.push([points[n - 1]!, points[n - 1]!]);
    return { start: points[0]!, curves };
  }
  const curves: [Point, Point][] = [];
  for (let i = 0; i < n; i++) curves.push([points[i]!, mid(points[i]!, points[(i + 1) % n]!)]);
  return { start: mid(points[n - 1]!, points[0]!), curves };
}

/** The smoothed path as a polyline, each curve cut into CURVE_STEPS straight pieces. */
export function flatten(path: SmoothPath): Point[] {
  const out: Point[] = [path.start];
  let p0 = path.start;
  for (const [c, p1] of path.curves) {
    for (let k = 1; k <= CURVE_STEPS; k++) {
      const t = k / CURVE_STEPS;
      const u = 1 - t;
      out.push([u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]]);
    }
    p0 = p1;
  }
  return out;
}

/** A shape's outline (or centre-line) as drawn and as rasterised. */
export function shapePath(s: CityShape): SmoothPath {
  if (s.kind === "pavement") {
    const [first, ...rest] = s.points;
    return { start: first!, curves: [...rest, first!].map((p): [Point, Point] => [p, p]) };
  }
  return smoothPath(s.points, s.kind !== "road");
}

function bounds(pts: readonly Point[], pad: number, w: number, h: number): Rect {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  const ax = Math.max(0, Math.floor(x0 - pad));
  const ay = Math.max(0, Math.floor(y0 - pad));
  return { x: ax, y: ay, w: Math.min(w, Math.ceil(x1 + pad) + 1) - ax, h: Math.min(h, Math.ceil(y1 + pad) + 1) - ay };
}

function segDist2(px: number, py: number, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / len2));
  const ex = a[0] + t * dx - px;
  const ey = a[1] + t * dy - py;
  return ex * ex + ey * ey;
}

/** Calls `paint` for every tile whose centre lies inside the outline (even-odd, by scanline). */
function eachInside(g: Grid, outline: readonly Point[], paint: (x: number, y: number) => void): void {
  const b = bounds(outline, 0, g.w, g.h);
  const xs: number[] = [];
  for (let y = b.y; y < b.y + b.h; y++) {
    const cy = y + 0.5;
    xs.length = 0;
    for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
      const [xi, yi] = outline[i]!;
      const [xj, yj] = outline[j]!;
      if (yi > cy !== yj > cy) xs.push(((xj - xi) * (cy - yi)) / (yj - yi) + xi);
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      // Tiles whose centre x + 0.5 lies strictly between the crossings.
      const from = Math.max(0, Math.ceil(xs[k]! - 0.5 + 1e-9));
      const to = Math.min(g.w - 1, Math.ceil(xs[k + 1]! - 0.5) - 1);
      for (let x = from; x <= to; x++) paint(x, y);
    }
  }
}

/** Calls `paint` for every tile whose centre lies within `half` of the line. */
function eachNear(g: Grid, line: readonly Point[], half: number, paint: (x: number, y: number) => void): void {
  const h2 = half * half;
  for (let k = 1; k < line.length; k++) {
    const a = line[k - 1]!;
    const c = line[k]!;
    const b = bounds([a, c], half, g.w, g.h);
    for (let y = b.y; y < b.y + b.h; y++)
      for (let x = b.x; x < b.x + b.w; x++) if (segDist2(x + 0.5, y + 0.5, a, c) <= h2) paint(x, y);
  }
}

const KIND_ORDER: CityShape["kind"][] = ["water", "park", "road", "pavement", "locked"];
const TILE_OF = { water: Tile.Water, park: Tile.Park, pavement: Tile.Pavement, locked: Tile.Locked } as const;

/**
 * The city as tiles: everything Ground, then water, parks, roads, pavements and locked areas
 * painted from the smoothed shapes by tile centre. A road crossing water is a bridge: its
 * carriageway is Road with a tile of Pavement either side. The station is painted over this by
 * buildGrid.
 */
export function rasterise(city: City): Grid {
  let tiles = rasterCache.get(city);
  if (!tiles) {
    tiles = paintCity(city).tiles;
    rasterCache.set(city, tiles);
  }
  const g = new Grid(city.w, city.h);
  g.tiles.set(tiles);
  return g;
}

// The city never changes, so each is painted once; every grid built from it gets a copy.
const rasterCache = new WeakMap<City, Uint8Array>();

function paintCity(city: City): Grid {
  const g = new Grid(city.w, city.h);
  for (const kind of KIND_ORDER) {
    for (const s of city.shapes) {
      if (s.kind !== kind) continue;
      const line = flatten(shapePath(s));
      if (kind === "road") {
        const half = (s.width ?? 1) / 2;
        eachNear(g, line, half + 1, (x, y) => {
          if (g.tile(x, y) === Tile.Water) g.setTile(x, y, Tile.Pavement);
        });
        eachNear(g, line, half, (x, y) => g.setTile(x, y, Tile.Road));
      } else {
        const t = TILE_OF[kind];
        eachInside(g, line, (x, y) => g.setTile(x, y, t));
      }
    }
  }
  return g;
}

let walkAreaCache: Rect | null = null;

/**
 * The bounding box of every tile anyone could ever stand on: the station grounds and the
 * pavements leading off them. Per-step and per-frame work over the grid is bounded to it.
 */
export function walkArea(city: City = CITY): Rect {
  if (city === CITY && walkAreaCache) return walkAreaCache;
  const g = rasterise(city);
  const r = city.station.grounds;
  let x0 = r.x;
  let y0 = r.y;
  let x1 = r.x + r.w;
  let y1 = r.y + r.h;
  for (let i = 0; i < g.tiles.length; i++) {
    if (g.tiles[i] !== Tile.Pavement) continue;
    const x = i % g.w;
    const y = (i - x) / g.w;
    // Bridge pavements off the station's own roads never join it; only the walks that touch matter.
    if (!touchesGroundsPavement(g, r, x, y)) continue;
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x + 1);
    y1 = Math.max(y1, y + 1);
  }
  const out = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  if (city === CITY) walkAreaCache = out;
  return out;
}

/** Pavement tiles joined (through pavement) to a tile beside the grounds. */
const joinedPavement = new WeakMap<Grid, Uint8Array>();
function touchesGroundsPavement(g: Grid, r: Rect, x: number, y: number): boolean {
  let mark = joinedPavement.get(g);
  if (!mark) {
    mark = new Uint8Array(g.w * g.h);
    const queue: number[] = [];
    for (let yy = r.y - 1; yy <= r.y + r.h; yy++) {
      for (let xx = r.x - 1; xx <= r.x + r.w; xx++) {
        if (!g.inBounds(xx, yy) || g.tile(xx, yy) !== Tile.Pavement) continue;
        const i = g.idx(xx, yy);
        if (mark[i]) continue;
        mark[i] = 1;
        queue.push(i);
      }
    }
    for (let h = 0; h < queue.length; h++) {
      const [qx, qy] = g.xy(queue[h]!);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = qx + dx;
        const ny = qy + dy;
        if (!g.inBounds(nx, ny) || g.tile(nx, ny) !== Tile.Pavement) continue;
        const n = g.idx(nx, ny);
        if (mark[n]) continue;
        mark[n] = 1;
        queue.push(n);
      }
    }
    joinedPavement.set(g, mark);
  }
  return mark[g.idx(x, y)] === 1;
}

export function inRect(r: Rect, x: number, y: number): boolean {
  return x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
}
