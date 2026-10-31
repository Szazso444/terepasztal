#!/usr/bin/env node
/**
 * Cuts the painted resource icons out of their sheet and lays them into
 * `public/assets/icons.{png,json}` under the keys they have always had.
 *
 *   node tools/resource-icons.mjs            # writes the icons atlas
 *   node tools/resource-icons.mjs --check    # builds in memory, exits 1 if the shipped atlas differs
 *
 * pngjs only. `assets/source/resource-icons-2026-10-29/icons-3.png` is the sheet (its README says
 * where it comes from): twelve icons in a row, in the order of SHEET, on real transparency. Per
 * icon:
 *
 *   1. Cut. The icons are the sheet's connected parts of alpha over EDGE, left to right, so a
 *      neighbour's rim never comes along, however close the two stand.
 *   2. Edge. The picture's alpha is soft for a few pixels at the rim, with colours there that are
 *      only compression noise. What lies inside the rim is made solid; on the rim the alpha is
 *      stretched between EDGE and SOLID, and the colour comes from the nearest solid pixel, the
 *      dark outline, so nothing light is left to show as a halo on the dark panels.
 *   3. Scale. The longest side goes to FIT texels, centred in a FRAME-texel square. The game's
 *      icon slots are square (`.res-icon`, `.tt-icon`) and stretch what is not, so the frame is
 *      square whatever the icon's shape. Lanczos 3 in premultiplied alpha, only ever down.
 *   4. Sharpen. The browser takes these frames down to the 12 to 16 px slots by averaging, which
 *      washes out what lies inside the outline (the dollar sign, the score marks on the loaf). An
 *      unsharp mask on the colour puts that contrast back in advance. The alpha is not touched,
 *      so the silhouette does not move.
 *   5. Gold. The coin, the bolt and the wheat are as strong as the selection amber over most of
 *      their face, and the cap pass would pull those texels to one pale tone with a hard line
 *      against the deeper gold beside them. Their saturation is eased under the amber's first
 *      (`easeGold`), a soft knee on the lit texels only, fading out in value and hue, so the
 *      gradient stays and the bright side stays bright.
 *   6. The atlas cap pass (`tools/atlas-cap.mjs`), with its luma compression: a highlight clipped
 *      at the cursor white alone turns grey in the middle of the lighter tints around it.
 *
 * The other frames of the atlas (the full chain's, which have no painting yet) stay as they are,
 * pixel for pixel, and `resolution` and `partial` with them. Everything is packed anew by
 * `packFrames`. Run it after `tools/illustrated-sprites.mjs`, which writes `icons.png` from its
 * older pictures; `tools/resource-icons.test.mjs` fails until this has run again.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { AMBER_STRENGTH, capPng, fromHsv, toHsv } from './atlas-cap.mjs';
import { packFrames } from './illustrated-sprites.mjs';
import { isMain } from './is-main.mjs';

export const SHEET_FILE = 'assets/source/resource-icons-2026-10-29/icons-3.png';
const DEFAULT_ASSETS = 'public/assets';
/** The sheet's icons, left to right. */
export const SHEET = [
  'money',
  'wood',
  'stone',
  'iron',
  'coal',
  'water',
  'oil',
  'power',
  'wheat',
  'food',
  'passengers',
  'population',
];
/** Side of a frame in texels: 16 world px at the atlas's four texels per world pixel. */
export const FRAME = 64;
/** Longest side of an icon in its frame; the margin keeps the outline off the frame's edge. */
export const FIT = 62;
/** Alpha at and below this is outside the icon. */
export const EDGE = 32;
/** Alpha from this up is the icon itself. The sheet's solid areas stand at 253. */
export const SOLID = 245;
/** Connected parts smaller than this many pixels are specks, not icons. */
const MIN_AREA = 500;
/** Radius of the Lanczos kernel, in target texels. */
const LOBES = 3;
/** `sharpen`: the unsharp mask, its radius in texels of a finished frame. */
export const SHARPEN = { amount: 0.8, radius: 2 };
/**
 * `easeGold`: saturation is left alone up to `knee` and eased toward `ceiling`, just under the
 * amber's, which it never reaches. It starts at value `valueFrom`, in full by the amber's value,
 * and fades out over `hueFade` degrees either side of the amber's hues.
 */
export const GOLD = {
  knee: 0.45,
  ceiling: AMBER_STRENGTH.saturation - 0.01,
  valueFrom: 0.72,
  hueFade: 8,
};

