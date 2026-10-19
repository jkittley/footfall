const canvas = document.getElementById("game");
if (!(canvas instanceof HTMLCanvasElement)) throw new Error("index.html is missing its canvas");

if (new URLSearchParams(location.search).get("debug") === "render") {
  void import("./debugRender").then((m) => m.startDebugRender(canvas));
}
