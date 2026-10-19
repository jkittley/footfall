import { Tile, Zone } from "./grid";
import { PState } from "./people";
import type { Service } from "./timetable";
import { onTrainArrived, rebook, rebookContext, sendToExit, type RebookContext } from "./spawner";
import { recordOutcome, type World } from "./world";

/**
 * Runs train events in (w.trainsUpTo, w.minute]: arrivals, boarding by anyone Waiting on their
 * platform while their train is in, and misses at departure (rebooked onto the platform's next
 * service, or sent to an exit when there is none). Anyone booked on a service that was cancelled or
 * is gone is rebooked rather than left waiting for it. Working on the interval rather than the instant means a long step cannot skip one.
 */
export function stepTrains(w: World): void {
  const from = w.trainsUpTo;
  const to = w.minute;
  if (to <= from) return;
  w.trainsUpTo = to;
  const { timetable, people } = w;

  let departed: Map<number, Service | undefined> | null = null;
  for (const s of timetable.services.values()) {
    if (s.cancelled) continue;
    if (s.arriveAt > from && s.arriveAt <= to) onTrainArrived(w, s);
    if (s.departAt > from && s.departAt <= to) (departed ??= new Map()).set(s.id, undefined);
  }

  const { x, y, state, serviceId } = people;
  let ctx: RebookContext | null = null;
  for (let i = 0, end = people.end; i < end; i++) {
    if (!people.isAlive(i) || serviceId[i]! < 0) continue;
    const s = timetable.services.get(serviceId[i]!);
    if (!s || s.cancelled) {
      rebook(w, i, (ctx ??= rebookContext(w)));
      continue;
    }
    if (state[i] === PState.Waiting && s.arriveAt <= to && s.departAt > from && onPlatform(w, s.platformId, x[i]!, y[i]!)) {
      recordOutcome(w, i, true, false);
      people.free(i);
      continue;
    }
    if (departed?.has(s.id)) {
      recordOutcome(w, i, false, false);
      let next = departed.get(s.id);
      if (!next) {
        next = timetable.upcoming(s.platformId, s.departAt)[0];
        departed.set(s.id, next);
      }
      if (next) serviceId[i] = next.id;
      else sendToExit(w, i);
    }
  }
}

function onPlatform(w: World, platformId: number, px: number, py: number): boolean {
  const r = w.map.slots[platformId - 1]?.platform;
  if (!r) return false;
  const tx = Math.floor(px);
  const ty = Math.floor(py);
  if (tx < r.x || tx >= r.x + r.w || ty < r.y || ty >= r.y + r.h) return false;
  return w.grid.tile(tx, ty) === Tile.Platform && w.grid.zone(tx, ty) === Zone.None;
}
