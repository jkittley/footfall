export const START_MINUTE = 300;

const DAY = 1440;
const WEEK = 7 * DAY;
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MIN_DEMAND = 0.05;

export function dayIndex(m: number): number {
  return Math.floor(m / DAY);
}
export function dayOfWeek(m: number): number {
  return dayIndex(m) % 7;
}
export function minuteOfDay(m: number): number {
  return Math.floor(m) - dayIndex(m) * DAY;
}
function weekIndex(m: number): number {
  return Math.floor(m / WEEK);
}
export function month(m: number): number {
  return (2 + weekIndex(m)) % 12;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function formatClock(m: number): string {
  const mod = minuteOfDay(m);
  const name = DAYS[dayOfWeek(m)] ?? "";
  const monthName = MONTHS[month(m)] ?? "";
  return `${name} ${pad(Math.floor(mod / 60))}:${pad(mod % 60)} · ${monthName}`;
}

function isSummer(m: number): boolean {
  const mo = month(m);
  return mo === 6 || mo === 7;
}
function isChristmas(m: number): boolean {
  const d = dayOfWeek(m);
  return month(m) === 11 && d >= 3 && d <= 6;
}

export function periodLabel(m: number): string {
  const mod = minuteOfDay(m);
  const night = mod >= 60 && mod < 300;
  let label: string;
  if (dayOfWeek(m) >= 5) label = night ? "Night" : "Weekend";
  else if (night) label = "Night";
  else if (mod < 420) label = mod >= 300 ? "Early morning" : "Evening";
  else if (mod < 570) label = "Morning peak";
  else if (mod < 990) label = "Midday";
  else if (mod < 1140) label = "Evening peak";
  else label = "Evening";
  if (isSummer(m)) label += " · Summer holidays";
  else if (isChristmas(m)) label += " · Christmas";
  return label;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
function gauss(x: number, centre: number, sigma: number): number {
  const z = (x - centre) / sigma;
  return Math.exp(-0.5 * z * z);
}
/** 0 in the dead of night, 1 through the day; continuous across midnight. */
function dayEnvelope(hour: number): number {
  const h = hour < 1 ? hour + 24 : hour;
  return smoothstep(5, 7, h) * (1 - smoothstep(23, 25, h));
}

function dayShape(m: number): number {
  const hour = minuteOfDay(m) / 60 + (m - Math.floor(m)) / 60;
  const base = MIN_DEMAND + (1 - MIN_DEMAND) * dayEnvelope(hour);
  const d = dayOfWeek(m);
  if (d >= 5) {
    // Raised-cosine hump over 10:00 to 18:00.
    const hump = hour > 10 && hour < 18 ? 0.5 * (1 - Math.cos(((hour - 10) / 8) * 2 * Math.PI)) : 0;
    return base + 0.3 * hump;
  }
  const evening = d === 4 ? 1.4 * 1.25 : 1.4;
  return base + 1.6 * gauss(hour, 8.25, 0.9) + evening * gauss(hour, 17.75, 1);
}

function holidayFactor(m: number): number {
  if (isSummer(m)) return 1.15;
  if (isChristmas(m)) return 1.5;
  return 1;
}

export function demand(m: number): number {
  return Math.max(MIN_DEMAND, dayShape(m) * holidayFactor(m));
}

export function leisureShare(m: number): number {
  const base = dayOfWeek(m) >= 5 ? 0.6 : 0.2;
  const holiday = isSummer(m) || isChristmas(m) ? 0.2 : 0;
  return Math.min(0.9, base + holiday);
}

export type Holiday = { name: "Summer holidays" | "Christmas"; startsAt: number };

/** The holiday running at minute m, if any. */
export function currentHoliday(m: number): Holiday["name"] | null {
  if (isSummer(m)) return "Summer holidays";
  if (isChristmas(m)) return "Christmas";
  return null;
}

/** The next holiday start at or after minute m. */
export function nextHoliday(m: number): Holiday | null {
  const first = Math.max(0, weekIndex(m));
  for (let w = first; w < first + 13; w++) {
    const mo = (2 + w) % 12;
    if (mo === 6 && w * WEEK >= m) return { name: "Summer holidays", startsAt: w * WEEK };
    if (mo === 11 && w * WEEK + 3 * DAY >= m) return { name: "Christmas", startsAt: w * WEEK + 3 * DAY };
  }
  return null;
}
