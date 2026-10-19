# Footfall: Playable Station Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A playable browser game of the first stage only: the Harbour Street railway station, from 2 platforms growing towards 18, with passengers, trains, shops, toilets, seating, building, money, growth, disruptions and saving.

**Architecture:** A pure TypeScript simulation (`src/sim/`, no DOM) stepped at a fixed timestep, drawn by a Canvas 2D renderer (`src/render/`) with a plain-DOM HUD on top (`src/ui/`). People live in typed arrays and walk shared route fields (one Dijkstra field per destination) with local crowd avoidance from a per-tile crowd grid. Later plans (subway, airport, venues) add levels and venue data on the same core.

**Tech Stack:** TypeScript 5 (strict), Vite 6, Vitest 3, Canvas 2D, Google Fonts (Schibsted Grotesk, IBM Plex Mono). No runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-10-19-footfall-design.md`

**Out of scope for this plan (later plans):** the subway level, stairs, escalators, lifts, buggies, mobility-limited passengers, the airport and its check-in and security, the three venues, the phone layout.

## Global Constraints

- Repo: `~/Code/footfall`, its own git repo, branch `main`. Commit after every task.
- Palette (exact hexes): Ground `#ECE8E1`, Floor `#F8F6F2`, Wall `#23262B`, Track `#CBC5BA`, Night `#14171C`, Circle/train `#2F6FDB`, Triangle/subway `#E8772E`, Square/retail `#14907F`, Diamond/street `#E5B72A`, Alert `#C4342C`, Ink `#1E2126`, secondary ink `#585D65`, Flight hexagon `#7B5CD6`.
- Fonts: Schibsted Grotesk for UI, IBM Plex Mono for numbers, clock and money.
- People: shape and colour = where they're going (circle blue train, triangle orange subway, hexagon purple flight, diamond yellow street); fill = journey kind (solid departing, outline arriving, half-filled connecting).
- **No game over, ever.** Crowding only slows people. Money below zero only blocks building.
- **Fair deadlines:** every person's deadline ≥ now + unimpeded walk time on the layout as built at spawn + `MIN_SLACK_MINUTES`. Deadlines are never recalculated afterwards.
- **Only the on-time rate feeds the service meter.** Jam rings are visual only.
- **A platform, once added, is never removed**, only made inactive. Progress counts platforms added.
- `src/sim/**` must not touch `window`, `document` or `localStorage` (keeps a later desktop wrap cheap). Save/load I/O lives in `src/ui/`.
- No em-dashes in player-facing copy (use a comma, colon or brackets).
- Every random choice in the sim goes through the seeded `Rng` so tests are deterministic.
- **Time model (my call, flag to the user):** one game day = 600 real seconds at ×1, so `GAME_MIN_PER_REAL_SEC = 2.4`. People walk at a watchable speed in real time (`WALK_TILES_PER_SEC = 2.5` at ×1), so a long walk takes tens of game minutes. All deadlines are computed from these same constants, so the rules stay fair.

## Review Focus

1. **The player builds something that cuts off a platform or an entrance** → the build is refused with a reason ("Would cut off Platform 2"), nothing changes, no money is taken. Test: Task 12 `refuses a wall that cuts off a platform`.
2. **A rebuild lands on top of people** (a shop or wall placed where someone is standing) → they are moved to the nearest walkable tile, never stuck inside. Test: Task 12 `moves people out of newly blocked tiles`.
3. **Fast-forward at peak** (×3, big real-time steps) → nobody tunnels through a wall or obstacle. Test: Task 4 `never enters a non-walkable tile with a large dt`.
4. **A platform goes inactive or a line closes while people are booked on it** → they are rebooked fairly or wait; it is never counted as their miss on the meter. Tests: Task 13 `rebooks passengers when a platform goes inactive`, Task 14 `disruption misses are excluded from the meter`.
5. **Money goes negative from refunds and maintenance** → the game keeps running, building is refused until the balance recovers, and income still arrives. Test: Task 9 `blocks building while negative but keeps crediting`.

---

## File Structure

```
index.html                 game page
bench.html                 performance test page (Task 5)
src/
  main.ts                  boots world, renderer, UI, loop
  sim/
    constants.ts           every tunable number, one place
    rng.ts                 seeded RNG
    grid.ts                tile/zone layers, walkability, rects
    maps/harbourStreet.ts  starter map + platform slots + entrances + obstacles
    routeField.ts          Dijkstra fields, best-neighbour step, FieldCache
    people.ts              PeopleStore (typed arrays)
    crowd.ts               CrowdGrid (per-tile counts, density)
    movement.ts            stepMovement
    clock.ts               calendar, formatting, demand curve
    timetable.ts           services per platform
    trains.ts              train phases, alight/board/miss
    spawner.ts             departures, alighting, connections, fair deadlines
    economy.ts             Ledger, prices, maintenance
    facilities.ts          retail/toilet/seating units, queues, tenants
    needs.ts               need levels, errands, discovery, signs
    build.ts               previewPlacement / applyPlacement / evict
    growth.ts              ServiceMeter, platform add/activate/deactivate
    disruptions.ts         line closures
    world.ts               World type, createWorld, step
    save.ts                serialise / deserialise World
  render/
    camera.ts  renderer.ts  drawPlan.ts  drawPeople.ts  drawTrains.ts  drawOverlays.ts
  ui/
    hud.ts  toolRail.ts  inspector.ts  input.ts  storage.ts  styles.css
tests/sim/*.test.ts        one file per sim module
```

---

### Task 1: Scaffold, RNG and Grid

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `.gitignore`, `index.html`, `src/main.ts` (placeholder), `src/sim/rng.ts`, `src/sim/grid.ts`, `src/sim/constants.ts`
- Test: `tests/sim/rng.test.ts`, `tests/sim/grid.test.ts`

**Interfaces:**
- Produces:
  - `class Rng { constructor(seed: number); next(): number /*[0,1)*/; int(lo: number, hi: number): number /*inclusive*/; pick<T>(xs: readonly T[]): T; weighted<T>(items: readonly {item: T; w: number}[]): T; poisson(mean: number): number; state(): number; static fromState(s: number): Rng }` (mulberry32).
  - `enum Tile { Ground = 0, Obstacle = 1, Floor = 2, Wall = 3, Track = 4, Platform = 5, Entrance = 6, Rail = 7 }`
  - `enum Zone { None = 0, Retail = 1, Seating = 2, Toilet = 3, Travelator = 4 }`
  - `enum Dir { N = 0, E = 1, S = 2, W = 3, None = 255 }`
  - `interface Rect { x: number; y: number; w: number; h: number }`
  - `class Grid { readonly w: number; readonly h: number; tiles: Uint8Array; zones: Uint8Array; zoneOwner: Int32Array /*facility id, -1*/; dir: Uint8Array; version: number; idx(x,y): number; xy(i): [number, number]; inBounds(x,y): boolean; tile(x,y): Tile; setTile(x,y,t): void; setZone(x,y,z,owner): void; isWalkable(x,y): boolean; clone(): Grid }`
  - `isWalkable` = tile ∈ {Floor, Platform, Entrance} and zone ∈ {None, Seating, Travelator}. Every mutator bumps `version`.
  - `constants.ts`: start with `GAME_MIN_PER_REAL_SEC = 2.4`, `WALK_TILES_PER_SEC = 2.5`, `SIM_DT = 1 / 30`, `MAX_STEPS_PER_FRAME = 12`, `MAX_PEOPLE = 8000`, `TILE_PX = 16`. Later tasks append their constants here.

- [ ] **Step 1:** `git init` in `~/Code/footfall`, commit the existing `docs/` as "docs: design and station plan".
- [ ] **Step 2:** Create the Vite vanilla-TS project by hand (package.json scripts `dev`, `build`, `test` = `vitest run`, `typecheck` = `tsc --noEmit`; devDeps `typescript`, `vite`, `vitest`). `tsconfig` strict, `noUncheckedIndexedAccess: true`. Run `npm install`.
- [ ] **Step 3: Write failing tests**

```ts
// tests/sim/rng.test.ts
test("same seed gives same sequence", () => {
  const a = new Rng(42), b = new Rng(42);
  expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
});
test("state round-trips", () => {
  const a = new Rng(7); a.next(); const b = Rng.fromState(a.state());
  expect(b.next()).toBe(a.next());
});
test("poisson mean is about right", () => {
  const r = new Rng(1); let s = 0; for (let i = 0; i < 20000; i++) s += r.poisson(3);
  expect(s / 20000).toBeCloseTo(3, 1);
});

// tests/sim/grid.test.ts
test("floor is walkable, retail zone is not, seating is", () => {
  const g = new Grid(4, 1);
  for (let x = 0; x < 4; x++) g.setTile(x, 0, Tile.Floor);
  g.setZone(1, 0, Zone.Retail, 3); g.setZone(2, 0, Zone.Seating, 4);
  expect([0, 1, 2, 3].map((x) => g.isWalkable(x, 0))).toEqual([true, false, true, true]);
});
test("mutations bump version", () => {
  const g = new Grid(2, 2); const v = g.version; g.setTile(0, 0, Tile.Floor);
  expect(g.version).toBeGreaterThan(v);
});
test("obstacles, walls, rails, track and ground are not walkable", () => {
  const g = new Grid(5, 1);
  [Tile.Obstacle, Tile.Wall, Tile.Rail, Tile.Track, Tile.Ground].forEach((t, x) => g.setTile(x, 0, t));
  expect([0, 1, 2, 3, 4].some((x) => g.isWalkable(x, 0))).toBe(false);
});
```

