#!/usr/bin/env node
/**
 * Finishes the wheat field paintings of `assets/source/fields-2026-10-11` into the frames
 * `props/wheat_0..2` and lays them over the generator in `public/assets/props.{png,json}`.
 *
 *   node tools/finish-fields.mjs            # writes finished/wheat_N.png and the props atlas
 *   node tools/finish-fields.mjs --check    # builds in memory, exits 1 if the shipped atlas differs
 *   node tools/finish-fields.mjs --paintings DIR --raise 0 --grade 0   # other paintings, already
 *                                           # raised and in the colour they should keep
 *
 * pngjs only. The paintings (`wheat-0..2.png`, 1254 px square) are not touched. Per painting:
 *
 *   1. Scale. The paintings come out about 1.4 times too large for `geometry.json`'s tile (the
 *      art review of 2026-10-11): each is scaled about the tile centre, the anchor, by its `scale`
 *      in VARIANTS (0.72, 0.77, 0.73) on top of the fixed ratio between its canvas and the atlas's four
 *      texels per world pixel. Area sampling in premultiplied alpha, so edges stay soft.
 *   2. Recentre. wheat-2 sits about 2 world px high after scaling (3 before it); it is moved so
 *      that its centre of mass lies where the other two's lies.
 *   3. Alpha from the geometry. The tile is the contract: nothing may lie outside the patch's
 *      bounds (`patch.absoluteTileBounds`, plus `edgeWanderTile` on the SE and SW sides only). A
 *      painting left flat may also stand `earsMaxHeightGamePx` ears over the ground; one that is
 *      raised is its own ground footprint, and the stalks that lift it are the ears.
 *   4. Grade. The paintings are an orange-brown that the season tint turns to rust; the colours
 *      are pulled to the straw gold of the approved demo's wheat (`GRADE`): hue toward 42 degrees,
 *      yellower the lighter, saturation toward 0.58, more spread between light and shade. It is
 *      judged after the summer prop tint (0xf8f2dc), where its lit pixels average about
 *      187, 149, 66.
 *      `--grade 0` keeps the painting's own colour; `--grade '{"gain":1.1}'` overrides single
 *      terms of `GRADE`.
 *   5. Raise. The field is a low raised patch: each ground texel carries a column of stalks
 *      STALK_MIN to STALK_MIN + STALK_SWELL world px high (the same heights the generator frames
 *      have), shorter toward a ragged edge, and the furrows between the rows (found from the
 *      painting's own luminance) lie FURROW_DROP lower than the ridges. The painting is the heads
 *      on top; below them the front of the stalks shows in the shade of their own heads, darker
 *      toward the ground, the lower-left front lit and the lower-right one turned from the light.
 *      The ground footprint does not move, only the heads lift. `--raise 0` leaves the painting
 *      flat, for a painting that already stands up on its own (PROMPT.md asks for one).
 *   6. Highlights. No pixel may reach the selection amber (#E8AA48) or the cursor white
 *      (#ECE4D0) in all three channels; red is held under HIGHLIGHT_CAP with a soft knee, the
 *      hue kept, so a field never reads as selected.
 *   7. The atlas cap pass (`tools/atlas-cap.mjs`) on the cut frame: alpha under 16 goes, 250 and
 *      over is solid, and the odd ear step 6 left as strong as the amber in hue, saturation and
 *      value is toned. The size and anchor stay.
 *
 * Then the frames are packed with 4 texel gutters in a new row under the frames the atlas already
 * has, which stay byte for byte where they are. Run it after `tools/illustrated-sprites.mjs`,
 * which writes `props.png` without these frames.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { isMain } from './is-main.mjs';
import { packFrames } from './illustrated-sprites.mjs';
import { capFrame } from './atlas-cap.mjs';

/** Texels per world pixel: the props atlas's `resolution`. */
export const DENSITY = 4;
/** Half a tile, in world px. */
const HALF_W = 32;
const HALF_H = 16;
/** The brightest red a finished pixel keeps: amber's is 232 and the cursor white's 236. */
export const HIGHLIGHT_CAP = 226;
/** Red starts to give from here up to the cap. */
export const HIGHLIGHT_KNEE = 24;
/** Stalks stand STALK_MIN to STALK_MIN + STALK_SWELL world px over the ground (the demo's 2.6 to 3.5). */
export const STALK_MIN = 2.6;
export const STALK_SWELL = 0.9;
/** The furrows between the rows lie this much lower than the ridges, as a share of the stalks' height. */
export const FURROW_DROP = 0.4;
/** Gutter around every packed frame, extruded, as `illustrated-sprites.mjs` packs it. */
const PAD = 4;

