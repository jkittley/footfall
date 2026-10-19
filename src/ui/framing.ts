import { Tile, type Grid, type Rect } from "../sim/grid";

/**
 * The bounding box of the station as built: its floor and platforms (lone entrance tiles left
 * out), or with `floorOnly` just the concourse floor; null if none.
 */
export function stationBounds(g: Grid, floorOnly = false): Rect | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const t = g.tiles[y * g.w + x];
      if (t !== Tile.Floor && (floorOnly || t !== Tile.Platform)) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Gap (CSS px) kept between the HUD and the station, and at the free screen edges. */
export const HUD_GAP = 16;
/**
 * Extra room (CSS px) left of the rail for Entrance B's name pill ("Entrance B · Market Street",
 * about 200px), which is drawn left of the station's west edge, so it stays clear of the rail when
 * the station is framed.
 */
const SIDE_PILL_ROOM_PX = 120;

/** The screen insets (CSS px) the camera frames inside and may pan the map out from under. */
export function framingInsets(railRight: number, hudBottom: number): { left: number; top: number; right: number; bottom: number } {
  return { left: railRight + HUD_GAP + SIDE_PILL_ROOM_PX, top: hudBottom + HUD_GAP, right: HUD_GAP, bottom: HUD_GAP };
}
