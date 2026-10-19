import { describe, expect, it } from "vitest";
import {
  CELL_TILES,
  CROWDED_DENSITY,
  CrowdClass,
  JAM_HOLD_MIN,
  JAM_RING_FULL_MIN,
  JamTracker,
  cellPeaks,
  jamClusters,
} from "../../src/render/jamCells";
import { JAM_DENSITY } from "../../src/sim/constants";
import { CrowdGrid } from "../../src/sim/crowd";
import { Rng } from "../../src/sim/rng";

const W = 13;
const H = 9;

/** Counts with every tile of cell (0, 0)'s 3x3 around tile (1, 1) at `n`, so its peak density is n. */
function packed(n: number): Uint16Array {
  const c = new Uint16Array(W * H);
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) c[y * W + x] = n;
  return c;
}

describe("cellPeaks", () => {
  it("is the highest 3x3 density (as CrowdGrid.density) over each 4x4 cell's tiles", () => {
    const crowd = new CrowdGrid(W, H);
    const rng = new Rng(7);
    for (let i = 0; i < crowd.counts.length; i++) crowd.counts[i] = rng.int(0, 6);
    const cw = Math.ceil(W / CELL_TILES);
    const ch = Math.ceil(H / CELL_TILES);
    const out = new Float32Array(cw * ch);
    cellPeaks(crowd.counts, W, H, out);
    for (let cy = 0; cy < ch; cy++) {
      for (let cx = 0; cx < cw; cx++) {
        let want = 0;
        for (let y = cy * CELL_TILES; y < Math.min(H, (cy + 1) * CELL_TILES); y++)
          for (let x = cx * CELL_TILES; x < Math.min(W, (cx + 1) * CELL_TILES); x++) want = Math.max(want, crowd.density(x, y));
        expect(out[cy * cw + cx]).toBeCloseTo(want, 5);
      }
    }
  });
});

describe("JamTracker", () => {
  it("calls a cell jammed only after a game minute at jam density, and fills the ring over JAM_RING_FULL_MIN", () => {
    const t = new JamTracker();
    const jam = packed(Math.ceil(JAM_DENSITY));
    t.update(jam, W, H, 100);
    t.update(jam, W, H, 100.5);
    expect(t.classOf(0)).toBe(CrowdClass.Crowded);
    expect(t.ringFill(0)).toBe(0);
    t.update(jam, W, H, 101);
    expect(t.classOf(0)).toBe(CrowdClass.Jam);
    expect(t.ringFill(0)).toBeCloseTo(1 / JAM_RING_FULL_MIN, 6);
    t.update(jam, W, H, 105);
    expect(t.ringFill(0)).toBeCloseTo(5 / JAM_RING_FULL_MIN, 6);
    for (let m = 106; m <= 120; m++) t.update(jam, W, H, m);
    expect(t.ringFill(0)).toBe(1);
  });

  it("drains three times as fast while merely crowded, holds Jam about a minute below jam density, and clears once calm", () => {
    const t = new JamTracker();
    const jam = packed(Math.ceil(JAM_DENSITY));
    const crowded = packed(Math.ceil(CROWDED_DENSITY));
    for (let m = 0; m <= 4; m++) t.update(jam, W, H, m);
    t.update(crowded, W, H, 4.5);
    expect(t.classOf(0)).toBe(CrowdClass.Jam);
    expect(t.ringFill(0)).toBeCloseTo((4 - 3 * 0.5) / JAM_RING_FULL_MIN, 6);
    t.update(crowded, W, H, 4.5 + JAM_HOLD_MIN + 0.1);
    expect(t.classOf(0)).toBe(CrowdClass.Crowded);
    expect(t.ringFill(0)).toBe(0);
    t.update(jam, W, H, 5.7);
    expect(t.classOf(0)).toBe(CrowdClass.Crowded);
    t.update(packed(0), W, H, 6);
    expect(t.classOf(0)).toBe(CrowdClass.Calm);
    t.update(jam, W, H, 6.5);
    expect(t.classOf(0)).toBe(CrowdClass.Crowded);
  });

  it("starts afresh on reset", () => {
    const t = new JamTracker();
    const jam = packed(Math.ceil(JAM_DENSITY));
    t.update(jam, W, H, 0);
    t.update(jam, W, H, 3);
    expect(t.classOf(0)).toBe(CrowdClass.Jam);
    t.reset();
    t.update(jam, W, H, 3.5);
    expect(t.classOf(0)).toBe(CrowdClass.Crowded);
  });

  it("does not count paused time, and starts afresh after the clock jumps (a load) or runs backwards", () => {
    const t = new JamTracker();
    const jam = packed(Math.ceil(JAM_DENSITY));
    t.update(jam, W, H, 10);
    t.update(jam, W, H, 10);
    expect(t.classOf(0)).toBe(CrowdClass.Crowded);
    t.update(jam, W, H, 12);
    expect(t.classOf(0)).toBe(CrowdClass.Jam);
    t.update(jam, W, H, 500);
    expect(t.classOf(0)).toBe(CrowdClass.Crowded);
    t.update(jam, W, H, 502);
    t.update(jam, W, H, 400);
    expect(t.classOf(0)).toBe(CrowdClass.Crowded);
  });

  it("rates a lone walker calm and a light crowd busy", () => {
    const t = new JamTracker();
    const c = new Uint16Array(W * H);
    c[0] = 1;
    t.update(c, W, H, 0);
    expect(t.classOf(0)).toBe(CrowdClass.Calm);
    t.update(packed(1), W, H, 0);
    expect(t.classOf(0)).toBe(CrowdClass.Busy);
  });
});

describe("jamClusters", () => {
  /** A 5 x 4 cell grid with the given cells jammed (fill = jam minutes / JAM_RING_FULL_MIN). */
  function grid(jammed: Record<number, number>): { cw: number; ch: number; fill: (c: number) => number } {
    return { cw: 5, ch: 4, fill: (c) => jammed[c] ?? -1 };
  }

  it("merges touching jam cells (edges or corners) into one, at their centroid, filled by the fullest", () => {
    // Cells (1,1), (2,1) and (3,2): a chain through a corner.
    const out = jamClusters(grid({ 6: 0.2, 7: 0.7, 13: 0.4 }));
    expect(out).toHaveLength(1);
    const c = out[0]!;
    expect(c.x).toBeCloseTo(((1.5 + 2.5 + 3.5) / 3) * CELL_TILES, 6);
    expect(c.y).toBeCloseTo(((1.5 + 1.5 + 2.5) / 3) * CELL_TILES, 6);
    expect(c.fill).toBe(0.7);
    expect(c.extent).toBeCloseTo(Math.max(...[[1.5, 1.5], [2.5, 1.5], [3.5, 2.5]].map(([x, y]) => Math.hypot(x! * CELL_TILES - c.x, y! * CELL_TILES - c.y))), 6);
  });

  it("keeps cells apart that do not touch, and a lone cell has no extent", () => {
    const out = jamClusters(grid({ 0: 0.1, 2: 0.5, 19: 1 }));
    expect(out).toHaveLength(3);
    const lone = out.find((c) => c.fill === 0.5)!;
    expect(lone.x).toBeCloseTo(2.5 * CELL_TILES, 6);
    expect(lone.y).toBeCloseTo(0.5 * CELL_TILES, 6);
    expect(lone.extent).toBe(0);
  });

  it("counts a jammed cell whose ring is still empty", () => {
    expect(jamClusters({ cw: 2, ch: 1, fill: (c) => (c === 0 ? 0 : -1) })).toHaveLength(1);
  });
});
