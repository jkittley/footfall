import type { World } from "../sim/world";
import { Camera } from "./camera";
import { drawCrowding, drawUi, type UiOverlayState } from "./drawOverlays";
import { drawPeople } from "./drawPeople";
import { drawPlanDynamic, drawStatic } from "./drawPlan";
import { drawTrains } from "./drawTrains";
import { JamTracker } from "./jamCells";
import { GROUND } from "./palette";
import { StaticLayerCache, staticLayerKey } from "./staticCache";
import { MONO_FONT, UI_FONT } from "./text";
import { makeView } from "./view";

export type { UiOverlayState };

/** The longest the first plan waits for its fonts (ms). */
const FONT_WAIT_MS = 1500;

export interface RenderStats {
  /** Last frame's whole draw (ms). */
  drawMs: number;
  /** Last static-layer redraw (ms) and how many there have been. */
  staticMs: number;
  staticDraws: number;
}

/**
 * Draws a World onto a canvas sized by CSS (its client size); the backing store follows
 * devicePixelRatio. The camera maps world tiles to CSS px and every draw module works in CSS px on
 * a context scaled by dpr. The plan's static parts are drawn once into an offscreen layer and
 * blitted until the grid object or staticLayerKey (grid version, camera, size, fonts) changes;
 * trains, labels, signs, crowding, people and the UI overlays are drawn over it every frame. Until
 * the label fonts settle (or FONT_WAIT_MS passes) only the ground is painted, so the plan never
 * shows in a fallback face first.
 */
export class Renderer {
  readonly camera = new Camera();
  readonly stats: RenderStats = { drawMs: 0, staticMs: 0, staticDraws: 0 };
  /** Frames the first view (once the canvas has a size, and again after refit()); the whole map if unset. */
  initialFrame: ((cam: Camera, w: World) => void) | null = null;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly layer: HTMLCanvasElement;
  private readonly layerCtx: CanvasRenderingContext2D;
  private readonly jam = new JamTracker();
  private readonly cache = new StaticLayerCache();
  private fonts = 0;
  private fontsSettled = false;
  private fitted = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    this.layer = document.createElement("canvas");
    const layerCtx = this.layer.getContext("2d");
    if (!ctx || !layerCtx) throw new Error("Canvas 2D is not available");
    this.ctx = ctx;
    this.layerCtx = layerCtx;
    const settle = (): void => {
      this.fontsSettled = true;
    };
    setTimeout(settle, FONT_WAIT_MS);
    void loadFonts().then(() => {
      this.fonts++;
      settle();
    });
  }

  draw(w: World, ui: UiOverlayState): void {
    const t0 = performance.now();
    const dpr = window.devicePixelRatio || 1;
    const cssW = this.canvas.clientWidth;
    const cssH = this.canvas.clientHeight;
    this.fitTo(w, cssW, cssH, dpr);
    const cam = this.camera;
    const v = makeView(cam, dpr, cssW, cssH, w.grid.w, w.grid.h);
    const ctx = this.ctx;
    if (!this.fontsSettled) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = GROUND;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      return;
    }

    const key = staticLayerKey({
      version: w.grid.version,
      x: cam.x,
      y: cam.y,
      zoom: cam.zoom,
      width: this.canvas.width,
      height: this.canvas.height,
      dpr,
      fonts: this.fonts,
    });
    const { redraw, newGrid } = this.cache.update(w.grid, key);
    // A different grid is a different world (a load or a new game): its jams are not this one's.
    if (newGrid) this.jam.reset();
    if (redraw) {
      const s0 = performance.now();
      this.layerCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawStatic(this.layerCtx, w, v);
      this.stats.staticMs = performance.now() - s0;
      this.stats.staticDraws++;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.layer, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawTrains(ctx, w, v);
    drawPlanDynamic(ctx, w, v);
    this.jam.update(w.crowd.counts, w.grid.w, w.grid.h, w.minute);
    drawCrowding(ctx, this.jam, v, t0);
    drawPeople(ctx, cam, w.people, dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawUi(ctx, w, ui, v);
    this.stats.drawMs = performance.now() - t0;
  }

  /** Keeps the backing stores at the canvas's CSS size times dpr, and the camera on the map. */
  private fitTo(w: World, cssW: number, cssH: number, dpr: number): void {
    const pw = Math.max(1, Math.round(cssW * dpr));
    const ph = Math.max(1, Math.round(cssH * dpr));
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw;
      this.canvas.height = ph;
    }
    if (this.layer.width !== pw || this.layer.height !== ph) {
      this.layer.width = pw;
      this.layer.height = ph;
    }
    const cam = this.camera;
    if (cam.mapW !== w.grid.w || cam.mapH !== w.grid.h) cam.setBounds(w.grid.w, w.grid.h);
    if (cam.viewW !== cssW || cam.viewH !== cssH) cam.setViewport(cssW, cssH);
    if (!this.fitted && cssW > 0) {
      if (this.initialFrame) this.initialFrame(cam, w);
      else cam.fit();
      this.fitted = true;
    }
  }

  /** Frames the view afresh on the next draw (a new game). */
  refit(): void {
    this.fitted = false;
  }
}

/** Resolves once the label faces are loaded (or failed to), so the static layer can be redrawn in them. */
async function loadFonts(): Promise<void> {
  const fonts = document.fonts;
  if (!fonts) return;
  try {
    await Promise.all([
      fonts.load(`400 12px ${UI_FONT}`),
      fonts.load(`500 12px ${UI_FONT}`),
      fonts.load(`600 12px ${UI_FONT}`),
      fonts.load(`700 12px ${UI_FONT}`),
      fonts.load(`500 12px ${MONO_FONT}`),
    ]);
    await fonts.ready;
  } catch {
    // Labels stay in the fallback faces.
  }
}
