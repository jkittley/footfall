import { ALERT, CIRCLE, FLOOR, GROUND, INK, INK_2, NIGHT, TRACK, WALL, hexToUnit } from "./render/palette";

// Page colours come from the one palette, as CSS variables the stylesheet reads.
const root = document.documentElement.style;
const rgb = (hex: string): string => hexToUnit(hex).map((c) => Math.round(c * 255)).join(",");
for (const [name, value] of Object.entries({
  "--ground": GROUND,
  "--floor": FLOOR,
  "--wall": WALL,
  "--track": TRACK,
  "--ink": INK,
  "--ink-2": INK_2,
  "--alert": ALERT,
  "--circle": CIRCLE,
  "--scrim": `rgba(${rgb(NIGHT)},0.35)`,
  "--panel": `rgba(${rgb(FLOOR)},0.92)`,
})) {
  root.setProperty(name, value);
}

const canvas = document.getElementById("game");
if (!(canvas instanceof HTMLCanvasElement)) throw new Error("index.html is missing its canvas");

if (new URLSearchParams(location.search).get("debug") === "render") {
  void import("./debugRender").then((m) => m.startDebugRender(canvas));
} else {
  void import("./ui/game").then((m) => m.startGame(canvas));
}
