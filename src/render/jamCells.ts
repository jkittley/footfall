import { CALM_DENSITY, JAM_DENSITY } from "../sim/constants";

/** Crowding is judged per square cell of this many tiles a side. */
export const CELL_TILES = 4;
/** A jam ring fills over this many game minutes. Visual only: it never feeds the sim. */
export const JAM_RING_FULL_MIN = 10;
/** A cell is a jam once it has held jam density this long (game minutes). */
export const JAM_AFTER_MIN = 1;
/** Density at or above which a cell glows orange: halfway from calm to jam, where people are well slowed. */
export const CROWDED_DENSITY = (CALM_DENSITY + JAM_DENSITY) / 2;
/** A clock jump larger than this (a load, a huge step) starts every jam afresh. */
const MAX_GAP_MIN = 5;

export enum CrowdClass {
  Calm = 0,
  Busy = 1,
  Crowded = 2,
  Jam = 3,
}

let rowSums = new Float32Array(0);

/**
 * Each cell's highest 3x3 density (CrowdGrid.density: the mean over the 3x3 block, off-grid tiles
 * empty) over its tiles, into `out` (cells row-major, ceil(w / CELL_TILES) across).
 */
export function cellPeaks(counts: ArrayLike<number>, w: number, h: number, out: Float32Array): void {
  if (rowSums.length < w * h) rowSums = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const r = y * w;
    for (let x = 0; x < w; x++) {
      rowSums[r + x] = (x > 0 ? counts[r + x - 1]! : 0) + counts[r + x]! + (x < w - 1 ? counts[r + x + 1]! : 0);
    }
  }
  const cw = Math.ceil(w / CELL_TILES);
  out.fill(0);
  for (let y = 0; y < h; y++) {
    const rowCell = Math.floor(y / CELL_TILES) * cw;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const sum = (y > 0 ? rowSums[i - w]! : 0) + rowSums[i]! + (y < h - 1 ? rowSums[i + w]! : 0);
      const c = rowCell + Math.floor(x / CELL_TILES);
      const d = sum / 9;
      if (d > out[c]!) out[c] = d;
    }
  }
}

/**
 * Per-cell crowding for the overlay, kept by the renderer from the crowd grid and the game clock.
 * Jam time builds while a cell is at jam density, drains while it is merely crowded, and clears
 * once it calms, so a jam flickering across the threshold keeps its ring.
 */
export class JamTracker {
  cw = 0;
  ch = 0;
  peak = new Float32Array(0);
  jamMin = new Float32Array(0);
  private lastMinute: number | null = null;

  update(counts: ArrayLike<number>, w: number, h: number, minute: number): void {
    const cw = Math.ceil(w / CELL_TILES);
    const ch = Math.ceil(h / CELL_TILES);
    if (cw !== this.cw || ch !== this.ch) {
      this.cw = cw;
      this.ch = ch;
      this.peak = new Float32Array(cw * ch);
      this.jamMin = new Float32Array(cw * ch);
      this.lastMinute = null;
    }
    cellPeaks(counts, w, h, this.peak);
    let dt = this.lastMinute === null ? 0 : minute - this.lastMinute;
    if (dt < 0 || dt > MAX_GAP_MIN) {
      this.jamMin.fill(0);
      dt = 0;
    }
    this.lastMinute = minute;
    const { peak, jamMin } = this;
    for (let c = 0; c < peak.length; c++) {
      const d = peak[c]!;
      if (d >= JAM_DENSITY) jamMin[c] = jamMin[c]! + dt;
      else if (d >= CROWDED_DENSITY) jamMin[c] = Math.max(0, jamMin[c]! - dt);
      else jamMin[c] = 0;
    }
  }

  classOf(c: number): CrowdClass {
    const d = this.peak[c]!;
    if (d >= CROWDED_DENSITY) return this.jamMin[c]! >= JAM_AFTER_MIN ? CrowdClass.Jam : CrowdClass.Crowded;
    return d > CALM_DENSITY ? CrowdClass.Busy : CrowdClass.Calm;
  }

  /** How full a jammed cell's ring is, 0..1; 0 for any cell not jammed. */
  ringFill(c: number): number {
    if (this.classOf(c) !== CrowdClass.Jam) return 0;
    return Math.min(1, this.jamMin[c]! / JAM_RING_FULL_MIN);
  }
}
