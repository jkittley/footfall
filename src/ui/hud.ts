import { formatClock, minuteOfDay, periodLabel } from "../sim/clock";
import { SHRINK_RATE } from "../sim/constants";
import { dailyUpkeep } from "../sim/economy";
import type { World } from "../sim/world";
import { button, el, icon, setText } from "./dom";
import { formatCount, formatMoney, formatPercent, holidayLine, isNegativeMoney, type Toast } from "./format";
import type { Speed } from "./loop";

const MAX_TOASTS = 4;
const TOAST_MS = 6000;
const DAY_TOAST_MS = 10000;

const PAUSE = icon('<path d="M9 5v14M15 5v14"></path>', 18, 3);
const PLAY = icon('<path d="M8 5l11 7-11 7z"></path>', 18);
const FAST = icon('<path d="M3 6l9 6-9 6zM12 6l9 6-9 6z"></path>', 20);
const MENU = icon('<path d="M4 7h16M4 12h16M4 17h16"></path>', 20);

export interface HudActions {
  setSpeed: (s: Speed) => void;
  newGame: () => void;
}

/**
 * The score (top left), clock, speed and money (top right), the menu with New game and its
 * confirm panel, the disruption banner and the toasts. update() runs every frame and only writes
 * text that changed.
 */
export class Hud {
  private readonly moved = el("div", "hud-moved mono");
  private readonly rail = el("div", "hud-rail");
  private readonly meterBar = el("div", "bar");
  private readonly meterFill = el("i");
  private readonly meterText = el("span", "mono");
  private readonly time = el("div", "hud-time mono");
  private readonly dayFill = el("i");
  private readonly period = el("div", "hud-period");
  private readonly speedButtons = new Map<Speed, HTMLButtonElement>();
  private readonly balance = el("div", "hud-balance mono");
  private readonly today = el("div");
  private readonly upkeep = el("div");
  private readonly holiday = el("div", "hud-holiday");
  private readonly banner = el("div", "banner");
  private readonly toasts = el("div", "toasts");
  private readonly menuList = el("div", "menu-list");
  private readonly menuButton: HTMLButtonElement;
  private readonly scrim = el("div", "scrim");
  private readonly cancelButton: HTMLButtonElement;
  private upkeepKey = "";
  private returnFocus: HTMLElement | null = null;

  constructor(root: HTMLElement, private readonly actions: HudActions) {
    const score = el("div", "hud-score");
    this.meterBar.append(this.meterFill);
    const meter = el("div", "hud-meter");
    meter.append(this.meterBar, this.meterText);
    score.append(el("div", "hud-venue", "Harbour Street"), this.moved, el("div", "hud-sub", "people moved today"), this.rail, meter);

    const clock = el("div", "hud-clock");
    const dayBar = el("div", "bar");
    dayBar.append(this.dayFill);
    clock.append(this.time, dayBar, this.period);

    const speed = el("div", "hud-speed");
    const speeds: [Speed, string, string][] = [
      [0, "Pause", PAUSE],
      [1, "Normal speed", PLAY],
      [3, "Fast forward", FAST],
    ];
    for (const [s, label, html] of speeds) {
      const b = button("round-btn", { label, html, onClick: () => actions.setSpeed(s) });
      this.speedButtons.set(s, b);
      speed.append(b);
    }

    const menu = el("div", "menu");
    this.menuButton = button("round-btn", { label: "Menu", html: MENU, onClick: () => this.toggleMenu() });
    this.menuButton.setAttribute("aria-expanded", "false");
    this.menuList.hidden = true;
    this.menuList.append(
      button("menu-item", {
        text: "New game",
        onClick: () => {
          this.toggleMenu(false);
          this.openConfirm();
        },
      }),
    );
    menu.append(this.menuButton, this.menuList);
    speed.append(menu);

    const clockRow = el("div", "hud-clockrow");
    clockRow.append(clock, speed);
    const money = el("div", "hud-money");
    money.append(this.balance, this.today, this.upkeep, this.holiday);
    const right = el("div", "hud-right");
    right.append(clockRow, money);

    this.banner.hidden = true;
    this.banner.setAttribute("role", "status");
    this.toasts.setAttribute("aria-live", "polite");

    this.cancelButton = button("card-btn secondary", { text: "Cancel", onClick: () => this.closeConfirm() });
    const panel = el("div", "card confirm");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    const question = el("div", "", "Start a new game? Your current station will be lost.");
    question.id = "confirm-new-game";
    panel.setAttribute("aria-labelledby", question.id);
    const buttons = el("div", "confirm-actions");
    buttons.append(
      this.cancelButton,
      button("card-btn", {
        text: "Start again",
        onClick: () => {
          this.closeConfirm();
          actions.newGame();
        },
      }),
    );
    panel.append(question, buttons);
    this.scrim.append(panel);
    this.scrim.hidden = true;
    this.scrim.addEventListener("click", (e) => {
      if (e.target === this.scrim) this.closeConfirm();
    });

    root.append(score, right, this.banner, this.toasts, this.scrim);
  }

