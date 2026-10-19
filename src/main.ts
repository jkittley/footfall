import { GROUND } from "./render/palette";

// The page background before (and around) the canvas, from the one palette.
document.documentElement.style.setProperty("--ground", GROUND);

const canvas = document.getElementById("game");
if (!(canvas instanceof HTMLCanvasElement)) throw new Error("index.html is missing its canvas");

if (new URLSearchParams(location.search).get("debug") === "render") {
  void import("./debugRender").then((m) => m.startDebugRender(canvas));
}
