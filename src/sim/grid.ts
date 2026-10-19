export enum Tile {
  Ground = 0,
  Obstacle = 1,
  Floor = 2,
  Wall = 3,
  Track = 4,
  Platform = 5,
  Entrance = 6,
  Rail = 7,
  /** An open ticket gate: walkable, admitting one person per GATE_INTERVAL_SEC. */
  Gate = 8,
  /** A closed-off slot in a gate line. */
  GateClosed = 9,
  /** The city's river and harbour: unwalkable, unbuildable. */
  Water = 10,
  /** Parks: unwalkable, unbuildable. */
  Park = 11,
  /** Roads (people walk only on pavements): unwalkable, unbuildable. */
  Road = 12,
  /** A later stage's site, under a haze until it opens: unwalkable, unbuildable. */
  Locked = 13,
  /** Pavements to the entrances, the footbridge and bridge pavements: walkable, unbuildable. */
  Pavement = 14,
}

export enum Zone {
  None = 0,
  Retail = 1,
  Seating = 2,
  Toilet = 3,
  Travelator = 4,
}

export enum Dir {
  N = 0,
  E = 1,
  S = 2,
  W = 3,
  None = 255,
}

/** Bits of Grid.built: what on a tile the player paid for (removing refunds only these). */
export const BUILT_FLOOR = 1;
/** A wall, rail or opened gate standing on the tile. */
export const BUILT_TOP = 2;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class Grid {
  readonly w: number;
  readonly h: number;
  tiles: Uint8Array;
  zones: Uint8Array;
  /** Owning facility id per tile, -1 for none. */
  zoneOwner: Int32Array;
  dir: Uint8Array;
  /** BUILT_FLOOR | BUILT_TOP per tile; the starting station and whatever opening a platform paints are 0. */
  built: Uint8Array;
  /** Bumped by every mutator so caches (e.g. flow fields) know to rebuild. */
  version = 0;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.tiles = new Uint8Array(w * h);
    this.zones = new Uint8Array(w * h);
    this.zoneOwner = new Int32Array(w * h).fill(-1);
    this.dir = new Uint8Array(w * h).fill(Dir.None);
    this.built = new Uint8Array(w * h);
  }

  idx(x: number, y: number): number {
    return y * this.w + x;
  }

  xy(i: number): [number, number] {
    return [i % this.w, Math.floor(i / this.w)];
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  tile(x: number, y: number): Tile {
    return this.tiles[this.idx(x, y)] as Tile;
  }

  zone(x: number, y: number): Zone {
    return this.zones[this.idx(x, y)] as Zone;
  }

  setTile(x: number, y: number, t: Tile): void {
    this.tiles[this.idx(x, y)] = t;
    this.version++;
  }

  setZone(x: number, y: number, z: Zone, owner: number): void {
    const i = this.idx(x, y);
    this.zones[i] = z;
    this.zoneOwner[i] = owner;
    this.version++;
  }

  /** The only way game code writes a direction, so route fields see the change. */
  setDir(x: number, y: number, d: Dir): void {
    this.dir[this.idx(x, y)] = d;
    this.version++;
  }

  isWalkable(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false;
    const t = this.tile(x, y);
    if (t !== Tile.Floor && t !== Tile.Platform && t !== Tile.Entrance && t !== Tile.Gate && t !== Tile.Pavement) return false;
    const z = this.zone(x, y);
    return z === Zone.None || z === Zone.Seating || z === Zone.Travelator;
  }

  clone(): Grid {
    const g = new Grid(this.w, this.h);
    g.tiles = this.tiles.slice();
    g.zones = this.zones.slice();
    g.zoneOwner = this.zoneOwner.slice();
    g.dir = this.dir.slice();
    g.built = this.built.slice();
    g.version = this.version;
    return g;
  }
}