/** The three paintings: how far each is scaled about its anchor, and whether it is recentred. */
export const VARIANTS = [
  { file: 'wheat-0.png', key: 'props/wheat_0', scale: 0.72, recentre: false, seed: 11 },
  { file: 'wheat-1.png', key: 'props/wheat_1', scale: 0.77, recentre: false, seed: 12 },
  { file: 'wheat-2.png', key: 'props/wheat_2', scale: 0.73, recentre: true, seed: 13 },
];

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SRC = resolve(here, '../assets/source/fields-2026-10-11');
const DEFAULT_ASSETS = resolve(here, '../public/assets');

/** The game's own hash of integer coordinates (src/engine/rng.ts), in [0, 1). */
function hash2(x, y, seed = 0) {
  let h = (x * 374761393 + y * 668265263 + seed * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise on a lattice `cell` tile units wide, in [0, 1). */
function swell(tx, ty, cell, seed) {
  const x = tx / cell;
  const y = ty / cell;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

const smooth = (t) => {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
};

/**
 * Soft cap on red with the hue kept. Red up to `cap - knee` is left alone; above it the pixel is
 * scaled down so that its red eases toward the cap (`start + knee * (1 - e^-over)`) and never
 * reaches it, whatever it was: 232 comes out at 219, 255 at 223.
 */
export function capHighlight([r, g, b], cap = HIGHLIGHT_CAP, knee = HIGHLIGHT_KNEE) {
  const start = cap - knee;
  if (r <= start) return [r, g, b];
  const eased = start + knee * (1 - Math.exp(-(r - start) / knee));
  const f = Math.min(eased, cap - 1) / r;
  return [r * f, g * f, b * f];
}

/**
 * The colour grade. The paintings come out a deep orange-brown (hue 37 degrees, saturation 0.67, its
 * highlights a pale cream), and the season tint, which multiplies a prop's blue down (summer
 * 0xf8f2dc, autumn 0xf0c088), pushes that on to rust. The wheat of the approved art demo is a
 * golden straw: over the lit heads a mean of about 181, 145, 69 (hue 41, saturation 0.62), warmer in
 * the shade and yellower in the light. So each colour's hue is pulled `pull` of the way toward
 * `hue` (that is the target at a value of `pivot`; it moves `slope` degrees per whole step of value,
 * yellower the lighter), its saturation `satPull` of the way toward `sat`, and its value spread
 * about `pivot` by `contrast` and scaled by `gain`. Greens are left as they are: the grade fades
 * out between the hues `greenFrom` and `greenTo`, so wheat-1's greener ends stay green. The
 * highlight cap runs after it and has the last word.
 */
export const GRADE = {
  hue: 42,
  slope: 24,
  pull: 0.75,
  sat: 0.58,
  satPull: 0.8,
  gain: 1.03,
  contrast: 1.35,
  pivot: 0.78,
  greenFrom: 46,
  greenTo: 54,
};

/** Rgb in 0..255 -> [hue in degrees, saturation, value in 0..255]. */
function toHsv([r, g, b]) {
  const mx = Math.max(r, g, b);
  const d = mx - Math.min(r, g, b);
  if (d === 0) return [0, 0, mx];
  const h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, d / mx, mx];
}

function fromHsv([h, s, v]) {
  const k = (n) => (n + h / 60) % 6;
  const f = (n) => v * (1 - s * Math.max(0, Math.min(1, Math.min(k(n), 4 - k(n)))));
  return [f(5), f(3), f(1)];
}

/** One colour toward the straw gold, as `GRADE` describes; a colour with no hue is left alone. */
export function gradeGold(rgb, grade = GRADE) {
  const [h, s, v] = toHsv(rgb);
  if (s === 0) return rgb;
  const t = v / 255;
  const want = grade.hue + grade.slope * (t - grade.pivot);
  const graded = fromHsv([
    h + (want - h) * grade.pull,
    Math.min(1, s + (grade.sat - s) * grade.satPull),
    255 * Math.max(0, grade.pivot + (t - grade.pivot) * grade.contrast) * grade.gain,
  ]);
  const keep = smooth((h - grade.greenFrom) / (grade.greenTo - grade.greenFrom));
  return rgb.map((c, i) => c + (graded[i] - c) * (1 - keep));
}

/** Grades every covered texel of a float image in place. */
export function gradeImage(img, grade = GRADE) {
  for (let o = 0; o < img.w * img.h; o++) {
    if (img.a[o] <= 0) continue;
    const out = gradeGold([img.rgb[o * 3], img.rgb[o * 3 + 1], img.rgb[o * 3 + 2]], grade);
    img.rgb[o * 3] = out[0];
    img.rgb[o * 3 + 1] = out[1];
    img.rgb[o * 3 + 2] = out[2];
  }
}

/** The numbers `geometry.json` fixes, with the canvas the painting actually came in. */
export function frameOf(geometry, painting) {
  const scale = painting.width / geometry.canvas[0];
  const pxPerGame = geometry.canvasPxPerGamePx * scale;
  return {
    anchor: [geometry.anchor[0] * scale, geometry.anchor[1] * scale],
    // painting px -> texels at DENSITY, before the variant's own scale
    texelsPerPx: DENSITY / pxPerGame,
    bounds: geometry.patch.absoluteTileBounds,
    wander: geometry.patch.edgeWanderTile,
    ears: geometry.earsMaxHeightGamePx,
  };
}

/** The canvas the frames are finished on, in texels, and where its tile centre is. */
export const CANVAS = { w: 288, h: 160, ax: 144, ay: 96 };

/**
 * Painting -> the canvas, scaled by `k` texels per painting px about the painting's anchor and
 * moved by (dx, dy) texels. Area sampling in premultiplied alpha. Returns Float32 channels,
 * straight (not premultiplied) colour plus alpha in [0, 1].
 */
export function placePainting(png, anchor, k, dx = 0, dy = 0, canvas = CANVAS) {
  const out = {
    w: canvas.w,
    h: canvas.h,
    rgb: new Float32Array(canvas.w * canvas.h * 3),
    a: new Float32Array(canvas.w * canvas.h),
  };
  const span = 1 / k;
  for (let v = 0; v < canvas.h; v++)
    for (let u = 0; u < canvas.w; u++) {
      const x0 = anchor[0] + (u - canvas.ax - dx) * span;
      const y0 = anchor[1] + (v - canvas.ay - dy) * span;
      const x1 = x0 + span;
      const y1 = y0 + span;
      let a = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let yy = Math.max(0, Math.floor(y0)); yy < Math.min(png.height, Math.ceil(y1)); yy++) {
        const wy = Math.min(yy + 1, y1) - Math.max(yy, y0);
        for (let xx = Math.max(0, Math.floor(x0)); xx < Math.min(png.width, Math.ceil(x1)); xx++) {
          const w = wy * (Math.min(xx + 1, x1) - Math.max(xx, x0));
          const i = (yy * png.width + xx) * 4;
          const alpha = (png.data[i + 3] / 255) * w;
          a += alpha;
          r += png.data[i] * alpha;
          g += png.data[i + 1] * alpha;
          b += png.data[i + 2] * alpha;
        }
      }
      const o = v * canvas.w + u;
      if (a > 0) {
        out.rgb[o * 3] = r / a;
        out.rgb[o * 3 + 1] = g / a;
        out.rgb[o * 3 + 2] = b / a;
        out.a[o] = Math.min(1, a / (span * span));
      }
    }
  return out;
}

/** The alpha-weighted centre of mass, in texels from the canvas's tile centre. */
export function massCentre(img, canvas = CANVAS) {
  let m = 0;
  let sx = 0;
  let sy = 0;
  for (let v = 0; v < img.h; v++)
    for (let u = 0; u < img.w; u++) {
      const a = img.a[v * img.w + u];
      m += a;
      sx += a * (u + 0.5);
      sy += a * (v + 0.5);
    }
  return [sx / m - canvas.ax, sy / m - canvas.ay];
}

/** Tile-space point of a canvas texel taken as a ground point. */
function tileOf(u, v, canvas = CANVAS) {
  const px = (u + 0.5 - canvas.ax) / (HALF_W * DENSITY);
  const py = (v + 0.5 - canvas.ay) / (HALF_H * DENSITY);
  return [(px + py) / 2, (py - px) / 2];
}

/**
 * How far inside the patch's tile bounds a ground point is, in tile units (negative outside):
 * the bounds on the NE and NW sides, the bounds plus the wander on the SE and SW sides.
 */
function marginOf(tx, ty, g) {
  return Math.min(
    tx + g.bounds.x,
    g.bounds.x + g.wander - tx,
    ty + g.bounds.y,
    g.bounds.y + g.wander - ty,
  );
}

/**
 * Alpha from the geometry: a texel stays where it, taken as a ground point or as an ear tip up to
 * `ears` world px above one, lies inside the patch's bounds. The edge ramps over about a texel.
 * A painting that is going to be raised is its own ground footprint, so it is clipped with no ears
 * (the stalks that lift it are the ears); one that stays flat keeps the geometry's `ears` allowance.
 */
export function clipToGeometry(img, g, canvas = CANVAS, ears = g.ears) {
  const ramp = 1.5 / (HALF_W * DENSITY * 2);
  const reach = Math.round(ears * DENSITY);
  for (let v = 0; v < img.h; v++)
    for (let u = 0; u < img.w; u++) {
      const i = v * img.w + u;
      if (!img.a[i]) continue;
      let allow = 0;
      for (let e = 0; e <= reach; e++) {
        const [tx, ty] = tileOf(u, v + e, canvas);
        allow = Math.max(allow, Math.max(0, Math.min(1, marginOf(tx, ty, g) / ramp + 0.5)));
        if (allow >= 1) break;
      }
      img.a[i] *= allow;
      if (!img.a[i]) img.rgb.fill(0, i * 3, i * 3 + 3);
    }
}

/** The mean of the alpha in a (2r+1) square around each texel (zero outside the canvas). */
function boxCover(a, w, h, r) {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    let run = 0;
    for (let x = -r; x < w + r; x++) {
      if (x + r < w) run += a[y * w + x + r];
      if (x - r - 1 >= 0) run -= a[y * w + x - r - 1];
      if (x >= 0 && x < w) tmp[y * w + x] = run;
    }
  }
  for (let x = 0; x < w; x++) {
    let run = 0;
    for (let y = -r; y < h + r; y++) {
      if (y + r < h) run += tmp[(y + r) * w + x];
      if (y - r - 1 >= 0) run -= tmp[(y - r - 1) * w + x];
      if (y >= 0 && y < h) out[y * w + x] = run / ((2 * r + 1) * (2 * r + 1));
    }
  }
  return out;
}

