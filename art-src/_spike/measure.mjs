// Judge a render without a human: how much of the building silhouette is wall versus roof,
// and how much contrast separates the two visible wall faces.
import { PNG } from '/home/user/terepasztal/node_modules/pngjs/lib/png.js';
import { readFileSync } from 'node:fs';
const p = PNG.sync.read(readFileSync(process.argv[2]));
const near = (c, t, tol) => Math.abs(c[0] - t[0]) < tol && Math.abs(c[1] - t[1]) < tol && Math.abs(c[2] - t[2]) < tol;
let wall = 0, roof = 0, grass = 0, opaque = 0;
const lum = [];
for (let y = 0; y < p.height; y++)
  for (let x = 0; x < p.width; x++) {
    const i = (y * p.width + x) * 4;
    if (p.data[i + 3] < 128) continue;
    opaque++;
    const c = [p.data[i], p.data[i + 1], p.data[i + 2]];
    if (near(c, [122, 146, 76], 42)) { grass++; continue; }
    // limestone family is warm and light; slate is cool and mid
    const warm = c[0] - c[2];
    if (warm > 18 && c[0] > 110) { wall++; lum.push([x, 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]]); }
    else if (Math.abs(warm) < 26 && c[2] > 70 && c[0] < 165) roof++;
  }
const body = wall + roof;
// split wall pixels left/right of the silhouette centre: the two visible faces
const xs = lum.map(v => v[0]).sort((a, b) => a - b);
const mid = xs.length ? xs[Math.floor(xs.length / 2)] : 0;
const avg = (f) => { const v = lum.filter(f).map(u => u[1]); return v.length ? v.reduce((s, u) => s + u, 0) / v.length : 0; };
const left = avg(v => v[0] < mid), right = avg(v => v[0] >= mid);
console.log(JSON.stringify({
  wallShare: +(wall / Math.max(1, body)).toFixed(3),
  roofShare: +(roof / Math.max(1, body)).toFixed(3),
  bodyPx: body,
  faceContrast: +((Math.max(left, right) - Math.min(left, right)) / Math.max(1, Math.max(left, right))).toFixed(3),
}));
