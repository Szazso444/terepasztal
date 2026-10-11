// Seeds the face table of the bridge kit (assets/source/bridges-v1/materials.json) from the
// silhouettes of the source pieces, and draws the faces over the sources for checking by eye.
//   node scratchpad/bridges/facefit.mjs seed      print estimated silhouette points per source
//   node scratchpad/bridges/facefit.mjs overlay   write scratchpad/bridges/mat/overlay-<src>.png
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { PNG } from 'pngjs';
const DIR = 'assets/source/bridges-v1/';
const load = (name) => PNG.sync.read(readFileSync(`${DIR}${name}.png`));
const solid = (p, x, y) => p.data[(y * p.width + x) * 4 + 3] > 150;
function column(p, x) {
  let top = -1,
    bot = -1;
  for (let y = 0; y < p.height; y++)
    if (solid(p, x, y)) {
      if (top < 0) top = y;
      bot = y;
    }
  return [top, bot];
}
function extremes(p) {
  let l = p.width,
    r = -1,
    t = p.height,
    b = -1;
  for (let y = 0; y < p.height; y++)
    for (let x = 0; x < p.width; x++)
      if (solid(p, x, y)) {
        l = Math.min(l, x);
        r = Math.max(r, x);
        t = Math.min(t, y);
        b = Math.max(b, y);
      }
  const rowMean = (y) => {
    let s = 0,
      n = 0;
    for (let x = 0; x < p.width; x++)
      if (solid(p, x, y)) {
        s += x;
        n++;
      }
    return s / n;
  };
  return {
    left: l,
    right: r,
    top: t,
    bottom: b,
    leftCol: column(p, l + 3),
    rightCol: column(p, r - 3),
    topX: Math.round(rowMean(t + 2)),
    bottomX: Math.round(rowMean(b - 2)),
  };
}
const mode = process.argv[2] ?? 'seed';
const names = [
  'stone-pad',
  'stone-rail-x',
  'stone-rail-y',
  'stone-arch-x',
  'stone-arch-y',
  'stone-pier',
  'wood-pad',
  'wood-rail-x',
  'wood-rail-y',
  'wood-truss-x',
  'wood-truss-y',
  'wood-post',
  'wood-brace-x',
  'wood-brace-y',
];
if (mode === 'seed') {
  for (const n of names) console.log(n, JSON.stringify(extremes(load(n))));
} else {
  mkdirSync('scratchpad/bridges/mat', { recursive: true });
  const table = JSON.parse(readFileSync(`${DIR}materials.json`, 'utf8'));
  const bySrc = new Map();
  for (const [key, f] of Object.entries(table.swatches)) {
    if (!bySrc.has(f.src)) bySrc.set(f.src, []);
    bySrc.get(f.src).push([key, f]);
  }
  const only = process.argv[3] ? new RegExp(process.argv[3]) : /./;
  for (const [src, list] of bySrc) {
    if (!only.test(src)) continue;
    const p = load(src);
    // black backdrop so the faces read; lines in strong colours
    for (let i = 0; i < p.data.length; i += 4) {
      const a = p.data[i + 3] / 255;
      for (let c = 0; c < 3; c++) p.data[i + c] = Math.round(p.data[i + c] * a + 40 * (1 - a));
      p.data[i + 3] = 255;
    }
    const plot = (x, y, col) => {
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = Math.round(x) + dx,
            yy = Math.round(y) + dy;
          if (xx < 0 || yy < 0 || xx >= p.width || yy >= p.height) continue;
          const i = (yy * p.width + xx) * 4;
          p.data[i] = col[0];
          p.data[i + 1] = col[1];
          p.data[i + 2] = col[2];
        }
    };
    const line = (a, b, col) => {
      const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]));
      for (let i = 0; i <= n; i++)
        plot(a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n, col);
    };
    const COLS = [
      [255, 0, 255],
      [0, 255, 255],
      [255, 255, 0],
      [0, 255, 0],
      [255, 80, 80],
    ];
    list.forEach(([, f], i) => {
      const { o, u, v } = f,
        w = [u[0] + v[0] - o[0], u[1] + v[1] - o[1]],
        c = COLS[i % COLS.length];
      line(o, u, c);
      line(u, w, c);
      line(w, v, c);
      line(v, o, c);
    });
    // crop to the art, at half size
    const e = extremes(load(src)),
      x0 = Math.max(0, e.left - 30),
      y0 = Math.max(0, e.top - 30),
      x1 = Math.min(p.width, e.right + 30),
      y1 = Math.min(p.height, e.bottom + 30),
      out = new PNG({ width: x1 - x0, height: y1 - y0 });
    for (let y = y0; y < y1; y++)
      p.data.copy(out.data, (y - y0) * out.width * 4, (y * p.width + x0) * 4, (y * p.width + x1) * 4);
    writeFileSync(`scratchpad/bridges/mat/overlay-${src}.png`, PNG.sync.write(out));
    console.log(src, list.map(([k]) => k).join(' '), 'crop origin', x0, y0);
  }
}
