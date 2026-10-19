import type { ToolId } from "../sim/build";
import type { Rect } from "../sim/grid";

type Tile = readonly [number, number];

/** A drag from `start` to `end` (tiles) as the tool's rect: one tile for a sign, a straight line for walls, rails and travelators. */
export function dragRect(tool: ToolId, start: Tile, end: Tile): Rect {
  if (tool === "sign") return { x: end[0], y: end[1], w: 1, h: 1 };
  let [ex, ey] = end;
  const [sx, sy] = start;
  if (tool === "wall" || tool === "rail" || tool === "travelator") {
    if (Math.abs(ex - sx) >= Math.abs(ey - sy)) ey = sy;
    else ex = sx;
  }
  return { x: Math.min(sx, ex), y: Math.min(sy, ey), w: Math.abs(ex - sx) + 1, h: Math.abs(ey - sy) + 1 };
}