/**
 * How much of a ridge each texel is, 0 in the furrow soil to 1 on the crop: the painting's
 * luminance between its 20th and 75th percentile among the texels it covers, eased and blurred
 * a texel, so the rows the painter drew stand as rows without being read off a guide that the
 * painting only follows roughly.
 */
export function ridgeMap(img) {
  const lum = new Float32Array(img.w * img.h);
  const seen = [];
  for (let o = 0; o < lum.length; o++) {
    lum[o] = 0.2126 * img.rgb[o * 3] + 0.7152 * img.rgb[o * 3 + 1] + 0.0722 * img.rgb[o * 3 + 2];
    if (img.a[o] > 0.5) seen.push(lum[o]);
  }
  seen.sort((a, b) => a - b);
  const lo = seen[Math.floor(seen.length * 0.2)] ?? 0;
  const hi = seen[Math.floor(seen.length * 0.75)] ?? 1;
  const ridge = new Float32Array(lum.length);
  // a painting with no rows in it has no furrows to lower
  if (hi - lo < 4) return ridge.fill(1);
  for (let o = 0; o < lum.length; o++) ridge[o] = smooth((lum[o] - lo) / Math.max(1, hi - lo));
  return boxCover(boxCover(ridge, img.w, img.h, 1), img.w, img.h, 1);
}

