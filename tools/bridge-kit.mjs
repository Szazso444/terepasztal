/** Cut the illustrated bridge kit (assets/source/bridges-v1) into the `bridges` atlas group.
 *   node tools/bridge-kit.mjs [output directory] [review sheet .png]
 * Bridges are drawn as geometry in the game's own projection (src/render/bridgeGeometry.ts); the
 * kit supplies only their materials. Each swatch is one painted face of a source piece: a
 * parallelogram in the source (three points, assets/source/bridges-v1/materials.json) resampled
 * square-on to the size named in src/art/bridgeSwatches.json, the list the procedural fallback
 * (src/art/bridges.ts) draws as well. The optional review sheet tiles every swatch three times,
 * which shows seams and broken courses. Uses pngjs (dev dependency) only.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';
import { packFrames } from './illustrated-sprites.mjs';

const SOURCE = 'assets/source/bridges-v1';
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8').replace(/^﻿/, ''));
/** Names and texel sizes, shared with the game. */
export const SWATCHES = readJson('src/art/bridgeSwatches.json');

/** Source alpha without the detached low-alpha glow of the generated studies (0..1). */
const coverage = (alpha) => (alpha <= 64 ? 0 : (alpha - 64) / 191);
/** Premultiplied bilinear sample of the source at (x, y), glow removed. */
function sample(src, x, y, out) {
  const x0 = Math.floor(x - 0.5),
    y0 = Math.floor(y - 0.5),
    fx = x - 0.5 - x0,
    fy = y - 0.5 - y0;
  for (let j = 0; j < 2; j++)
    for (let i = 0; i < 2; i++) {
      const xx = x0 + i,
        yy = y0 + j;
      if (xx < 0 || yy < 0 || xx >= src.width || yy >= src.height) continue;
      const k = (yy * src.width + xx) * 4,
        a = coverage(src.data[k + 3]) * (i ? fx : 1 - fx) * (j ? fy : 1 - fy);
      out[0] += src.data[k] * a;
      out[1] += src.data[k + 1] * a;
      out[2] += src.data[k + 2] * a;
      out[3] += a;
    }
}
/**
 * One face of a source piece as a w x h rectangle. `face` gives the parallelogram: o its top-left
 * corner, u its top-right, v its bottom-left, in source pixels. Every texel averages the source
 * area it covers. `mirror` flips the face left to right, `shade` multiplies its colour. A `solid`
 * face has no holes: texels the parallelogram takes from outside the painted face (its soft rim,
 * a sliver beyond a corner) are filled from the nearest painted texel, so tiles join without a gap.
 */
export function cutFace(src, face, w, h, shade = 1) {
  const out = new PNG({ width: w, height: h }),
    [ox, oy] = face.o,
    ux = face.u[0] - ox,
    uy = face.u[1] - oy,
    vx = face.v[0] - ox,
    vy = face.v[1] - oy,
    n = Math.max(
      1,
      Math.min(8, Math.ceil(Math.max(Math.hypot(ux, uy) / w, Math.hypot(vx, vy) / h))),
    ),
    sum = [0, 0, 0, 0];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      sum[0] = sum[1] = sum[2] = sum[3] = 0;
      for (let j = 0; j < n; j++)
        for (let i = 0; i < n; i++) {
          const a = (x + (i + 0.5) / n) / w,
            s = face.mirror ? 1 - a : a,
            t = (y + (j + 0.5) / n) / h;
          sample(src, ox + ux * s + vx * t, oy + uy * s + vy * t, sum);
        }
      const k = (y * w + x) * 4;
      if (sum[3] <= 0) continue;
      for (let c = 0; c < 3; c++)
        out.data[k + c] = Math.min(255, Math.round((sum[c] / sum[3]) * shade));
      out.data[k + 3] = Math.round((255 * sum[3]) / (n * n));
    }
  return face.solid ? fillHoles(out) : out;
}
/** Make every texel opaque: thin rims keep their colour, empty texels take the nearest painted one. */
function fillHoles(png) {
  const { width: w, height: h, data } = png,
    painted = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) painted[i] = data[i * 4 + 3] >= 128 ? 1 : 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const k = y * w + x;
      if (!painted[k]) {
        let best = -1,
          bd = Infinity;
        for (let r = 1; r <= Math.max(w, h) && best < 0; r++)
          for (let dy = -r; dy <= r; dy++)
            for (let dx = -r; dx <= r; dx++) {
              if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
              const xx = x + dx,
                yy = y + dy;
              if (xx < 0 || yy < 0 || xx >= w || yy >= h || !painted[yy * w + xx]) continue;
              const d = dx * dx + dy * dy;
              if (d < bd) {
                bd = d;
                best = yy * w + xx;
              }
            }
        if (best >= 0) data.copy(data, k * 4, best * 4, best * 4 + 3);
      }
      data[k * 4 + 3] = 255;
    }
  return png;
}

