// Flatten the kit's painted faces back to rectangles, so their surfaces can be re-projected onto
// other shapes. node scratchpad/bridge-tex/unshear.mjs -> scratchpad/bridge-tex/faces/*.png
import { PNG } from 'pngjs';
import fs from 'node:fs';
const SRC = 'assets/source/bridges-v1/',
  OUT = 'scratchpad/bridge-tex/faces/';
fs.mkdirSync(OUT, { recursive: true });
const read = (f) => PNG.sync.read(fs.readFileSync(SRC + f + '.png'));
function sample(p, x, y) {
  const ix = Math.max(0, Math.min(p.width - 2, Math.floor(x))),
    iy = Math.max(0, Math.min(p.height - 2, Math.floor(y))),
    u = x - ix,
    v = y - iy,
    out = [0, 0, 0, 0];
  for (let c = 0; c < 4; c++) {
    const at = (dx, dy) => p.data[((iy + dy) * p.width + ix + dx) * 4 + c];
    out[c] =
      (at(0, 0) * (1 - u) + at(1, 0) * u) * (1 - v) + (at(0, 1) * (1 - u) + at(1, 1) * u) * v;
  }
  return out;
}
/** Map the parallelogram origin + u*a + v*b (u, v in 0..1) to a w x h image. */
function flatten(p, origin, a, b, w, h, name) {
  const o = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w,
        v = (y + 0.5) / h,
        s = sample(p, origin[0] + u * a[0] + v * b[0], origin[1] + u * a[1] + v * b[1]);
      for (let c = 0; c < 4; c++) o.data[(y * w + x) * 4 + c] = Math.round(s[c]);
    }
  fs.writeFileSync(OUT + name + '.png', PNG.sync.write(o));
}
function alphaSpan(p, x) {
  let top = -1,
    bottom = -1;
  for (let y = 0; y < p.height; y++)
    if (p.data[(y * p.width + x) * 4 + 3] > 128) {
      if (top < 0) top = y;
      bottom = y;
    }
  return [top, bottom];
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
/** Top face of a slab: corners from the silhouette (left, right and top extremes). */
function top(f, name) {
  const p = read(f),
    b = bounds(p),
    L = [b.x0 + 2, alphaSpan(p, b.x0 + 2)[0]],
    R = [b.x1 - 2, alphaSpan(p, b.x1 - 2)[0]];
  let tx = 0,
    n = 0;
  for (let x = 0; x < p.width; x++)
    if (p.data[((b.y0 + 2) * p.width + x) * 4 + 3] > 128) {
      tx += x;
      n++;
    }
  const T = [tx / n, b.y0];
  // From T: a toward R, b toward L. Inset a little to drop the outline.
  const a = [R[0] - T[0], R[1] - T[1]],
    c = [L[0] - T[0], L[1] - T[1]],
    k = 0.04;
  flatten(
    p,
    [T[0] + (a[0] + c[0]) * k, T[1] + (a[1] + c[1]) * k],
    [a[0] * (1 - 2 * k), a[1] * (1 - 2 * k)],
    [c[0] * (1 - 2 * k), c[1] * (1 - 2 * k)],
    256,
    256,
    name,
  );
  console.log(name, { T, L, R });
}
/** The long +y face of a wall running along x: from its leftmost vertical edge, slope +1/2. */
function wall(f, name, length, w = 512) {
  const p = read(f),
    b = bounds(p),
    x = b.x0 + 3,
    [y0, y1] = alphaSpan(p, x);
  // The leftmost column runs down the front-left vertical edge of the wall (top face corner first).
  flatten(
    p,
    [x, y0],
    [length, length / 2],
    [0, y1 - y0],
    w,
    Math.round(((y1 - y0) / length) * w),
    name,
  );
  console.log(name, { x, y0, y1 });
}
top('stone-pad', 'stone-top');
top('wood-pad', 'wood-top');
wall('stone-rail-x', 'stone-wall', 760);
wall('wood-post', 'wood-side-raw', 60, 64);
wall('stone-pier', 'stone-pier-raw', 110, 128);