  get confirmOpen(): boolean {
    return !this.scrim.hidden;
  }

  get menuOpen(): boolean {
    return !this.menuList.hidden;
  }

  update(w: World, speed: Speed): void {
    setText(this.moved, formatCount(w.stats.movedToday));
    setText(this.rail, `Rail ${w.platformsAdded} / ${w.map.slots.length}`);
    const rate = w.meter.rate(w.minute);
    setText(this.meterText, rate === null ? "Too few journeys yet" : `${formatPercent(rate)} on time`);
    this.meterFill.style.width = `${(rate ?? 0) * 100}%`;
    this.meterBar.classList.toggle("alert", rate !== null && rate < SHRINK_RATE);

    setText(this.time, formatClock(w.minute));
    this.dayFill.style.width = `${(minuteOfDay(w.minute) / 1440) * 100}%`;
    setText(this.period, periodLabel(w.minute));
    for (const [s, b] of this.speedButtons) b.setAttribute("aria-pressed", String(s === speed));

    setText(this.balance, formatMoney(w.ledger.balance));
    this.balance.classList.toggle("alert", isNegativeMoney(w.ledger.balance));
    const { income, costs } = w.ledger.todayTotals();
    setText(this.today, `Today: ${formatMoney(income)} in, ${formatMoney(costs)} out`);
    const key = `${w.grid.version}:${w.signs.length}`;
    if (key !== this.upkeepKey) {
      this.upkeepKey = key;
      setText(this.upkeep, `Running costs ${formatMoney(dailyUpkeep(w))}/day`);
    }
    const holiday = holidayLine(w.minute);
    this.holiday.hidden = holiday === null;
    setText(this.holiday, holiday ?? "");

    const running = w.disruptions.find((d) => !d.ended);
    this.banner.hidden = !running;
    setText(this.banner, running ? running.text : "");
  }

  toast(t: Toast): void {
    const node = el("div", t.style === "day" ? "toast toast-day" : "toast", t.text);
    this.toasts.prepend(node);
    while (this.toasts.childElementCount > MAX_TOASTS) this.toasts.lastElementChild?.remove();
    setTimeout(() => node.remove(), t.style === "day" ? DAY_TOAST_MS : TOAST_MS);
  }

  toggleMenu(open = this.menuList.hidden): void {
    this.menuList.hidden = !open;
    this.menuButton.setAttribute("aria-expanded", String(open));
  }

  openConfirm(): void {
    this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.scrim.hidden = false;
    this.cancelButton.focus();
  }

  closeConfirm(): void {
    if (this.scrim.hidden) return;
    this.scrim.hidden = true;
    this.returnFocus?.focus();
    this.returnFocus = null;
  }
}
