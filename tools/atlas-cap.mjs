/**
 * The cap pass every packed atlas texel goes through (issue #465): scenery never reaches the
 * game's semantic colours, and alpha carries no haze. The packers run it on each frame after
 * resampling, before the frames are packed (tools/illustrated-sprites.mjs, tools/finish-fields.mjs,
 * tools/bridge-kit.mjs, tools/pack-atlas.mjs); tools/atlas-cap.test.mjs checks every atlas in
 * public/assets against it. Per texel, in this order:
 *
 *   1. Alpha. Below ALPHA_FLOOR (16) it becomes 0, colour included: the specks and glow a
 *      painting leaves across its canvas. From ALPHA_FULL (250) it becomes 255: a surface that
 *      came back at 250 to 254 is meant to be solid.
 *   2. Luma, for a set with a large lit area over the cap only (`compress`). Luma above
 *      LUMA_KNEE (0.85) is compressed smoothly toward LUMA_CEILING, which it never reaches, the
 *      colour scaled as a whole so its hue and saturation stay. A broad lit wall keeps its
 *      gradient instead of being clipped flat at the cap.
 *   3. Cursor white. A texel at or above the cursor white #ECE4D0 in all three channels is scaled
 *      as a whole to at most (235, 227, 207), so its hue stays.
 *   4. Selection amber. A texel as strong as the amber #E8AA48 (hue 25 to 50 degrees,
 *      saturation 0.62 or more, value 0.85 or more) keeps its hue with saturation at most 0.6
 *      and value at most 0.88.
 *
 * Texels left at alpha 0 are not touched. The pass is idempotent without `compress`; with it,
 * run it once per frame (`capPng` returns a new image, so a frame shared by several keys is
 * capped once).
 */
import { PNG } from 'pngjs';

/** `PAL.white` in src/art/palette.ts, the map cursor; tools/atlas-cap.test.mjs keeps them equal. */
export const CURSOR_WHITE = [236, 228, 208];
/** `PAL.amber` in src/art/palette.ts, the selection outline (src/ui/style.css `--amber`). */
export const SELECTION_AMBER = [232, 170, 72];
/** Where a texel over the cursor white ends up at most: one step under it in every channel. */
export const WHITE_CAP = CURSOR_WHITE.map((c) => c - 1);
/** Alpha below this is haze and becomes 0. */
export const ALPHA_FLOOR = 16;
/** Alpha from this up is a solid surface and becomes 255. */
export const ALPHA_FULL = 250;
/** What "as strong as the amber" means, in HSV: hue in degrees, saturation and value in 0..1. */
export const AMBER_STRENGTH = { hueFrom: 25, hueTo: 50, saturation: 0.62, value: 0.85 };
/** Where a texel as strong as the amber ends up at most. */
export const AMBER_TONE = { saturation: 0.6, value: 0.88 };
/** Luma compression of a lit set: identity up to the knee, slope 1 there, then toward the ceiling. */
export const LUMA_KNEE = 0.85;
/**
 * Under the cursor white's own luma (about 0.895): any texel at or above the cursor white in all
 * three channels has at least that luma, so a compressed texel can never be one.
 */
export const LUMA_CEILING = 0.89;

/** Rec. 709 luma in 0..1 of a colour in 0..255. */
export const luma = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

/** Rgb in 0..255 -> [hue in degrees, saturation 0..1, value 0..1]. */
export function toHsv(r, g, b) {
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return [0, 0, max / 255];
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, d / max, max / 255];
}

/** [hue, saturation, value] -> rgb in 0..255, unrounded. */
export function fromHsv(h, s, v) {
  const k = (n) => (n + h / 60) % 6;
  const f = (n) => 255 * v * (1 - s * Math.max(0, Math.min(1, Math.min(k(n), 4 - k(n)))));
  return [f(5), f(3), f(1)];
}

/** At or above the cursor white in all three channels. */
export const isOverWhite = (r, g, b) =>
  r >= CURSOR_WHITE[0] && g >= CURSOR_WHITE[1] && b >= CURSOR_WHITE[2];

/** As strong as the selection amber. */
export function isAmberStrong(r, g, b) {
  const [h, s, v] = toHsv(r, g, b);
  const a = AMBER_STRENGTH;
  return h >= a.hueFrom && h <= a.hueTo && s >= a.saturation && v >= a.value;
}

/** Luma through the soft knee: unchanged up to LUMA_KNEE, then easing toward LUMA_CEILING. */
export function compressLuma(y) {
  if (y <= LUMA_KNEE) return y;
  const room = LUMA_CEILING - LUMA_KNEE;
  return LUMA_KNEE + room * (1 - Math.exp(-(y - LUMA_KNEE) / room));
}