/**
 * Raises the painting. The painting stands for the heads of the stalks and its alpha for the
 * ground footprint; every footprint texel becomes a column that many texels tall, drawn front to
 * back so a nearer texel hides the front of the one behind it. Returns the same layout, straight
 * colour and alpha. `raise` scales the heights (1 is the demo's 2.6 to 3.5 world px, 0 flat).
 * `ridge` is the ridge map to lower the furrows by (the painting's own, from its colour as it was
 * painted, so that grading the colour never moves a row).
 */
export function raiseField(img, seed, raise = 1, canvas = CANVAS, ridge = ridgeMap(img)) {
  if (raise <= 0) return img;
  const { w, h } = img;
  const out = { w, h, rgb: new Float32Array(w * h * 3), a: new Float32Array(w * h) };
  // a ragged edge ends in low ears, not a cut wall: the stalks stand shorter where less of the
  // neighbourhood is field (a 2 world px radius)
  const cover = boxCover(img.a, w, h, 2 * DENSITY);
  for (let u = 0; u < w; u++) {
    for (let gy = h - 1; gy >= 0; gy--) {
      const i = gy * w + u;
      const alpha = img.a[i];
      if (alpha <= 0.01) continue;
      const [tx, ty] = tileOf(u, gy, canvas);
      const shoulder = smooth((cover[i] - 0.15) / 0.35);
      const stalks = STALK_MIN + STALK_SWELL * swell(tx, ty, 0.37, seed + 7);
      const rise = Math.max(
        1,
        Math.round(
          DENSITY *
            raise *
            stalks *
            shoulder *
            (1 - FURROW_DROP * (1 - Math.min(1, ridge[i] * 1.2))),
        ),
      );
      const top = gy - rise;
      // a front at the field's edge is lit on the left and turned from the light on the right;
      // a step inside it, between a ridge and its furrow, always faces the lower right
      const nearer = gy + 1 < h && img.a[(gy + 1) * w + u] > 0.5;
      const turned = nearer || u + 0.5 >= canvas.ax;
      // the rows of the column this texel shows: those the texels in front of it left open. A
      // step of a texel or two between neighbours is no front; a run of rows is.
      let first = -1;
      let rows = 0;
      for (let y = Math.max(0, top); y <= gy; y++)
        if (out.a[y * w + u] < 0.999) {
          if (first < 0) first = y;
          rows++;
        }
      const side = smooth((rows - 2) / DENSITY);
      for (let y = Math.max(0, top); y <= gy; y++) {
        const o = y * w + u;
        if (out.a[o] >= 0.999) continue;
        let r = img.rgb[i * 3];
        let g = img.rgb[i * 3 + 1];
        let b = img.rgb[i * 3 + 2];
        if (y > top) {
          // the front of the stalks, in the shade of their own heads and darker toward the
          // ground; the lower-right front is turned from the light
          const q = (y - first) / rows;
          const f = 1 - side * ((turned ? 0.2 : 0.12) + (turned ? 0.3 : 0.24) * q);
          r *= f * (1 - 0.05 * side);
          g *= f * (1 - 0.08 * side);
          b *= f * (1 - 0.18 * side);
        }
        const take = alpha * (1 - out.a[o]);
        out.rgb[o * 3] += r * take;
        out.rgb[o * 3 + 1] += g * take;
        out.rgb[o * 3 + 2] += b * take;
        out.a[o] += take;
      }
    }
  }
  // back to straight colour
  for (let o = 0; o < w * h; o++)
    if (out.a[o] > 0) for (let c = 0; c < 3; c++) out.rgb[o * 3 + c] /= out.a[o];
  return out;
}

