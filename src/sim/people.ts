import { decodeBytesInto, encodeBytes } from "./base64";
import { ERRAND_COOLDOWN_MIN } from "./constants";

export enum Mode {
  Train = 0,
  Subway = 1,
  Flight = 2,
  Street = 3,
}

export enum Journey {
  Departing = 0,
  Arriving = 1,
  Connecting = 2,
}

/** Where an arriving passenger is headed once they leave the station. */
export enum DestLabel {
  Home = 0,
  Hotel = 1,
  Work = 2,
}

export enum PState {
  Free = 0,
  Walking = 1,
  /** On a platform. */
  Waiting = 2,
  InQueue = 3,
  InFacility = 4,
  Seated = 5,
}

export enum Need {
  Hunger = 0,
  Thirst = 1,
  Tired = 2,
  Toilet = 3,
  Browse = 4,
  Charge = 5,
}

export const NEED_COUNT = 6;

/** A PeopleStore as saved: every per-slot array, cut to the slots ever handed out. */
export interface PeopleSave {
  count: number;
  freeTop: number;
  top: number;
  /** Typed arrays (base64 of their bytes), by field name. */
  arrays: Record<string, string>;
  /** Next serial to hand out; absent in saves from before serials existed. */
  nextSerial?: number;
  /** String arrays, by field name. */
  strings: Record<string, string[]>;
}

/**
 * Struct-of-arrays store of people; slot indices are stable while a person is alive.
 * Liveness is isAlive / forEachAlive, never `state === PState.Free` (Free is a live state).
 */
export class PeopleStore {
  readonly cap: number;
  count = 0;
  x: Float32Array;
  y: Float32Array;
  state: Uint8Array;
  mode: Uint8Array;
  journey: Uint8Array;
  /** Field key currently walked to. */
  targetKey: string[];
  /** End goal field key. */
  goalKey: string[];
  serviceId: Int32Array;
  deadline: Float64Array;
  spawnedAt: Float64Array;
  /** Unimpeded walk minutes to the goal, measured at spawn. */
  spawnWalk: Float32Array;
  speedMul: Float32Array;
  leisure: Uint8Array;
  destLabel: Uint8Array;
  /** cap * NEED_COUNT. */
  needs: Float32Array;
  /** Need being served, or -1. */
  errand: Int8Array;
  errandFacility: Int32Array;
  /** cap * NEED_COUNT, facility id or -1. */
  known: Int32Array;
  /** Game minutes spent on the current errand with no facility known for it. */
  seekMin: Float32Array;
  /** Game minutes left before a new errand may start. */
  errandCooldown: Float32Array;
  /** Tile a desperate walker is lurching to, or -1. */
  drift: Int32Array;
  timer: Float32Array;
  counted: Uint8Array;
  /** Unique per person for the life of the game; unlike the slot, never reused. */
  serial: Float64Array;

  private nextSerial = 0;
  private readonly alive: Uint8Array;
  private readonly freeList: Int32Array;
  private freeTop = 0;
  /** One past the highest slot ever handed out. */
  private top = 0;

  constructor(cap: number) {
    this.cap = cap;
    this.x = new Float32Array(cap);
    this.y = new Float32Array(cap);
    this.state = new Uint8Array(cap);
    this.mode = new Uint8Array(cap);
    this.journey = new Uint8Array(cap);
    this.targetKey = new Array<string>(cap).fill("");
    this.goalKey = new Array<string>(cap).fill("");
    this.serviceId = new Int32Array(cap);
    this.deadline = new Float64Array(cap);
    this.spawnedAt = new Float64Array(cap);
    this.spawnWalk = new Float32Array(cap);
    this.speedMul = new Float32Array(cap);
    this.leisure = new Uint8Array(cap);
    this.destLabel = new Uint8Array(cap);
    this.needs = new Float32Array(cap * NEED_COUNT);
    this.errand = new Int8Array(cap);
    this.errandFacility = new Int32Array(cap);
    this.known = new Int32Array(cap * NEED_COUNT);
    this.seekMin = new Float32Array(cap);
    this.errandCooldown = new Float32Array(cap);
    this.drift = new Int32Array(cap);
    this.timer = new Float32Array(cap);
    this.counted = new Uint8Array(cap);
    this.serial = new Float64Array(cap);
    this.alive = new Uint8Array(cap);
    this.freeList = new Int32Array(cap);
  }

  /** A fresh slot with every field reset. Throws RangeError when full. */
  alloc(): number {
    if (this.count >= this.cap) throw new RangeError(`PeopleStore full (cap ${this.cap})`);
    const i = this.freeTop > 0 ? this.freeList[--this.freeTop]! : this.top++;
    this.reset(i);
    this.serial[i] = this.nextSerial++;
    this.alive[i] = 1;
    this.count++;
    return i;
  }

