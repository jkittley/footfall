import { Grid, Tile, type Rect } from "../grid";

export interface PlatformSlot {
  id: number;
  track: Rect;
  platform: Rect;
  foot: Rect;
}

export interface EntranceDef {
  id: string;
  name: string;
  tiles: Rect;
  weight: number;
}

export interface ObstacleDef {
  name: string;
  rect: Rect;
}

export interface StationMap {
  name: "Harbour Street";
  w: 120;
  h: 90;
  startingPlatforms: 2;
  slots: PlatformSlot[];
  entrances: EntranceDef[];
  obstacles: ObstacleDef[];
  startingFloor: Rect[];
}

const PLATFORM_TOP = 24;
const PLATFORM_LEN = 30;
const CONCOURSE_TOP = PLATFORM_TOP + PLATFORM_LEN;

function makeSlot(id: number): PlatformSlot {
  const x = 8 + 4 * (id - 1);
  return {
    id,
    track: { x, y: PLATFORM_TOP, w: 1, h: PLATFORM_LEN },
    platform: { x: x + 1, y: PLATFORM_TOP, w: 2, h: PLATFORM_LEN },
    // Spans the gap column too, so neighbouring aprons join into one concourse.
    foot: { x, y: CONCOURSE_TOP, w: 4, h: 2 },
  };
}

// The slot field (every slot's track, platform and foot) stays obstacle-free so
// platforms can be painted later. Rows 22-23 are a Ground buffer between the
// track bed and the platform tops. Pinch points sit east of the field (x 84..95)
// and at the canal crossing: the route to Quay Lane must use each of them.
const OBSTACLES: ObstacleDef[] = [
  { name: "Track bed (north throat)", rect: { x: 6, y: 0, w: 76, h: 22 } },
  { name: "Neighbouring offices", rect: { x: 0, y: 20, w: 5, h: 30 } },
  { name: "St Mary's Church (listed)", rect: { x: 0, y: 62, w: 7, h: 14 } },
  { name: "The Old Customs House (listed)", rect: { x: 20, y: 64, w: 14, h: 10 } },
  { name: "Fish market hall", rect: { x: 38, y: 64, w: 12, h: 10 } },
  { name: "Pilot's Row terraces", rect: { x: 53, y: 66, w: 10, h: 12 } },
  { name: "Chandlery", rect: { x: 66, y: 66, w: 8, h: 12 } },
  { name: "Bus lane", rect: { x: 54, y: 62, w: 30, h: 3 } },
  { name: "Harbour Road", rect: { x: 0, y: 80, w: 120, h: 10 } },
  { name: "Coal depot", rect: { x: 84, y: 4, w: 10, h: 18 } },
  { name: "Goods shed", rect: { x: 84, y: 22, w: 4, h: 34 } },
  { name: "Coal wharf sidings", rect: { x: 84, y: 59, w: 4, h: 21 } },
  { name: "Signal works (north)", rect: { x: 90, y: 22, w: 3, h: 22 } },
  { name: "Signal works (south)", rect: { x: 90, y: 47, w: 3, h: 33 } },
  { name: "Station Master's House (listed)", rect: { x: 30, y: 57, w: 8, h: 5 } },
  { name: "Left luggage office", rect: { x: 52, y: 57, w: 6, h: 4 } },
  { name: "Ashby Canal (north reach)", rect: { x: 96, y: 0, w: 6, h: 56 } },
  { name: "Ashby Canal (south reach)", rect: { x: 96, y: 60, w: 6, h: 20 } },
  { name: "Quay warehouse", rect: { x: 104, y: 20, w: 12, h: 20 } },
  { name: "Customs yard", rect: { x: 104, y: 64, w: 12, h: 10 } },
];

export const HARBOUR_STREET: StationMap = {
  name: "Harbour Street",
  w: 120,
  h: 90,
  startingPlatforms: 2,
  slots: Array.from({ length: 18 }, (_, i) => makeSlot(i + 1)),
  entrances: [
    { id: "A", name: "Harbour Road", tiles: { x: 9, y: 79, w: 4, h: 1 }, weight: 3 },
    { id: "B", name: "Market Place", tiles: { x: 0, y: 55, w: 1, h: 3 }, weight: 2 },
    { id: "C", name: "Quay Lane", tiles: { x: 119, y: 55, w: 1, h: 4 }, weight: 2 },
  ],
  obstacles: OBSTACLES,
  startingFloor: [
    { x: 6, y: CONCOURSE_TOP + 2, w: 10, h: 4 },
    { x: 9, y: 60, w: 4, h: 19 },
    { x: 1, y: 55, w: 5, h: 3 },
  ],
};

function fill(grid: Grid, r: Rect, t: Tile): void {
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) grid.setTile(x, y, t);
}

export function paintSlot(grid: Grid, slot: PlatformSlot): void {
  fill(grid, slot.track, Tile.Track);
  fill(grid, slot.platform, Tile.Platform);
  fill(grid, slot.foot, Tile.Floor);
}

export function buildGrid(map: StationMap, platformsAdded: number): Grid {
  const g = new Grid(map.w, map.h);
  for (const o of map.obstacles) fill(g, o.rect, Tile.Obstacle);
  for (const r of map.startingFloor) fill(g, r, Tile.Floor);
  for (const e of map.entrances) fill(g, e.tiles, Tile.Entrance);
  for (const s of map.slots.slice(0, platformsAdded)) paintSlot(g, s);
  return g;
}
