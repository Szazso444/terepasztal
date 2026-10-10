/** Repeating bridge surfaces from the illustrated kit: the painted faces of the kit pieces,
 * flattened back to rectangles, so the procedural bridge shapes can wear the kit's stone and
 * timber. node tools/bridge-surfaces.mjs [sourceDir] [outDir]
 * Writes bridge-surface-{stone-top,stone-wall,wood-top,wood-grain}.png (power-of-two sizes,
 * repeating), which src/render/worldRenderer.ts loads for the textured bridges.
 * Uses pngjs (dev dependency) only.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';

const SOURCE = process.argv[2] ?? 'assets/source/bridges-v1',
  OUT = process.argv[3] ?? 'public/assets';

const read = (name) => PNG.sync.read(readFileSync(join(SOURCE, `${name}.png`)));
function sample(p, x, y, out) {
  const ix = Math.max(0, Math.min(p.width - 2, Math.floor(x))),
    iy = Math.max(0, Math.min(p.height - 2, Math.floor(y))),
    u = x - ix,
    v = y - iy;
  for (let c = 0; c < 4; c++) {
    const at = (dx, dy) => p.data[((iy + dy) * p.width + ix + dx) * 4 + c];
    out[c] =
      (at(0, 0) * (1 - u) + at(1, 0) * u) * (1 - v) + (at(0, 1) * (1 - u) + at(1, 1) * u) * v;
  }
}
/** The parallelogram origin + u*a + v*b (u, v in 0..1) of a source, as a w x h image. */
function flatten(p, origin, a, b, w, h) {
  const o = new PNG({ width: w, height: h }),
    s = [0, 0, 0, 0];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w,
        v = (y + 0.5) / h;
      sample(p, origin[0] + u * a[0] + v * b[0], origin[1] + u * a[1] + v * b[1], s);
      for (let c = 0; c < 4; c++) o.data[(y * w + x) * 4 + c] = Math.round(s[c]);
      o.data[(y * w + x) * 4 + 3] = 255;
    }
  return o;
}
function bounds(p) {
  let x0 = 1e9,
    y0 = 1e9,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < p.height; y++)
    for (let x = 0; x < p.width; x++)
      if (p.data[(y * p.width + x) * 4 + 3] > 128) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
  return { x0, y0, x1, y1 };
}
function firstOpaque(p, x) {
  for (let y = 0; y < p.height; y++) if (p.data[(y * p.width + x) * 4 + 3] > 128) return y;
  return -1;
}
/** The top face of a slab piece (left, right and top extremes of its silhouette), inset past
 * the painted outline. */
