import { Mode } from "../sim/people";

// The one place colours are written down (global constraints' palette, exact hexes).
export const GROUND = "#ECE8E1";
export const FLOOR = "#F8F6F2";
export const WALL = "#23262B";
export const TRACK = "#CBC5BA";
export const NIGHT = "#14171C";
export const CIRCLE = "#2F6FDB";
export const TRIANGLE = "#E8772E";
export const SQUARE = "#14907F";
export const DIAMOND = "#E5B72A";
export const HEXAGON = "#7B5CD6";
export const ALERT = "#C4342C";
export const INK = "#1E2126";
export const INK_2 = "#585D65";

/** Person colour by Mode: train, subway, flight, street. */
export const MODE_COLOURS: Record<Mode, string> = {
  [Mode.Train]: CIRCLE,
  [Mode.Subway]: TRIANGLE,
  [Mode.Flight]: HEXAGON,
  [Mode.Street]: DIAMOND,
};

/** The ground's dot grid (Wall at 13%). */
export const DOT = "rgba(35,38,43,0.13)";
/** Crowded cell glow, as on the Style board. */
export const GLOW_CROWDED: Rgba = [232, 119, 46, 0.32];
/** Jammed cell glow. */
export const GLOW_JAM: Rgba = [224, 67, 58, 0.36];
/** The unfilled part of a jam ring (Alert at 20%). */
export const RING_BACK = "rgba(196,52,44,0.2)";

export type Rgba = readonly [number, number, number, number];

export function rgba([r, g, b, a]: Rgba, alphaMul = 1): string {
  return `rgba(${r},${g},${b},${a * alphaMul})`;
}

/** "#RRGGBB" as 0..1 channels. */
export function hexToUnit(h: string): [number, number, number] {
  return [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
}