- [ ] **Step 4:** `npm test` → FAIL (modules missing).
- [ ] **Step 5:** Implement `rng.ts`, `grid.ts`, `constants.ts` as in Interfaces.
- [ ] **Step 6:** `npm test && npm run typecheck` → PASS.
- [ ] **Step 7:** Commit "feat: scaffold, seeded rng, grid".

---

### Task 2: Harbour Street starter map

**Files:**
- Create: `src/sim/maps/harbourStreet.ts`
- Test: `tests/sim/harbourStreet.test.ts`

**Interfaces:**
- Consumes: `Grid`, `Tile`, `Rect` (Task 1).
- Produces:
  - `interface PlatformSlot { id: number /*1..18*/; track: Rect /*1 col wide*/; platform: Rect /*2 cols wide*/; foot: Rect /*floor apron added with the platform, touching concourse row*/ }`
  - `interface EntranceDef { id: string /*"A"|"B"|"C"*/; name: string; tiles: Rect; weight: number }`
  - `interface ObstacleDef { name: string; rect: Rect }`
  - `interface StationMap { name: "Harbour Street"; w: 120; h: 90; startingPlatforms: 2; slots: PlatformSlot[]; entrances: EntranceDef[]; obstacles: ObstacleDef[]; startingFloor: Rect[] }`
  - `const HARBOUR_STREET: StationMap`
  - `function buildGrid(map: StationMap, platformsAdded: number): Grid` — Ground everywhere, obstacles → Obstacle, starting floor → Floor, entrances → Entrance, first `platformsAdded` slots → Track/Platform plus their `foot` → Floor.

Layout rules (author the data to satisfy them; tests enforce): platforms are vertical strips 30 rows long whose south end meets a concourse band along the bottom third; slot k sits at x = 8 + 4(k−1) (track col, then 2 platform cols, then a 1-col gap), so slots run west to east and slots 3+ need the player to extend floor east to reach them. Starting floor is a concourse under slots 1–2 plus corridors to entrances A (south), B (west). Entrance C "Quay Lane" (east) sits beyond the obstacles and must be reached by building. At least 10 obstacles, named per spec §11 station list (e.g. "The Old Customs House" listed building, "Harbour Road", "Bus lane", "Ashby Canal", "Neighbouring offices"), placed so expanding any direction soon meets one, with at least three gaps between obstacles 2 to 4 tiles wide.

- [ ] **Step 1: Write failing tests**

```ts
test("has 18 slots that never overlap obstacles", () => {
  expect(HARBOUR_STREET.slots).toHaveLength(18);
  for (const s of HARBOUR_STREET.slots) for (const o of HARBOUR_STREET.obstacles) {
    for (const r of [s.track, s.platform, s.foot]) expect(overlaps(r, o.rect)).toBe(false);
  }
});
test("starting grid connects entrances A and B to platforms 1 and 2", () => {
  const g = buildGrid(HARBOUR_STREET, 2);
  expect(reachable(g, entranceTiles("A"), platformTiles(1))).toBe(true);
  expect(reachable(g, entranceTiles("B"), platformTiles(2))).toBe(true);
});
test("every slot and entrance is reachable if all ground were floor", () => {
  const g = buildGrid(HARBOUR_STREET, 18); fillGroundWithFloor(g);
  for (const s of HARBOUR_STREET.slots) expect(reachable(g, entranceTiles("A"), tilesOf(s.platform))).toBe(true);
  expect(reachable(g, entranceTiles("A"), entranceTiles("C"))).toBe(true);
});
test("has at least 10 obstacles and 3 narrow gaps", () => {
  expect(HARBOUR_STREET.obstacles.length).toBeGreaterThanOrEqual(10);
  expect(countNarrowGaps(HARBOUR_STREET, 2, 4)).toBeGreaterThanOrEqual(3);
});
```

`reachable` / `countNarrowGaps` / `fillGroundWithFloor` / `tilesOf` are test helpers in `tests/sim/helpers.ts` (BFS over `isWalkable`; a narrow gap = a run of 2–4 non-obstacle tiles in a row or column bounded by obstacles on both sides).

- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Author the map data and `buildGrid`.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit "feat: Harbour Street starter map".

---

### Task 3: Route fields and field cache

**Files:**
- Create: `src/sim/routeField.ts`
- Test: `tests/sim/routeField.test.ts`

**Interfaces:**
- Consumes: `Grid`, `Zone`, `Dir`.
- Produces:
  - `function computeField(grid: Grid, targets: readonly number[]): Float32Array` — Dijkstra from targets (distance 0) over walkable tiles, 8-way, diagonal √2, no corner cutting past a non-walkable tile. Unreachable = `Infinity`. Cost of moving a→b is `stepCost(grid, a, b)`.
  - `function stepCost(grid: Grid, from: number, to: number): number` — base 1 (√2 diagonal) × `SEATING_COST = 3` if `to` is a seating tile; on a travelator tile moving along its `dir` × `TRAVELATOR_COST = 0.4`; moving against it `Infinity`; across it 1.
  - `function bestNeighbour(grid: Grid, field: Float32Array, x: number, y: number, crowdAt?: (i: number) => number, densityWeight?: number): number /*tile idx or -1*/` — minimises `field[n] + stepCost + densityWeight * crowdAt(n)`.
  - `function walkMinutes(field: Float32Array, tile: number): number` — `field[tile] / WALK_TILES_PER_SEC * GAME_MIN_PER_REAL_SEC`.
  - `class FieldCache { constructor(grid: Grid); get(key: string, targets: () => readonly number[]): Float32Array; }` — recomputes when `grid.version` changed since that key was computed.
  - Constants: `SEATING_COST = 3`, `TRAVELATOR_COST = 0.4`, `DENSITY_WEIGHT = 1.5`.

- [ ] **Step 1: Write failing tests**

```ts
test("distance grows away from the target and walls are routed around", () => {
  const g = corridorWithWall(); // 7x3 floor, wall at x=3 rows 0-1
  const f = computeField(g, [g.idx(6, 0)]);
  expect(f[g.idx(6, 0)]).toBe(0);
  expect(f[g.idx(0, 0)]).toBeGreaterThan(6); // has to dip to row 2
  expect(f[g.idx(3, 0)]).toBe(Infinity);
});
test("travelator is cheap one way and impassable the other", () => {
  const g = strip(10); for (let x = 2; x < 8; x++) { g.setZone(x, 0, Zone.Travelator, -1); g.dir[g.idx(x, 0)] = Dir.E; }
  const east = computeField(g, [g.idx(9, 0)]), west = computeField(g, [g.idx(0, 0)]);
  expect(east[g.idx(0, 0)]).toBeLessThan(9);
  expect(west[g.idx(9, 0)]).toBe(Infinity);
});
test("bestNeighbour steps around a crowded tile when density weight is high", () => {
  const g = openFloor(5, 3); const f = computeField(g, [g.idx(4, 1)]);
  const crowd = (i: number) => (i === g.idx(1, 1) ? 10 : 0);
  expect(bestNeighbour(g, f, 0, 1, crowd, DENSITY_WEIGHT)).not.toBe(g.idx(1, 1));
});
test("cache recomputes after the grid changes", () => {
  const g = openFloor(5, 1); const c = new FieldCache(g);
  const a = c.get("t", () => [g.idx(4, 0)]); g.setTile(2, 0, Tile.Wall);
  expect(c.get("t", () => [g.idx(4, 0)])[g.idx(0, 0)]).toBe(Infinity); expect(a).not.toBe(c.get("t", () => [g.idx(4, 0)]));
});
```

- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement with a binary-heap Dijkstra over `Float32Array`.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit "feat: route fields".

---

### Task 4: People store, crowd grid, movement

