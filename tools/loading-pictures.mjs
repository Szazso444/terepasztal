#!/usr/bin/env node
/**
 * Builds the three loading-screen pictures, `public/assets/loading-1..3.png` (issue #287), from the
 * painted sources in `assets/source/loading-2026-10-11/`.
 *
 *   node tools/loading-pictures.mjs           writes public/assets/loading-1.png, -2.png, -3.png
 *   node tools/loading-pictures.mjs --check   builds in memory and fails if a shipped file differs
 *
 * These are plain PNGs, not an atlas group: atlases load inside `init` (src/game.ts), after the
 * loading screen is already showing, and `ATLAS_GROUPS` stays as it is. Uses pngjs (an existing
 * devDependency) and node's zlib; no model call, no new dependency.
 *
 * The finishing, in this order (every number is a constant below):
 *   1. loading-2 only: the bottom of the picture comes back from the original. Attempt 3 (the
 *      service buildings moved to the track, the pipe gone) is used above a line that runs just
 *      below the main line's near ballast edge, attempt 1 (the original) below it, over a feather.
 *      The two are pixel-aligned, so no repainting is needed. Attempt 3 calmed the whole
 *      foreground and lost the river's stones and reeds, the trees and the hut.
 *   2. Crop y 80..944 of the 1536x1024 canvas to the 1536x864 (16:9) frame the game shows.
 *   3. Highlight cap: no pixel reaches the cursor white #ECE4D0's luma. A soft knee compresses
 *      luma above LUMA_KNEE, with the same hue (the three channels scale together).
 *   4. Amber cap: no yellow or orange is as strong as the selection amber #E8AA48. A soft knee
 *      compresses chroma (max - min) of warm hues, with the same hue and luma.
 *   5. A dark gradient over the bottom 30% (where the progress bar and the tip line are drawn).
 *   6. Quantise to 256 colours (median cut, then a few k-means steps; no dithering), clamp the
 *      palette to the two caps once more, and write an 8-bit indexed PNG.
 *
 * Both caps are the game's own colours: the cursor white and the selection amber are the highest
 * highlights anywhere in its UI, and the art direction keeps painted scenery below them.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { PNG } from 'pngjs';
import { isMain } from './is-main.mjs';

export const SOURCE_DIR = 'assets/source/loading-2026-10-11';
export const OUTPUT_DIR = 'public/assets';

/** The painted sources are 1536x1024; the game shows y 80..944 of it, 16:9. */
export const SOURCE_SIZE = { width: 1536, height: 1024 };
export const CROP = { top: 80, height: 864 };
export const COLOURS = 256;

/**
 * loading-2: attempt 3 above the line from (x0, y0) to (x1, y1), attempt 1 below it, with a
 * feather (px, centred on the line). The line runs just below the near edge of the main line's
 * ballast.
 */
export const COMPOSITE = {
  above: 'raw/loading-2-attempt-3.png',
  below: 'raw/loading-2-attempt-1.png',
  line: { x0: 0, y0: 285, x1: 1536, y1: 965 },
  feather: 16,
};

/** The pictures in play order: name, and the source file(s) it is made of. */
export const PICTURES = [
  { name: 'loading-1', source: 'loading-1.png' },
  { name: 'loading-2', composite: COMPOSITE },
  { name: 'loading-3', source: 'loading-3.png' },
];

/** The game's cap colours (src/ui/style.css `--amber`; the cursor white of the map cursor). */
export const CURSOR_WHITE = [0xec, 0xe4, 0xd0];
export const SELECTION_AMBER = [0xe8, 0xaa, 0x48];

const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
/** Rec. 709 luma of #ECE4D0, about 228.3: nothing painted may reach it. */
export const CURSOR_WHITE_LUMA = luma(...CURSOR_WHITE);
/** Chroma (max - min) of #E8AA48, 160: no yellow or orange may reach it. */
export const AMBER_CHROMA = Math.max(...SELECTION_AMBER) - Math.min(...SELECTION_AMBER);

