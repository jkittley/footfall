import type { Camera } from "../render/camera";
import { countdown, retailLabel, runsText } from "../render/labels";
import { PRICES } from "../sim/economy";
import { FacilityKind, Tenant } from "../sim/facilityKinds";
import { NEED_COUNT, type PState } from "../sim/people";
import type { World } from "../sim/world";
import { CLOSE_ICON, button, el, setText } from "./dom";
import { formatMoney, shopRentText, yesterdayLine } from "./format";
import { NEED_LABELS, errandLine, goalFacts, goalLine, timeLeftIsShort, walkFromHere } from "./personText";

/** How long "Left the station" shows before the card closes (real ms). */
const LEFT_MS = 1600;
/** Gap between the person and their card (CSS px). */
const CARD_GAP = 22;
const EDGE = 16;

/** Keeps a box of size (w, h) placed at (x, y) inside the window. */
function clampToWindow(x: number, y: number, w: number, h: number): [number, number] {
  return [
    Math.min(Math.max(EDGE, x), window.innerWidth - w - EDGE),
    Math.min(Math.max(EDGE, y), window.innerHeight - h - EDGE),
  ];
}

/** The card for one person: goal, time left, errand and needs. It follows them round the station. */
export class Inspector {
  pid: number | null = null;
  private spawnedAt = 0;
  private leftAt: number | null = null;
  private readonly card = el("div", "card");
  private readonly title = el("div", "card-title");
  private readonly timeLeft = el("span", "card-big mono");
  private readonly errand = el("div");
  private readonly needs = el("div", "needs");
  private readonly needBars: HTMLElement[] = [];
  /** Each bar's last written percentage, so unchanged bars aren't restyled every frame. */
  private readonly needShown: number[] = [];
  private readonly details = el("div");

  constructor(root: HTMLElement, private readonly onClose: () => void) {
    this.card.setAttribute("role", "dialog");
    this.card.setAttribute("aria-label", "Passenger");
    this.card.hidden = true;
    const close = button("card-close", { label: "Close", html: CLOSE_ICON, onClick: () => this.close() });
    const row = el("div", "card-row");
    row.append(el("span", "muted", "Time left"), this.timeLeft);
    for (let n = 0; n < NEED_COUNT; n++) {
      const bar = el("div", "bar");
      const fill = el("i");
      bar.append(fill);
      bar.setAttribute("role", "meter");
      bar.setAttribute("aria-label", NEED_LABELS[n]!);
      bar.setAttribute("aria-valuemin", "0");
      bar.setAttribute("aria-valuemax", "100");
      this.needBars.push(fill);
      this.needs.append(el("span", "", NEED_LABELS[n]!), bar);
    }
    this.details.style.display = "contents";
    this.details.append(row, this.errand, this.needs);
    this.card.append(close, this.title, this.details);
    root.append(this.card);
  }

  get isOpen(): boolean {
    return this.pid !== null;
  }

  open(w: World, pid: number): void {
    this.pid = pid;
    this.spawnedAt = w.people.spawnedAt[pid]!;
    this.leftAt = null;
    this.details.hidden = false;
    this.card.hidden = false;
  }

  close(): void {
    if (this.pid === null) return;
    this.pid = null;
    this.card.hidden = true;
    this.onClose();
  }

  /** True while the person it shows is still in the station. */
  tracking(w: World): boolean {
    const pid = this.pid;
    // A freed slot may be handed straight to someone new: spawnedAt tells them apart.
    return pid !== null && w.people.isAlive(pid) && w.people.spawnedAt[pid] === this.spawnedAt;
  }

