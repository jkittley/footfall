import { APPROACH_MIN, LEAVE_MIN, trainPhase, type Service } from "../sim/timetable";
import type { World } from "../sim/world";
import { FLOOR, WALL } from "./palette";
import { rectInView, sx, sy, type View } from "./view";

const CARRIAGES = 4;
/** Gap between carriages and room left at the buffer end, in tiles. */
const GAP = 0.35;
const BUFFER = 0.5;
const CAR_WIDTH = 0.76;
const WINDOW_EVERY = 1.1;

const easeOut = (t: number): number => 1 - (1 - t) ** 3;
const easeIn = (t: number): number => t ** 3;

/**
 * How far (tiles) a train stands north of its resting place: it runs in from the track's north
 * end over APPROACH_MIN and back out the same way over LEAVE_MIN (the station is a terminus).
 * 0 while it stands at the platform; null when there is no train to draw.
 */
export function trainOffset(s: Service, now: number, travel: number): number | null {
  const phase = trainPhase(s, now);
  if (phase === null) return null;
  if (phase === "approaching") return travel * (1 - easeOut((now - (s.arriveAt - APPROACH_MIN)) / APPROACH_MIN));
  if (phase === "leaving") return travel * easeIn((now - s.departAt) / LEAVE_MIN);
  return 0;
}

/** Trains as dark carriages with floor-coloured windows on their track, clipped to it. */
export function drawTrains(ctx: CanvasRenderingContext2D, w: World, v: View): void {
  for (const s of w.timetable.services.values()) {
    if (s.platformId > w.platformsAdded) continue;
    const track = w.map.slots[s.platformId - 1]?.track;
    if (!track || !rectInView(v, track.x, track.y, track.w, track.h)) continue;
    const length = track.h - 2 * BUFFER;
    const offset = trainOffset(s, w.minute, length + BUFFER);
    if (offset === null) continue;
    const carLen = (length - GAP * (CARRIAGES - 1)) / CARRIAGES;
    const top = track.y + track.h - BUFFER - length - offset;
    const cx = track.x + track.w / 2;
    ctx.save();
    ctx.beginPath();
    ctx.rect(sx(v, track.x), sy(v, track.y), track.w * v.s, track.h * v.s);
    ctx.clip();
    const wpx = CAR_WIDTH * v.s;
    const cars = new Path2D();
    const windows = new Path2D();
    for (let c = 0; c < CARRIAGES; c++) {
      const y0 = top + c * (carLen + GAP);
      cars.roundRect(sx(v, cx) - wpx / 2, sy(v, y0), wpx, carLen * v.s, wpx * 0.4);
      const n = Math.floor((carLen - 0.6) / WINDOW_EVERY);
      const first = y0 + (carLen - (n - 1) * WINDOW_EVERY) / 2;
      for (let k = 0; k < n; k++) {
        const wy = first + k * WINDOW_EVERY;
        windows.rect(sx(v, cx) - wpx * 0.22, sy(v, wy - 0.3), wpx * 0.44, 0.6 * v.s);
      }
    }
    ctx.fillStyle = WALL;
    ctx.fill(cars);
    ctx.fillStyle = FLOOR;
    ctx.fill(windows);
    ctx.restore();
  }
}
