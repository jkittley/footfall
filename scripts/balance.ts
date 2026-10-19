/** Node global (the project has no Node types). */
declare const process: { argv: string[]; exitCode?: number };

import { createAutoplay, playDays, roomyStation, type DayRow } from "../src/sim/autoplay";
import { currentHoliday } from "../src/sim/clock";
import { SIM_DT } from "../src/sim/constants";
import { createWorld, step } from "../src/sim/world";

// npm run balance                         every target, with a PASS/FAIL line each (exit 1 on a FAIL)
// npm run balance idle|autoplay [days] [seeds]   one player's per-day table, e.g. autoplay 49 1,2,3
// npm run balance needs [seeds]          the whole-day toilets-and-seating check

const SEEDS = [1, 2, 3];
const IDLE_DAYS = 3;
/** Through the first summer holidays (game days 29-42) and the week after. */
const AUTOPLAY_DAYS = 49;
/** The balance may dip this far below zero, and no further. */
const SUMMER_FLOOR = -20000;
/** Game days after the holidays end by which the balance must be positive again. */
const RECOVER_DAYS = 7;

const pct = (x: number | null): string => (x === null ? "-" : `${(x * 100).toFixed(1)}%`);
const money = (x: number): string => Math.round(x).toLocaleString("en-GB");
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? NaN : s[Math.floor(s.length / 2)]!;
};

function printRow(row: DayRow): void {
  console.log(
    [
      String(row.day + 1).padStart(3),
      String(row.added).padStart(5),
      String(row.active).padStart(6),
      pct(row.onTime).padStart(7),
      pct(row.worstMeter).padStart(11),
      money(row.balance).padStart(8),
      money(row.income).padStart(8),
      money(row.upkeep).padStart(7),
      `${row.closed > 0 ? `-${row.closed}` : ""}${row.reopened > 0 ? `+${row.reopened}` : ""}`.padStart(5),
      String(row.moved).padStart(5),
      String(row.peakGateQueue).padStart(11),
      row.gates.join("").padEnd(9),
      row.rentMuls.map((m) => m.toFixed(2)).join(" "),
    ].join(" | "),
  );
}

function table(player: "idle" | "autoplay", days: number, seed: number): DayRow[] {
  const w = createWorld(seed);
  console.log(`\n${player} player, seed ${seed}, ${days} game days`);
  console.log("day |  added | active | on-time | worst meter |  balance |   income |  upkeep | shut+open | moved | peak gate q | gates     | rent x");
  return playDays(w, days, player === "idle" ? null : createAutoplay(w), printRow);
}

const isSummer = (r: DayRow): boolean => currentHoliday(r.day * 1440 + 720) === "Summer holidays";

/** The 1-based game day on which `n` platforms had been added, or null. */
function dayReaching(rows: DayRow[], n: number): number | null {
  const r = rows.find((x) => x.added >= n);
  return r ? r.day + 1 : null;
}

/** Whole-day on-time rate (05:00 to 05:00) of the roomy station over the seeds, pooled. */
function roomyRate(restrooms: boolean, seeds: number[]): number {
  let on = 0;
  let all = 0;
  for (const seed of seeds) {
    const w = createWorld(seed);
    w.ledger.balance = 1e6;
    roomyStation(w, restrooms);
    const until = w.minute + 1440;
    while (w.minute < until) {
      step(w, SIM_DT);
      for (const e of w.events) {
        if (e.kind !== "outcome" || e.excluded) continue;
        all++;
        if (e.onTime) on++;
      }
      w.events.length = 0;
    }
  }
  return on / all;
}

function needsCheck(seeds: number[]): number {
  const withRooms = roomyRate(true, seeds);
  const without = roomyRate(false, seeds);
  console.log(`\nRoomy station, whole day, seeds ${seeds.join(",")}: with toilets and seating ${pct(withRooms)}, without ${pct(without)}`);
  return (withRooms - without) * 100;
}

const results: { target: string; measured: string; pass: boolean }[] = [];
function check(target: string, measured: string, pass: boolean): void {
  results.push({ target, measured, pass });
}

