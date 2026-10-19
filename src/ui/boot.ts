import { deserialise } from "../sim/save";
import { createWorld, type World } from "../sim/world";

export const CORRUPT_SAVE_NOTICE = "Your saved game couldn't be loaded, so a new one has started";
export const SAVE_FAILED_NOTICE = "Couldn't save the game";

export interface BootDeps {
  load: () => string | null;
  /** Moves an unreadable save out of the way, keeping it. */
  stashCorrupt: (json: string) => void;
  newSeed: () => number;
}

/** The saved world if there is a readable one, else a new world (with a notice if a save was lost). */
export function bootWorld(deps: BootDeps): { world: World; notice: string | null } {
  const json = deps.load();
  if (json !== null) {
    try {
      return { world: deserialise(json), notice: null };
    } catch (error) {
      console.warn("Saved game could not be loaded", error);
      deps.stashCorrupt(json);
      return { world: createWorld(deps.newSeed()), notice: CORRUPT_SAVE_NOTICE };
    }
  }
  return { world: createWorld(deps.newSeed()), notice: null };
}
