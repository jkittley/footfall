// Pure text for the HUD, tooltips and toasts: no DOM, so it is unit-tested.
import type { PlacementPreview, ToolId } from "../sim/build";
import { currentHoliday, dayOfWeek, nextHoliday } from "../sim/clock";
import type { DaySummary } from "../sim/economy";
import type { GameEvent } from "../sim/world";

const DAY = 1440;
/** U+2212, the minus sign: money is never shown with a hyphen. */
const MINUS = "−";
const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export const TOOL_NAMES: Record<ToolId, string> = {
  floor: "New floor",
  retail: "Shop",
  seating: "Seating",
  toilet: "Toilets",
  wall: "Wall",
  rail: "Queue rail",
  gate: "Gate",
  sign: "Sign",
  travelator: "Travelator",
  remove: "Remove",
};

/** "4,920": a whole number with thousands separators. */
export function formatCount(n: number): string {
  const r = Math.round(Math.abs(n));
  const s = String(r).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return n < 0 && r > 0 ? `${MINUS}${s}` : s;
}

export function isNegativeMoney(n: number): boolean {
  return Math.round(n) < 0;
}

/** "£12,450", or "−£340" when negative; whole pounds, rounded here and nowhere else. */
export function formatMoney(n: number): string {
  const sign = isNegativeMoney(n) ? MINUS : "";
  return `${sign}£${formatCount(Math.abs(n))}`;
}

/** "+£3,410" for a gain, "−£340" for a loss, "£0" for neither. */
export function formatSignedMoney(n: number): string {
  return Math.round(n) > 0 ? `+${formatMoney(n)}` : formatMoney(n);
}

/** "96%". */
export function formatPercent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/** "Summer holidays in 2 weeks", "Christmas next week", "Summer holidays now"; null if none is coming. */
export function holidayLine(m: number): string | null {
  const now = currentHoliday(m);
  if (now) return `${now} now`;
  const next = nextHoliday(m);
  if (!next) return null;
  const days = Math.ceil((next.startsAt - m) / DAY);
  if (days <= 1) return `${next.name} tomorrow`;
  if (days < 7) return `${next.name} in ${days} days`;
  if (days < 14) return `${next.name} next week`;
  return `${next.name} in ${Math.floor(days / 7)} weeks`;
}

/** "Monday: 4,920 moved, 96% on time, +£3,410" for the day that ended. */
export function daySummaryText(s: DaySummary): string {
  const name = DAY_NAMES[dayOfWeek(s.day * DAY)] ?? "";
  const timed = s.onTime + s.missed;
  const parts = [`${formatCount(s.moved)} moved`];
  if (timed > 0) parts.push(`${formatPercent(s.onTime / timed)} on time`);
  parts.push(formatSignedMoney(s.income - s.costs));
  return `${name}: ${parts.join(", ")}`;
}

export interface Tooltip {
  text: string;
  /** Why it can't be built, shown on a second line in Alert red. */
  reason: string | null;
}

/** "New floor · 88 tiles · £8,800 · you have £12,450", or "Remove · 6 tiles · +£300". */
export function placementTooltip(pv: PlacementPreview, balance: number): Tooltip {
  // A facility or gate counts its whole rect, so the tooltip reads the same over a tile it can't take.
  const whole = pv.tool === "retail" || pv.tool === "toilet" || pv.tool === "seating" || pv.tool === "gate";
  const n = whole ? pv.rect.w * pv.rect.h : pv.tiles.length;
  const tiles = `${formatCount(n)} ${n === 1 ? "tile" : "tiles"}`;
  const reason = pv.valid ? null : pv.reason;
  if (pv.tool === "remove") return { text: `Remove · ${tiles} · ${formatSignedMoney(-pv.cost)}`, reason };
  return { text: `${TOOL_NAMES[pv.tool]} · ${tiles} · ${formatMoney(pv.cost)} · you have ${formatMoney(balance)}`, reason };
}

export interface Toast {
  text: string;
  /** "day" is the end-of-day summary card. */
  style: "note" | "day";
}

/** The toast a game event shows, if any; none that only repeats the disruption banner's text. */
export function toastForEvent(ev: GameEvent, bannerText: string | null = null): Toast | null {
  if (ev.kind === "toast") return ev.text === bannerText ? null : { text: ev.text, style: "note" };
  if (ev.kind === "dayEnd") return { text: daySummaryText(ev.summary), style: "day" };
  return null;
}
