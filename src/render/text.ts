import type { Run } from "./labels";
import { INK, INK_2 } from "./palette";

export const UI_FONT = `"Schibsted Grotesk", "Helvetica Neue", system-ui, sans-serif`;
export const MONO_FONT = `"IBM Plex Mono", ui-monospace, monospace`;

export function uiFont(size: number, weight = 400): string {
  return `${weight} ${size}px ${UI_FONT}`;
}

function runFont(r: Run, size: number): string {
  return r.mono ? `500 ${size}px ${MONO_FONT}` : uiFont(size, r.strong ? 600 : 400);
}

export function runsWidth(ctx: CanvasRenderingContext2D, runs: readonly Run[], size: number): number {
  let wsum = 0;
  for (const r of runs) {
    ctx.font = runFont(r, size);
    wsum += ctx.measureText(r.text).width;
  }
  return wsum;
}

/** Draws runs left to right from (x, y), vertically centred on y. */
export function drawRuns(ctx: CanvasRenderingContext2D, runs: readonly Run[], x: number, y: number, size: number): void {
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  let at = x;
  for (const r of runs) {
    ctx.font = runFont(r, size);
    ctx.fillStyle = r.muted ? INK_2 : INK;
    ctx.fillText(r.text, at, y);
    at += ctx.measureText(r.text).width;
  }
}

/** Splits `text` into lines no wider than maxW at the current font; null if a single word will not fit. */
export function wrapWords(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] | null {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const next = line === "" ? word : `${line} ${word}`;
    if (ctx.measureText(next).width <= maxW) {
      line = next;
      continue;
    }
    if (line === "" || ctx.measureText(word).width > maxW) return null;
    lines.push(line);
    line = word;
  }
  if (line !== "") lines.push(line);
  return lines;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
