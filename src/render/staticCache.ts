export interface StaticLayerInputs {
  /** Grid.version: every tile, zone and direction change bumps it, facilities included. */
  version: number;
  x: number;
  y: number;
  zoom: number;
  /** Backing store size in device px. */
  width: number;
  height: number;
  dpr: number;
  /** Bumped when the web fonts finish loading, so labels first drawn in a fallback face are redrawn. */
  fonts: number;
}

/** The static layer is redrawn exactly when this changes. */
export function staticLayerKey(k: StaticLayerInputs): string {
  return `${k.version}|${k.x}|${k.y}|${k.zoom}|${k.width}|${k.height}|${k.dpr}|${k.fonts}`;
}

/**
 * Remembers which grid the static layer was drawn for, and with which key. A loaded save restores
 * grid.version, so a new world can match the old key exactly: the grid's identity is checked too.
 */
export class StaticLayerCache {
  private grid: object | null = null;
  private key = "";

  /** Whether to redraw the layer for `grid` under `key`, and whether the grid is a different one (a new world). */
  update(grid: object, key: string): { redraw: boolean; newGrid: boolean } {
    const newGrid = grid !== this.grid;
    const redraw = newGrid || key !== this.key;
    this.grid = grid;
    this.key = key;
    return { redraw, newGrid };
  }

  /** Forgets the layer, so the next update redraws it. */
  invalidate(): void {
    this.key = "";
  }
}
