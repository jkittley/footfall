import type { World } from "../sim/world";
import { Camera } from "./camera";
import { drawCrowding, drawUi, type UiOverlayState } from "./drawOverlays";
import { drawPeople } from "./drawPeople";
import { drawPlanDynamic, drawStatic } from "./drawPlan";
import { drawTrains } from "./drawTrains";
import { JamTracker } from "./jamCells";
import { staticLayerKey } from "./labels";
import { MONO_FONT, UI_FONT } from "./text";
import { makeView } from "./view";

export type { UiOverlayState };

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
 * blitted until staticLayerKey changes (grid, camera, size or fonts); trains, labels, signs,
 * crowding, people and the UI overlays are drawn over it every frame.
 */
export class Renderer {
  readonly camera = new Camera();
  readonly stats: RenderStats = { drawMs: 0, staticMs: 0, staticDraws: 0 };
  private readonly ctx: CanvasRenderingContext2D;
  private readonly layer: HTMLCanvasElement;
  private readonly layerCtx: CanvasRenderingContext2D;
  private readonly jam = new JamTracker();
  private key = "";
  private fonts = 0;
  private fitted = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    this.layer = document.createElement("canvas");
    const layerCtx = this.layer.getContext("2d");
    if (!ctx || !layerCtx) throw new Error("Canvas 2D is not available");
    this.ctx = ctx;
    this.layerCtx = layerCtx;
    void loadFonts().then(() => this.fonts++);
  }

  draw(w: World, ui: UiOverlayState): void {
    const t0 = performance.now();
    const dpr = window.devicePixelRatio || 1;
    const cssW = this.canvas.clientWidth;
    const cssH = this.canvas.clientHeight;
    this.fitTo(w, cssW, cssH, dpr);
    const cam = this.camera;
    const v = makeView(cam, dpr, cssW, cssH, w.grid.w, w.grid.h);

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
    if (key !== this.key) {
      const s0 = performance.now();
      this.key = key;
      this.layerCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawStatic(this.layerCtx, w, v);
      this.stats.staticMs = performance.now() - s0;
      this.stats.staticDraws++;
    }

    const ctx = this.ctx;
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
      cam.fit();
      this.fitted = true;
    }
  }
}

/** Resolves once the label faces are loaded (or failed to), so the static layer can be redrawn in them. */
async function loadFonts(): Promise<void> {
  const fonts = document.fonts;
  if (!fonts) return;
  try {
    await Promise.all([
      fonts.load(`400 12px ${UI_FONT}`),
      fonts.load(`600 12px ${UI_FONT}`),
      fonts.load(`700 12px ${UI_FONT}`),
      fonts.load(`500 12px ${MONO_FONT}`),
    ]);
    await fonts.ready;
  } catch {
    // Labels stay in the fallback faces.
  }
}
