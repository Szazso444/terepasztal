/**
 * Cut the individual objects out of a concept board, so they can be used as reference.
 *
 *   node scratchpad/extract-refs.mjs docs/art-direction/images/02-nature-objects.png out/
 *
 * The boards in docs/art-direction are studies drawn on paper: one warm cream background, the
 * specimens laid out on it with space between them. So finding the objects is finding what is not
 * paper. No grid is assumed -- the rules between the cells are not clean enough to trust, and the
 * bottom strips have no grid at all.
 *
 * Labels and rules come out of the same segmentation, so they are filtered by what they are:
 * near-neutral dark ink, or long and thin. The filter is deliberately loose; `index.png` numbers
 * every survivor so the wrong ones can be seen and dropped by hand, which is a better trade than a
 * clever filter that silently eats a cactus.
 */
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const [, , src, outDir, mapFile] = process.argv;
if (!src || !outDir) {
  console.error('usage: node scratchpad/extract-refs.mjs <board.png> <out-dir> [map.json]');
  process.exit(2);
}
// An optional { "<index>": "<frame key>" } map names the crops. Which specimen is the birch is a
// judgement made once, by eye, off index.png; keeping it in a file makes it reviewable and makes
// re-running the extractor reproduce the same named set.
const NAMES = mapFile ? JSON.parse(readFileSync(mapFile, 'utf8')) : {};
const MIN_AREA = 900; // smaller than a flower clump, larger than a word
const INK = 46; // manhattan distance from the paper before a pixel counts as drawn
const GAP = 3; // pixels of paper two parts of one specimen may have between them

const png = PNG.sync.read(readFileSync(src));
const { width: W, height: H, data } = png;

/** The paper is whatever colour most of the board is. */
function paper() {
  const h = new Map();
  for (let y = 0; y < H; y += 3)
    for (let x = 0; x < W; x += 3) {
      const o = (y * W + x) * 4;
      const k = `${data[o] >> 2},${data[o + 1] >> 2},${data[o + 2] >> 2}`;
      h.set(k, (h.get(k) ?? 0) + 1);
    }
  const [k] = [...h].sort((a, b) => b[1] - a[1])[0];
  return k.split(',').map((v) => (Number(v) << 2) + 2);
}
const PAPER = paper();

const drawn = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) {
  const o = i * 4;
  const d =
    Math.abs(data[o] - PAPER[0]) +
    Math.abs(data[o + 1] - PAPER[1]) +
    Math.abs(data[o + 2] - PAPER[2]);
  drawn[i] = d > INK ? 1 : 0;
}

// Grow the mask by GAP before labelling, so a canopy and the trunk under it are one object, then
// crop from the original: the grown mask decides what belongs together, not what gets cut out.
const grown = new Uint8Array(W * H);
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    if (!drawn[y * W + x]) continue;
    for (let dy = -GAP; dy <= GAP; dy++)
      for (let dx = -GAP; dx <= GAP; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < W && ny < H) grown[ny * W + nx] = 1;
      }
  }

/** Flood fill each connected blob of the grown mask; returns its box and its drawn pixels. */
function components() {
  const seen = new Uint8Array(W * H);
  const out = [];
  const stack = new Int32Array(W * H);
  for (let s = 0; s < W * H; s++) {
    if (!grown[s] || seen[s]) continue;
    let top = 0;
    stack[top++] = s;
    seen[s] = 1;
    let x0 = W;
    let y0 = H;
    let x1 = -1;
    let y1 = -1;
    let area = 0;
    let sat = 0;
    let lum = 0;
    while (top) {
      const i = stack[--top];
      const x = i % W;
      const y = (i - x) / W;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
      if (drawn[i]) {
        const o = i * 4;
        const r = data[o];
        const g = data[o + 1];
        const b = data[o + 2];
        sat += Math.max(r, g, b) - Math.min(r, g, b);
        lum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
        area++;
      }
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (grown[j] && !seen[j]) {
          seen[j] = 1;
          stack[top++] = j;
        }
      }
    }
    if (area >= MIN_AREA) out.push({ x0, y0, x1, y1, area, sat: sat / area, lum: lum / area });
  }
  return out;
}

