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
/** Game minutes between a retail unit being built (or emptied) and its tenant moving in. */
export const TENANT_DELAY_MIN = 40;
/** A to-let unit counts passers-by within this many tiles of it. */
export const FOOTFALL_RADIUS = 6;
/** A seated person stands this many minutes earlier than their walk to the goal strictly needs. */
export const SEAT_LEAVE_MARGIN = 5;
/** Nobody sits longer than this (game minutes). */
export const SEAT_MAX_MIN = 30;
/** Game minutes an evicted unit stays empty before a new tenant moves in. */
export const EMPTY_AFTER_EVICT_MIN = 120;
/** Leisure customers spend this much more than commuters. */
export const LEISURE_SPEND_MUL = 1.3;
/** A person gives up on a queue after waiting this many game minutes in it. */
export const QUEUE_GIVE_UP_MIN = 20;
/** A queuer leaves once they have less than this many spare minutes over their walk to the goal. */
export const QUEUE_LEAVE_MARGIN = 5;
/** Longest line of floor tiles a queue may stand on. */
export const MAX_QUEUE_TILES = 12;
/** Game minutes between looks round for a facility that meets an errand. */
export const SEARCH_INTERVAL_MIN = 1;
/** A facility this many tiles' walk away (or nearer) is seen. */
export const SIGHT_RADIUS = 8;
/** A sign this many tiles away (straight line) or nearer is read. */
export const SIGN_RADIUS = 10;
/** A person who has not found a toilet in this many game minutes is desperate. */
export const DESPERATE_AFTER_MIN = 20;
/** A desperate person's speed multiplier. */
export const DESPERATE_SPEED_MUL = 0.7;
/** Chance per tile walked that a desperate person lurches to a random neighbouring tile. */
export const DRIFT_PER_TILE = 0.25;
/** An errand is dropped when fewer than this many spare minutes remain over the walk to the goal. */
export const ABANDON_MARGIN_MIN = 5;
/** Game minutes after an errand ends before a person takes up another. */
export const ERRAND_COOLDOWN_MIN = 5;
/** The service meter's look-back window (game minutes). */
export const METER_WINDOW_MIN = 120;
/** The meter shows no rate on fewer outcomes than this in its window. */
export const MIN_SAMPLES = 30;
/** An on-time rate at or above this, held for SUSTAIN_MIN, grows the station. */
export const GROW_RATE = 0.9;
/** An on-time rate below this, held for SUSTAIN_MIN, closes a platform. */
export const SHRINK_RATE = 0.7;
export const SUSTAIN_MIN = 180;
/** Game minutes after a platform opens or closes before the meter can move another. */
export const COOLDOWN_MIN = 240;