/** Hue band (degrees) of the yellows and oranges the amber cap covers; full weight inside. */
export const WARM_HUES = { from: 20, to: 70, rampFrom: 10, rampTo: 85 };

/** Soft knees: unchanged up to `knee`, then compressed towards `limit`, which is never reached. */
export const HIGHLIGHT = { knee: 196, limit: 232 };
export const AMBER = { knee: 112, limit: 168 };

/** The darkening of the bottom 30% of the frame: a smooth ramp to `strength` of `shade`. */
export const GRADIENT = { start: 0.7, strength: 0.55, shade: [16, 28, 22] };

/** The palette entries are clamped once more, a little inside the caps, after quantising. */
const PALETTE_LUMA_MAX = 222;
const PALETTE_CHROMA_MAX = 156;

/** `v` through a soft knee: identity up to `knee`, slope 1 there, approaching `limit`. */
function softKnee(v, { knee, limit }) {
  if (v <= knee) return v;
  const x = (v - knee) / (limit - knee);
  return knee + (limit - knee) * (x / (1 + x));
}

/** Hue in degrees [0, 360) of an RGB colour with chroma `c` > 0. */
function hueOf(r, g, b, max, c) {
  let h;
  if (max === r) h = ((g - b) / c) % 6;
  else if (max === g) h = (b - r) / c + 2;
  else h = (r - g) / c + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

/** 1 inside the warm hue band, 0 outside its ramps, linear between. */
function warmWeight(hue) {
  const { from, to, rampFrom, rampTo } = WARM_HUES;
  if (hue <= rampFrom || hue >= rampTo) return 0;
  if (hue < from) return (hue - rampFrom) / (from - rampFrom);
  if (hue > to) return (rampTo - hue) / (rampTo - to);
  return 1;
}

/** Highlight and amber caps on one colour. Returns [r, g, b] as floats. */
export function capColour(r, g, b) {
  const y = luma(r, g, b);
  if (y > HIGHLIGHT.knee) {
    const k = softKnee(y, HIGHLIGHT) / y;
    r *= k;
    g *= k;
    b *= k;
  }
  const max = Math.max(r, g, b);
  const c = max - Math.min(r, g, b);
  if (c > AMBER.knee) {
    const w = warmWeight(hueOf(r, g, b, max, c));
    if (w > 0) {
      const f = 1 + w * (softKnee(c, AMBER) / c - 1);
      const y2 = luma(r, g, b);
      r = y2 + (r - y2) * f;
      g = y2 + (g - y2) * f;
      b = y2 + (b - y2) * f;
    }
  }
  return [r, g, b];
}

/** Hard version of the caps, for palette entries: only ever moves a colour inwards. */
function clampPaletteColour(r, g, b) {
  const y = luma(r, g, b);
  if (y > PALETTE_LUMA_MAX) {
    const k = PALETTE_LUMA_MAX / y;
    r *= k;
    g *= k;
    b *= k;
  }
  const max = Math.max(r, g, b);
  const c = max - Math.min(r, g, b);
  if (c > PALETTE_CHROMA_MAX) {
    const hue = hueOf(r, g, b, max, c);
    if (hue >= WARM_HUES.from && hue <= WARM_HUES.to) {
      const f = PALETTE_CHROMA_MAX / c;
      const y2 = luma(r, g, b);
      r = y2 + (r - y2) * f;
      g = y2 + (g - y2) * f;
      b = y2 + (b - y2) * f;
    }
  }
  return [r, g, b];
}

const byte = (v) => (v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v));

export function readPng(path) {
  return PNG.sync.read(readFileSync(path));
}

/** The RGB bytes (3 per pixel) of a decoded PNG; alpha is ignored. */
export function toRgb(png) {
  const out = new Uint8Array(png.width * png.height * 3);
  for (let i = 0, j = 0; i < png.data.length; i += 4, j += 3) {
    out[j] = png.data[i];
    out[j + 1] = png.data[i + 1];
    out[j + 2] = png.data[i + 2];
  }
  return out;
}

