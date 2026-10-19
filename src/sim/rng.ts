// mulberry32: tiny, fast, and its whole state is one 32-bit integer.
export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [lo, hi], both inclusive. */
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }

  pick<T>(xs: readonly T[]): T {
    if (xs.length === 0) throw new Error("Rng.pick: empty list");
    return xs[this.int(0, xs.length - 1)]!;
  }

  weighted<T>(items: readonly { item: T; w: number }[]): T {
    let total = 0;
    for (const it of items) total += it.w;
    if (items.length === 0 || total <= 0) throw new Error("Rng.weighted: no weight");
    let r = this.next() * total;
    for (const it of items) {
      r -= it.w;
      if (r < 0) return it.item;
    }
    return items[items.length - 1]!.item;
  }

  poisson(mean: number): number {
    if (mean <= 0) return 0;
    if (mean > 30) {
      // Knuth's loop underflows for large means; use a normal approximation.
      const u1 = 1 - this.next();
      const u2 = this.next();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      return Math.max(0, Math.round(mean + Math.sqrt(mean) * z));
    }
    const limit = Math.exp(-mean);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= this.next();
    } while (p > limit);
    return k - 1;
  }

  state(): number {
    return this.s;
  }

  static fromState(s: number): Rng {
    return new Rng(s);
  }
}