/**
 * The icons of a sheet, left to right: { box: [x0, y0, x1, y1] inclusive, pixels: indices }.
 * Eight-connected over alpha above EDGE.
 */
export function findIcons(sheet) {
  const { width: w, height: h, data } = sheet;
  const seen = new Uint8Array(w * h);
  const icons = [];
  for (let s = 0; s < w * h; s++) {
    if (seen[s] || data[s * 4 + 3] <= EDGE) continue;
    seen[s] = 1;
    const stack = [s];
    const pixels = [];
    const box = [w, h, 0, 0];
    while (stack.length) {
      const p = stack.pop();
      pixels.push(p);
      const x = p % w;
      const y = (p - x) / w;
      box[0] = Math.min(box[0], x);
      box[1] = Math.min(box[1], y);
      box[2] = Math.max(box[2], x);
      box[3] = Math.max(box[3], y);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (seen[q] || data[q * 4 + 3] <= EDGE) continue;
          seen[q] = 1;
          stack.push(q);
        }
    }
    if (pixels.length >= MIN_AREA) icons.push({ box, pixels });
  }
  return icons.sort((a, b) => a.box[0] - b.box[0]);
}

/** Steps 1 and 2: one icon alone on a canvas of its own size, straight alpha, edge cleaned. */
export function cutIcon(sheet, { box, pixels }) {
  const [x0, y0, x1, y1] = box;
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const out = new PNG({ width: w, height: h });
  out.data.fill(0);
  // the icon's own pixels only: a neighbour's rim can lie inside the box
  const alpha = new Uint8Array(w * h);
  for (const p of pixels) {
    const x = p % sheet.width;
    const y = (p - x) / sheet.width;
    const i = (y - y0) * w + (x - x0);
    alpha[i] = sheet.data[p * 4 + 3];
    sheet.data.copy(out.data, i * 4, p * 4, p * 4 + 3);
  }
  // the rim: under SOLID and reachable from outside. A dip in the alpha further in is no rim.
  const rim = new Uint8Array(w * h);
  const stack = [];
  const reach = (i) => {
    if (rim[i] || alpha[i] >= SOLID) return;
    rim[i] = 1;
    stack.push(i);
  };
  for (let x = 0; x < w; x++) {
    reach(x);
    reach((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    reach(y * w);
    reach(y * w + w - 1);
  }
  while (stack.length) {
    const i = stack.pop();
    const x = i % w;
    if (x > 0) reach(i - 1);
    if (x < w - 1) reach(i + 1);
    if (i >= w) reach(i - w);
    if (i < (h - 1) * w) reach(i + w);
  }
  // the rim takes the colour of the nearest solid pixel, one ring of it at a time
  const filled = new Uint8Array(w * h);
  let ring = [];
  for (let i = 0; i < w * h; i++)
    if (!rim[i]) {
      filled[i] = 1;
      ring.push(i);
    }
  while (ring.length) {
    const next = [];
    for (const i of ring) {
      const x = i % w;
      for (const n of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (n < 0 || n >= w * h || filled[n]) continue;
        filled[n] = 1;
        out.data.copy(out.data, n * 4, i * 4, i * 4 + 3);
        next.push(n);
      }
    }
    ring = next;
  }
  for (let i = 0; i < w * h; i++) {
    const a = rim[i] ? Math.max(0, alpha[i] - EDGE) / (SOLID - EDGE) : 1;
    out.data[i * 4 + 3] = Math.round(255 * Math.min(1, a));
  }
  return out;
}

/** Normalised Lanczos weights of each target position along an axis, the kernel widened to fit. */
function weights(from, to) {
  const scale = from / to;
  const sinc = (x) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));
  const axis = [];
  for (let t = 0; t < to; t++) {
    const centre = (t + 0.5) * scale;
    const first = Math.max(0, Math.ceil(centre - LOBES * scale - 0.5));
    const last = Math.min(from - 1, Math.floor(centre + LOBES * scale - 0.5));
    const taps = [];
    let sum = 0;
    for (let s = first; s <= last; s++) {
      const d = (s + 0.5 - centre) / scale;
      const w = Math.abs(d) < LOBES ? sinc(d) * sinc(d / LOBES) : 0;
      taps.push(w);
      sum += w;
    }
    axis.push({ first, taps: taps.map((w) => w / sum) });
  }
  return axis;
}