/**
 * One texel through steps 1 to 4. Returns [r, g, b, a] in 0..255, rounded; the input when
 * nothing applies.
 */
export function capTexel(r, g, b, a, { compress = false } = {}) {
  if (a === 0) return [r, g, b, a];
  if (a < ALPHA_FLOOR) return [0, 0, 0, 0];
  if (a >= ALPHA_FULL) a = 255;
  if (compress) {
    const y = luma(r, g, b);
    if (y > LUMA_KNEE) {
      const f = compressLuma(y) / y;
      r = Math.round(r * f);
      g = Math.round(g * f);
      b = Math.round(b * f);
    }
  }
  if (isOverWhite(r, g, b)) {
    // the largest factor that brings every channel to its cap; the colour is scaled as a whole,
    // so hue and saturation stay
    const f = Math.min(WHITE_CAP[0] / r, WHITE_CAP[1] / g, WHITE_CAP[2] / b);
    r = Math.min(WHITE_CAP[0], Math.round(r * f));
    g = Math.min(WHITE_CAP[1], Math.round(g * f));
    b = Math.min(WHITE_CAP[2], Math.round(b * f));
  }
  if (isAmberStrong(r, g, b)) {
    const [h, s, v] = toHsv(r, g, b);
    [r, g, b] = fromHsv(h, Math.min(s, AMBER_TONE.saturation), Math.min(v, AMBER_TONE.value)).map(
      Math.round,
    );
  }
  return [r, g, b, a];
}

/**
 * The cap pass over a whole image ({ width, height, data } RGBA). Returns a new PNG and what it
 * changed: texels changed in all, and how many each step touched.
 */
export function capPng(png, options = {}) {
  const out = new PNG({ width: png.width, height: png.height });
  png.data.copy(out.data);
  const counts = { texels: 0, haze: 0, solid: 0, white: 0, amber: 0, compressed: 0 };
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    const [r, g, b, a] = [d[i], d[i + 1], d[i + 2], d[i + 3]];
    if (a === 0) continue;
    const c = capTexel(r, g, b, a, options);
    if (c[0] === r && c[1] === g && c[2] === b && c[3] === a) continue;
    counts.texels++;
    if (a < ALPHA_FLOOR) counts.haze++;
    else {
      if (a >= ALPHA_FULL && a < 255) counts.solid++;
      if (options.compress && luma(r, g, b) > LUMA_KNEE) counts.compressed++;
      if (isOverWhite(r, g, b)) counts.white++;
      if (isAmberStrong(r, g, b)) counts.amber++;
    }
    d[i] = c[0];
    d[i + 1] = c[1];
    d[i + 2] = c[2];
    d[i + 3] = c[3];
  }
  return { png: out, counts };
}

/**
 * The frames of the sets with a large lit area over the cap, which compress their luma instead of
 * being clipped at the cursor white (step 2). The review of 2026-10-17 measured the Fuel Pump's
 * r0 master at 11,180 pixels over the cursor white's luma, most of them its cream tank bands and
 * lit walls, which the white cap alone would leave over that luma (a cream is not at or above the
 * cursor white in its blue). Its packed views (`structures/fuel_pump`, `_r1` to `_r3`, #325) take
 * the compression; nothing else does. The stone bridge kit, the stations and the townhouses also
 * have lit areas over that luma, but at 4x the compression flattens their stone into a washed,
 * even face, where the white cap alone leaves it as painted.
 */
export const LIT_FRAMES = [/^structures\/fuel_pump(_r[1-3])?$/];

/** Whether a frame key belongs to a set in LIT_FRAMES. */
export const isLitFrame = (key) => LIT_FRAMES.some((pattern) => pattern.test(key));

/** The cap pass on one packed frame, compressing the frames of the sets in LIT_FRAMES. */
export const capFrame = (key, png) => capPng(png, { compress: isLitFrame(key) });

/** Adds the counts of one capPng call into a running total. */
export function addCounts(total, counts) {
  for (const [k, v] of Object.entries(counts)) total[k] = (total[k] ?? 0) + v;
  return total;
}

/**
 * What in an image breaks the cap: texels with alpha 1 to 15 or 250 to 254, over the cursor
 * white, or as strong as the amber. The atlas test and the packers' reports use it.
 */
export function capViolations(png) {
  const v = { haze: 0, solid: 0, white: 0, amber: 0 };
  const d = png.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a === 0) continue;
    if (a < ALPHA_FLOOR) v.haze++;
    if (a >= ALPHA_FULL && a < 255) v.solid++;
    if (isOverWhite(d[i], d[i + 1], d[i + 2])) v.white++;
    if (isAmberStrong(d[i], d[i + 1], d[i + 2])) v.amber++;
  }
  return v;
}
