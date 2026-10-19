export enum Tile {
  Ground = 0,
  Obstacle = 1,
  Floor = 2,
  Wall = 3,
  Track = 4,
  Platform = 5,
  Entrance = 6,
  Rail = 7,
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
  /** Bumped by every mutator so caches (e.g. flow fields) know to rebuild. */
  version = 0;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.tiles = new Uint8Array(w * h);
    this.zones = new Uint8Array(w * h);
    this.zoneOwner = new Int32Array(w * h).fill(-1);
    this.dir = new Uint8Array(w * h).fill(Dir.None);
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
    if (t !== Tile.Floor && t !== Tile.Platform && t !== Tile.Entrance) return false;
    const z = this.zone(x, y);
    return z === Zone.None || z === Zone.Seating || z === Zone.Travelator;
  }

  clone(): Grid {
    const g = new Grid(this.w, this.h);
    g.tiles = this.tiles.slice();
    g.zones = this.zones.slice();
    g.zoneOwner = this.zoneOwner.slice();
    g.dir = this.dir.slice();
    g.version = this.version;
    return g;
  }
}
