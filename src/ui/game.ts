import { Renderer, type UiOverlayState } from "../render/renderer";
import { evictTenant } from "../sim/facilities";
import { serialise } from "../sim/save";
import { createWorld, step, type World } from "../sim/world";
import { SIM_DT } from "../sim/constants";
import { SAVE_FAILED_NOTICE, bootWorld } from "./boot";
import { el } from "./dom";
import { toastForEvent } from "./format";
import { Hud } from "./hud";
import { Input } from "./input";
import { Inspector, ShopPanel, Tip } from "./inspector";
import { planFrame, type Speed } from "./loop";
import { clearSave, loadSave, stashCorruptSave, writeSave } from "./storage";
import { ToolRail } from "./toolRail";

function newSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

/** The playable page: the loop, the HUD, the tools, the inspector, saving and New game. */
export function startGame(canvas: HTMLCanvasElement): void {
  const boot = bootWorld({ load: loadSave, stashCorrupt: stashCorruptSave, newSeed });
  let w: World = boot.world;
  let speed: Speed = 1;
  let acc = 0;
  let saveFailShown = false;
  const ui: UiOverlayState = { preview: null, selectedPerson: null, hoverTile: null };
  const renderer = new Renderer(canvas);

  const layer = el("div", "ui");
  document.body.append(layer);

  function save(): void {
    if (writeSave(serialise(w))) {
      saveFailShown = false;
    } else if (!saveFailShown) {
      saveFailShown = true;
      hud.toast({ text: SAVE_FAILED_NOTICE, style: "note" });
    }
  }

  function setSpeed(s: Speed): void {
    if (s === 0 && speed !== 0) save();
    speed = s;
  }

  function newGame(): void {
    clearSave();
    w = createWorld(newSeed());
    acc = 0;
    input.cancel();
    rail.select(null);
    inspector.close();
    shop.close();
    ui.selectedPerson = null;
    save();
    window.__world = w;
  }

  const rail = new ToolRail(layer, () => {
    input.cancel();
    if (rail.tool) {
      inspector.close();
      shop.close();
    }
  });
  const hud = new Hud(layer, { setSpeed, newGame });
  const inspector = new Inspector(layer, () => {
    ui.selectedPerson = null;
  });
  const shop = new ShopPanel(
    layer,
    () => w,
    (id) => {
      if (!evictTenant(w, id)) hud.toast({ text: "Not enough money", style: "note" });
    },
  );
  const tip = new Tip(layer);
  const input = new Input({
    canvas,
    camera: renderer.camera,
    ui,
    rail,
    tip,
    world: () => w,
    setSpeed,
    togglePause: () => setSpeed(speed === 0 ? 1 : 0),
    selectPerson: (pid) => {
      shop.close();
      inspector.open(w, pid);
      ui.selectedPerson = pid;
    },
    openShop: (id, x, y) => {
      inspector.close();
      shop.open(id, x, y);
    },
    escape: () => {
      if (hud.confirmOpen) hud.closeConfirm();
      else if (hud.menuOpen) hud.toggleMenu(false);
      else if (rail.tool) rail.select(null);
      else if (shop.isOpen) shop.close();
      else inspector.close();
    },
    modalOpen: () => hud.confirmOpen,
    refused: (reason) => hud.toast({ text: reason, style: "note" }),
  });

  if (boot.notice) hud.toast({ text: boot.notice, style: "note" });
  window.addEventListener("pagehide", save);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") save();
  });
  window.__world = w;

  let last = performance.now();
  function frame(now: number): void {
    const plan = planFrame(acc, Math.max(0, (now - last) / 1000), speed);
    last = now;
    acc = plan.acc;
    for (let k = 0; k < plan.steps; k++) step(w, SIM_DT);

    let wantSave = false;
    for (const ev of w.events) {
      if (ev.kind === "autosave") wantSave = true;
      const t = toastForEvent(ev);
      if (t) hud.toast(t);
    }
    w.events.length = 0;
    if (wantSave) save();

    if (inspector.isOpen && !inspector.tracking(w)) ui.selectedPerson = null;
    input.frame();
    renderer.draw(w, ui);
    hud.update(w, speed);
    inspector.update(w, renderer.camera, now);
    shop.update();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
