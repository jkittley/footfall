// localStorage can throw (private windows, blocked storage, a full quota); none of that may stop the game.

const KEY = "footfall.save.v1";

export function loadSave(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** False if the browser refused to store it. */
export function writeSave(json: string): boolean {
  try {
    localStorage.setItem(KEY, json);
    return true;
  } catch {
    return false;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing stored to clear.
  }
}
