import { Mode } from "../sim/people";

const CIRCLE_R = 5;
const CIRCLE_SEGMENTS = 16;

export type Pt = readonly [number, number];

export const POLYS: Record<Mode, readonly Pt[]> = {
  [Mode.Train]: Array.from({ length: CIRCLE_SEGMENTS }, (_, k): Pt => [
    CIRCLE_R * Math.cos((k * 2 * Math.PI) / CIRCLE_SEGMENTS),
    CIRCLE_R * Math.sin((k * 2 * Math.PI) / CIRCLE_SEGMENTS),
  ]),
  [Mode.Subway]: [[0, -5.5], [6, 5.5], [-6, 5.5]],
  [Mode.Flight]: [0, 1, 2, 3, 4, 5].map((k): Pt => [6 * Math.cos((k * Math.PI) / 3), 6 * Math.sin((k * Math.PI) / 3)]),
  [Mode.Street]: [[0, -5.5], [5.5, 0], [0, 5.5], [-5.5, 0]],
};

/** Sutherland-Hodgman clip of a convex polygon to x <= 0. */
export function leftHalf(poly: readonly Pt[]): Pt[] {
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

/** Triangle fan around the origin (every shape is convex and contains it). */
export function fan(poly: readonly Pt[], out: number[]): void {
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k]!;
    const b = poly[(k + 1) % poly.length]!;
    out.push(0, 0, a[0], a[1], b[0], b[1]);
  }
}


/** Outline ring width at zoom 1 (px); it scales with zoom like the shapes do. */
export const RING_PX = 1.5;

/** Convex polygon (containing the origin) with every edge moved inward by `d`, so the ring has constant width. */
export function inset(poly: readonly Pt[], d: number): Pt[] {
  const n = poly.length;
  // Offset line i runs along edge i (poly[i] -> poly[i+1]), moved d towards the origin.
  const lines = poly.map((p, i) => {
    const q = poly[(i + 1) % n]!;
    let dx = q[0] - p[0];
    let dy = q[1] - p[1];
    const len = Math.hypot(dx, dy);
    dx /= len;
    dy /= len;
    let nx = -dy;
    let ny = dx;
    if (nx * -p[0] + ny * -p[1] < 0) {
      nx = -nx;
      ny = -ny;
    }
    return { px: p[0] + nx * d, py: p[1] + ny * d, dx, dy };
  });
  return poly.map((_, i) => {
    const a = lines[(i + n - 1) % n]!;
    const b = lines[i]!;
    const cross = a.dx * b.dy - a.dy * b.dx;
    const t = ((b.px - a.px) * b.dy - (b.py - a.py) * b.dx) / cross;
    return [a.px + a.dx * t, a.py + a.dy * t] as Pt;
  });
}