/** `above` where the pixel is over the line, `below` under it, blended across the feather. */
export function compositeBelow(above, below, width, height, { line, feather }) {
  const out = new Uint8Array(width * height * 3);
  const slope = (line.y1 - line.y0) / (line.x1 - line.x0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = Math.min(1, Math.max(0, (y - (line.y0 + (x - line.x0) * slope)) / feather + 0.5));
      const i = (y * width + x) * 3;
      for (let k = 0; k < 3; k++) out[i + k] = byte(above[i + k] * (1 - t) + below[i + k] * t);
    }
  }
  return out;
}

/** Rows `top .. top + height` of an RGB buffer `width` wide. */
export function cropRows(rgb, width, top, height) {
  return rgb.slice(top * width * 3, (top + height) * width * 3);
}

/** The caps and the bottom gradient over a cropped RGB frame. */
export function finish(rgb, width, height) {
  const out = new Uint8Array(rgb.length);
  const { start, strength, shade } = GRADIENT;
  for (let y = 0; y < height; y++) {
    const g = Math.min(1, Math.max(0, (y / height - start) / (1 - start)));
    const a = strength * g * g * (3 - 2 * g);
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const [r, gr, b] = capColour(rgb[i], rgb[i + 1], rgb[i + 2]);
      out[i] = byte(r + (shade[0] - r) * a);
      out[i + 1] = byte(gr + (shade[1] - gr) * a);
      out[i + 2] = byte(b + (shade[2] - b) * a);
    }
  }
  return out;
}

// Distance weights for the quantiser (red 2, green 4, blue 3: the eye's order of sensitivity).
const WR = 2;
const WG = 4;
const WB = 3;

/**
 * Quantise an RGB buffer to at most `colours` colours: median cut on the exact-colour histogram,
 * a few k-means steps, no dithering. Returns { palette: Uint8Array (3 per entry), indices }.
 */