**Files:**
- Create: `src/sim/people.ts`, `src/sim/crowd.ts`, `src/sim/movement.ts`
- Test: `tests/sim/movement.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 3.
- Produces:
  - `enum Mode { Train = 0, Subway = 1, Flight = 2, Street = 3 }`, `enum Journey { Departing = 0, Arriving = 1, Connecting = 2 }`
  - `enum PState { Free = 0, Walking = 1, Waiting = 2 /*on platform*/, InQueue = 3, InFacility = 4, Seated = 5 }`
  - `enum Need { Hunger = 0, Thirst = 1, Tired = 2, Toilet = 3, Browse = 4, Charge = 5 }` with `NEED_COUNT = 6`
  - `class PeopleStore { readonly cap: number; count: number; x: Float32Array; y: Float32Array; state: Uint8Array; mode: Uint8Array; journey: Uint8Array; targetKey: string[]; /*field key currently walked to*/ goalKey: string[]; /*end goal field key*/ serviceId: Int32Array; deadline: Float64Array; spawnedAt: Float64Array; spawnWalk: Float32Array /*unimpeded walk minutes to the goal, measured at spawn*/; speedMul: Float32Array; leisure: Uint8Array; destLabel: Uint8Array; needs: Float32Array /*cap*NEED_COUNT*/; errand: Int8Array /*Need or -1*/; errandFacility: Int32Array; known: Int32Array /*cap*NEED_COUNT, facility id or -1*/; timer: Float32Array; counted: Uint8Array; alloc(): number; free(i: number): void; forEachAlive(fn: (i: number) => void): void }`. Free slots are reused (free list). `alloc` throws a `RangeError` at `cap`; callers check `count < cap` first.
  - `class CrowdGrid { constructor(w: number, h: number); counts: Uint16Array; rebuild(people: PeopleStore, grid: Grid): void; at(i: number): number; density(x: number, y: number): number /*mean of 3x3*/ }` — counts people in states Walking, Waiting, InQueue, Seated (InFacility excluded).
  - `function speedFactor(density: number): number` — 1 at ≤ `CALM_DENSITY = 0.5`, linear down to `MIN_SPEED_FACTOR = 0.25` at `JAM_DENSITY = 2.5`.
  - `function stepMovement(grid: Grid, fields: FieldCache, fieldTargets: (key: string) => readonly number[], people: PeopleStore, crowd: CrowdGrid, dtReal: number): number[] /*indices that reached their targetKey this step*/` — Walking people move toward the centre of `bestNeighbour(...)` at `WALK_TILES_PER_SEC × speedFactor × speedMul` (× 1/`TRAVELATOR_COST` while standing on a travelator going its way), sub-stepping so no sub-step moves more than 0.4 tiles. A person whose current tile is non-walkable is first moved to the nearest walkable tile (BFS). Arrival = current tile has field value 0.
  - `function nudgeToWalkable(grid: Grid, people: PeopleStore, i: number): void` (exported; Task 12 uses it).

- [ ] **Step 1: Write failing tests**

```ts
test("a walker reaches the target across open floor", () => { /* 20x5 floor, one walker, step 1/30 s until arrival or 30 s */ });
test("arrival time matches walkMinutes on an empty floor within 15%", () => { /* compare elapsed real s * GAME_MIN_PER_REAL_SEC to walkMinutes */ });
test("never enters a non-walkable tile with a large dt", () => {
  // corridor with a wall line and one gap; 200 walkers; step dt = 0.5 s for 60 steps
  // assert every walker's floor(x), floor(y) tile isWalkable after every step
});
test("crowding slows people down", () => {
  // 1 walker alone vs the same walker behind 40 standing (InQueue) people in a 3-wide corridor: alone arrives sooner
});
test("speedFactor bounds", () => {
  expect(speedFactor(0)).toBe(1); expect(speedFactor(10)).toBe(0.25);
});
test("nudgeToWalkable moves someone off a wall", () => { /* place on wall tile, nudge, assert walkable */ });
```

Write each test body fully in the test file; the comments above give the setup and assertion.

- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement the three modules.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit "feat: people, crowd grid, movement".

---

### Task 5: Performance test (decision gate)

**Files:**
- Create: `bench.html`, `src/bench.ts`, `src/render/camera.ts` (minimal), `src/render/drawPeople.ts` (first version)
- Modify: `vite.config.ts` (multi-page: `index.html`, `bench.html`)

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces:
  - `class Camera { x: number; y: number; zoom: number; worldToScreen(wx, wy): [number, number]; screenToWorld(sx, sy): [number, number] }`
  - `function drawPeople(ctx: CanvasRenderingContext2D, cam: Camera, people: PeopleStore): void` — batches one path per (shape, fill) combination; circle r=5px, triangle 12×11, hexagon r=6, diamond 11×11 at zoom 1; solid / outline (2px stroke, floor fill) / half (left half filled, clipped) by journey.

Bench: a 200×120 floor with 60 random obstacle rects, 4 target areas, 5,000 walkers each assigned a random target, respawned at a random edge when they arrive. Runs ×3 (three `SIM_DT` steps per 1/30 s of frame time). Overlay text: fps, sim ms per frame, draw ms per frame, people count.

- [ ] **Step 1:** Implement `bench.ts`, `camera.ts`, `drawPeople.ts`.
- [ ] **Step 2:** `npm run dev`, open `/bench.html` in Chrome (claude-in-chrome), read the overlay after 20 s.
- [ ] **Step 3: Gate.** PASS if fps ≥ 55 and sim + draw ≤ 12 ms per frame. Record the numbers in `docs/perf.md`.
  - If draw is the problem: switch `drawPeople` to WebGL instanced points (no library) behind the same signature.
  - If sim is the problem: profile `stepMovement`; first fix is caching `bestNeighbour` per tile per field per step; second is moving `step` into a Web Worker.
  - Re-measure until PASS, or stop and report the numbers to the user.
- [ ] **Step 4:** Commit "perf: 5,000-person benchmark" with `docs/perf.md`.

---

### Task 6: Clock, calendar and demand

**Files:**
- Create: `src/sim/clock.ts`
- Test: `tests/sim/clock.test.ts`

**Interfaces:**
- Produces (all take `minute: number` = game minutes since game start; minute 0 = Monday 00:00 of the first week, which is March):
  - `const START_MINUTE = 300` (Monday 05:00)
  - `dayOfWeek(m): number /*0 Mon..6 Sun*/`, `minuteOfDay(m): number`, `dayIndex(m): number`, `month(m): number /*0 Jan..11; week w → (2 + w) % 12*/`
  - `formatClock(m): string` → `"Tue 08:42 · March"`
  - `periodLabel(m): string` → one of `"Night"`, `"Early morning"`, `"Morning peak"`, `"Midday"`, `"Evening peak"`, `"Evening"`, `"Weekend"`, plus `" · Summer holidays"` / `" · Christmas"` suffix when relevant.
  - `demand(m): number` — product of a day-shape curve and a holiday factor. Weekday shape: peaks 07:00–09:30 (2.6, centred 08:15) and 16:30–19:00 (2.4, centred 17:45), midday 1.0, night 01:00–05:00 0.05. Friday evening peak × 1.25. Weekend: smooth hump 10:00–18:00 at 1.3. Holiday factor: July and August weeks × 1.3; December week, Thu–Sun, × 1.5.
  - `leisureShare(m): number` — weekday 0.2, weekend 0.6, + 0.2 in holidays (cap 0.9).

- [ ] **Step 1: Write failing tests**

```ts
test("formats the first morning", () => expect(formatClock(START_MINUTE)).toBe("Mon 05:00 · March"));
test("week 4 is July", () => expect(month(4 * 7 * 1440)).toBe(6));
test("weekday shape", () => {
  const mon = (h: number) => demand(h * 60);
  expect(mon(8.25)).toBeGreaterThan(mon(12)); expect(mon(12)).toBeGreaterThan(mon(3));
});
test("Friday evening is the busiest moment of a March week", () => {
  let best = 0, at = 0; for (let m = 0; m < 7 * 1440; m += 5) if (demand(m) > best) { best = demand(m); at = m; }
  expect(dayOfWeek(at)).toBe(4); expect(minuteOfDay(at)).toBeGreaterThan(16 * 60);
});
test("Saturday morning is quieter than Monday morning", () => expect(demand(5 * 1440 + 8 * 60)).toBeLessThan(demand(8 * 60)));
test("summer midday beats March midday", () => expect(demand(4 * 7 * 1440 + 12 * 60)).toBeGreaterThan(demand(12 * 60)));
test("leisure share is higher at weekends", () => expect(leisureShare(5 * 1440 + 12 * 60)).toBeGreaterThan(leisureShare(12 * 60)));
```

- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit "feat: clock, calendar, demand curve".

---

### Task 7: World skeleton, timetable and trains

**Files:**
- Create: `src/sim/world.ts`, `src/sim/timetable.ts`, `src/sim/trains.ts`
- Test: `tests/sim/timetable.test.ts`, `tests/sim/trains.test.ts`

**Interfaces:**
- Consumes: Tasks 1–6.
- Produces:
  - `interface Service { id: number; platformId: number; destination: string; arriveAt: number; departAt: number; alighting: number; cancelled: boolean; cancelReason: "inactive" | "disruption" | null }`
  - `class Timetable { services: Map<number, Service>; ensureHorizon(now: number, activePlatforms: readonly number[], rng: Rng): void; upcoming(platformId: number, after: number): Service[]; departuresAfter(t: number): Service[] /*non-cancelled, sorted by departAt*/; prune(before: number): void }` — horizon `TIMETABLE_HORIZON_MIN = 240`; per platform, next arrival = previous departure + interval, `interval = clamp(round(BASE_INTERVAL_MIN / demand(t)), 20, 120)` with `BASE_INTERVAL_MIN = 50`; `DWELL_MIN = 12`; `alighting = round(ALIGHT_BASE * demand(t) * rng in [0.6, 1.4])`, `ALIGHT_BASE = 25`; destinations from a fixed list of 12 UK-sounding made-up towns ("Ashby", "Leeds Road", "Kingsmoor", …).
  - `type TrainPhase = "approaching" | "dwelling" | "leaving"`, `function trainPhase(s: Service, now: number): TrainPhase | null` — approaching from `arriveAt − APPROACH_MIN (3)`, leaving until `departAt + LEAVE_MIN (3)`.
  - `type GameEvent = { kind: "toast"; text: string } | { kind: "outcome"; personId: number; onTime: boolean; excluded: boolean } | { kind: "dayEnd"; summary: DaySummary } | { kind: "autosave" }` (DaySummary defined in Task 9; use `unknown` until then and narrow in Task 9).
  - `interface World { seed: number; rng: Rng; map: StationMap; grid: Grid; fields: FieldCache; people: PeopleStore; crowd: CrowdGrid; minute: number; timetable: Timetable; platformsAdded: number; platformActive: boolean[] /*index = slot id − 1*/; events: GameEvent[]; stats: { movedToday: number; onTimeToday: number; missedToday: number }; nextId: number }` — later tasks add `ledger`, `facilities`, `signs`, `meter`, `growth`, `disruptions` fields to this interface.
  - `function createWorld(seed: number): World`, `function fieldTargets(w: World, key: string): readonly number[]` — keys: `platform:<id>` (that slot's platform tiles), `exit:<A|B|C>`, `spot:<tileIdx>` (one tile), `facility:<id>` and `seat:<id>` (Task 10 adds both).
  - Test helper in `tests/sim/helpers.ts`: `runMinutes(w: World, minutes: number): void` — calls `step(w, SIM_DT)` until `w.minute` has advanced by `minutes`.
  - `function step(w: World, dtReal: number): void` — for now: advance `minute`, `ensureHorizon`, `stepTrains`, movement, crowd rebuild. Tasks 8–14 insert their step functions in this order: disruptions → trains → spawner → needs → facilities → movement → crowd → growth → economy day rollover.
  - `function stepTrains(w: World): void` — on a service entering `dwelling`: call `onTrainArrived(w, s)` (stub here; Task 8 implements spawning alighting people). While dwelling: every person with `serviceId === s.id` in state `Waiting` on that platform boards: freed, `outcome onTime: true`. At `departAt`: every person still booked (`serviceId === s.id`) gets `outcome onTime: false` and is rebooked onto `upcoming(platform)[0]` with `counted = 1` so no second outcome is emitted.

- [ ] **Step 1: Write failing tests**

```ts
test("services cover the horizon for each active platform without overlap", () => { /* createWorld, ensureHorizon(START_MINUTE,[1,2]); per platform services sorted, each arriveAt ≥ previous departAt, last departAt ≥ now + 240 − 120 */ });
test("peak hours get more services than midday", () => { /* count services on platform 1 between 07:00-10:00 vs 11:00-14:00 on Monday */ });
test("train phases", () => { /* s.arriveAt=100, departAt=112: phase(96)=null, phase(98)="approaching", phase(105)="dwelling", phase(113)="leaving", phase(116)=null */ });
test("a waiting booked passenger boards and is on time", () => { /* place person Waiting on platform 1 booked on a dwelling service, stepTrains → freed, outcome onTime true */ });
test("a passenger not on the platform at departure misses once and is rebooked", () => { /* outcome onTime false emitted exactly once across two departures; serviceId changes to the next service */ });
```

- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit "feat: world skeleton, timetable, trains".

---

### Task 8: Spawner and fair deadlines

**Files:**
- Create: `src/sim/spawner.ts`
- Modify: `src/sim/world.ts` (call `stepSpawner`, implement `onTrainArrived`)
- Test: `tests/sim/spawner.test.ts`

**Interfaces:**
- Consumes: Tasks 3, 4, 6, 7.
- Produces:
  - `function sampleSlack(rng: Rng): number` — 25% uniform[`MIN_SLACK_MINUTES` = 3, 10], 50% uniform[10, 45], 25% uniform[45, 120] game minutes.
  - `function stepSpawner(w: World, dtMin: number): void` — departing spawns: `rng.poisson(SPAWN_PER_MIN_PER_PLATFORM (1.2) × activeCount × demand × dtMin)`; each at a random tile of an entrance chosen by `weight`, only entrances reachable on the current grid. Picks `slack`, then the earliest non-cancelled service on any active platform with `departAt ≥ minute + walkMinutes(platformField, spawnTile) + slack`; random among the first 3 such. Sets `mode Train`, `journey Departing`, `goalKey platform:<id>`, `targetKey = goalKey`, `deadline = service.departAt`, `leisure = rng < leisureShare`, initial needs uniform[0, 0.7]. No spawn if no service fits or `people.count ≥ cap`.
  - `function onTrainArrived(w: World, s: Service): void` — `s.alighting` people at random tiles of that platform. `CONNECT_SHARE = 0.15` become `Connecting` onto a service on a *different* active platform meeting the same fair rule (else Arriving). Arriving: exit chosen by entrance weight among reachable exits, `goalKey exit:<id>`, `deadline = minute + walkMinutes(exitField, tile) + sampleSlack`, `destLabel` Home / Hotel / Work with Work 0.6 before 10:00 on weekdays, Home 0.6 after 16:00, else even.
  - Arriving at the exit (`exit:*` with field 0) → freed, outcome by `minute ≤ deadline`. Reaching their platform → state `Waiting`, walk to a random tile of that platform (`targetKey = "spot:<tile>"`, a single-tile field).
  - `stats.movedToday` increments on every on-time or late outcome.

- [ ] **Step 1: Write failing tests**

```ts
test("every spawned person has a fair deadline", () => {
  const w = createWorld(3); runMinutes(w, 8 * 60); // through the morning peak
  let checked = 0;
  w.people.forEachAlive((i) => {
    const p = w.people;
    expect(p.deadline[i]! - p.spawnedAt[i]!).toBeGreaterThanOrEqual(p.spawnWalk[i]! + MIN_SLACK_MINUTES - 1e-6);
    checked++;
  });
  expect(checked).toBeGreaterThan(50);
});
test("an unobstructed station has a very high on-time rate", () => { /* run 6 game hours on the starting map; on-time outcomes / all outcomes ≥ 0.97 */ });
test("arrivals and connections appear when a train arrives", () => { /* force a service dwelling; onTrainArrived spawns s.alighting people, some Connecting with goal on another platform */ });
test("no spawns from an unreachable entrance", () => { /* wall off entrance B; run 60 min; no person spawnedAt tile inside B */ });
```

The spawner sets `spawnWalk[i]` for every person it creates (departing, arriving and connecting).

- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit "feat: spawner with fair deadlines".

---

### Task 9: Ledger, prices and maintenance

**Files:**
- Create: `src/sim/economy.ts`
- Modify: `src/sim/world.ts` (add `ledger`; fare bonus on on-time departing/connecting outcomes, refund on misses; daily maintenance and `dayEnd` event at midnight)
- Test: `tests/sim/economy.test.ts`

**Interfaces:**
- Produces:
  - `type LedgerLine = "rent" | "fares" | "refunds" | "build" | "maintenance" | "evictions" | "removals"`
  - `interface DaySummary { day: number; moved: number; onTime: number; missed: number; income: number; costs: number; balance: number }`
  - `class Ledger { balance: number; today: Record<LedgerLine, number>; canAfford(cost: number): boolean /*balance − cost ≥ 0*/; credit(line, amount): void; debit(line, amount): void; closeDay(day: number, stats): DaySummary /*resets today*/ }`
  - `const PRICES` (station level): floor 100/tile, retail 250/tile, seating 80/tile, toilet 400/tile, wall 20/tile, rail 15/tile, sign 150, travelator 600/tile, evict fee 2000.
  - `const UPKEEP_PER_DAY`: floor 2/tile, retail 3/tile, seating 2/tile, toilet 12/tile, wall 0.5/tile, rail 0.5/tile, sign 5, travelator 20/tile.
  - `RENT_SHARE = 0.2`, `FARE_BONUS = 4`, `REFUND = 12`, `DISRUPTION_REFUND_FACTOR = 0.4`, `STARTING_CASH = 20000`, `REMOVE_REFUND = 0.5`.
  - `function dailyUpkeep(w: World): number` — counts tiles by kind on the grid plus signs.

- [ ] **Step 1: Write failing tests**

```ts
test("canAfford refuses a build that would go below zero", () => { const l = new Ledger(100); expect(l.canAfford(100)).toBe(true); expect(l.canAfford(101)).toBe(false); });
test("blocks building while negative but keeps crediting", () => {
  const l = new Ledger(10); l.debit("refunds", 50); expect(l.canAfford(1)).toBe(false);
  l.credit("rent", 100); expect(l.balance).toBe(60); expect(l.canAfford(60)).toBe(true);
});
test("upkeep on the starting map is charged once at midnight", () => { /* createWorld, run to Tue 00:01, maintenance line of the closed day equals dailyUpkeep */ });
test("on-time departure pays the fare bonus, a miss costs a refund", () => { /* drive outcomes through world, check today.fares and today.refunds */ });
```

- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit "feat: ledger, prices, upkeep".

---

### Task 10: Facilities, queues and tenants

**Files:**
- Create: `src/sim/facilities.ts`
- Modify: `src/sim/world.ts` (add `facilities: Map<number, Facility>`, field key `facility:<id>` → its service tiles, `seat:<id>` → its tiles; call `stepFacilities`)
- Test: `tests/sim/facilities.test.ts`

**Interfaces:**
- Produces:
  - `enum FacilityKind { Retail = 0, Toilet = 1, Seating = 2 }`
  - `enum Tenant { None = 0, FoodDrink = 1, Newsagent = 2, PhoneCharging = 3, Electronics = 4 }`
  - `const TENANTS: Record<Exclude<Tenant, Tenant.None>, { name: string; serveMin: number; spend: number; maxQueue: number; meets: Need[] }>` — FoodDrink "Food and drink" 4 min £6 queue 8 meets Hunger, Thirst; Newsagent 2 min £3 queue 5 meets Browse; PhoneCharging 10 min £2 queue 4 meets Charge; Electronics 6 min £25 queue 4 meets Browse.
  - `const TOILET = { serveMin: 3, maxQueue: 10 }`
  - `interface Facility { id: number; kind: FacilityKind; rect: Rect; serviceTiles: number[]; queueTiles: number[]; tenant: Tenant; tenantAt: number /*minute a tenant moves in, −1 if has one*/; footfall: { commuter: number; leisure: number }; queue: number[]; serving: { pid: number; until: number }[]; capacity: number; takingsToday: number; builtPrice: number }`
  - `function createFacility(w: World, kind: FacilityKind, rect: Rect): Facility` — zones the tiles, `capacity` retail `ceil(area / 4)`, toilet `area`, seating `area * 2`; `serviceTiles` = walkable tiles orthogonally adjacent to the rect (retail/toilet; seating has none, its own tiles are the target); `queueTiles` = up to 12 tiles grown by BFS from the service tiles away from the rect, preferring straight continuation. Retail: `tenant None`, `tenantAt = minute + TENANT_DELAY_MIN (40)`.
  - `function chooseTenant(f: Facility, rng: Rng): Tenant` — weights lerp from commuter `{FoodDrink .45, Newsagent .35, PhoneCharging .1, Electronics .1}` to leisure `{FoodDrink .3, Newsagent .1, PhoneCharging .2, Electronics .4}` by `leisure / (commuter + leisure)` (0.5 if no footfall).
  - `function tryJoin(w: World, f: Facility, pid: number): boolean` — refuses when `queue.length ≥ maxQueue` or `queueTiles` exhausted; on join, state `InQueue`, `targetKey "spot:<queueTile>"`.
  - `function stepFacilities(w: World, dtMin: number): void` — counts footfall for to-let units (people within `FOOTFALL_RADIUS = 6` tiles); moves a tenant in at `tenantAt`; advances queues (people shuffle forward to the next queue tile); serves from the front into `serving` up to `capacity` (person state `InFacility`, hidden); on finishing: retail credits `spend × RENT_SHARE` to ledger "rent" and `spend` to `takingsToday`, with `spend × LEISURE_SPEND_MUL (1.3)` for leisure customers, resets the met needs to 0; the person resumes their goal. Seating: person sits (state `Seated`) until `deadline − walkMinutes(goal) − SEAT_LEAVE_MARGIN (5)` or 30 min, Tired reset to 0.
  - `function evictTenant(w: World, id: number): boolean` — debit `PRICES.evict` (refused if `!canAfford`), tenant None, `tenantAt = minute + EMPTY_AFTER_EVICT_MIN (120)`, queue released.

- [ ] **Step 1: Write failing tests**

```ts
test("a new retail unit is to let, then a tenant moves in", () => { /* create unit: tenant None; run 41 game min: tenant !== None */ });
test("leisure customers spend more", () => { /* same FoodDrink unit, a leisure customer credits LEISURE_SPEND_MUL (1.3) × the commuter's rent */ });
test("leisure footfall favours electronics", () => { /* 10,000 chooseTenant draws with leisure-only footfall: Electronics most frequent */ });
test("queue forms on the floor and serves in order", () => { /* 6 people join a FoodDrink unit with capacity 1; positions equal queueTiles[0..5]; first served first */ });
test("people refuse a full queue", () => { /* 8 join, 9th tryJoin false */ });
test("a served customer pays rent and loses their hunger", () => { /* ledger.today.rent === 6 * 0.2, needs Hunger 0 */ });
test("eviction costs the fee and empties the unit for two hours", () => { /* balance −2000, tenant None, tenantAt === minute + 120, queued people released to Walking */ });
```

- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit "feat: facilities, queues, tenants".

---

### Task 11: Needs, errands and signs

**Files:**
- Create: `src/sim/needs.ts`
- Modify: `src/sim/world.ts` (add `signs: Sign[]`; call `stepNeeds`)
- Test: `tests/sim/needs.test.ts`

**Interfaces:**
- Produces:
  - `const NEED_RATE_PER_MIN: Record<Need, number>` = Hunger 1/240, Thirst 1/150, Tired 1/200, Toilet 1/180, Browse 1/300, Charge 1/400. Tired rises × 2 while `Waiting` and not seated. Browse rises × 2 for leisure travellers (they're likelier to shop).
  - `const NEED_TO_FACILITY`: Hunger, Thirst → Retail FoodDrink; Browse → Retail Newsagent or Electronics; Charge → Retail PhoneCharging; Toilet → Toilet; Tired → Seating.
  - `interface Sign { id: number; tile: number; kind: "toilets" | "seating" | "shops"; pointsTo: number /*facility id or −1*/ }` — `pointsTo` = nearest matching facility by its field from the sign tile, refreshed when facilities change.
  - `function stepNeeds(w: World, dtMin: number): void` — raises needs; a person with no errand and a need ≥ 1 gets that errand (highest first). Discovery every `SEARCH_INTERVAL_MIN = 1`: a matching open facility whose field value at the person's tile ≤ `SIGHT_RADIUS = 8` becomes known; a sign within `SIGN_RADIUS = 10` tiles (Euclidean) teaches its `pointsTo`. Known facility → `targetKey facility:<id>` (or `seat:<id>`); on arrival → `tryJoin`, or drop the errand if refused. Unknown toilet for > `DESPERATE_AFTER_MIN = 20` → `speedMul = 0.7` and a random drift every few tiles while continuing towards the goal. **Abandon rule:** drop the errand (need stays) when `deadline − minute < walkMinutes(goal field, here) + ABANDON_MARGIN_MIN (5)`.

- [ ] **Step 1: Write failing tests**

```ts
test("a hungry person with time to spare finds a visible food unit and eats", () => { /* Hunger 1.0, 60 min slack, food unit 5 tiles away: within 30 min Hunger === 0 and ledger.today.rent > 0 */ });
test("a person does not know about a toilet out of sight, but a sign teaches it", () => { /* toilet 30 tiles round a wall: known[Toilet] stays -1 for 10 min; add a sign beside them: known becomes the toilet id */ });
test("a person with almost no time left drops their errand", () => { /* Hunger 1.0, deadline = now + walk + 2: errand === -1 after one step, Hunger still ≥ 1 */ });
test("a desperate person with no toilet slows down", () => { /* speedMul 0.7 after 20 min unmet */ });
test("errands never make a fair-deadline person miss on an empty map", () => { /* starting map + one food unit + one toilet + 2 signs; 6 game hours; on-time ≥ 0.95 */ });
```

- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit "feat: needs, errands, signs".

---

### Task 12: Build tools (logic)

**Files:**
- Create: `src/sim/build.ts`
- Test: `tests/sim/build.test.ts`

**Interfaces:**
- Consumes: Tasks 1–11.
- Produces:
  - `type ToolId = "floor" | "retail" | "seating" | "toilet" | "wall" | "rail" | "sign" | "travelator" | "remove"`
  - `interface PlacementPreview { tool: ToolId; rect: Rect; tiles: number[] /*tiles that will change*/; blocked: number[] /*tiles in rect that can't take it*/; cost: number /*negative = refund*/; valid: boolean; reason: string | null; signKind?: Sign["kind"]; dir?: Dir }`
  - `function previewPlacement(w: World, tool: ToolId, rect: Rect, opts?: { signKind?: Sign["kind"]; dir?: Dir }): PlacementPreview`
  - `function applyPlacement(w: World, p: PlacementPreview): boolean` — re-validates, debits, mutates the grid, creates facilities/signs, calls `nudgeToWalkable` for anyone now on a non-walkable tile, and refreshes sign targets.
  - Rules and reason copy (exact strings):
    - floor: `tiles` = Ground tiles in rect; `blocked` = obstacles etc; needs ≥ 1 tile orthogonally next to existing walkable floor ("Must join existing floor"); 0 tiles → "Nothing to build here".
    - retail / toilet / seating: every tile Floor with zone None, no Platform/Entrance ("Must be on plain floor"); min size retail 2×2, toilet 2×2, seating 1×2 ("Too small"); retail/toilet need ≥ 1 service tile ("Needs a floor tile beside it").
    - wall / rail: rect 1 tile thick ("Draw a line"), tiles Floor with zone None.
    - sign: 1 tile, Floor, zone None.
    - travelator: 1 tile thick, ≥ 3 long, `dir` along its length; tiles Floor, zone None.
    - remove: everything removable in rect (walls, rails, signs, travelators, whole facilities touched by rect, then floor tiles that aren't Platform/Entrance/foot); cost = −`REMOVE_REFUND` × build price.
    - every tool: after the hypothetical change, BFS from every reachable entrance must still reach every active platform and every entrance that was reachable before: else "Would cut off Platform N" / "Would block Entrance X".
    - every tool with cost > 0: `ledger.canAfford(cost)` else "Not enough money".

- [ ] **Step 1: Write failing tests**

```ts
test("floor preview counts only ground tiles and prices them", () => { /* rect over 6 ground + 2 obstacle tiles next to floor: tiles.length 6, blocked.length 2, cost 600, valid */ });
test("floor must join existing floor", () => { /* rect of ground far from any floor: valid false, reason "Must join existing floor" */ });
test("refuses a wall that cuts off a platform", () => {
  const w = createWorld(1); const p = previewPlacement(w, "wall", wallAcrossPlatformOneFoot(w));
  expect(p.valid).toBe(false); expect(p.reason).toBe("Would cut off Platform 1");
  const before = w.ledger.balance, v = w.grid.version; expect(applyPlacement(w, p)).toBe(false);
  expect(w.ledger.balance).toBe(before); expect(w.grid.version).toBe(v);
});
test("moves people out of newly blocked tiles", () => { /* person standing inside a 2x2 rect; place retail; person now on walkable tile */ });
test("retail too small and off-floor are refused with reasons", () => { /* 1x2 retail: "Too small"; 2x2 over ground: "Must be on plain floor" */ });
test("not enough money refuses", () => { /* balance 50, floor rect costing 600: valid false, reason "Not enough money" */ });
test("remove refunds half and keeps platforms reachable", () => { /* build 4-tile wall (cost 80), remove it: balance +40; removing the only floor link to Platform 2 is refused with "Would cut off Platform 2" */ });
```

- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit "feat: build tools logic".

---

### Task 13: Service meter and growth

**Files:**
- Create: `src/sim/growth.ts`
- Modify: `src/sim/world.ts` (add `meter`, `growth`, `stagesUnlocked: { subway: boolean }`; outcome events feed the meter unless `excluded`; call `stepGrowth`)
- Test: `tests/sim/growth.test.ts`

**Interfaces:**
- Produces:
  - `class ServiceMeter { record(minute: number, onTime: boolean): void; rate(now: number): number | null /*null below MIN_SAMPLES = 30 in window*/ }` — window `METER_WINDOW_MIN = 120`.
  - `interface GrowthState { goodSince: number | null; badSince: number | null; cooldownUntil: number }`
  - `function stepGrowth(w: World): void` — every game minute: rate ≥ `GROW_RATE = 0.9` continuously for `SUSTAIN_MIN = 180` → reactivate the lowest inactive platform, else add slot `platformsAdded + 1` (≤ 18) via `addPlatform`; rate < `SHRINK_RATE = 0.7` for 180 → deactivate the highest active platform above the first 2. Then `cooldownUntil = minute + COOLDOWN_MIN (240)`. Toasts: "Platform 3 opens", "Platform 5 is closed: too many people missed their trains", "Platform 5 reopens".
  - `function addPlatform(w: World, slotId: number): void` — sets track/platform/foot tiles, `platformsAdded++`, active. At `platformsAdded === 10` set `stagesUnlocked.subway = true` and toast "The subway is coming".
  - `function deactivatePlatform(w: World, slotId: number): void` — future services on it cancelled with `cancelReason "inactive"`; booked people rebooked onto another active platform's service using the fair rule from their current tile; no outcome emitted. Platform tiles stay.

- [ ] **Step 1: Write failing tests**

```ts
test("meter rate over the window", () => { /* 40 on-time at minutes 0..39, 10 late at 40..49: rate(50) 0.8; rate(200) uses only samples after minute 80 → null */ });
test("meter is null with too few samples", () => { /* 29 samples: null */ });
test("sustained good service adds platform 3", () => { /* feed 3h of on-time outcomes; platformsAdded 3; grid has Platform tiles in slot 3 */ });
test("sustained poor service deactivates a platform but never below 2 or removes tiles", () => { /* 3 platforms, 3h at 50%: platformActive[2] false, Platform tiles still in slot 3; another 6h at 50%: platforms 1 and 2 still active */ });
test("reactivates before adding", () => { /* platform 3 inactive, 3h at 100%: platformActive[2] true, platformsAdded still 3 */ });
test("rebooks passengers when a platform goes inactive", () => { /* booked person gets a new serviceId on another platform; no outcome event */ });
test("tenth platform unlocks the subway flag", () => { /* addPlatform up to 10: stagesUnlocked.subway true, toast "The subway is coming" emitted once */ });
```

- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit "feat: service meter and platform growth".

---

### Task 14: Disruptions

**Files:**
- Create: `src/sim/disruptions.ts`
- Modify: `src/sim/world.ts` (add `disruptions: Disruption[]`; call `stepDisruptions` first in `step`)
- Test: `tests/sim/disruptions.test.ts`

**Interfaces:**
- Produces:
  - `interface Disruption { id: number; kind: "line-closure"; platforms: number[]; startsAt: number; endsAt: number; text: string }` — text like "Signal failure at Ashby: Platforms 3 and 4 closed until 11:20".
  - `function stepDisruptions(w: World, dtMin: number): void` — starts one with probability `DISRUPTIONS_PER_DAY (1.5) / 1440 × dtMin` when no other is running; closes `1..max(1, floor(active / 3))` active platforms for 60–180 min. Services on them in the window are cancelled with `cancelReason "disruption"`. Booked people: half rebooked fairly onto other platforms, half wait and are rebooked onto the first service after `endsAt`. If a booked person's train is cancelled their outcome is `onTime: false, excluded: true`, refunded at `REFUND × DISRUPTION_REFUND_FACTOR`. Emits a toast at start and end.

- [ ] **Step 1: Write failing tests**

```ts
test("a disruption closes platforms and cancels their services in the window", () => { /* force one on platform 2 for 90 min: every service departing in the window has cancelReason "disruption" */ });
test("disruption misses are excluded from the meter and refunded at the lower rate", () => { /* booked person whose train is cancelled: outcome excluded true, meter sample count unchanged, refunds += 12 × 0.4 */ });
test("services resume after the disruption ends", () => { /* after endsAt, upcoming(2) has non-cancelled services and waiting people are booked on them */ });
```

- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit "feat: line closures".

---

### Task 15: Saving and loading

**Files:**
- Create: `src/sim/save.ts`, `src/ui/storage.ts`
- Test: `tests/sim/save.test.ts`

**Interfaces:**
- Produces:
  - `const SAVE_VERSION = 1`
  - `function serialise(w: World): string` (JSON; typed arrays as base64; fields cache and crowd grid are not saved, rebuilt on load)
  - `function deserialise(json: string): World` — throws `Error("Unsupported save version")` on mismatch.
  - `storage.ts` (UI side): `loadSave(): string | null`, `writeSave(json: string): void`, `clearSave(): void` on `localStorage` key `"footfall.save.v1"`, all wrapped in try/catch (private windows).
  - World emits `{ kind: "autosave" }` each game hour; the UI writes on that event, on pause and on `pagehide`.

- [ ] **Step 1: Write failing test**

```ts
test("a world saved mid-rush steps identically after loading", () => {
  const a = createWorld(9); runMinutes(a, 8 * 60 + 15); // Mon 08:15, trains dwelling, queues
  const b = deserialise(serialise(a));
  runMinutes(a, 30); runMinutes(b, 30);
  expect(serialise(b)).toBe(serialise(a));
});
test("refuses an unknown version", () => { /* JSON with version 99: deserialise throws "Unsupported save version" */ });
```

- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit "feat: save and load".

---

### Task 16: Renderer

**Files:**
- Create: `src/render/renderer.ts`, `src/render/drawPlan.ts`, `src/render/drawTrains.ts`, `src/render/drawOverlays.ts`
- Modify: `src/render/camera.ts` (pan, wheel zoom 0.5–3, clamp to map), `src/render/drawPeople.ts` (all three fills)
- Test: `tests/render/camera.test.ts`

**Interfaces:**
- Consumes: World and everything in `src/sim`.
- Produces:
  - `class Renderer { constructor(canvas: HTMLCanvasElement); camera: Camera; draw(w: World, ui: UiOverlayState): void }`
  - `interface UiOverlayState { preview: PlacementPreview | null; selectedPerson: number | null; hoverTile: number | null }`
  - `drawPlan`: Ground with a 20px dot grid; obstacles as Track-colour hatched blocks with their name in small secondary ink; Floor; walls drawn as 4px Wall-colour edges wherever walkable meets non-walkable, plus placed Wall tiles as 8px bars; rails dotted; track with sleepers; platform tiles with a 2px edge on the track side; inactive platforms at 35% opacity with "Closed"; retail units teal-outlined squares with tenant name, or "To let · tenant in 0:40"; toilets "WC"; seating as bench strokes; signs as dark rounded squares with an arrow towards their target; travelators as tread lines with direction chevrons; platform labels "Platform 1 · 08:51 Ashby · 0:18" (countdown in game minutes).
  - `drawTrains`: carriages as Wall-colour rounded rects with Floor windows on the track column, sliding in over `APPROACH_MIN`, out over `LEAVE_MIN`.
  - `drawOverlays`: per 4×4-tile cell, density class from the crowd grid: crowded → orange radial glow `rgba(232,119,46,0.32)`; jam (density ≥ `JAM_DENSITY` for ≥ 1 game min) → red glow `rgba(224,67,58,0.36)` plus a ring that fills over `JAM_RING_FULL_MIN = 10`; drag preview as dashed rect (blue valid, Alert red invalid) with blocked tiles tinted; selected person's route as a 2px line along `bestNeighbour` steps to their current target then on to their goal.

- [ ] **Step 1:** Write the camera test (`screenToWorld(worldToScreen(p)) ≈ p` at zooms 0.5, 1, 3; zoom keeps the point under the cursor fixed). FAIL, implement, PASS.
- [ ] **Step 2:** Implement the draw modules. Check against the canvas boards in Chrome side by side (claude-in-chrome screenshot of `index.html` with a debug world).
- [ ] **Step 3:** Commit "feat: plan renderer".

---

### Task 17: HUD, tools, inspector and game loop (playable)

**Files:**
- Create: `src/ui/hud.ts`, `src/ui/toolRail.ts`, `src/ui/inspector.ts`, `src/ui/input.ts`, `src/ui/styles.css`
- Modify: `src/main.ts`, `index.html`

**Interfaces:**
- Consumes: everything above.
- Produces the playable page:
  - **Loop** (`main.ts`): `requestAnimationFrame`; accumulate `realDt × speed` (speed 0, 1, 3); run `step(w, SIM_DT)` up to `MAX_STEPS_PER_FRAME`; drain `w.events` to the HUD (toasts, day summary, autosave); draw.
  - **HUD** (top left): "Harbour Street", people moved today (Plex Mono 32px), "Rail 2 / 18", on-time meter bar with %; (top right): `formatClock`, `periodLabel`, pause / play / fast buttons (aria-labels "Pause", "Normal speed", "Fast forward"; keys Space, 1, 3); money: balance, today's income and costs, "Running costs £N/day"; balance in Alert red when negative; a calendar line warning of the next holiday ("Summer holidays in 2 weeks", "Christmas next week").
  - **Tool rail** (left edge, buttons ≥ 44px, as on the canvas): Floor, Shop, Seating, Toilets, Wall, Rail, Sign (sub-choice Toilets / Seating / Shops), Travelator (R key rotates direction), Remove. Esc cancels.
  - **Drag** (`input.ts`): left-drag a rect snapped to tiles; live tooltip "New floor · 88 tiles · £8,800 · you have £12,450", reason line in red when invalid; release applies. Right-drag or Space-drag pans; wheel zooms.
  - **Inspector** (`inspector.ts`): click a person → card that follows them: end goal line (e.g. "Catch the 08:51 to Ashby, Platform 4" / "Leave by Quay Lane, going to work by 09:10"), time left (red when time left < walk minutes from here + 5), current errand ("Looking for a toilet", "Queueing for food"), six need bars, close button. Hover → one-line tooltip. Click a retail unit → small panel with tenant, takings today, "Evict (£2,000)".
  - **Banners and toasts:** disruption banner across the top while running; toasts bottom centre for growth events; end-of-day toast "Monday: 4,920 moved, 96% on time, +£3,410".
  - **Save:** on boot, if a save exists load it, else new world; "New game" button in a small menu asks "Start a new game? Your current station will be lost." before clearing.
- [ ] **Step 1:** Implement.
- [ ] **Step 2:** `npm run typecheck && npm test` → PASS.
- [ ] **Step 3:** Browser check in Chrome (claude-in-chrome): play 2 game hours at ×3; build floor, a shop, a toilet, seating, a sign, a wall; confirm queues form, an inspector card follows a person, a refused build shows its reason, the clock and money tick, reload resumes the save. Screenshot each and note anything off.
- [ ] **Step 4:** Commit "feat: playable station".

---

### Task 18: Island platforms

Added 2026-10-19 at the user's request (spec §9 "Platforms come in pairs"). Platforms pair up: one shared walkway with a track either side.

**Files:**
- Modify: `src/sim/maps/harbourStreet.ts`, `src/sim/growth.ts`, `src/sim/build.ts` (reserved footprint), `src/sim/world.ts` (fieldTargets), `src/sim/trains.ts` (onPlatform), `src/sim/save.ts` + `saveCheck.ts` (`SAVE_VERSION = 2`), `src/render/drawPlan.ts`, `drawTrains.ts`, `labels.ts`, debug world
- Test: `tests/sim/harbourStreet.test.ts`, `growth.test.ts`, `trains.test.ts`, `build.test.ts`, `save.test.ts`, render label tests

**Interfaces:**
- Produces:
  - `interface IslandDef { id: number /*1..9*/; walkway: Rect /*4 cols × 30 rows*/; leftTrack: Rect; rightTrack: Rect; foot: Rect }`
  - `PlatformSlot` gains `island: number; side: "left" | "right"`; its `track` is its island's left or right track, its `platform` is its half of the walkway (left 2 cols / right 2 cols), its `foot` is the island's foot.
  - `StationMap` gains `islands: IslandDef[]` (9). Slot `2i − 1` is island `i` left, slot `2i` is island `i` right.
  - Geometry: island `i` starts at `x0 = 8 + 7(i − 1)`: left track col `x0`, walkway cols `x0+1..x0+4`, right track col `x0+5`, gap col `x0+6`; rows and foot as the old slots (30 rows, foot touching the concourse band).
  - `paintIsland(grid, island)` paints walkway (Platform), both tracks (Track) and foot (Floor). `paintSlot(grid, slot)` paints its island if the walkway isn't painted yet, otherwise does nothing. `buildGrid(map, n)` paints the islands of the first `n` slots.
- Rules:
  - Opening platform `2i − 1` (or `2i`) paints island `i` if needed; the second platform of a pair only flips `platformActive`. Toasts unchanged.
  - Reserved footprint (build.ts) = every tile of islands with no opened platform (walkway, tracks; foot floor-only as before).
  - Waiting passengers walk to a random walkable tile of their own half (`slot.platform`); boarding requires being on that half.
  - An inactive platform greys its own track and half only; its partner keeps working.
  - Renderer: one walkway per island with a 2px platform edge on both track sides; a label per platform running along its own half; closed/disrupted/future labels per platform as before (future islands: one dashed outline labelled "Future platforms 5 and 6").
  - `SAVE_VERSION = 2`; a version 1 save is refused ("Unsupported save version"), so boot stashes it and starts a new game with the existing toast.
  - Move obstacles so none overlap the 9 island footprints and the existing pinch-point and reachability tests still hold.

- [ ] **Step 1: Write failing tests**

```ts
test("9 islands, 18 slots, slot 2i-1 left and 2i right of island i", () => { /* slots[2].island === 2, side "left", platform rect = island 2 walkway cols x0+1..x0+2 */ });
test("islands 2..9 are all Ground in the starting grid and clear of obstacles", () => {});
test("opening platform 3 paints island 2; opening platform 4 changes no tiles", () => { /* grid.version unchanged by addPlatform(4) apart from activation */ });
test("a platform-2 passenger waits on the right half and boards from it", () => {});
test("deactivating platform 2 leaves platform 1 boarding normally", () => {});
test("a version 1 save is refused", () => {});
```

- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS (full suite, typecheck).
- [ ] **Step 5:** Commit "feat: island platforms".

---

### Task 19: Ticket gates

Added 2026-10-19 at the user's request (spec §9 "Ticket gates", §11 Gate tool).

**Files:**
- Modify: `src/sim/grid.ts` (tiles), `maps/harbourStreet.ts` (gate line per island), `routeField.ts` (gate cost), `movement.ts` (one person per gate), `build.ts` (Gate tool), `economy.ts` (price, upkeep), `src/render/drawPlan.ts`, `src/ui/toolRail.ts`, `src/ui/format.ts` (tooltip name "Gate")
- Test: `tests/sim/gates.test.ts`, `build.test.ts`, `economy.test.ts`, `routeField.test.ts`

**Interfaces:**
- Produces:
  - `Tile.Gate = 8` (walkable), `Tile.GateClosed = 9` (not walkable; a closed-off slot in a gate line).
  - `IslandDef.gateLine: Rect` — the walkway's southernmost row (4 tiles). `paintIsland` paints the 2 middle tiles `Gate` and the 2 outer ones `GateClosed`.
  - `GATE_SPEED_FACTOR = 0.25` (crossing a gate tile takes 4× a floor tile), `stepCost` onto a Gate tile × `1 / GATE_SPEED_FACTOR`, so the unimpeded walk includes gate time.
  - Movement: at most one person on a Gate tile at once. A person may only move onto a Gate tile nobody occupies (check and claim within the sub-step loop, so it holds at any dt); on it they move at `× GATE_SPEED_FACTOR`. Both directions use the same gates.
  - Build tool `"gate"`: a single tile that is `GateClosed` on an island with an opened platform → `Gate`, cost `PRICES.gate = 500`. Remove on a `Gate` tile → `GateClosed`, refund half, refused with "An island needs at least one gate" if it is that island's last gate. Upkeep `UPKEEP_PER_DAY.gate = 15` per gate.
  - Renderer: gates as on the canvas (posts with a gap), closed slots as a solid barrier with posts; tool rail button "Gate" with price; tooltip "Gate · 1 tile · £500".
  - Save: no version change (tiles are already saved; version 2 from Task 18).

- [ ] **Step 1: Write failing tests**

```ts
test("never two people on one gate tile, even with a large dt", () => { /* 60 walkers through a 1-gate line, dt 0.5 s, check occupancy every step */ });
test("one gate is a bottleneck and opening a second roughly doubles throughput", () => { /* people through per 10 game min: 2 gates ≥ 1.7 × 1 gate */ });
test("fair deadline walk includes gate crossing time", () => { /* walkMinutes across a gate line > the same path without it */ });
test("Gate tool opens a closed slot, costs 500, and remove refuses the last gate", () => {});
test("gate upkeep is counted", () => {});
test("an unobstructed station still has a high on-time rate with 2 gates per island", () => { /* the Task 8 6-hour test: ≥ 0.95 */ });
```

- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit "feat: ticket gates".

---

### Task 20: Wider islands with a usable centre

Added 2026-10-19 at the user's request (spec §9 "Wider islands with a usable centre").

**Files:**
- Modify: `src/sim/maps/harbourStreet.ts` (ISLANDS geometry), `src/sim/world.ts` (waitingSpots), `src/sim/build.ts` (platform rules), `src/sim/save.ts` (`SAVE_VERSION = 3`), renderer platform/label drawing, any test coordinates tied to island columns
- Test: `harbourStreet.test.ts`, `build.test.ts`, `trains.test.ts`, `gates.test.ts`, `save.test.ts`

**Interfaces:**
- Island `i` at `x0 = 8 + 8(i − 1)`: left track `x0`, walkway `x0+1..x0+5` (5 wide), right track `x0+6`, gap `x0+7`. Gate line = the walkway's southernmost row (5 tiles); an island opens with gates at `x0+2` and `x0+4` (one per side) and the other 3 closed, up to 5 gates.
- Slot halves: left platform = cols `x0+1..x0+2`, right platform = cols `x0+4..x0+5`; col `x0+3` belongs to neither (shared centre).
- Edge rows `x0+1` and `x0+5` (every walkway row except the gate row) are platform edges: never buildable, reason "Keep the platform edge clear".
- Centre cols `x0+2..x0+4` accept retail, seating, toilet, wall, rail, sign (not floor, not travelator), subject to the usual checks.
- Waiting spots stay the edge column of each half; boarding accepts the whole half.
- `SAVE_VERSION = 3` (geometry change).

- [ ] **Step 1: Write failing tests** — island geometry (5-wide walkway, stride 8, all clear of obstacles, map tests still pass); a seat on an island centre is allowed, a seat on an edge row refused with "Keep the platform edge clear"; a build that blocks the whole centre and both edges' access refused with "Would cut off Platform N"; gate line has 5 tiles; v2 save refused; multi-seed on-time bars unchanged.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit "feat: wider islands with a usable centre".

---

### Task 21: The city map

Added 2026-10-19 at the user's request (spec §10b). Replaces the stand-alone Harbour Street map with the whole city, with only the station usable for now.

**Files:**
- Create: `src/sim/maps/city.ts` (city shapes and areas), `src/render/drawCity.ts`
- Modify: `src/sim/grid.ts` (tile kinds), `src/sim/maps/harbourStreet.ts` (station placed inside the city; entrances A/B/C renamed), `src/sim/world.ts`, `src/render/palette.ts` (water, shore, park, tree, road colours), `drawPlan.ts`, `renderer.ts`, `src/ui/framing.ts`, save (`SAVE_VERSION = 4`), map tests
- Test: `tests/sim/city.test.ts`, `harbourStreet.test.ts`, `save.test.ts`

**Interfaces:**
- `Tile.Water = 10`, `Tile.Park = 11`, `Tile.Road = 12`, `Tile.Locked = 13`: unwalkable, unbuildable. `Tile.Pavement = 14`: walkable, unbuildable (road-bridge pavements, the footbridge, and short pavement runs leading to each entrance).
- `interface CityShape { kind: "water" | "park" | "road" | "locked"; name?: string; points: [number, number][] /*tile coords, closed polygon or road centre-line*/; width?: number /*roads*/; area?: string /*locked: which stage*/ }`
- `const CITY: { w: number; h: number; shapes: CityShape[]; station: { origin: [number, number] } }` — the city at tile scale following the v4 layout; the station's existing 120 × 90 footprint placed at `station.origin`; the rest of the map is Ground (buildable later only where the station grows) or Locked.
- `rasterise(city): Grid` paints shapes into tiles (polygons filled by tile centre; roads by width), then the station map on top.
- Entrances: A Harbour Road (south), B Market Street (west), C Footbridge (east). Footbridge tiles are Pavement over Water; a road bridge is Road with Pavement each side.
- Renderer draws water/park/road/locked shapes as smooth curves from `CITY.shapes` (not tile squares): water soft blue with a faint grid and a pale shore band, parks sage with round trees, roads pale with kerbs and a dashed centre line, the river name in spaced capitals; locked stage areas under a haze with their name and unlock line. Static layer.
- Rail throat drawn north of the station (decorative).
- Map tests keep their intent: Entrance C reachable only by building (now across the footbridge), several 2 to 4 tile pinch points on the A→C route (river banks, park edges, roads), all islands clear of obstacles, everything reachable when ground is floor.
- Camera framing unchanged in spirit (frames the station); panning is limited to the city.
- `SAVE_VERSION = 4`.

- [ ] **Step 1: Write failing tests** — rasterised water/park/road/locked tiles unwalkable; footbridge walkable; entrances A/B/C on the right edges; station map tests still pass in city coordinates; v3 save refused.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS; run the bench (5,000 people) and check fps holds on the bigger map.
- [ ] **Step 5:** Commit "feat: the city map".

---

### Task 22: Rent by location

Added 2026-10-19 at the user's request (spec §8 "Rent by location").

**Files:**
- Modify: `src/sim/facilities.ts`, `src/sim/world.ts` (rollDays), `src/sim/saveCheck.ts`, `src/ui/game.ts` / shop panel text in `src/ui/format.ts`
- Test: `tests/sim/facilities.test.ts`, `tests/ui/format.test.ts`, `save.test.ts`

**Interfaces:**
- Produces:
  - `Facility.footfallToday: number` — distinct people seen within `FOOTFALL_RADIUS` today (always counted, not only while to let; one seen-set per unit, cleared at midnight), `Facility.rentMul: number` (starts 1).
  - At each day rollover, for every retail unit: `rentMul = clamp(footfallToday / RENT_FOOTFALL_REF, RENT_MUL_MIN 0.6, RENT_MUL_MAX 2.0)`, then `footfallToday = 0`. `RENT_FOOTFALL_REF = 300` (Task 21 tunes it).
  - Rent credited per sale = `spend × RENT_SHARE × rentMul` (× leisure multiplier as before).
  - `rentLine(rentMul): string` → "Busy spot: rent ×1.6" (≥ 1.05), "Quiet spot: rent ×0.8" (≤ 0.95), else "Average spot: rent ×1.0" (one decimal, U+00D7 multiply sign). Shown in the shop panel with "Yesterday: 412 people passed".
  - Saved and checked like the other facility fields.

- [ ] **Step 1: Write failing tests**

```ts
test("a unit on the main path ends the day with a higher rent multiplier than one in a corner", () => {});
test("rentMul is clamped to 0.6..2.0 and applied to the next day's rent", () => {});
test("rentLine wording", () => { expect(rentLine(1.6)).toBe("Busy spot: rent ×1.6"); expect(rentLine(0.8)).toBe("Quiet spot: rent ×0.8"); expect(rentLine(1)).toBe("Average spot: rent ×1.0"); });
test("footfallToday and rentMul survive save and load", () => {});
```

- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit "feat: rent by location".

---

### Task 23: Balance pass and handover

(Includes the islands, gates and location rent: the autoplay player also opens a gate on an island when the queue at its gate line stays long, and `RENT_FOOTFALL_REF` is tuned so a typical concourse unit sits near ×1.0.)

**Files:**
- Create: `src/sim/autoplay.ts` (a scripted "reasonable player" that extends floor towards the next slot and adds one food unit, one toilet and seating per two platforms), `tests/sim/balance.test.ts`
- Modify: `src/sim/constants.ts` values only

- [ ] **Step 1: Write balance tests**

```ts
test("an idle player on the starting map stays at 2 platforms and never errors over 3 game days", () => {});
test("the autoplay player reaches 10 platforms within 4 hours of real play time (≈ 24 game days)", () => {});
test("a station with no toilets and no seating has a worse on-time rate at peak than one with them", () => {});
test("money stays positive for the autoplay player after day 2", () => {});
```

- [ ] **Step 2:** Run; tune constants (spawn rate, prices, growth thresholds) until PASS. Keep the spec's target: subway by hour 3–4 of play.
- [ ] **Step 3:** Run the 5,000-person bench again and a ×3 play session at 10+ platforms in Chrome; record fps in `docs/perf.md`.
- [ ] **Step 4:** Commit "chore: balance pass".