  update(w: World, cam: Camera, now: number): void {
    const pid = this.pid;
    if (pid === null) return;
    if (!this.tracking(w)) {
      if (this.leftAt === null) {
        this.leftAt = now;
        setText(this.title, "Left the station");
        this.details.hidden = true;
      } else if (now - this.leftAt > LEFT_MS) {
        this.close();
      }
      return;
    }
    const p = w.people;
    setText(this.title, goalLine(goalFacts(w, pid)));
    const left = p.deadline[pid]! - w.minute;
    setText(this.timeLeft, countdown(left));
    this.timeLeft.classList.toggle("alert", timeLeftIsShort(left, walkFromHere(w, pid)));
    const errand = errandLine(p.state[pid]! as PState, p.errand[pid]!);
    this.errand.hidden = errand === null;
    setText(this.errand, errand ?? "");
    for (let n = 0; n < NEED_COUNT; n++) {
      const pct = Math.round(Math.min(1, Math.max(0, p.needs[pid * NEED_COUNT + n]!)) * 100);
      if (this.needShown[n] === pct) continue;
      this.needShown[n] = pct;
      this.needBars[n]!.style.width = `${pct}%`;
      this.needBars[n]!.parentElement?.setAttribute("aria-valuenow", String(pct));
    }

    const [x, y] = cam.worldToScreen(p.x[pid]!, p.y[pid]!);
    const { offsetWidth: cw, offsetHeight: ch } = this.card;
    const right = x + CARD_GAP + cw + EDGE <= window.innerWidth;
    const [cx, cy] = clampToWindow(right ? x + CARD_GAP : x - CARD_GAP - cw, y - ch / 2, cw, ch);
    this.card.style.left = `${cx}px`;
    this.card.style.top = `${cy}px`;
  }
}

/** A retail unit's tenant, today's takings and an Evict button. */
export class ShopPanel {
  facilityId: number | null = null;
  private readonly card = el("div", "card");
  private readonly title = el("div", "card-title");
  private readonly takings = el("span", "card-big mono");
  private readonly rent = el("div", "muted");
  private readonly yesterday = el("div", "muted mono");
  private readonly evict: HTMLButtonElement;

  constructor(
    root: HTMLElement,
    private readonly world: () => World,
    private readonly onEvict: (id: number) => void,
  ) {
    this.card.setAttribute("role", "dialog");
    this.card.setAttribute("aria-label", "Shop");
    this.card.hidden = true;
    const close = button("card-close", { label: "Close", html: CLOSE_ICON, onClick: () => this.close() });
    const row = el("div", "card-row");
    row.append(el("span", "muted", "Takings today"), this.takings);
    this.evict = button("card-btn", {
      text: `Evict (${formatMoney(PRICES.evict)})`,
      onClick: () => {
        if (this.facilityId !== null) this.onEvict(this.facilityId);
      },
    });
    this.card.append(close, this.title, row, this.rent, this.yesterday, this.evict);
    root.append(this.card);
  }

  get isOpen(): boolean {
    return this.facilityId !== null;
  }

  open(id: number, screenX: number, screenY: number): void {
    this.facilityId = id;
    this.card.hidden = false;
    this.update();
    const [x, y] = clampToWindow(screenX + CARD_GAP, screenY - 40, this.card.offsetWidth, this.card.offsetHeight);
    this.card.style.left = `${x}px`;
    this.card.style.top = `${y}px`;
  }

  close(): void {
    this.facilityId = null;
    this.card.hidden = true;
  }

  update(): void {
    if (this.facilityId === null) return;
    const w = this.world();
    const f = w.facilities.get(this.facilityId);
    if (!f || f.kind !== FacilityKind.Retail) {
      this.close();
      return;
    }
    setText(this.title, runsText(retailLabel(f, w.minute)));
    setText(this.takings, formatMoney(f.takingsToday));
    setText(this.rent, shopRentText(f.rentMul, f.footfallYesterday));
    const passed = yesterdayLine(f.footfallYesterday);
    this.yesterday.hidden = passed === null;
    setText(this.yesterday, passed ?? "");
    this.evict.disabled = f.tenant === Tenant.None || !w.ledger.canAfford(PRICES.evict);
  }
}

/** A tooltip by the cursor: one line, and an optional reason in Alert red below it. */
export class Tip {
  private readonly node = el("div", "tip");
  private readonly line = el("span");
  private readonly reason = el("span", "alert");

  constructor(root: HTMLElement) {
    this.node.hidden = true;
    this.node.setAttribute("role", "tooltip");
    this.node.append(this.line, this.reason);
    root.append(this.node);
  }

  show(x: number, y: number, text: string, reason: string | null = null, dark = false): void {
    this.node.hidden = false;
    this.node.classList.toggle("tip-dark", dark);
    setText(this.line, text);
    this.reason.hidden = reason === null;
    setText(this.reason, reason ?? "");
    const [tx, ty] = clampToWindow(x + 16, y + 18, this.node.offsetWidth, this.node.offsetHeight);
    this.node.style.left = `${tx}px`;
    this.node.style.top = `${ty}px`;
  }

  hide(): void {
    this.node.hidden = true;
  }
}