/** Straight float image -> trimmed RGBA PNG with the highlight cap applied; returns its anchor too. */
export function toFrame(img, canvas = CANVAS) {
  let left = img.w;
  let top = img.h;
  let right = -1;
  let bottom = -1;
  const alpha = (o) => Math.round(img.a[o] * 255);
  for (let v = 0; v < img.h; v++)
    for (let u = 0; u < img.w; u++)
      if (alpha(v * img.w + u) > 0) {
        left = Math.min(left, u);
        top = Math.min(top, v);
        right = Math.max(right, u);
        bottom = Math.max(bottom, v);
      }
  if (right < left) throw new Error('The finished frame is empty');
  const png = new PNG({ width: right - left + 1, height: bottom - top + 1 });
  for (let v = top; v <= bottom; v++)
    for (let u = left; u <= right; u++) {
      const o = v * img.w + u;
      const a = alpha(o);
      if (!a) continue;
      const [r, g, b] = capHighlight([img.rgb[o * 3], img.rgb[o * 3 + 1], img.rgb[o * 3 + 2]]);
      const i = ((v - top) * png.width + (u - left)) * 4;
      png.data[i] = Math.round(r);
      png.data[i + 1] = Math.round(g);
      png.data[i + 2] = Math.round(b);
      png.data[i + 3] = a;
    }
  return { png, ax: canvas.ax - left, ay: canvas.ay - top };
}