/** Lanczos 3 in premultiplied alpha, to `width` x `height`; `src` is never enlarged. */
export function lanczos(src, width, height) {
  if (width > src.width || height > src.height)
    throw new Error(`${src.width}x${src.height} would have to grow to ${width}x${height}`);
  const across = weights(src.width, width);
  const down = weights(src.height, height);
  // rows first, into floats, so the kernel's negative lobes survive to the second pass
  const rows = new Float64Array(width * src.height * 4);
  for (let y = 0; y < src.height; y++)
    for (let x = 0; x < width; x++) {
      const { first, taps } = across[x];
      const o = (y * width + x) * 4;
      taps.forEach((w, t) => {
        const i = (y * src.width + first + t) * 4;
        const a = (src.data[i + 3] / 255) * w;
        rows[o] += src.data[i] * a;
        rows[o + 1] += src.data[i + 1] * a;
        rows[o + 2] += src.data[i + 2] * a;
        rows[o + 3] += a;
      });
    }
  const out = new PNG({ width, height });
  out.data.fill(0);
  for (let x = 0; x < width; x++)
    for (let y = 0; y < height; y++) {
      const { first, taps } = down[y];
      const c = [0, 0, 0, 0];
      taps.forEach((w, t) => {
        const i = ((first + t) * width + x) * 4;
        for (let k = 0; k < 4; k++) c[k] += rows[i + k] * w;
      });
      if (c[3] <= 0) continue;
      const o = (y * width + x) * 4;
      // the true alpha, even over 1 where the lobes overshoot, or the colour would overshoot too
      for (let k = 0; k < 3; k++)
        out.data[o + k] = Math.round(Math.min(255, Math.max(0, c[k] / c[3])));
      out.data[o + 3] = Math.round(Math.min(1, c[3]) * 255);
    }
  return out;
}

/** Step 3: the cut icon scaled to FIT and centred in a FRAME-square canvas. */
export function placeIcon(cut) {
  const k = FIT / Math.max(cut.width, cut.height);
  const w = Math.max(1, Math.round(cut.width * k));
  const h = Math.max(1, Math.round(cut.height * k));
  const small = lanczos(cut, w, h);
  const out = new PNG({ width: FRAME, height: FRAME });
  out.data.fill(0);
  PNG.bitblt(small, out, 0, 0, w, h, Math.floor((FRAME - w) / 2), Math.floor((FRAME - h) / 2));
  return out;
}

/** A Gaussian blur of premultiplied RGBA floats along one axis; the frame's edge is repeated. */
function blurAxis(src, w, h, dx, dy, kernel) {
  const reach = (kernel.length - 1) / 2;
  const out = new Float64Array(src.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let t = -reach; t <= reach; t++) {
        const sx = Math.max(0, Math.min(w - 1, x + t * dx));
        const sy = Math.max(0, Math.min(h - 1, y + t * dy));
        for (let c = 0; c < 4; c++)
          out[(y * w + x) * 4 + c] += src[(sy * w + sx) * 4 + c] * kernel[t + reach];
      }
  return out;
}

/** Step 4 over a whole frame, in place: an unsharp mask on the colour, the alpha as it was. */
export function sharpen(png) {
  const { width: w, height: h, data } = png;
  const { amount, radius } = SHARPEN;
  const raw = Array.from({ length: 6 * radius + 1 }, (_, i) =>
    Math.exp(-((i - 3 * radius) ** 2) / (2 * radius * radius)),
  );
  const total = raw.reduce((a, b) => a + b, 0);
  const kernel = raw.map((v) => v / total);
  const flat = new Float64Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const a = data[i * 4 + 3] / 255;
    for (let c = 0; c < 3; c++) flat[i * 4 + c] = data[i * 4 + c] * a;
    flat[i * 4 + 3] = a;
  }
  const soft = blurAxis(blurAxis(flat, w, h, 1, 0, kernel), w, h, 0, 1, kernel);
  for (let i = 0; i < w * h; i++) {
    const a = flat[i * 4 + 3];
    if (a === 0) continue;
    for (let c = 0; c < 3; c++) {
      const v = flat[i * 4 + c] + amount * (flat[i * 4 + c] - soft[i * 4 + c]);
      data[i * 4 + c] = Math.round(Math.min(255, Math.max(0, v / a)));
    }
  }
  return png;
}