const all = components();
// A label is near-neutral dark ink; a rule is long and thin; the cell grid and the full-width
// strips at the foot of a board come out as one huge blob once the rules join them up. A specimen
// is none of those, and is never a large fraction of the board it is drawn on.
const MAX_SPAN = 0.4;
const kept = all.filter((c) => {
  const w = c.x1 - c.x0 + 1;
  const h = c.y1 - c.y0 + 1;
  const thin = w / h > 6 || h / w > 6;
  // Dark and near-neutral describes a label, but it also describes a coal seam. Lettering is
  // strokes with paper between them, so it fills its box loosely; an outcrop fills it.
  const fill = c.area / (w * h);
  const text = c.sat < 26 && c.lum < 150 && fill < 0.38;
  const huge = w > W * MAX_SPAN || h > H * MAX_SPAN;
  return !thin && !text && !huge;
});
kept.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);

mkdirSync(outDir, { recursive: true });
kept.forEach((c, i) => {
  const w = c.x1 - c.x0 + 1;
  const h = c.y1 - c.y0 + 1;
  const crop = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const s = ((c.y0 + y) * W + (c.x0 + x)) * 4;
      const d = (y * w + x) * 4;
      const on = drawn[(c.y0 + y) * W + (c.x0 + x)];
      for (let k = 0; k < 3; k++) crop.data[d + k] = data[s + k];
      crop.data[d + 3] = on ? 255 : 0; // paper drops out, so the silhouette is usable directly
    }
  const id = String(i).padStart(2, '0');
  const named = NAMES[id];
  if (mapFile && !named) return; // with a map, only what it names is written
  const file = named ? `${named.replace('/', '_')}.png` : `${id}.png`;
  mkdirSync(join(outDir, ...(named ? [] : [])), { recursive: true });
  writeFileSync(join(outDir, file), PNG.sync.write(crop));
});

// index.png: every survivor, numbered, on a dark ground so pale specimens still read
const COLS = 7;
const cw = Math.max(...kept.map((c) => c.x1 - c.x0 + 1)) + 10;
const ch = Math.max(...kept.map((c) => c.y1 - c.y0 + 1)) + 22;
const rows = Math.ceil(kept.length / COLS);
const idx = new PNG({ width: COLS * cw, height: rows * ch });
for (let i = 0; i < idx.width * idx.height; i++) {
  const o = i * 4;
  idx.data[o] = 28;
  idx.data[o + 1] = 34;
  idx.data[o + 2] = 30;
  idx.data[o + 3] = 255;
}
// a 3x5 dot-matrix for the index digits; enough to read a number, and no font to depend on
const DIGITS =
  '111101101101111:010110010010111:111001111100111:111001111001111:101101111001001:111100111001111:111100111101111:111001001001001:111101111101111:111101111001111'
    .split(':')
    .map((d) => [...d].map(Number));
function digit(png, n, x0, y0, s = 2) {
  const g = DIGITS[n];
  for (let r = 0; r < 5; r++)
    for (let c = 0; c < 3; c++) {
      if (!g[r * 3 + c]) continue;
      for (let dy = 0; dy < s; dy++)
        for (let dx = 0; dx < s; dx++) {
          const o = ((y0 + r * s + dy) * png.width + x0 + c * s + dx) * 4;
          png.data[o] = 232;
          png.data[o + 1] = 170;
          png.data[o + 2] = 72;
        }
    }
}
kept.forEach((c, i) => {
  const w = c.x1 - c.x0 + 1;
  const h = c.y1 - c.y0 + 1;
  const ox = (i % COLS) * cw + Math.floor((cw - w) / 2);
  const oy = Math.floor(i / COLS) * ch + 20 + (ch - 20 - h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!drawn[(c.y0 + y) * W + (c.x0 + x)]) continue;
      const s2 = ((c.y0 + y) * W + (c.x0 + x)) * 4;
      const d = ((oy + y) * idx.width + ox + x) * 4;
      for (let k = 0; k < 3; k++) idx.data[d + k] = data[s2 + k];
    }
  const tx = (i % COLS) * cw + 4;
  const ty = Math.floor(i / COLS) * ch + 5;
  String(i)
    .padStart(2, '0')
    .split('')
    .forEach((d, j) => digit(idx, Number(d), tx + j * 8, ty));
});
writeFileSync(join(outDir, 'index.png'), PNG.sync.write(idx));

console.log(`paper ${PAPER.join(',')} · ${all.length} objects · ${kept.length} kept -> ${outDir}`);
kept.forEach((c, i) =>
  console.log(
    `  ${String(i).padStart(2, '0')}  ${String(c.x1 - c.x0 + 1).padStart(4)}x${String(c.y1 - c.y0 + 1).padStart(4)}` +
      `  at ${String(c.x0).padStart(4)},${String(c.y0).padStart(3)}  area ${String(c.area).padStart(6)}  sat ${c.sat.toFixed(0)}`,
  ),
);
