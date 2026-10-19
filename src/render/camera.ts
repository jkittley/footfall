import { TILE_PX } from "../sim/constants";

/** `x`, `y` are the world tile at the screen's top-left corner; `zoom` 1 is TILE_PX screen px per tile. */
export class Camera {
  x = 0;
  y = 0;
  zoom = 1;

  worldToScreen(wx: number, wy: number): [number, number] {
    const s = TILE_PX * this.zoom;
    return [(wx - this.x) * s, (wy - this.y) * s];
  }

  screenToWorld(sx: number, sy: number): [number, number] {
    const s = TILE_PX * this.zoom;
    return [sx / s + this.x, sy / s + this.y];
  }
}
