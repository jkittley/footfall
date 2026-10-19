import type { Camera } from "../render/camera";
import type { UiOverlayState } from "../render/renderer";
import { applyPlacement, previewPlacement, type PlacementPreview } from "../sim/build";
import { FacilityKind } from "../sim/facilityKinds";
import type { World } from "../sim/world";
import { dragRect } from "./drag";
import { placementTooltip } from "./format";
import type { Tip } from "./inspector";
import type { Speed } from "./loop";
import { goalFacts, goalLine } from "./personText";
import type { ToolRail } from "./toolRail";

/** Pointer travel (CSS px) before a press becomes a drag. */
const DRAG_PX = 4;
/** A click picks the nearest person within this many CSS px (or this many tiles, whichever is more). */
const PICK_PX = 14;
const PICK_MIN_TILES = 0.75;

export interface InputHost {
  canvas: HTMLCanvasElement;
  camera: Camera;
  ui: UiOverlayState;
  rail: ToolRail;
  tip: Tip;
  world: () => World;
  setSpeed: (s: Speed) => void;
  togglePause: () => void;
  selectPerson: (pid: number) => void;
  openShop: (facilityId: number, x: number, y: number) => void;
  /** Esc with no drag running: close the confirm or menu, else cancel the tool, else close a card. */
  escape: () => void;
  /** A key that a dialog should have to itself (the New game confirm). */
  modalOpen: () => boolean;
  refused: (reason: string) => void;
}

type Press =
  | { kind: "build"; startX: number; startY: number; endX: number; endY: number }
  | { kind: "pan"; x: number; y: number }
  /** A left press with no tool: a click unless it moves, then a pan. */
  | { kind: "click"; x: number; y: number; downX: number; downY: number; moved: boolean };

/**
 * Pointer, wheel and keyboard on the station: left-drag with a tool builds (live preview and
 * tooltip, applied on release), right-drag, Space-drag or a moved left-drag without a tool pans,
 * the wheel zooms, a click picks a person or a shop. Keys: Space pause/play, 1 normal, 3 fast,
 * Esc cancel, R rotate the travelator.
 */
export class Input {
  private press: Press | null = null;
  private pointer: [number, number] | null = null;
  private spaceDown = false;
  private spaceDragged = false;
  private previewKey = "";
  /** Whether the balance covered the current preview's cost when it was made. */
  private previewAfford = false;

