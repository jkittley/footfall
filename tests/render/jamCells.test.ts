import { describe, expect, it } from "vitest";
import {
  CELL_TILES,
  CROWDED_DENSITY,
  CrowdClass,
  JAM_RING_FULL_MIN,
  JamTracker,
  cellPeaks,
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

  it("drains while merely crowded and clears once calm", () => {
    const t = new JamTracker();
    const jam = packed(Math.ceil(JAM_DENSITY));
    const crowded = packed(Math.ceil(CROWDED_DENSITY));
    for (let m = 0; m <= 4; m++) t.update(jam, W, H, m);
    t.update(crowded, W, H, 6);
    expect(t.classOf(0)).toBe(CrowdClass.Jam);
    expect(t.ringFill(0)).toBeCloseTo(2 / JAM_RING_FULL_MIN, 6);
    t.update(packed(0), W, H, 6.5);
    expect(t.classOf(0)).toBe(CrowdClass.Calm);
    t.update(jam, W, H, 7);
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
