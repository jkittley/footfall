import { Tile, Zone, type Grid } from "./grid";
import type { World } from "./world";

export type LedgerLine = "rent" | "fares" | "refunds" | "build" | "maintenance" | "evictions" | "removals";

export const LEDGER_LINES: readonly LedgerLine[] = ["rent", "fares", "refunds", "build", "maintenance", "evictions", "removals"];
// Removal refunds come back as income.
const INCOME_LINES: ReadonlySet<LedgerLine> = new Set<LedgerLine>(["rent", "fares", "removals"]);

export interface DayStats {
  movedToday: number;
  onTimeToday: number;
  missedToday: number;
}

export interface DaySummary {
  day: number;
  moved: number;
  onTime: number;
  missed: number;
  income: number;
  costs: number;
  balance: number;
}

export const PRICES = {
  floor: 100,
  retail: 250,
  seating: 80,
  toilet: 400,
  wall: 20,
  rail: 15,
  sign: 150,
  travelator: 600,
  gate: 500,
  evict: 2000,
} as const;

export const UPKEEP_PER_DAY = {
  floor: 2,
  retail: 3,
  seating: 2,
  toilet: 12,
  wall: 0.5,
  rail: 0.5,
  sign: 5,
  travelator: 20,
  gate: 15,
} as const;

export const RENT_SHARE = 0.2;
export const FARE_BONUS = 4;
export const REFUND = 12;
export const DISRUPTION_REFUND_FACTOR = 0.4;
export const STARTING_CASH = 20000;
export const REMOVE_REFUND = 0.5;

function emptyLines(): Record<LedgerLine, number> {
  return { rent: 0, fares: 0, refunds: 0, build: 0, maintenance: 0, evictions: 0, removals: 0 };
}

/** Amounts are kept positive per line; the line decides whether it is income or a cost. */
export class Ledger {
  balance: number;
  today: Record<LedgerLine, number> = emptyLines();

  constructor(startingCash: number) {
    this.balance = startingCash;
  }

  canAfford(cost: number): boolean {
    return this.balance - cost >= 0;
  }

  credit(line: LedgerLine, amount: number): void {
    this.balance += amount;
    this.today[line] += amount;
  }

  /** May push the balance below zero: that only blocks building. */
  debit(line: LedgerLine, amount: number): void {
    this.balance -= amount;
    this.today[line] += amount;
  }

  /** Today's takings and spending so far, each a positive sum of its lines. */
  todayTotals(): { income: number; costs: number } {
    let income = 0;
    let costs = 0;
    for (const line of LEDGER_LINES) {
      if (INCOME_LINES.has(line)) income += this.today[line];
      else costs += this.today[line];
    }
    return { income, costs };
  }

  closeDay(day: number, stats: DayStats): DaySummary {
    const { income, costs } = this.todayTotals();
    this.today = emptyLines();
    return {
      day,
      moved: stats.movedToday,
      onTime: stats.onTimeToday,
      missed: stats.missedToday,
      income,
      costs,
      balance: this.balance,
    };
  }
}

/** Upkeep for one day: a zoned tile pays its zone's rate instead of the floor rate. */
export function dailyUpkeep(w: World): number {
  const g = w.grid;
  const r = w.map.grounds;
  let total = 0;
  // Nothing is built outside the station's grounds.
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) total += tileUpkeep(g, y * g.w + x);
  return total + w.signs.length * UPKEEP_PER_DAY.sign;
}

function tileUpkeep(g: Grid, i: number): number {
  switch (g.zones[i] as Zone) {
    case Zone.Retail:
      return UPKEEP_PER_DAY.retail;
    case Zone.Seating:
      return UPKEEP_PER_DAY.seating;
    case Zone.Toilet:
      return UPKEEP_PER_DAY.toilet;
    case Zone.Travelator:
      return UPKEEP_PER_DAY.travelator;
    default:
      break;
  }
  switch (g.tiles[i] as Tile) {
    case Tile.Floor:
    case Tile.Platform:
    case Tile.Entrance:
      return UPKEEP_PER_DAY.floor;
    case Tile.Wall:
      return UPKEEP_PER_DAY.wall;
    case Tile.Rail:
      return UPKEEP_PER_DAY.rail;
    case Tile.Gate:
      return UPKEEP_PER_DAY.gate;
    default:
      return 0;
  }
}