  constructor(private readonly host: InputHost) {
    const c = host.canvas;
    c.addEventListener("pointerdown", (e) => this.down(e));
    c.addEventListener("pointermove", (e) => this.move(e));
    c.addEventListener("pointerup", (e) => this.up(e));
    c.addEventListener("pointercancel", () => this.cancel());
    c.addEventListener("pointerleave", () => {
      if (!this.press) this.pointer = null;
    });
    c.addEventListener("contextmenu", (e) => e.preventDefault());
    c.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        host.camera.wheel(e.offsetX, e.offsetY, e.deltaY);
      },
      { passive: false },
    );
    window.addEventListener("keydown", (e) => this.keyDown(e));
    window.addEventListener("keyup", (e) => this.keyUp(e));
    window.addEventListener("blur", () => {
      this.spaceDown = false;
    });
  }

  /** Drops a drag in progress (a new game, a tool change). */
  cancel(): void {
    this.press = null;
    this.previewKey = "";
    this.host.ui.preview = null;
    this.host.tip.hide();
  }

  /** Every frame: the build preview and tooltip against the world as it is now, and the hover. */
  frame(): void {
    const { ui, tip, rail } = this.host;
    const w = this.host.world();
    ui.hoverTile = null;
    const tile = this.pointer ? this.tileAt(this.pointer[0], this.pointer[1]) : null;
    if (this.press?.kind === "build" && rail.tool) {
      const p = this.press;
      const rect = dragRect(rail.tool, [p.startX, p.startY], [p.endX, p.endY]);
      const opts = rail.opts();
      const key = `${rail.tool}|${rect.x},${rect.y},${rect.w},${rect.h}|${opts.signKind}|${opts.dir}|${w.grid.version}`;
      if (key !== this.previewKey || !ui.preview || w.ledger.canAfford(ui.preview.cost) !== this.previewAfford) {
        this.previewKey = key;
        ui.preview = previewPlacement(w, rail.tool, rect, opts);
        this.previewAfford = w.ledger.canAfford(ui.preview.cost);
      }
      const t = placementTooltip(ui.preview, w.ledger.balance);
      if (this.pointer) tip.show(this.pointer[0], this.pointer[1], t.text, t.reason);
      return;
    }
    ui.preview = null;
    this.previewKey = "";
    if (!this.pointer || tile === null) {
      tip.hide();
      return;
    }
    ui.hoverTile = w.grid.idx(tile[0], tile[1]);
    if (rail.tool || this.press) {
      tip.hide();
      return;
    }
    const pid = this.personAt(this.pointer[0], this.pointer[1]);
    // The selected person already has their card open.
    if (pid === null || pid === ui.selectedPerson) tip.hide();
    else tip.show(this.pointer[0], this.pointer[1], goalLine(goalFacts(w, pid)), null, true);
  }

  private down(e: PointerEvent): void {
    if (this.press) return;
    this.host.canvas.setPointerCapture(e.pointerId);
    this.pointer = [e.offsetX, e.offsetY];
    if (e.button === 1 || e.button === 2 || (e.button === 0 && this.spaceDown)) {
      if (this.spaceDown) this.spaceDragged = true;
      this.press = { kind: "pan", x: e.offsetX, y: e.offsetY };
      return;
    }
    if (e.button !== 0) return;
    const tile = this.tileAt(e.offsetX, e.offsetY);
    if (this.host.rail.tool && tile) {
      this.press = { kind: "build", startX: tile[0], startY: tile[1], endX: tile[0], endY: tile[1] };
      return;
    }
    this.press = { kind: "click", x: e.offsetX, y: e.offsetY, downX: e.offsetX, downY: e.offsetY, moved: false };
  }

  private move(e: PointerEvent): void {
    this.pointer = [e.offsetX, e.offsetY];
    const p = this.press;
    if (!p) return;
    if (p.kind === "build") {
      const w = this.host.world();
      const [wx, wy] = this.host.camera.screenToWorld(e.offsetX, e.offsetY);
      p.endX = Math.min(w.grid.w - 1, Math.max(0, Math.floor(wx)));
      p.endY = Math.min(w.grid.h - 1, Math.max(0, Math.floor(wy)));
      return;
    }
    if (p.kind === "click" && !p.moved) {
      if (Math.hypot(e.offsetX - p.downX, e.offsetY - p.downY) < DRAG_PX) return;
      p.moved = true;
    }
    this.host.camera.pan(e.offsetX - p.x, e.offsetY - p.y);
    p.x = e.offsetX;
    p.y = e.offsetY;
  }

  private up(e: PointerEvent): void {
    const p = this.press;
    this.press = null;
    if (!p) return;
    if (p.kind === "build") {
      this.place();
      return;
    }
    if (p.kind === "click" && !p.moved) this.click(e.offsetX, e.offsetY);
  }

  /** Builds what the released drag previewed; says why not if it can't. */
  private place(): void {
    const { ui, rail } = this.host;
    const w = this.host.world();
    const pv: PlacementPreview | null = ui.preview;
    ui.preview = null;
    this.previewKey = "";
    this.host.tip.hide();
    if (!pv || !rail.tool) return;
    if (!pv.valid) {
      if (pv.reason) this.host.refused(pv.reason);
      return;
    }
    if (!applyPlacement(w, pv)) {
      const fresh = previewPlacement(w, pv.tool, pv.rect, rail.opts());
      this.host.refused(fresh.reason ?? "Can't build that now");
    }
  }

  private click(x: number, y: number): void {
    const pid = this.personAt(x, y);
    if (pid !== null) {
      this.host.selectPerson(pid);
      return;
    }
    const tile = this.tileAt(x, y);
    if (!tile) return;
    for (const f of this.host.world().facilities.values()) {
      if (f.kind !== FacilityKind.Retail) continue;
      const r = f.rect;
      if (tile[0] >= r.x && tile[1] >= r.y && tile[0] < r.x + r.w && tile[1] < r.y + r.h) {
        this.host.openShop(f.id, x, y);
        return;
      }
    }
  }

  private tileAt(sx: number, sy: number): [number, number] | null {
    const g = this.host.world().grid;
    const [wx, wy] = this.host.camera.screenToWorld(sx, sy);
    const tx = Math.floor(wx);
    const ty = Math.floor(wy);
    return g.inBounds(tx, ty) ? [tx, ty] : null;
  }

  private personAt(sx: number, sy: number): number | null {
    const cam = this.host.camera;
    const p = this.host.world().people;
    const [wx, wy] = cam.screenToWorld(sx, sy);
    let best: number | null = null;
    let bestD = Math.max(PICK_MIN_TILES, PICK_PX / cam.scale);
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

  private keyDown(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (this.host.modalOpen()) {
      if (e.key === "Escape") this.host.escape();
      return;
    }
    if (e.code === "Space") {
      e.preventDefault();
      if (!e.repeat) {
        this.spaceDown = true;
        this.spaceDragged = false;
      }
      return;
    }
    if (e.key === "1") this.host.setSpeed(1);
    else if (e.key === "3") this.host.setSpeed(3);
    else if (e.key === "r" || e.key === "R") this.host.rail.rotate();
    else if (e.key === "Escape") {
      if (this.press?.kind === "build") this.cancel();
      else this.host.escape();
    }
  }

  private keyUp(e: KeyboardEvent): void {
    if (e.code !== "Space") return;
    if (this.host.modalOpen()) {
      this.spaceDown = false;
      return;
    }
    e.preventDefault();
    // Space held for a pan is not a pause.
    if (this.spaceDown && !this.spaceDragged) this.host.togglePause();
    this.spaceDown = false;
  }
}