const [mode, a1, a2] = process.argv.slice(2);
if (mode === "idle" || mode === "autoplay") {
  const days = Number(a1 ?? (mode === "idle" ? IDLE_DAYS : AUTOPLAY_DAYS));
  for (const seed of (a2 ?? "1").split(",").map(Number)) table(mode, days, seed);
} else if (mode === "needs") {
  console.log(`gain ${needsCheck((a1 ?? "1,2,3").split(",").map(Number)).toFixed(1)} points`);
} else {
  const t0 = performance.now();
  for (const seed of SEEDS) {
    const rows = table("idle", IDLE_DAYS, seed);
    const added = rows[rows.length - 1]!.added;
    check(`idle, seed ${seed}: 2-3 platforms after ${IDLE_DAYS} game days`, `${added}`, added >= 2 && added <= 3);
  }
  for (const seed of SEEDS) {
    const rows = table("autoplay", AUTOPLAY_DAYS, seed);
    const six = dayReaching(rows, 6);
    const ten = dayReaching(rows, 10);
    const hours = (d: number | null): string => (d === null ? "not reached" : `game day ${d} (${((d * 10) / 60).toFixed(1)} h at x1)`);
    check(`autoplay, seed ${seed}: 6 platforms in game days 9-15`, hours(six), six !== null && six >= 9 && six <= 15);
    check(`autoplay, seed ${seed}: 10 platforms in game days 18-24`, hours(ten), ten !== null && ten >= 18 && ten <= 24);
    const summer = rows.filter(isSummer);
    const firstSummer = summer[0]!.day;
    const lastSummer = summer[summer.length - 1]!.day;
    const spring = rows.filter((r) => r.day < firstSummer);
    const low = Math.min(...spring.filter((r) => r.day + 1 > 2).map((r) => r.balance));
    check(`autoplay, seed ${seed}: money positive after day 2, up to the summer`, `lowest ${money(low)}`, low > 0);
    const rent = median(spring.filter((r) => r.day + 1 > 3).flatMap((r) => r.rentMuls));
    check(`autoplay, seed ${seed}: typical concourse shop near x1.0 rent (median 0.8-1.25)`, `median x${rent.toFixed(2)}`, rent >= 0.8 && rent <= 1.25);
    const floor = Math.min(...rows.map((r) => r.balance));
    check(`autoplay, seed ${seed}: balance never below ${money(SUMMER_FLOOR)} over ${AUTOPLAY_DAYS} days`, `lowest ${money(floor)}`, floor >= SUMMER_FLOOR);
    const recovered = rows.find((r) => r.day >= lastSummer && r.balance > 0);
    check(
      `autoplay, seed ${seed}: balance positive within ${RECOVER_DAYS} days of the summer's end (game day ${lastSummer + 1})`,
      recovered ? `positive on game day ${recovered.day + 1}` : "still negative",
      recovered !== undefined && recovered.day - lastSummer <= RECOVER_DAYS,
    );
    const closures = summer.filter((r) => r.closed > 0).map((r) => r.day + 1);
    check(`autoplay, seed ${seed}: platforms close in the summer`, closures.length > 0 ? `on game days ${closures.join(", ")}` : "none", closures.length > 0);
    const firstClose = summer.find((r) => r.closed > 0)?.day ?? Infinity;
    const reopen = rows.find((r) => r.day > firstClose && r.reopened > 0);
    check(`autoplay, seed ${seed}: and reopen afterwards`, reopen ? `first on game day ${reopen.day + 1}` : "none", reopen !== undefined);
    const weekdays = summer.filter((r) => r.onTime !== null && (r.day % 7) < 5).map((r) => r.onTime!);
    console.log(`summer weekdays on time ${pct(Math.min(...weekdays))}-${pct(Math.max(...weekdays))}, lowest balance ${money(Math.min(...summer.map((r) => r.balance)))}`);
  }
  const gain = needsCheck(SEEDS);
  check("roomy station: toilets and seating at least 5 points better over a whole day", `${gain.toFixed(1)} points`, gain >= 5);
  console.log("\nTargets");
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.target}: ${r.measured}`);
  console.log(`(${((performance.now() - t0) / 1000).toFixed(0)} s)`);
  if (results.some((r) => !r.pass)) process.exitCode = 1;
}
