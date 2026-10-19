import type { Camera } from "./camera";

/**
 * One frame's drawing context: the camera (world tiles to CSS px), the device pixel ratio the
 * canvas backing store uses, the view's CSS size and the tiles it shows (clamped to the grid,
 * x1 / y1 exclusive). Draw modules work in CSS px on a context scaled by dpr.
 */
export interface View {
  cam: Camera;
  dpr: number;
  cssW: number;
  cssH: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** CSS px per tile. */
  s: number;
  /** Screen position of world (0, 0). */
  ox: number;
  oy: number;
}

export function makeView(cam: Camera, dpr: number, cssW: number, cssH: number, gridW: number, gridH: number): View {
  const [wx0, wy0] = cam.screenToWorld(0, 0);
  const [wx1, wy1] = cam.screenToWorld(cssW, cssH);
  const [ox, oy] = cam.worldToScreen(0, 0);
  return {
    cam,
    dpr,
    cssW,
    cssH,
    x0: Math.max(0, Math.floor(wx0) - 1),
    y0: Math.max(0, Math.floor(wy0) - 1),
    x1: Math.min(gridW, Math.ceil(wx1) + 1),
    y1: Math.min(gridH, Math.ceil(wy1) + 1),
    s: cam.scale,
    ox,
    oy,
  };
}

/** Screen x / y (CSS px) of world tile coordinate. */
export function sx(v: View, tx: number): number {
  return v.ox + tx * v.s;
}
export function sy(v: View, ty: number): number {
  return v.oy + ty * v.s;
}

/** Rounds a CSS px coordinate to the nearest device pixel, so abutting fills leave no seams. */
export function snap(v: View, px: number): number {
  return Math.round(px * v.dpr) / v.dpr;
}

/** True if the world rect is at least partly in view. */
export function rectInView(v: View, x: number, y: number, w: number, h: number): boolean {
  return x < v.x1 && y < v.y1 && x + w > v.x0 && y + h > v.y0;
}