/** Every swatch of the table, cut from `dir`. */
export function cutSwatches(dir = SOURCE) {
  const table = readJson(join(dir, 'materials.json')),
    sources = new Map(),
    frames = [];
  for (const [key, [w, h]] of Object.entries(SWATCHES.swatches)) {
    const under = key.endsWith('-shade'),
      face = table.swatches[under ? key.slice(0, -6) : key];
    if (!face) throw new Error(`No source face for ${key} in ${dir}/materials.json`);
    if (!sources.has(face.src))
      sources.set(face.src, PNG.sync.read(readFileSync(join(dir, `${face.src}.png`))));
    const shade = (face.side ? table.sideShade : 1) * (under ? table.underShade : 1);
    frames.push({ key, png: cutFace(sources.get(face.src), face, w, h, shade), ax: 0, ay: 0 });
  }
  return frames;
}

/** Each swatch three times side by side (shafts: stacked as well) on a dark ground, at double size. */
function reviewSheet(frames) {
  const shown = frames.filter((f) => !f.key.endsWith('-shade')),
    pad = 10,
    cell = (f) =>
      f.png.height > f.png.width
        ? [f.png.width * 3 + 8, f.png.height * 2]
        : [f.png.width * 3, f.png.height],
    rows = [];
  // Wide swatches one per row; shafts share a row.
  let shafts = [];
  for (const f of shown)
    if (f.png.height > f.png.width) shafts.push(f);
    else rows.push([f]);
  if (shafts.length) rows.push(shafts);
  const width = Math.max(...rows.map((r) => r.reduce((a, f) => a + cell(f)[0] + pad, pad))),
    height = rows.reduce((a, r) => a + Math.max(...r.map((f) => cell(f)[1])) + pad, pad),
    sheet = new PNG({ width, height });
  for (let i = 0; i < sheet.data.length; i += 4) {
    const x = (i / 4) % width,
      y = Math.floor(i / 4 / width),
      c = ((x >> 3) + (y >> 3)) & 1 ? 52 : 44;
    sheet.data[i] = c;
    sheet.data[i + 1] = c + 8;
    sheet.data[i + 2] = c + 22;
    sheet.data[i + 3] = 255;
  }
  const put = (png, dx, dy) => {
    for (let y = 0; y < png.height; y++)
      for (let x = 0; x < png.width; x++) {
        const k = (y * png.width + x) * 4,
          o = ((dy + y) * width + dx + x) * 4,
          a = png.data[k + 3] / 255;
        for (let c = 0; c < 3; c++)
          sheet.data[o + c] = Math.round(png.data[k + c] * a + sheet.data[o + c] * (1 - a));
      }
  };
  let y = pad;
  const legend = [];
  for (const row of rows) {
    let x = pad,
      tall = 0;
    for (const f of row) {
      const [cw, ch] = cell(f),
        shaft = f.png.height > f.png.width;
      for (let i = 0; i < 3; i++) {
        put(f.png, x + i * (f.png.width + (shaft ? 4 : 0)), y);
        if (shaft) put(f.png, x + i * (f.png.width + 4), y + f.png.height);
      }
      legend.push(`${f.key} at ${x},${y}`);
      x += cw + pad;
      tall = Math.max(tall, ch);
    }
    y += tall + pad;
  }
  const big = new PNG({ width: width * 2, height: height * 2 });
  for (let yy = 0; yy < big.height; yy++)
    for (let xx = 0; xx < big.width; xx++)
      sheet.data.copy(
        big.data,
        (yy * big.width + xx) * 4,
        ((yy >> 1) * width + (xx >> 1)) * 4,
        ((yy >> 1) * width + (xx >> 1)) * 4 + 4,
      );
  return { sheet: big, legend };
}

export function build(output = 'public/assets', dir = SOURCE, review) {
  const frames = cutSwatches(dir),
    packed = packFrames(frames, 1024);
  writeFileSync(join(output, 'bridges.png'), PNG.sync.write(packed.sheet));
  writeFileSync(
    join(output, 'bridges.json'),
    JSON.stringify(
      { resolution: SWATCHES.density, partial: true, frames: packed.frames },
      null,
      2,
    ) + '\n',
  );
  const report = { frames: frames.length, width: packed.sheet.width, height: packed.sheet.height };
  if (review) {
    const { sheet, legend } = reviewSheet(frames);
    writeFileSync(review, PNG.sync.write(sheet));
    report.review = legend;
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  console.log(JSON.stringify(build(process.argv[2], SOURCE, process.argv[3]), null, 1));
