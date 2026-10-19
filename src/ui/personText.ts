// Pure text for the person inspector: no DOM, so it is unit-tested.
import { walkMinutes } from "../sim/routeField";
import { DestLabel, Journey, Need, PState } from "../sim/people";
import { fieldFor, tileOf } from "../sim/walk";
import type { World } from "../sim/world";
import { clockTime } from "../render/labels";

/** Time left shows red when it is under the walk from here plus this many game minutes. */
const SHORT_MARGIN_MIN = 5;

export const NEED_LABELS: readonly string[] = ["Hunger", "Thirst", "Tired", "Toilet", "Browse", "Charge"];

const GOING: Record<DestLabel, string> = {
  [DestLabel.Home]: "going home by",
  [DestLabel.Hotel]: "going to a hotel by",
  [DestLabel.Work]: "going to work by",
};

/** What the goal line needs to know about a person. */
export interface GoalFacts {
  journey: Journey;
  service: { departAt: number; destination: string; platformId: number } | null;
  /** The platform they are walking to, if any. */
  platformId: number | null;
  /** The entrance they are leaving by, if any. */
  exitName: string | null;
  destLabel: DestLabel;
  deadline: number;
}

/** "Catch the 08:51 to Ashby, Platform 4" or "Leave by Quay Lane, going to work by 09:10". */
export function goalLine(g: GoalFacts): string {
  if (g.exitName !== null) return `Leave by ${g.exitName}, ${GOING[g.destLabel]} ${clockTime(g.deadline)}`;
  if (g.service) return `Catch the ${clockTime(g.service.departAt)} to ${g.service.destination}, Platform ${g.service.platformId}`;
  const platform = g.platformId !== null ? `, Platform ${g.platformId}` : "";
  return `Catch the ${clockTime(g.deadline)}${platform}`;
}

export function timeLeftIsShort(timeLeftMin: number, walkMin: number): boolean {
  return timeLeftMin < walkMin + SHORT_MARGIN_MIN;
}

/** What they are doing on the way, or null when they are just heading for their goal. */
export function errandLine(state: PState, errand: number): string | null {
  if (state === PState.Seated) return "Resting";
  switch (errand) {
    case Need.Toilet:
      return "Looking for a toilet";
    case Need.Hunger:
    case Need.Thirst:
      return state === PState.InQueue ? "Queueing for food" : "Getting food";
    case Need.Tired:
      return "Looking for somewhere to sit";
    case Need.Browse:
      return "Browsing";
    case Need.Charge:
      return "Charging a phone";
    default:
      return null;
  }
}

/** The facts goalLine needs, read off the world. */
export function goalFacts(w: World, pid: number): GoalFacts {
  const p = w.people;
  const goal = p.goalKey[pid]!;
  const svc = w.timetable.services.get(p.serviceId[pid]!);
  const exit = goal.startsWith("exit:") ? w.map.entrances.find((e) => `exit:${e.id}` === goal) : undefined;
  return {
    journey: p.journey[pid]! as Journey,
    service: svc && !exit ? { departAt: svc.departAt, destination: svc.destination, platformId: svc.platformId } : null,
    platformId: goal.startsWith("platform:") ? Number(goal.slice(9)) : null,
    exitName: exit ? exit.name : null,
    destLabel: p.destLabel[pid]! as DestLabel,
    deadline: p.deadline[pid]!,
  };
}

/** Unimpeded game minutes from where they stand to their goal; 0 if they can't get there from here. */
export function walkFromHere(w: World, pid: number): number {
  const goal = w.people.goalKey[pid]!;
  if (goal === "") return 0;
  const m = walkMinutes(fieldFor(w, goal), tileOf(w, pid));
  return Number.isFinite(m) ? m : 0;
}
