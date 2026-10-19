/** A new element with classes and optional text. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
}

/** A real <button>; icon-only ones need `label` for their aria-label. */
export function button(className: string, opts: { label?: string; html?: string; text?: string; onClick: () => void }): HTMLButtonElement {
  const b = el("button", className);
  b.type = "button";
  if (opts.label) b.setAttribute("aria-label", opts.label);
  if (opts.html) b.innerHTML = opts.html;
  if (opts.text) b.textContent = opts.text;
  b.addEventListener("click", opts.onClick);
  return b;
}

/** Sets text only when it changed, so per-frame updates don't churn the DOM. */
export function setText(e: HTMLElement, text: string): void {
  if (e.textContent !== text) e.textContent = text;
}

/** Stroke icons (24px viewBox), drawn with currentColor. */
export function icon(paths: string, size = 20, strokeWidth = 2): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

export const CLOSE_ICON = icon('<path d="M6 6l12 12M18 6L6 18"></path>', 18);