/**
 * Finishes the paintings (`wheat-N.png` in `paintings`, by default `dir`, whose `geometry.json` is
 * the contract) and returns, per variant, the frame and what was done to it.
 * `raise` is the stalk height factor (1, or 0 for paintings that stand up on their own); `ears`
 * overrides the ears the geometry clip allows (none when raising, the geometry's when flat).
 */
export function finishAll({
  dir = DEFAULT_SRC,
  paintings = dir,
  raise = 1,
  ears,
  grade = GRADE,
} = {}) {
  const geometry = JSON.parse(readFileSync(join(dir, 'geometry.json'), 'utf8'));
  const placed = VARIANTS.map((variant) => {
    const painting = PNG.sync.read(readFileSync(join(paintings, variant.file)));
    const f = frameOf(geometry, painting);
    const k = f.texelsPerPx * variant.scale;
    const img = placePainting(painting, f.anchor, k);
    return { variant, painting, f, k, img, centre: massCentre(img) };
  });
  // wheat-2 goes where the others' mass lies; the others stay
  const kept = placed.filter((p) => !p.variant.recentre);
  const target = [
    kept.reduce((s, p) => s + p.centre[0], 0) / kept.length,
    kept.reduce((s, p) => s + p.centre[1], 0) / kept.length,
  ];
  return placed.map((p) => {
    let img = p.img;
    let shift = [0, 0];
    if (p.variant.recentre) {
      shift = [target[0] - p.centre[0], target[1] - p.centre[1]];
      img = placePainting(p.painting, p.f.anchor, p.k, shift[0], shift[1]);
    }
    clipToGeometry(img, p.f, CANVAS, ears ?? (raise > 0 ? 0 : p.f.ears));
    const ridge = ridgeMap(img);
    if (grade) gradeImage(img, grade);
    const finished = raiseField(img, p.variant.seed, raise, CANVAS, ridge);
    const frame = toFrame(finished);
    // the atlas cap pass, after the frame is cut, so its size and anchor stay
    const capped = capFrame(p.variant.key, frame.png);
    return {
      key: p.variant.key,
      file: p.variant.file,
      ...frame,
      png: capped.png,
      report: {
        scale: p.variant.scale,
        texelsPerPaintingPx: Number(p.k.toFixed(5)),
        shiftTexels: shift.map((n) => Number(n.toFixed(2))),
        shiftWorldPx: shift.map((n) => Number((n / DENSITY).toFixed(2))),
        capped: capped.counts,
      },
    };
  });
}

