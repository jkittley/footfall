// Dev only (index.html?debug=render): the renderer on a world with every piece in it, live, with
// wheel zoom, drag to pan, click to select a person and a retail preview that follows the cursor
// (Esc hides it, B brings it back). ?speed=1 (default 3), ?zoom=2&centre=18,56 to frame a close look.
// Task 17 builds the real game page.
import { previewPlacement } from "./sim/build";
import { MAX_STEPS_PER_FRAME, SIM_DT } from "./sim/constants";
import { PState } from "./sim/people";
import { step, type World } from "./sim/world";
import { buildDebugWorld } from "./render/debugWorld";
import { Renderer, type UiOverlayState } from "./render/renderer";

declare global {
  interface Window {
    __ui?: UiOverlayState;
    __world?: World;
    __render?: { fps: number; drawMs: number; staticMs: number; staticDraws: number; people: number };
  }
}

export function startDebugRender(canvas: HTMLCanvasElement): void {
  const params = new URLSearchParams(location.search);
  const speed = Number(params.get("speed") ?? 3);
  const w = buildDebugWorld(Number(params.get("seed") ?? 7));
  const r = new Renderer(canvas);
  const zoom = Number(params.get("zoom"));
  const centre = params.get("centre")?.split(",").map(Number);
  let placed = false;
  const ui: UiOverlayState = { preview: null, selectedPerson: null, hoverTile: null };
  let showPreview = true;
  let pointer: [number, number] | null = null;

  window.__ui = ui;
  window.__world = w;
  let autoSelect = true;
  function pickWalker(): number | null {
    const p = w.people;
    // Someone walking a field (to a platform or an exit) has a route worth showing.
    for (let i = 0; i < p.end; i++) {
      const key = p.targetKey[i]!;
      if (p.isAlive(i) && p.state[i] === PState.Walking && (key.startsWith("platform:") || key.startsWith("exit:"))) return i;
    }
    return null;
  }
  // Stress: ?extra=5000 stands that many more people on random walkable tiles.
  const extra = Number(params.get("extra") ?? 0);
  for (let k = 0; k < extra; k++) {
    const x = w.rng.int(0, w.grid.w - 1);
    const y = w.rng.int(0, w.grid.h - 1);
    if (!w.grid.isWalkable(x, y)) {
      k--;
      continue;
    }
    const i = w.people.alloc();
    w.people.x[i] = x + w.rng.next();
    w.people.y[i] = y + w.rng.next();
    w.people.state[i] = PState.Waiting;
    w.people.mode[i] = w.rng.int(0, 3);
    w.people.journey[i] = w.rng.int(0, 2);
  }

  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    r.camera.wheel(e.offsetX, e.offsetY, e.deltaY);
  }, { passive: false });
  let drag: { x: number; y: number; moved: boolean } | null = null;
  canvas.addEventListener("pointerdown", (e) => {
    drag = { x: e.offsetX, y: e.offsetY, moved: false };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    pointer = [e.offsetX, e.offsetY];
    if (!drag) return;
    const dx = e.offsetX - drag.x;
    const dy = e.offsetY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    r.camera.pan(dx, dy);
    drag.x = e.offsetX;
    drag.y = e.offsetY;
  });
  canvas.addEventListener("pointerup", (e) => {
    if (drag && !drag.moved) {
      ui.selectedPerson = nearestPerson(e.offsetX, e.offsetY);
      autoSelect = false;
    }
    drag = null;
  });
  canvas.addEventListener("pointerleave", () => (pointer = null));
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") showPreview = false;
    if (e.key === "b") showPreview = true;
  });

  function nearestPerson(px: number, py: number): number | null {
    const [wx, wy] = r.camera.screenToWorld(px, py);
    let best: number | null = null;
    let bestD = 1;
    const p = w.people;
    for (let i = 0; i < p.end; i++) {
      if (!p.isAlive(i)) continue;
      const d = Math.hypot(p.x[i]! - wx, p.y[i]! - wy);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  let last = performance.now();
  let acc = 0;
  let frames = 0;
  let since = last;
  function frame(now: number): void {
    acc += (Math.min(now - last, 100) / 1000) * speed;
    last = now;
    let steps = 0;
    while (acc >= SIM_DT && steps < MAX_STEPS_PER_FRAME) {
      step(w, SIM_DT);
      acc -= SIM_DT;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) acc = 0;
    for (const ev of w.events) if (ev.kind === "toast") console.info(ev.text);
    w.events.length = 0;

    // Until a click picks someone, keep a walker selected so a route is always on show.
    if (autoSelect && (ui.selectedPerson === null || !w.people.isAlive(ui.selectedPerson))) ui.selectedPerson = pickWalker();
    ui.hoverTile = null;
    ui.preview = null;
    if (pointer) {
      const [wx, wy] = r.camera.screenToWorld(pointer[0], pointer[1]);
      const tx = Math.floor(wx);
      const ty = Math.floor(wy);
      if (w.grid.inBounds(tx, ty)) {
        ui.hoverTile = w.grid.idx(tx, ty);
        if (showPreview && !drag) ui.preview = previewPlacement(w, "retail", { x: tx - 1, y: ty - 1, w: 3, h: 2 });
      }
    }
    r.draw(w, ui);
    if (!placed) {
      // The renderer fits the map on its first draw; ?zoom=2&centre=18,56 then frames a closer look.
      placed = true;
      const cam = r.camera;
      if (zoom > 0) cam.zoomAt(cam.viewW / 2, cam.viewH / 2, zoom / cam.zoom);
      if (centre?.length === 2) {
        const [cx, cy] = cam.worldToScreen(centre[0]!, centre[1]!);
        cam.pan(cam.viewW / 2 - cx, cam.viewH / 2 - cy);
      }
    }

    frames++;
    if (now - since >= 1000) {
      window.__render = { fps: (frames * 1000) / (now - since), ...r.stats, people: w.people.count };
      frames = 0;
      since = now;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