/** 0 up to `from`, 1 from `to`, smooth between. */
function smooth(from, to, x) {
  const t = Math.min(1, Math.max(0, (x - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

/** One colour through step 5; [r, g, b] in 0..255, rounded. */
export function easeGoldTexel(r, g, b) {
  const [h, s, v] = toHsv(r, g, b);
  const { hueFrom, hueTo, value } = AMBER_STRENGTH;
  const { knee, ceiling, valueFrom, hueFade } = GOLD;
  if (s <= knee) return [r, g, b];
  const inHue = smooth(hueFrom - hueFade, hueFrom, h) * (1 - smooth(hueTo, hueTo + hueFade, h));
  const share = inHue * smooth(valueFrom, value, v);
  if (share === 0) return [r, g, b];
  const room = ceiling - knee;
  const eased = knee + room * (1 - Math.exp(-(s - knee) / room));
  return fromHsv(h, s + share * (eased - s), v).map(Math.round);
}

/** Step 5 over a whole frame, in place. */
export function easeGold(png) {
  const d = png.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    [d[i], d[i + 1], d[i + 2]] = easeGoldTexel(d[i], d[i + 1], d[i + 2]);
  }
  return png;
}

/** The finished frames of the sheet, { key, png, ax, ay }. */
export function finishIcons(sheet) {
  const icons = findIcons(sheet);
  if (icons.length !== SHEET.length)
    throw new Error(`The sheet holds ${icons.length} icons, not ${SHEET.length}`);
  return SHEET.map((id, i) => {
    const eased = easeGold(sharpen(placeIcon(cutIcon(sheet, icons[i]))));
    const { png } = capPng(eased, { compress: true });
    return { key: `icons/${id}`, png, ax: FRAME / 2, ay: FRAME / 2 };
  });
}

/** A frame of a packed sheet as an image of its own. */
function cropFrame(sheet, f) {
  const out = new PNG({ width: f.w, height: f.h });
  PNG.bitblt(sheet, out, f.x, f.y, f.w, f.h, 0, 0);
  return out;
}

/**
 * The icons atlas with `items` ({ key, png, ax, ay }) in place of their namesakes: every other
 * frame is cut out as it stands, all are packed anew, and the json keeps its key order and
 * `resolution` and `partial`. A key the atlas does not have is an error: this tool adds no frames.
 */
export function mergeIcons(sheet, json, items) {
  const fresh = new Map(items.map((i) => [i.key, i]));
  for (const key of fresh.keys())
    if (!(key in json.frames)) throw new Error(`The atlas has no frame ${key}`);
  const frames = Object.entries(json.frames).map(([key, f]) => {
    const item = fresh.get(key);
    return item ?? { key, png: cropFrame(sheet, f), ax: f.ax, ay: f.ay };
  });
  const packed = packFrames(frames);
  return { sheet: packed.sheet, json: { ...json, frames: packed.frames } };
}

/** Builds the atlas from the sheet and the shipped atlas; writes it unless `check` is set. */
export function run({ sheetFile = SHEET_FILE, assets = DEFAULT_ASSETS, check = false } = {}) {
  const pngPath = join(assets, 'icons.png');
  const jsonPath = join(assets, 'icons.json');
  const shipped = PNG.sync.read(readFileSync(pngPath));
  const shippedText = readFileSync(jsonPath, 'utf8');
  const items = finishIcons(PNG.sync.read(readFileSync(sheetFile)));
  const merged = mergeIcons(shipped, JSON.parse(shippedText), items);
  const text = JSON.stringify(merged.json, null, 2) + '\n';
  if (check) {
    const same =
      shippedText === text &&
      shipped.width === merged.sheet.width &&
      shipped.height === merged.sheet.height &&
      Buffer.compare(shipped.data, merged.sheet.data) === 0;
    return { same, items, merged };
  }
  writeFileSync(pngPath, PNG.sync.write(merged.sheet));
  writeFileSync(jsonPath, text);
  return { same: false, items, merged };
}

if (isMain(import.meta.url)) {
  const check = process.argv.includes('--check');
  const { same, merged } = run({ check });
  if (check) {
    console.log(same ? 'icons atlas is up to date' : 'icons atlas differs from the sheet');
    process.exit(same ? 0 : 1);
  }
  console.log(`icons: ${merged.sheet.width}x${merged.sheet.height}`);
}
