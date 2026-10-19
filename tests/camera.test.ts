import { describe, expect, it } from "vitest";
import { Camera } from "../src/render/camera";

describe("Camera", () => {
  it("round-trips world and screen coordinates", () => {
    const cam = new Camera();
    cam.x = 12.5;
    cam.y = -3;
    cam.zoom = 1.75;
    const [sx, sy] = cam.worldToScreen(40.25, 9.5);
    const [wx, wy] = cam.screenToWorld(sx, sy);
    expect(wx).toBeCloseTo(40.25, 9);
    expect(wy).toBeCloseTo(9.5, 9);
  });
});
