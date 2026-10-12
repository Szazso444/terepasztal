/**
 * The number tokens tooltips print, each shown whole in bold (`ttNum` in `src/ui/tooltip.ts`):
 * its sign, its % and its × belong to the token. DOM-free, so it is tested under Node. Numbers use
 * a point for the decimal, as the rest of the game's figures do.
 */

/** The minus sign, U+2212, not the hyphen. */
export const MINUS = '−';
/** The times sign, U+00D7. */
export const TIMES = '×';
/** What a % row shows for a multiplier of exactly 1 (not bold; such rows are left out). */
export const NO_CHANGE = '—';

/** A multiplier as a signed percent: 1.25 is "+25%", 0.5 is "−50%"; exactly 1 is `NO_CHANGE`. */
export function signedPercent(m: number): string {
  if (m === 1) return NO_CHANGE;
  return `${m > 1 ? '+' : MINUS}${Math.round(Math.abs(m - 1) * 100)}%`;
}

/** A multiplier with two decimals: "×1.25". */
export function multiplier(m: number): string {
  return `${TIMES}${m.toFixed(2)}`;
}

/** A contribution, signed, with two decimals: "+1.50", "−0.25". */
export function contribution(v: number): string {
  return `${v < 0 ? MINUS : '+'}${Math.abs(v).toFixed(2)}`;
}

/** A weekly amount with one decimal: "37.5" (the words around it are the caller's). */
export function weekly(v: number): string {
  return v.toFixed(1);
}