export function quantise(rgb, colours = COLOURS) {
  const pixels = rgb.length / 3;
  const ids = new Int32Array(pixels);
  const seen = new Map();
  const cr = [];
  const cg = [];
  const cb = [];
  const cn = [];
  for (let p = 0, i = 0; p < pixels; p++, i += 3) {
    const key = (rgb[i] << 16) | (rgb[i + 1] << 8) | rgb[i + 2];
    let id = seen.get(key);
    if (id === undefined) {
      id = cr.length;
      seen.set(key, id);
      cr.push(rgb[i]);
      cg.push(rgb[i + 1]);
      cb.push(rgb[i + 2]);
      cn.push(0);
    }
    cn[id]++;
    ids[p] = id;
  }
  const unique = cr.length;
  const R = Float64Array.from(cr);
  const G = Float64Array.from(cg);
  const B = Float64Array.from(cb);
  const N = Float64Array.from(cn);

  // Median cut, splitting the box with the largest weighted squared error.
  const boxStats = (members) => {
    let n = 0;
    let sr = 0;
    let sg = 0;
    let sb = 0;
    for (const id of members) {
      n += N[id];
      sr += N[id] * R[id];
      sg += N[id] * G[id];
      sb += N[id] * B[id];
    }
    const mr = sr / n;
    const mg = sg / n;
    const mb = sb / n;
    let vr = 0;
    let vg = 0;
    let vb = 0;
    for (const id of members) {
      vr += N[id] * (R[id] - mr) ** 2;
      vg += N[id] * (G[id] - mg) ** 2;
      vb += N[id] * (B[id] - mb) ** 2;
    }
    vr *= WR;
    vg *= WG;
    vb *= WB;
    return { members, n, mean: [mr, mg, mb], axis: [vr, vg, vb], score: vr + vg + vb };
  };
  let boxes = [boxStats(Int32Array.from({ length: unique }, (_, i) => i))];
  while (boxes.length < colours) {
    let best = -1;
    for (let b = 0; b < boxes.length; b++)
      if (boxes[b].members.length > 1 && (best < 0 || boxes[b].score > boxes[best].score)) best = b;
    if (best < 0 || boxes[best].score <= 0) break;
    const box = boxes[best];
    const channel = [R, G, B][box.axis.indexOf(Math.max(...box.axis))];
    const sorted = Int32Array.from(box.members).sort((a, b) => channel[a] - channel[b] || a - b);
    let acc = 0;
    let cut = 1;
    for (let i = 0; i < sorted.length - 1; i++) {
      acc += N[sorted[i]];
      cut = i + 1;
      if (acc * 2 >= box.n) break;
    }
    boxes.splice(best, 1, boxStats(sorted.slice(0, cut)), boxStats(sorted.slice(cut)));
  }
  const k = boxes.length;
  const pr = Float64Array.from(boxes, (b) => b.mean[0]);
  const pg = Float64Array.from(boxes, (b) => b.mean[1]);
  const pb = Float64Array.from(boxes, (b) => b.mean[2]);
  boxes = null;

  const nearest = (r, g, b, qr, qg, qb) => {
    let best = 0;
    let bestD = Infinity;
    for (let c = 0; c < k; c++) {
      const d = WR * (r - qr[c]) ** 2 + WG * (g - qg[c]) ** 2 + WB * (b - qb[c]) ** 2;
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  };

  // k-means steps on the histogram; an empty cluster keeps its centre.
  for (let step = 0; step < 4; step++) {
    const sr = new Float64Array(k);
    const sg = new Float64Array(k);
    const sb = new Float64Array(k);
    const sn = new Float64Array(k);
    for (let u = 0; u < unique; u++) {
      const c = nearest(R[u], G[u], B[u], pr, pg, pb);
      sr[c] += N[u] * R[u];
      sg[c] += N[u] * G[u];
      sb[c] += N[u] * B[u];
      sn[c] += N[u];
    }
    for (let c = 0; c < k; c++)
      if (sn[c] > 0) {
        pr[c] = sr[c] / sn[c];
        pg[c] = sg[c] / sn[c];
        pb[c] = sb[c] / sn[c];
      }
  }

  // Integer palette, clamped to the caps, dark to light so neighbouring indices are close.
  const entries = [];
  for (let c = 0; c < k; c++) {
    const [r, g, b] = clampPaletteColour(pr[c], pg[c], pb[c]);
    entries.push([byte(r), byte(g), byte(b)]);
  }
  const order = Array.from({ length: k }, (_, i) => i).sort(
    (a, b) => luma(...entries[a]) - luma(...entries[b]) || a - b,
  );
  const qr = Float64Array.from(order, (i) => entries[i][0]);
  const qg = Float64Array.from(order, (i) => entries[i][1]);
  const qb = Float64Array.from(order, (i) => entries[i][2]);
  const palette = new Uint8Array(k * 3);
  for (let c = 0; c < k; c++) palette.set([qr[c], qg[c], qb[c]], c * 3);
  const slot = new Uint8Array(unique);
  for (let u = 0; u < unique; u++) slot[u] = nearest(R[u], G[u], B[u], qr, qg, qb);
  const indices = new Uint8Array(pixels);
  for (let p = 0; p < pixels; p++) indices[p] = slot[ids[p]];
  return { palette, indices };
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  Buffer.from(data.buffer, data.byteOffset, data.length).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** An 8-bit indexed (colour type 3) PNG: PLTE, one IDAT, scanlines with no filter. */
export function encodeIndexed(width, height, palette, indices) {
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width + 1);
    raw[row] = 0;
    raw.set(indices.subarray(y * width, (y + 1) * width), row + 1);
  }
  const head = Buffer.alloc(13);
  head.writeUInt32BE(width, 0);
  head.writeUInt32BE(height, 4);
  head.set([8, 3, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', head),
    chunk('PLTE', palette),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

/**
 * How far an RGB buffer is from the two caps: the brightest luma, the pixels at or above the
 * cursor white's luma, the strongest warm chroma, and the warm pixels at or above the amber's.
 * The warm band is WARM_HUES.from .. to, the full-weight core of the amber cap.
 */
export function measureCaps(rgb) {
  let maxLuma = 0;
  let bright = 0;
  let maxWarmChroma = 0;
  let strongWarm = 0;
  for (let i = 0; i < rgb.length; i += 3) {
    const r = rgb[i];
    const g = rgb[i + 1];
    const b = rgb[i + 2];
    const y = luma(r, g, b);
    if (y > maxLuma) maxLuma = y;
    if (y >= CURSOR_WHITE_LUMA) bright++;
    const max = Math.max(r, g, b);
    const c = max - Math.min(r, g, b);
    if (c === 0) continue;
    const hue = hueOf(r, g, b, max, c);
    if (hue < WARM_HUES.from || hue > WARM_HUES.to) continue;
    if (c > maxWarmChroma) maxWarmChroma = c;
    if (c >= AMBER_CHROMA) strongWarm++;
  }
  return { maxLuma, bright, maxWarmChroma, strongWarm };
}

/** Expands an indexed picture back to RGB bytes. */
export function indexedToRgb({ palette, indices }) {
  const out = new Uint8Array(indices.length * 3);
  for (let p = 0; p < indices.length; p++) {
    const c = indices[p] * 3;
    out[p * 3] = palette[c];
    out[p * 3 + 1] = palette[c + 1];
    out[p * 3 + 2] = palette[c + 2];
  }
  return out;
}

/**
 * One picture, built from the sources in `sourceDir`: the cropped frame before finishing (`raw`),
 * the quantised result and the PNG bytes. `picture` is an entry of PICTURES.
 */
export function buildPicture(picture, sourceDir = SOURCE_DIR) {
  const read = (file) => {
    const png = readPng(join(sourceDir, file));
    if (png.width !== SOURCE_SIZE.width || png.height !== SOURCE_SIZE.height)
      throw new Error(`${file} is ${png.width}x${png.height}, expected 1536x1024`);
    return toRgb(png);
  };
  let full;
  if (picture.composite) {
    const { above, below, line, feather } = picture.composite;
    full = compositeBelow(read(above), read(below), SOURCE_SIZE.width, SOURCE_SIZE.height, {
      line,
      feather,
    });
  } else full = read(picture.source);
  const width = SOURCE_SIZE.width;
  const height = CROP.height;
  const cropped = cropRows(full, width, CROP.top, height);
  const { palette, indices } = quantise(finish(cropped, width, height));
  return {
    name: picture.name,
    width,
    height,
    cropped,
    palette,
    indices,
    png: encodeIndexed(width, height, palette, indices),
  };
}

function main(argv) {
  const check = argv.includes('--check');
  let failed = false;
  if (!check) mkdirSync(OUTPUT_DIR, { recursive: true });
  for (const picture of PICTURES) {
    const built = buildPicture(picture);
    const file = join(OUTPUT_DIR, `${picture.name}.png`);
    const before = measureCaps(built.cropped);
    const after = measureCaps(indexedToRgb(built));
    console.log(
      `${picture.name}: ${built.width}x${built.height}, ${built.palette.length / 3} colours, ` +
        `${Math.round(built.png.length / 1024)} KB; at or above cursor white ` +
        `${before.bright} -> ${after.bright}, warm at or above amber ${before.strongWarm} -> ` +
        `${after.strongWarm}`,
    );
    if (check) {
      const shipped = toRgb(readPng(file));
      const same = Buffer.compare(Buffer.from(shipped), Buffer.from(indexedToRgb(built))) === 0;
      if (!same) {
        console.error(`${file} differs from what ${SOURCE_DIR} builds`);
        failed = true;
      }
    } else writeFileSync(file, built.png);
  }
  return failed ? 1 : 0;
}

if (isMain(import.meta.url)) process.exitCode = main(process.argv.slice(2));
