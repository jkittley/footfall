import { describe, expect, it } from "vitest";
import { Camera, MAX_ZOOM, MIN_ZOOM } from "../../src/render/camera";
import { TILE_PX } from "../../src/sim/constants";

describe("Camera", () => {
  it.each([0.5, 1, 3])("round-trips world and screen coordinates at zoom %s", (zoom) => {
    const cam = new Camera();
    cam.x = 12.5;
    cam.y = -3;
    cam.zoom = zoom;
    for (const [px, py] of [[40.25, 9.5], [0, 0], [-7.75, 130.125]] as const) {
      const [sx, sy] = cam.worldToScreen(px, py);
      const [wx, wy] = cam.screenToWorld(sx, sy);
      expect(wx).toBeCloseTo(px, 9);
      expect(wy).toBeCloseTo(py, 9);
    }
  });

  it("keeps the world point under the cursor fixed while zooming", () => {
    const cam = new Camera();
    cam.x = 10;
    cam.y = 5;
    const cursor = [313, 207] as const;
    const before = cam.screenToWorld(...cursor);
    for (const factor of [1.7, 0.4, 2.5, 0.9]) {
      cam.zoomAt(cursor[0], cursor[1], factor);
      const after = cam.screenToWorld(...cursor);
      expect(after[0]).toBeCloseTo(before[0], 9);
      expect(after[1]).toBeCloseTo(before[1], 9);
    }
  });

  it("clamps zoom to 0.5..3, the wheel zooming in on a negative deltaY", () => {
    const cam = new Camera();
    cam.zoomAt(0, 0, 100);
    expect(cam.zoom).toBe(MAX_ZOOM);
    cam.zoomAt(0, 0, 0.001);
    expect(cam.zoom).toBe(MIN_ZOOM);
    cam.zoom = 1;
    cam.wheel(50, 50, -100);
    expect(cam.zoom).toBeGreaterThan(1);
    cam.wheel(50, 50, 400);
    expect(cam.zoom).toBeLessThan(1);
  });

  it("pans by screen pixels", () => {
    const cam = new Camera();
    cam.zoom = 2;
    cam.pan(-TILE_PX * 2 * 3, TILE_PX * 2);
    expect(cam.x).toBeCloseTo(3, 9);
    expect(cam.y).toBeCloseTo(-1, 9);
  });

  it("clamps to the map, keeping the view on it within a small margin", () => {
    const cam = new Camera();
    cam.setBounds(120, 90);
    cam.setViewport(800, 600);
    cam.zoom = 2; // view is 25 x 18.75 tiles
    cam.pan(1e6, 1e6);
    const [left, top] = cam.screenToWorld(0, 0);
    expect(left).toBeGreaterThanOrEqual(-Camera.MARGIN_TILES);
    expect(top).toBeGreaterThanOrEqual(-Camera.MARGIN_TILES);
    cam.pan(-1e7, -1e7);
    const [right, bottom] = cam.screenToWorld(800, 600);
    expect(right).toBeLessThanOrEqual(120 + Camera.MARGIN_TILES);
    expect(bottom).toBeLessThanOrEqual(90 + Camera.MARGIN_TILES);
  });

  it("centres the map on an axis it does not fill", () => {
    const cam = new Camera();
    cam.setBounds(120, 90);
    cam.setViewport(4000, 600);
    cam.zoom = 1; // 250 tiles across, more than the map
    cam.pan(-5000, 0);
    const [left] = cam.screenToWorld(0, 0);
    const [right] = cam.screenToWorld(4000, 0);
    expect((left + right) / 2).toBeCloseTo(60, 9);
  });

  it("fits the whole map in view", () => {
    const cam = new Camera();
    cam.setBounds(120, 90);
    cam.setViewport(1440, 900);
    cam.fit();
    const [l, t] = cam.screenToWorld(0, 0);
    const [r, b] = cam.screenToWorld(1440, 900);
    expect(l).toBeLessThanOrEqual(0);
    expect(t).toBeLessThanOrEqual(0);
    expect(r).toBeGreaterThanOrEqual(120);
    expect(b).toBeGreaterThanOrEqual(90);
  });

  it("lets the map pan out from under screen insets (CSS px) on each side", () => {
    const cam = new Camera();
    cam.setBounds(120, 90);
    cam.setViewport(800, 600);
    cam.zoom = 2; // 32 px a tile
    cam.setInsets(128, 64, 0, 0);
    cam.pan(1e6, 1e6);
    // The map's left edge can sit right of the 128px rail, plus the usual margin.
    expect(cam.x).toBeCloseTo(-Camera.MARGIN_TILES - 128 / 32, 9);
    expect(cam.y).toBeCloseTo(-Camera.MARGIN_TILES - 64 / 32, 9);
    cam.pan(-1e6, -1e6);
    const [right, bottom] = cam.screenToWorld(800, 600);
    expect(right).toBeCloseTo(120 + Camera.MARGIN_TILES, 9);
    expect(bottom).toBeCloseTo(90 + Camera.MARGIN_TILES, 9);
  });

  it("frames a rect in the area inside the insets, zoom held to the given range", () => {
    const cam = new Camera();
    cam.setBounds(120, 90);
    cam.setViewport(1180, 1000);
    cam.setInsets(120, 200, 16, 16);
    cam.frame({ x: 50, y: 40, w: 15, h: 25 }, 2, 1.5, 2);
    expect(cam.zoom).toBeGreaterThanOrEqual(1.5);
    expect(cam.zoom).toBeLessThanOrEqual(2);
    // The rect's centre lands on the centre of the free area.
    const [cx, cy] = cam.worldToScreen(50 + 15 / 2, 40 + 25 / 2);
    expect(cx).toBeCloseTo(120 + (1180 - 120 - 16) / 2, 6);
    expect(cy).toBeCloseTo(200 + (1000 - 200 - 16) / 2, 6);
  });

  it("frames a rect at the map's edge clear of the insets, as near the centre as the clamp allows", () => {
    const cam = new Camera();
    cam.setBounds(120, 90);
    cam.setViewport(1180, 1000);
    cam.setInsets(120, 200, 16, 16);
    expect(cam.frame({ x: 1, y: 24, w: 15, h: 55 }, 2, 1.5, 2)).toBe(false);
    expect(cam.zoom).toBe(1.5);
    const [left] = cam.worldToScreen(1, 0);
    expect(left).toBeGreaterThan(120);
    expect(left).toBeLessThan(1180 / 2);
  });

  it("frames a small rect at the top of the zoom range", () => {
    const cam = new Camera();
    cam.setBounds(120, 90);
    cam.setViewport(1180, 1000);
    expect(cam.frame({ x: 10, y: 10, w: 4, h: 4 }, 1, 1.5, 2)).toBe(true);
    expect(cam.zoom).toBe(2);
  });
});
