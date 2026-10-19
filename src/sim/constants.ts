export const GAME_MIN_PER_REAL_SEC = 2.4;
export const WALK_TILES_PER_SEC = 2.5;
export const SIM_DT = 1 / 30;
export const MAX_STEPS_PER_FRAME = 12;
export const MAX_PEOPLE = 8000;
export const TILE_PX = 16;
export const SEATING_COST = 3;
export const TRAVELATOR_COST = 0.4;
export const DENSITY_WEIGHT = 1.5;
/** Crowd density (mean people per tile over a 3x3) at or below which people walk at full speed. */
export const CALM_DENSITY = 0.5;
/** Density at which speed bottoms out at MIN_SPEED_FACTOR. */
export const JAM_DENSITY = 2.5;
export const MIN_SPEED_FACTOR = 0.25;
/** Every deadline leaves at least this much spare time (game minutes) over the unimpeded walk. */
export const MIN_SLACK_MINUTES = 3;
/** Departing passengers per game minute per active platform at demand 1. */
export const SPAWN_PER_MIN_PER_PLATFORM = 0.3;
/** Share of alighting passengers who connect to a train on another platform. */
export const CONNECT_SHARE = 0.15;
