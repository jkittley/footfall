import { TILE_PX } from "../sim/constants";

// Low enough to see most of the city at once.
export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 3;
/** Zoom factor per pixel of wheel deltaY. */
const WHEEL_RATE = 0.0015;

/**
 * Maps world tiles to CSS pixels: `x`, `y` are the world tile at the view's top-left corner and
 * zoom 1 is TILE_PX CSS px per tile. Device pixels are the canvas's concern, not the camera's.
 * Once given bounds and a viewport, every move keeps the view on the map (within MARGIN_TILES,
 * plus the screen insets the HUD covers), centring the map on any axis it does not fill.
 */
export class Camera {
  static readonly MARGIN_TILES = 4;
  x = 0;
  y = 0;
  zoom = 1;
  /** View size in CSS px. */
  viewW = 0;
  viewH = 0;
  /** Map size in tiles; 0 leaves the camera unbounded. */
  mapW = 0;
  mapH = 0;
  /** Screen edges (CSS px) covered by the HUD, which the map may be panned out from under. */
  insets = { left: 0, top: 0, right: 0, bottom: 0 };

  /** CSS px per tile. */
  get scale(): number {
    return TILE_PX * this.zoom;
  }

  worldToScreen(wx: number, wy: number): [number, number] {
    const s = this.scale;
    return [(wx - this.x) * s, (wy - this.y) * s];
  }

  screenToWorld(sx: number, sy: number): [number, number] {
    const s = this.scale;
    return [sx / s + this.x, sy / s + this.y];
  }

  setViewport(w: number, h: number): void {
    this.viewW = w;
    this.viewH = h;
    this.clamp();
  }

  setBounds(mapW: number, mapH: number): void {
    this.mapW = mapW;
    this.mapH = mapH;
    this.clamp();
  }

  setInsets(left: number, top: number, right: number, bottom: number): void {
    this.insets = { left, top, right, bottom };
    this.clamp();
  }

  /**
   * Shows the world rect (plus `pad` tiles round it) as large as fits in the view inside the
   * insets, zoom held to minZoom..maxZoom, its centre on the centre of that free area. False if
   * it did not all fit (minZoom was too close).
   */
  frame(r: { x: number; y: number; w: number; h: number }, pad: number, minZoom: number, maxZoom: number): boolean {
    if (this.viewW <= 0) return false;
    const { left, top, right, bottom } = this.insets;
    const freeW = Math.max(1, this.viewW - left - right);
    const freeH = Math.max(1, this.viewH - top - bottom);
    const fit = Math.min(freeW / ((r.w + 2 * pad) * TILE_PX), freeH / ((r.h + 2 * pad) * TILE_PX));
    const lo = Math.max(MIN_ZOOM, minZoom);
    const hi = Math.min(MAX_ZOOM, maxZoom);
    this.zoom = Math.min(hi, Math.max(lo, fit));
    this.x = r.x + r.w / 2 - (left + freeW / 2) / this.scale;
    this.y = r.y + r.h / 2 - (top + freeH / 2) / this.scale;
    this.clamp();
    return fit >= this.zoom;
  }

  /** Drags the world by (dx, dy) CSS px. */
  pan(dx: number, dy: number): void {
    this.x -= dx / this.scale;
    this.y -= dy / this.scale;
    this.clamp();
  }

  /** Zooms by `factor` (clamped to MIN_ZOOM..MAX_ZOOM) about the screen point (sx, sy). */
  zoomAt(sx: number, sy: number, factor: number): void {
    const [wx, wy] = this.screenToWorld(sx, sy);
    this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom * factor));
    this.x = wx - sx / this.scale;
    this.y = wy - sy / this.scale;
    this.clamp();
  }

  /** A wheel event's deltaY at the cursor: scrolling up zooms in. */
  wheel(sx: number, sy: number, deltaY: number): void {
    this.zoomAt(sx, sy, Math.exp(-deltaY * WHEEL_RATE));
  }

  /** The largest zoom that shows the whole map, centred. */
  fit(): void {
    if (this.mapW <= 0 || this.viewW <= 0) return;
    const z = Math.min(this.viewW / (this.mapW * TILE_PX), this.viewH / (this.mapH * TILE_PX));
    this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
    this.x = this.mapW / 2 - this.viewW / this.scale / 2;
    this.y = this.mapH / 2 - this.viewH / this.scale / 2;
    this.clamp();
  }

  private clamp(): void {
    if (this.mapW <= 0 || this.viewW <= 0) return;
    const s = this.scale;
    const { left, top, right, bottom } = this.insets;
    this.x = clampAxis(this.x, this.viewW / s, this.mapW, left / s, right / s);
    this.y = clampAxis(this.y, this.viewH / s, this.mapH, top / s, bottom / s);
  }
}

/** The view's start on one axis, kept so the map (with its margin, and room to clear the insets) stays in view. */
function clampAxis(at: number, view: number, size: number, padLo: number, padHi: number): number {
  const m = Camera.MARGIN_TILES;
  const lo = -m - padLo;
  const hi = size + m + padHi - view;
  if (hi <= lo) return (size - view + padHi - padLo) / 2;
  return Math.min(hi, Math.max(lo, at));
}
