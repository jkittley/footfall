import type { BuildOpts, ToolId } from "../sim/build";
import { PRICES } from "../sim/economy";
import { Dir } from "../sim/grid";
import type { Sign } from "../sim/needs";
import { button, el, icon, setText } from "./dom";
import { TOOL_NAMES, formatMoney } from "./format";

interface ToolDef {
  id: ToolId;
  /** Per tile (per sign, per gate). */
  price: number | null;
  icon: string;
}

const TOOLS: readonly ToolDef[] = [
  { id: "floor", price: PRICES.floor, icon: icon('<rect x="4" y="4" width="16" height="16" rx="2"></rect><path d="M4 12h16M12 4v16"></path>') },
  { id: "retail", price: PRICES.retail, icon: icon('<path d="M4 9l1.5-4h13L20 9M5 9v10h14V9M4 9h16M10 19v-5h4v5"></path>') },
  { id: "seating", price: PRICES.seating, icon: icon('<path d="M5 8h14M4 12h16M6 12v6M18 12v6"></path>') },
  { id: "toilet", price: PRICES.toilet, icon: icon('<circle cx="8" cy="5.5" r="1.8"></circle><circle cx="16" cy="5.5" r="1.8"></circle><path d="M8 10v10M6 10h4M16 10l-3 6h6zM16 16v4"></path>') },
  { id: "wall", price: PRICES.wall, icon: icon('<path d="M4 12h16"></path>', 20, 4) },
  { id: "rail", price: PRICES.rail, icon: icon('<path d="M3 8h18M6 8v10M12 8v10M18 8v10"></path>') },
  { id: "gate", price: PRICES.gate, icon: icon('<path d="M5 6v12M19 6v12M5 12h5M14 12h5"></path>') },
  { id: "sign", price: PRICES.sign, icon: icon('<rect x="3" y="5" width="18" height="13" rx="2"></rect><path d="M8 11.5h8M13 8.5l3 3-3 3"></path>') },
  { id: "travelator", price: PRICES.travelator, icon: icon('<rect x="3" y="7" width="18" height="10" rx="2"></rect><path d="M7 12h9M13 9.5l3 2.5-3 2.5"></path>') },
  { id: "remove", price: null, icon: icon('<path d="M4 20h16"></path><path d="M7 16l9-9 3 3-9 9H7z"></path>') },
];

const SIGN_KINDS: readonly [Sign["kind"], string][] = [
  ["toilets", "Toilets"],
  ["seating", "Seating"],
  ["shops", "Shops"],
];

const DIR_ORDER: readonly Dir[] = [Dir.N, Dir.E, Dir.S, Dir.W];
const DIR_NAMES: Partial<Record<Dir, string>> = { [Dir.N]: "North", [Dir.E]: "East", [Dir.S]: "South", [Dir.W]: "West" };
const DIR_ROTATION: Partial<Record<Dir, number>> = { [Dir.N]: -90, [Dir.E]: 0, [Dir.S]: 90, [Dir.W]: 180 };
const ARROW = icon('<path d="M5 12h14M13 6l6 6-6 6"></path>', 18, 2.5);

/**
 * The build tools down the left edge, each a real button with its icon, name and price, plus the
 * Sign kind and Travelator direction beside the rail while those tools are picked.
 */
export class ToolRail {
  tool: ToolId | null = null;
  signKind: Sign["kind"] = "toilets";
  dir: Dir = Dir.E;
  private readonly buttons = new Map<ToolId, HTMLButtonElement>();
  private readonly signOptions = el("div", "tool-options");
  private readonly signChips = new Map<Sign["kind"], HTMLButtonElement>();
  private readonly dirOptions = el("div", "tool-options");
  private readonly dirArrow = el("span");
  private readonly dirText = el("span");

  private readonly rail = el("div", "rail panel");

  /** `onChange(toolChanged)`: true when the tool itself changed, false for a new sign kind or direction. */
  constructor(root: HTMLElement, private readonly onChange: (toolChanged: boolean) => void) {
    const rail = this.rail;
    rail.setAttribute("role", "toolbar");
    rail.setAttribute("aria-label", "Build tools");
    for (const t of TOOLS) {
      const b = button("tool", { onClick: () => this.select(this.tool === t.id ? null : t.id) });
      b.innerHTML = t.icon;
      b.append(el("span", "tool-label", TOOL_NAMES[t.id]), el("span", "tool-price mono", t.price === null ? "" : formatMoney(t.price)));
      b.setAttribute("aria-label", t.price === null ? TOOL_NAMES[t.id] : `${TOOL_NAMES[t.id]}, ${formatMoney(t.price)}${t.id === "sign" || t.id === "gate" ? "" : " a tile"}`);
      this.buttons.set(t.id, b);
      rail.append(b);
    }

    for (const [kind, label] of SIGN_KINDS) {
      const chip = button("chip", { text: label, onClick: () => this.setSignKind(kind) });
      this.signChips.set(kind, chip);
      this.signOptions.append(chip);
    }
    this.signOptions.setAttribute("aria-label", "Sign points to");
    this.signOptions.setAttribute("role", "group");

    this.dirArrow.innerHTML = ARROW;
    this.dirArrow.style.display = "flex";
    const rotate = button("chip", { label: "Rotate direction (R)", onClick: () => this.rotate() });
    rotate.append(this.dirArrow, this.dirText);
    this.dirOptions.append(rotate);

    root.append(rail, this.signOptions, this.dirOptions);
    this.refresh();
    window.addEventListener("resize", () => this.refresh());
  }

  /** The rail panel's right edge (CSS px). */
  right(): number {
    return this.rail.getBoundingClientRect().right;
  }

  select(tool: ToolId | null): void {
    this.tool = tool;
    this.refresh();
    this.onChange(true);
  }

  setSignKind(kind: Sign["kind"]): void {
    this.signKind = kind;
    this.refresh();
    this.onChange(false);
  }

  /** The travelator turns a quarter clockwise. */
  rotate(): void {
    this.dir = DIR_ORDER[(DIR_ORDER.indexOf(this.dir) + 1) % DIR_ORDER.length]!;
    this.refresh();
    this.onChange(false);
  }

  opts(): BuildOpts {
    if (this.tool === "sign") return { signKind: this.signKind };
    if (this.tool === "travelator") return { dir: this.dir };
    return {};
  }

  private refresh(): void {
    for (const [id, b] of this.buttons) b.setAttribute("aria-pressed", String(id === this.tool));
    for (const [kind, chip] of this.signChips) chip.setAttribute("aria-pressed", String(kind === this.signKind));
    this.dirArrow.style.transform = `rotate(${DIR_ROTATION[this.dir] ?? 0}deg)`;
    setText(this.dirText, `${DIR_NAMES[this.dir] ?? ""} (R)`);
    this.place(this.signOptions, this.tool === "sign" ? this.buttons.get("sign") : undefined);
    this.place(this.dirOptions, this.tool === "travelator" ? this.buttons.get("travelator") : undefined);
  }

  /** Shows the options beside their tool's button, or hides them. */
  private place(options: HTMLElement, beside: HTMLButtonElement | undefined): void {
    options.hidden = !beside;
    if (!beside) return;
    const r = beside.getBoundingClientRect();
    options.style.left = `${r.right + 12}px`;
    options.style.top = `${r.top + r.height / 2 - 30}px`;
  }
}
