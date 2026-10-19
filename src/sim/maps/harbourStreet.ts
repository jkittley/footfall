import { Grid, Tile, type Rect } from "../grid";
import { CITY, rasterise } from "./city";

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
  /** The side of the station it opens onto, where its pavement (or the footbridge) leads off. */
  faces: "N" | "E" | "S" | "W";
}

export interface ObstacleDef {
  name: string;
  rect: Rect;
}

export interface StationMap {
  name: "Harbour Street";
  /** The station's footprint in the city: its own ground, the only place floor may be built. */
  grounds: Rect;
  startingPlatforms: 2;
  islands: IslandDef[];
  slots: PlatformSlot[];
  entrances: EntranceDef[];
  obstacles: ObstacleDef[];
  startingFloor: Rect[];
}

const [OX, OY] = CITY.station.origin;

/** A rect given in the station's own coordinates (0..119, 0..89), placed in the city. */
function at(x: number, y: number, w: number, h: number): Rect {
  return { x: OX + x, y: OY + y, w, h };
}

const PLATFORM_TOP = 24;
const PLATFORM_LEN = 30;
const CONCOURSE_TOP = PLATFORM_TOP + PLATFORM_LEN;

function makeIsland(id: number): IslandDef {
  const x0 = 8 + 8 * (id - 1);
  return {
    id,
    walkway: at(x0 + 1, PLATFORM_TOP, 5, PLATFORM_LEN),
    leftTrack: at(x0, PLATFORM_TOP, 1, PLATFORM_LEN),
    rightTrack: at(x0 + 6, PLATFORM_TOP, 1, PLATFORM_LEN),
    // Spans the gap column too, so neighbouring aprons join into one concourse.
    foot: at(x0, CONCOURSE_TOP, 8, 2),
    gateLine: at(x0 + 1, CONCOURSE_TOP - 1, 5, 1),
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
    platform: { x: half, y: island.walkway.y, w: 2, h: PLATFORM_LEN },
    foot: island.foot,
  };
}

// In station coordinates. The island field (every island's tracks, walkway and foot, x 8..79) stays
// obstacle-free so platforms can be painted later. Rows 22-23 are a Ground buffer between the track
// bed and the platform tops. East of the field the route to the footbridge must take each pinch
// point: between the goods shed and the coal wharf sidings (rows 56-58), the gap in the signal
// works (rows 44-46), and the neck between the river and Riverside Gardens (x 96-101, rows 56-59).
// The river, the gardens and Harbour Road (rows 82-88) come from the city map.
const OBSTACLES: ObstacleDef[] = [
  { name: "Track bed", rect: at(6, 0, 76, 22) },
  { name: "Neighbouring offices", rect: at(0, 20, 5, 30) },
  { name: "The Old Customs House (listed)", rect: at(20, 64, 14, 10) },
  { name: "Fish market hall", rect: at(38, 64, 12, 10) },
  { name: "Pilot's Row terraces", rect: at(53, 66, 10, 12) },
  { name: "Chandlery", rect: at(66, 66, 8, 12) },
  { name: "Bus lane", rect: at(54, 62, 30, 3) },
  { name: "Coal depot", rect: at(84, 4, 10, 18) },
  { name: "Goods shed", rect: at(84, 22, 4, 34) },
  { name: "Coal wharf sidings", rect: at(84, 59, 4, 23) },
  { name: "Signal works (north)", rect: at(90, 22, 3, 22) },
  { name: "Signal works (south)", rect: at(90, 47, 3, 35) },
  { name: "Station Master's House (listed)", rect: at(30, 57, 8, 5) },
  { name: "Left luggage office", rect: at(52, 57, 6, 4) },
];

export const HARBOUR_STREET: StationMap = {
  name: "Harbour Street",
  grounds: CITY.station.grounds,
  startingPlatforms: 2,
  islands: ISLANDS,
  slots: Array.from({ length: 18 }, (_, i) => makeSlot(i + 1)),
  entrances: [
    { id: "A", name: "Harbour Road", tiles: at(9, 79, 4, 1), weight: 3, faces: "S" },
    { id: "B", name: "Market Street", tiles: at(0, 55, 1, 3), weight: 2, faces: "W" },
    { id: "C", name: "Footbridge", tiles: at(119, 55, 1, 4), weight: 2, faces: "E" },
  ],
  obstacles: OBSTACLES,
  startingFloor: [at(6, CONCOURSE_TOP + 2, 10, 4), at(9, 60, 4, 19), at(1, 55, 5, 3)],
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

/** The city with the station painted on top: its obstacles, starting floor, entrances and the platforms added. */
export function buildGrid(map: StationMap, platformsAdded: number): Grid {
  const g = rasterise(CITY);
  for (const o of map.obstacles) fill(g, o.rect, Tile.Obstacle);
  for (const r of map.startingFloor) fill(g, r, Tile.Floor);
  for (const e of map.entrances) fill(g, e.tiles, Tile.Entrance);
  for (const s of map.slots.slice(0, platformsAdded)) paintSlot(g, s);
  return g;
}
