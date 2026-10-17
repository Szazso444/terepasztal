/**
 * The numbers behind the loading screen (`loadingScreen.ts`): the progress clamp, the reveal's
 * timeline, the iris and the picture pick. DOM-free, so they are tested under Node.
 */

/** The fade to black that opens the reveal. */
export const FADE_MS = 1000;
/** The iris that follows it, opening from the centre of the viewport. */
export const IRIS_MS = 2500;
/** Under `prefers-reduced-motion` the iris is a plain fade of the black away, this long. */
export const REDUCED_FADE_OUT_MS = 1000;
/** The iris edge is feathered over this share of the radius. */
export const FEATHER = 0.1;
/**
 * Input is ignored this long after the reveal starts, so the second click of a double click on
 * "Click to begin" does not skip what it just started.
 */
export const SKIP_GUARD_MS = 400;
/** `public/assets/loading-1.png` to `loading-<this>.png`; a test keeps it equal to the files. */
export const LOADING_PICTURES = 3;

/** `x` held to 0..1; NaN reads as 0. */
export function clamp01(x: number): number {
  return x > 0 ? (x < 1 ? x : 1) : 0;
}

/**
 * The bar after `next` is asked of it: held to 0..1 and never lower than `prev`, so a stage that
 * reports less than an earlier one (or NaN) leaves the bar where it is.
 */
export function clampProgress(prev: number, next: number): number {
  const p = clamp01(prev);
  return Number.isNaN(next) ? p : Math.max(p, clamp01(next));
}

/** Ken Perlin's smootherstep: 0 at 0, 1 at 1, flat at both ends, held to 0..1 outside them. */
export function smootherstep(t: number): number {
  const x = clamp01(t);
  return x * x * x * (x * (x * 6 - 15) + 10);
}

/**
 * The iris radius in px at progress `t` (0..1) of an iris on a `w` x `h` viewport, opening from
 * the centre: 0 at the start, the distance to the far corner at the end, easing along smootherstep.
 */
export function irisRadius(t: number, w: number, h: number): number {
  return smootherstep(t) * (Math.hypot(Math.max(0, w), Math.max(0, h)) / 2);
}

/**
 * The CSS `mask-image` of the black layer for an iris of `radius`: the layer is hidden within
 * the radius, and its edge is feathered over `FEATHER` of the radius beyond it, so at the full
 * radius (the far corner) nothing of the black is left.
 */
export function irisMask(radius: number): string {
  const r = Math.max(0, radius);
  return `radial-gradient(circle at 50% 50%, transparent ${r.toFixed(2)}px, #000 ${(r * (1 + FEATHER)).toFixed(2)}px)`;
}

export type RevealPhase = 'fade' | 'open' | 'done';

export interface RevealFrame {
  phase: RevealPhase;
  /** opacity of the black layer: 0 to 1 over the fade, then 1 for the iris or 1 to 0 when plain */
  black: number;
  /** how far the iris (or the plain fade-out) has gone, 0..1; 0 until the fade is over */
  open: number;
}

/** How long a whole reveal takes. */
export function revealDuration(reduced: boolean): number {
  return FADE_MS + (reduced ? REDUCED_FADE_OUT_MS : IRIS_MS);
}

/**
 * Where the reveal stands `elapsedMs` after it started: a fade to black, then the iris, or for
 * `reduced` motion a plain fade of the black away.
 */
export function revealFrame(elapsedMs: number, reduced: boolean): RevealFrame {
  const t = Number.isNaN(elapsedMs) ? 0 : Math.max(0, elapsedMs);
  if (t < FADE_MS) return { phase: 'fade', black: t / FADE_MS, open: 0 };
  const openMs = reduced ? REDUCED_FADE_OUT_MS : IRIS_MS;
  if (t >= FADE_MS + openMs) return { phase: 'done', black: reduced ? 0 : 1, open: 1 };
  const open = (t - FADE_MS) / openMs;
  return { phase: 'open', black: reduced ? 1 - smootherstep(open) : 1, open };
}

/** Whether input may skip the reveal `elapsedMs` after it started. */
export function canSkip(elapsedMs: number): boolean {
  return elapsedMs >= SKIP_GUARD_MS;
}

/**
 * Whether a key press is the player's own and not the browser's: a modifier on its own or a
 * chord with Ctrl, Alt or Meta (reload, devtools, copy) is left alone.
 */
export function isPlainKey(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'metaKey'>) {
  if (e.ctrlKey || e.altKey || e.metaKey) return false;
  return !['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'NumLock', 'OS'].includes(
    e.key,
  );
}

/** A 0-based pick among `count` from `r` in 0..1; each index owns an equal share of the range. */
export function pickIndex(r: number, count: number): number {
  if (!(count >= 1)) return 0;
  return Math.min(count - 1, Math.floor(clamp01(r) * count));
}

/** The URL of loading picture `n` (1-based) under Vite's `BASE_URL` (`/`, `/sub/` or `./`). */
export function pictureUrl(base: string, n: number): string {
  return `${base}assets/loading-${n}.png`;
}