function slabTop(name, size) {
  const p = read(name),
    b = bounds(p),
    L = [b.x0 + 2, firstOpaque(p, b.x0 + 2)],
    R = [b.x1 - 2, firstOpaque(p, b.x1 - 2)];
  let sum = 0,
    n = 0;
  for (let x = 0; x < p.width; x++)
    if (p.data[((b.y0 + 2) * p.width + x) * 4 + 3] > 128) {
      sum += x;
      n++;
    }
  const T = [sum / n, b.y0],
    a = [R[0] - T[0], R[1] - T[1]],
    c = [L[0] - T[0], L[1] - T[1]],
    k = 0.05;
  return flatten(
    p,
    [T[0] + (a[0] + c[0]) * k, T[1] + (a[1] + c[1]) * k],
    [a[0] * (1 - 2 * k), a[1] * (1 - 2 * k)],
    [c[0] * (1 - 2 * k), c[1] * (1 - 2 * k)],
    size,
    size,
  );
}
/** The lit (+y) face of an upright piece, from its leftmost vertical edge along a 2:1 slope. */
function uprightFace(name, length, w) {
  const p = read(name),
    b = bounds(p),
    x = b.x0 + 3,
    top = firstOpaque(p, x);
  let bottom = top;
  while (bottom + 1 < p.height && p.data[((bottom + 1) * p.width + x) * 4 + 3] > 128) bottom++;
  return flatten(
    p,
    [x, top],
    [length, length / 2],
    [0, bottom - top],
    w,
    Math.round(((bottom - top) / length) * w),
  );
}
function crop(p, x0, y0, w, h) {
  const o = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 4; c++)
        o.data[(y * w + x) * 4 + c] = p.data[((y0 + y) * p.width + x0 + x) * 4 + c];
  return o;
}
function resize(p, w, h) {
  const o = new PNG({ width: w, height: h }),
    s = [0, 0, 0, 0];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      // Box-filter down: average the source area this pixel covers.
      const sx0 = (x / w) * p.width,
        sx1 = ((x + 1) / w) * p.width,
        sy0 = (y / h) * p.height,
        sy1 = ((y + 1) / h) * p.height,
        acc = [0, 0, 0, 0];
      let n = 0;
      for (let sy = sy0 + 0.25; sy < sy1; sy += Math.max(0.5, (sy1 - sy0) / 6))
        for (let sx = sx0 + 0.25; sx < sx1; sx += Math.max(0.5, (sx1 - sx0) / 6)) {
          sample(p, sx, sy, s);
          for (let c = 0; c < 4; c++) acc[c] += s[c];
          n++;
        }
      for (let c = 0; c < 4; c++) o.data[(y * w + x) * 4 + c] = Math.round(acc[c] / n);
    }
  return o;
}
/** Rows whose average luminance is a mortar line: the darkest band of each course. */
function mortarRows(p) {
  const rows = [];
  for (let y = 0; y < p.height; y++) {
    let s = 0;
    for (let x = Math.floor(p.width * 0.15); x < p.width * 0.85; x++) {
      const k = (y * p.width + x) * 4;
      s += 0.3 * p.data[k] + 0.59 * p.data[k + 1] + 0.11 * p.data[k + 2];
    }
    rows.push(s / (p.width * 0.7));
  }
  const floor = Math.min(...rows),
    starts = [];
  for (let y = 1; y < rows.length; y++)
    if (rows[y] < floor + 25 && rows[y - 1] >= floor + 25) starts.push(y);
  return starts;
}

mkdirSync(OUT, { recursive: true });
const write = (name, png) =>
  writeFileSync(join(OUT, `bridge-surface-${name}.png`), PNG.sync.write(png));
// Dressed flags and deck planks: one repeat covers one tile.
write('stone-top', resize(slabTop('stone-pad', 512), 128, 128));
write('wood-top', resize(slabTop('wood-pad', 512), 128, 128));
// Coursed masonry from the pier: two courses in running bond, one block long. The courses
// without a joint of their own get one at the repeat seam.
const pier = uprightFace('stone-pier', 110, 128),
  rows = mortarRows(pier),
  wall = crop(pier, 8, rows[0], 120, rows[2] - rows[0]);
{
  // Mortar colour from the first course joint; a joint at the seam for the course lacking one.
  const k = 4 * (2 * wall.width + 60),
    mortar = [wall.data[k], wall.data[k + 1], wall.data[k + 2]],
    jointless = (from, to) => {
      // A course with no mortar-dark column away from its ends carries no joint inside it.
      for (let x = 15; x < wall.width - 15; x++) {
        let dark = 0;
        for (let y = from; y < to; y++)
          if (wall.data[4 * (y * wall.width + x)] < mortar[0] + 40) dark++;
        if (dark > (to - from) * 0.6) return false;
      }
      return true;
    },
    courses = [
      [0, rows[1] - rows[0]],
      [rows[1] - rows[0], wall.height],
    ];
  for (const [from, to] of courses)
    if (jointless(from, to))
      for (let y = from; y < to; y++)
        for (let x = 0; x < 6; x++)
          for (let c = 0; c < 3; c++) wall.data[4 * (y * wall.width + x) + c] = mortar[c];
}
write('stone-wall', resize(wall, 64, 128));
// Timber grain from a trestle post, running along the texture's v.
const post = uprightFace('wood-post', 60, 64);
write('wood-grain', resize(crop(post, 10, 60, 48, post.height - 120), 32, 256));
console.log(`bridge surfaces -> ${OUT}`);
