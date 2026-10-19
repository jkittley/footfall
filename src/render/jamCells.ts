import { CALM_DENSITY, JAM_DENSITY } from "../sim/constants";

/** Crowding is judged per square cell of this many tiles a side. */
export const CELL_TILES = 4;
/** A jam ring fills over this many game minutes. Visual only: it never feeds the sim. */
export const JAM_RING_FULL_MIN = 10;
/** A cell is a jam once it has held jam density this long (game minutes). */
export const JAM_AFTER_MIN = 1;
/** Density at or above which a cell glows orange: halfway from calm to jam, where people are well slowed. */
export const CROWDED_DENSITY = (CALM_DENSITY + JAM_DENSITY) / 2;
/** A cell stays a jam this long (game minutes) after it drops below jam density. */
export const JAM_HOLD_MIN = 1;
/** While merely crowded, jam time drains this many times faster than it built. */
const DRAIN_RATE = 3;
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
 * Jam time builds while a cell is at jam density, drains DRAIN_RATE times as fast while it is merely
 * crowded, and clears once it calms; a cell stays a jam for JAM_HOLD_MIN after dropping below jam
 * density, so a jam flickering across the threshold keeps its ring without outliving the crowd.
 */
export class JamTracker {
  cw = 0;
  ch = 0;
  peak = new Float32Array(0);
  jamMin = new Float32Array(0);
  /** Game minutes since each cell was last at jam density. */
  belowMin = new Float32Array(0);
  private lastMinute: number | null = null;

  update(counts: ArrayLike<number>, w: number, h: number, minute: number): void {
    const cw = Math.ceil(w / CELL_TILES);
    const ch = Math.ceil(h / CELL_TILES);
    if (cw !== this.cw || ch !== this.ch) {
      this.cw = cw;
      this.ch = ch;
      this.peak = new Float32Array(cw * ch);
      this.jamMin = new Float32Array(cw * ch);
      this.belowMin = new Float32Array(cw * ch);
      this.lastMinute = null;
    }
    cellPeaks(counts, w, h, this.peak);
    let dt = this.lastMinute === null ? 0 : minute - this.lastMinute;
    if (dt < 0 || dt > MAX_GAP_MIN) {
      this.reset();
      dt = 0;
    }
    this.lastMinute = minute;
    const { peak, jamMin, belowMin } = this;
    for (let c = 0; c < peak.length; c++) {
      const d = peak[c]!;
      if (d >= JAM_DENSITY) {
        jamMin[c] = jamMin[c]! + dt;
        belowMin[c] = 0;
        continue;
      }
      belowMin[c] = belowMin[c]! + dt;
      jamMin[c] = d >= CROWDED_DENSITY ? Math.max(0, jamMin[c]! - DRAIN_RATE * dt) : 0;
    }
  }

  /** Forgets every jam (a new world, or the clock jumping). */
  reset(): void {
    this.jamMin.fill(0);
    this.belowMin.fill(0);
    this.lastMinute = null;
  }

  classOf(c: number): CrowdClass {
    const d = this.peak[c]!;
    if (d >= CROWDED_DENSITY) {
      const jammed = this.jamMin[c]! >= JAM_AFTER_MIN && this.belowMin[c]! <= JAM_HOLD_MIN;
      return jammed ? CrowdClass.Jam : CrowdClass.Crowded;
    }
    return d > CALM_DENSITY ? CrowdClass.Busy : CrowdClass.Calm;
  }

  /** How full a jammed cell's ring is, 0..1; 0 for any cell not jammed. */
  ringFill(c: number): number {
    if (this.classOf(c) !== CrowdClass.Jam) return 0;
    return Math.min(1, this.jamMin[c]! / JAM_RING_FULL_MIN);
  }
}

/** One jam as drawn: its centre (tiles), how far its cells reach from it, and its fullest ring. */
export interface JamCluster {
  x: number;
  y: number;
  /** Furthest member cell centre from (x, y), in tiles; 0 for a lone cell. */
  extent: number;
  fill: number;
}

/**
 * Groups jammed cells that touch (edge or corner) into one cluster each, so a jam spanning cells is
 * one glow and one ring. `fill(c)` is a cell's ring fill, negative when it is not jammed.
 */
export function jamClusters(cells: { cw: number; ch: number; fill: (c: number) => number }): JamCluster[] {
  const { cw, ch, fill } = cells;
  const seen = new Uint8Array(cw * ch);
  const out: JamCluster[] = [];
  const stack: number[] = [];
  for (let start = 0; start < cw * ch; start++) {
    if (seen[start] || fill(start) < 0) continue;
    seen[start] = 1;
    stack.push(start);
    const members: number[] = [];
    let best = 0;
    while (stack.length > 0) {
      const c = stack.pop()!;
      members.push(c);
      best = Math.max(best, fill(c));
      const cx = c % cw;
      const cy = (c - cx) / cw;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
          const n = ny * cw + nx;
          if (seen[n] || fill(n) < 0) continue;
          seen[n] = 1;
          stack.push(n);
        }
      }
    }
    const centre = (c: number): [number, number] => [((c % cw) + 0.5) * CELL_TILES, (Math.floor(c / cw) + 0.5) * CELL_TILES];
    let x = 0;
    let y = 0;
    for (const c of members) {
      const [px, py] = centre(c);
      x += px;
      y += py;
    }
    x /= members.length;
    y /= members.length;
    let extent = 0;
    for (const c of members) {
      const [px, py] = centre(c);
      extent = Math.max(extent, Math.hypot(px - x, py - y));
    }
    out.push({ x, y, extent, fill: best });
  }
  return out;
}
