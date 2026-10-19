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
  timer: Float32Array;
  counted: Uint8Array;

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
    this.timer = new Float32Array(cap);
    this.counted = new Uint8Array(cap);
    this.alive = new Uint8Array(cap);
    this.freeList = new Int32Array(cap);
  }

  /** A fresh slot with every field reset. Throws RangeError when full. */
  alloc(): number {
    if (this.count >= this.cap) throw new RangeError(`PeopleStore full (cap ${this.cap})`);
    const i = this.freeTop > 0 ? this.freeList[--this.freeTop]! : this.top++;
    this.reset(i);
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
    this.timer[i] = 0;
    this.counted[i] = 0;
  }
}
