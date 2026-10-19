import { Tile, Zone } from "./grid";
import type { World } from "./world";

export type LedgerLine = "rent" | "fares" | "refunds" | "build" | "maintenance" | "evictions" | "removals";

const LINES: readonly LedgerLine[] = ["rent", "fares", "refunds", "build", "maintenance", "evictions", "removals"];
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

  closeDay(day: number, stats: DayStats): DaySummary {
    let income = 0;
    let costs = 0;
    for (const line of LINES) {
      if (INCOME_LINES.has(line)) income += this.today[line];
      else costs += this.today[line];
    }
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
  let total = 0;
  for (let i = 0; i < g.tiles.length; i++) {
    switch (g.zones[i] as Zone) {
      case Zone.Retail:
        total += UPKEEP_PER_DAY.retail;
        continue;
      case Zone.Seating:
        total += UPKEEP_PER_DAY.seating;
        continue;
      case Zone.Toilet:
        total += UPKEEP_PER_DAY.toilet;
        continue;
      case Zone.Travelator:
        total += UPKEEP_PER_DAY.travelator;
        continue;
      default:
        break;
    }
    switch (g.tiles[i] as Tile) {
      case Tile.Floor:
      case Tile.Platform:
      case Tile.Entrance:
        total += UPKEEP_PER_DAY.floor;
        break;
      case Tile.Wall:
        total += UPKEEP_PER_DAY.wall;
        break;
      case Tile.Rail:
        total += UPKEEP_PER_DAY.rail;
        break;
      default:
        break;
    }
  }
  return total + w.signs.length * UPKEEP_PER_DAY.sign;
}
