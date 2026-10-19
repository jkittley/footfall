import { Grid, Tile, type Rect } from "../grid";

/** One island: a shared walkway with a track either side, and a foot joining it to the concourse. */
export interface IslandDef {
  id: number;
  walkway: Rect;
  leftTrack: Rect;
  rightTrack: Rect;
  foot: Rect;
  /** The walkway's southernmost row: the ticket gates every passenger crosses. */
  gateLine: Rect;
}

/**
 * One platform: its island's left or right track, and its half of the walkway (its own waiting
 * area): the edge column beside its track and the column in from it. The walkway's middle column
 * belongs to neither half.
 */
export interface PlatformSlot {
  id: number;
  island: number;
  side: "left" | "right";
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
  islands: IslandDef[];
  slots: PlatformSlot[];
  entrances: EntranceDef[];
  obstacles: ObstacleDef[];
  startingFloor: Rect[];
}

const PLATFORM_TOP = 24;
const PLATFORM_LEN = 30;
const CONCOURSE_TOP = PLATFORM_TOP + PLATFORM_LEN;

function makeIsland(id: number): IslandDef {
  const x0 = 8 + 8 * (id - 1);
  return {
    id,
    walkway: { x: x0 + 1, y: PLATFORM_TOP, w: 5, h: PLATFORM_LEN },
    leftTrack: { x: x0, y: PLATFORM_TOP, w: 1, h: PLATFORM_LEN },
    rightTrack: { x: x0 + 6, y: PLATFORM_TOP, w: 1, h: PLATFORM_LEN },
    // Spans the gap column too, so neighbouring aprons join into one concourse.
    foot: { x: x0, y: CONCOURSE_TOP, w: 8, h: 2 },
    gateLine: { x: x0 + 1, y: CONCOURSE_TOP - 1, w: 5, h: 1 },
  };
}

const ISLANDS: IslandDef[] = Array.from({ length: 9 }, (_, i) => makeIsland(i + 1));

function makeSlot(id: number): PlatformSlot {
  const island = ISLANDS[Math.ceil(id / 2) - 1]!;
  const left = id % 2 === 1;
  const half = left ? island.walkway.x : island.walkway.x + island.walkway.w - 2;
  return {
    id,
    island: island.id,
    side: left ? "left" : "right",
    track: left ? island.leftTrack : island.rightTrack,
    platform: { x: half, y: PLATFORM_TOP, w: 2, h: PLATFORM_LEN },
    foot: island.foot,
  };
}

// The island field (every island's tracks, walkway and foot, x 8..79) stays obstacle-free so
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
  islands: ISLANDS,
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

/** Every rect of an island's footprint: walkway, both tracks and foot. */
export function islandRects(island: IslandDef): Rect[] {
  return [island.walkway, island.leftTrack, island.rightTrack, island.foot];
}

/** The island whose walkway, above its gate row, holds (x, y); undefined if none. */
function walkwayIslandAt(map: StationMap, x: number, y: number): IslandDef | undefined {
  return map.islands.find((isl) => {
    const r = isl.walkway;
    return x >= r.x && x < r.x + r.w && y >= r.y && y < isl.gateLine.y;
  });
}

/** A walkway's edge column beside a track, above the gate row: where people wait and board, so nothing is built there. */
export function isPlatformEdge(map: StationMap, x: number, y: number): boolean {
  const isl = walkwayIslandAt(map, x, y);
  return isl !== undefined && (x === isl.walkway.x || x === isl.walkway.x + isl.walkway.w - 1);
}

/** A walkway's middle columns, above the gate row: where an island takes seating, shops and the like. */
export function isIslandCentre(map: StationMap, x: number, y: number): boolean {
  return walkwayIslandAt(map, x, y) !== undefined && !isPlatformEdge(map, x, y);
}

/** Reads one walkway tile: walkways are reserved until painted, so nothing else puts Platform there. */
export function isIslandPainted(grid: Grid, island: IslandDef): boolean {
  return grid.tile(island.walkway.x, island.walkway.y) === Tile.Platform;
}

export function paintIsland(grid: Grid, island: IslandDef): void {
  fill(grid, island.leftTrack, Tile.Track);
  fill(grid, island.rightTrack, Tile.Track);
  fill(grid, island.walkway, Tile.Platform);
  fill(grid, island.foot, Tile.Floor);
  const g = island.gateLine;
  // One gate open on each side of the centre column; the rest are closed off until the player buys gates there.
  for (let x = g.x; x < g.x + g.w; x++) grid.setTile(x, g.y, x === g.x + 1 || x === g.x + g.w - 2 ? Tile.Gate : Tile.GateClosed);
}

/** Paints the slot's island unless its partner already has; the second of a pair paints nothing. */
export function paintSlot(grid: Grid, slot: PlatformSlot): void {
  const island = ISLANDS[slot.island - 1]!;
  if (!isIslandPainted(grid, island)) paintIsland(grid, island);
}

export function buildGrid(map: StationMap, platformsAdded: number): Grid {
  const g = new Grid(map.w, map.h);
  for (const o of map.obstacles) fill(g, o.rect, Tile.Obstacle);
  for (const r of map.startingFloor) fill(g, r, Tile.Floor);
  for (const e of map.entrances) fill(g, e.tiles, Tile.Entrance);
  for (const s of map.slots.slice(0, platformsAdded)) paintSlot(g, s);
  return g;
}