/**
 * The props atlas with `items` ({ key, png, ax, ay }) added under what it holds: the sheet is cut
 * back to the rows its other frames use (so a second run replaces the first run's frames rather
 * than stacking), the items are packed in a row of their own below, and the json keeps every
 * other entry, its order and `resolution` and `partial` as they were.
 */
export function mergeFrames(sheet, json, items) {
  const keys = new Set(items.map((i) => i.key));
  const kept = Object.entries(json.frames).filter(([k]) => !keys.has(k));
  const baseH = Math.max(...kept.map(([, f]) => f.y + f.h)) + PAD;
  if (baseH > sheet.height) throw new Error('The atlas is shorter than its frames');
  const packed = packFrames(items, sheet.width);
  const out = new PNG({
    width: Math.max(sheet.width, packed.sheet.width),
    height: baseH + packed.sheet.height,
  });
  for (let y = 0; y < baseH; y++)
    sheet.data.copy(out.data, y * out.width * 4, y * sheet.width * 4, (y + 1) * sheet.width * 4);
  for (let y = 0; y < packed.sheet.height; y++)
    packed.sheet.data.copy(
      out.data,
      (baseH + y) * out.width * 4,
      y * packed.sheet.width * 4,
      (y + 1) * packed.sheet.width * 4,
    );
  const frames = Object.fromEntries(kept);
  for (const item of items) {
    const f = packed.frames[item.key];
    frames[item.key] = { ...f, y: f.y + baseH };
  }
  return { sheet: out, json: { ...json, frames } };
}

/** Writes the finished frames and the merged atlas, or with `check` only compares. */
export function run({
  dir = DEFAULT_SRC,
  paintings = dir,
  assets = DEFAULT_ASSETS,
  check = false,
  raise = 1,
  grade = GRADE,
} = {}) {
  const frames = finishAll({ dir, paintings, raise, grade });
  const sheet = PNG.sync.read(readFileSync(join(assets, 'props.png')));
  const json = JSON.parse(readFileSync(join(assets, 'props.json'), 'utf8'));
  const merged = mergeFrames(sheet, json, frames);
  const text = JSON.stringify(merged.json, null, 2) + '\n';
  if (check) {
    const shippedSheet = PNG.sync.read(readFileSync(join(assets, 'props.png')));
    const same =
      readFileSync(join(assets, 'props.json'), 'utf8') === text &&
      shippedSheet.width === merged.sheet.width &&
      shippedSheet.height === merged.sheet.height &&
      Buffer.compare(shippedSheet.data, merged.sheet.data) === 0;
    return { same, frames, merged };
  }
  const finishedDir = join(dir, 'finished');
  mkdirSync(finishedDir, { recursive: true });
  for (const f of frames)
    writeFileSync(join(finishedDir, `${f.key.split('/')[1]}.png`), PNG.sync.write(f.png));
  writeFileSync(join(assets, 'props.png'), PNG.sync.write(merged.sheet));
  writeFileSync(join(assets, 'props.json'), text);
  return { same: false, frames, merged };
}

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
  const raise = Number(opt('--raise', '1'));
  if (!Number.isFinite(raise) || raise < 0) throw new Error('--raise is a factor of 0 or more');
  // --grade 0 leaves the colour as painted; --grade '{"gain":1.1}' overrides single GRADE terms
  const gradeArg = opt('--grade');
  const grade =
    gradeArg === undefined
      ? GRADE
      : gradeArg === '0'
        ? null
        : { ...GRADE, ...JSON.parse(gradeArg) };
  const { same, frames } = run({
    dir: resolve(opt('--src', DEFAULT_SRC)),
    paintings: opt('--paintings') ? resolve(opt('--paintings')) : undefined,
    check: args.includes('--check'),
    raise,
    grade,
  });
  for (const f of frames)
    console.log(f.key, `${f.png.width}x${f.png.height}@${f.ax},${f.ay}`, JSON.stringify(f.report));
  if (args.includes('--check')) {
    console.log(
      same ? 'the shipped props atlas is what this builds' : 'the shipped props atlas differs',
    );
    process.exitCode = same ? 0 : 1;
  }
}