  free(i: number): void {
    if (!this.alive[i]) return;
    this.alive[i] = 0;
    this.state[i] = PState.Free;
    this.targetKey[i] = "";
    this.goalKey[i] = "";
    this.freeList[this.freeTop++] = i;
    this.count--;
  }

  /** One past the highest slot ever handed out: loops over `0..end` see every live person. */
  get end(): number {
    return this.top;
  }

  isAlive(i: number): boolean {
    return this.alive[i] === 1;
  }

  forEachAlive(fn: (i: number) => void): void {
    const top = this.top;
    for (let i = 0; i < top; i++) if (this.alive[i]) fn(i);
  }

  /**
   * Walks every array field (private ones too), so a field added later is saved without anyone
   * remembering to list it.
   */
  toSave(): PeopleSave {
    const arrays: Record<string, string> = {};
    const strings: Record<string, string[]> = {};
    for (const [name, v] of Object.entries(this)) {
      if (ArrayBuffer.isView(v)) arrays[name] = encodeBytes(v, (v.byteLength / this.cap) * this.top);
      else if (Array.isArray(v)) strings[name] = v.slice(0, this.top);
    }
    return {
      count: this.count,
      freeTop: this.freeTop,
      top: this.top,
      arrays,
      strings,
      nextSerial: this.nextSerial,
    };
  }

  static fromSave(cap: number, s: PeopleSave): PeopleStore {
    const p = new PeopleStore(cap);
    const int = (n: unknown): n is number => Number.isInteger(n);
    if (!int(s.top) || !int(s.count) || !int(s.freeTop) || s.count < 0 || s.freeTop < 0 || s.top > cap) {
      throw new Error("Corrupt save: people");
    }
    // Every slot ever handed out is either alive or on the free list.
    if (s.count + s.freeTop !== s.top) throw new Error("Corrupt save: people.count");
    if (typeof s.arrays !== "object" || s.arrays === null || typeof s.strings !== "object" || s.strings === null) {
      throw new Error("Corrupt save: people");
    }
    for (const [name, v] of Object.entries(p)) {
      if (ArrayBuffer.isView(v)) {
        const b64 = s.arrays[name];
        if (name === "serial" && b64 === undefined) {
          // Saved before serials: the slot id was the identity, so keep it.
          for (let i = 0; i < s.top; i++) p.serial[i] = i;
          continue;
        }
        if (decodeBytesInto(v, b64) !== (v.byteLength / cap) * s.top) {
          throw new Error(`Corrupt save: people.${name}`);
        }
      } else if (Array.isArray(v)) {
        const xs = s.strings[name];
        if (!Array.isArray(xs) || xs.length !== s.top || !xs.every((x) => typeof x === "string")) {
          throw new Error(`Corrupt save: people.${name}`);
        }
        for (let i = 0; i < xs.length; i++) v[i] = xs[i];
      }
    }
    p.count = s.count;
    p.freeTop = s.freeTop;
    p.top = s.top;
    if (s.nextSerial !== undefined && !(Number.isInteger(s.nextSerial) && s.nextSerial >= 0)) {
      throw new Error("Corrupt save: people.nextSerial");
    }
    p.nextSerial = s.nextSerial ?? s.top;
    return p;
  }

  /** Errand over, met or not: full speed again, and a pause before the next one. */
  endErrand(i: number): void {
    this.errand[i] = -1;
    this.errandFacility[i] = -1;
    this.speedMul[i] = 1;
    this.drift[i] = -1;
    this.errandCooldown[i] = ERRAND_COOLDOWN_MIN;
  }

  private reset(i: number): void {
    this.x[i] = 0;
    this.y[i] = 0;
    this.state[i] = PState.Free;
    this.mode[i] = 0;
    this.journey[i] = 0;
    this.targetKey[i] = "";
    this.goalKey[i] = "";
    this.serviceId[i] = -1;
    this.deadline[i] = 0;
    this.spawnedAt[i] = 0;
    this.spawnWalk[i] = 0;
    this.speedMul[i] = 1;
    this.leisure[i] = 0;
    this.destLabel[i] = 0;
    this.needs.fill(0, i * NEED_COUNT, (i + 1) * NEED_COUNT);
    this.errand[i] = -1;
    this.errandFacility[i] = -1;
    this.known.fill(-1, i * NEED_COUNT, (i + 1) * NEED_COUNT);
    this.seekMin[i] = 0;
    this.errandCooldown[i] = 0;
    this.drift[i] = -1;
    this.timer[i] = 0;
    this.counted[i] = 0;
  }
}
