// How far each "straight" wall foot bows: the lowest pixels along the base line the fit found,
// fitted with a parabola; `sag` is how far its middle lies off the straight line between its ends,
// in pixels and as a share of the foot's length. A wall's foot is straight; the base of a silo
// that stands before the wall is an arc. Every picture under a buildings-v2 folder.
//   node .cache/bow_probe.mjs <buildings-v2 folder>
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { PNG } from 'pngjs';
import { loadInventory } from '../tools/building-kit.mjs';
import { measureBase } from '../tools/building-fit.mjs';

const root = process.argv[2];
const rows = [];
/** least squares y = c2 x^2 + c1 x + c0 over points, x centred and scaled to [-1, 1] */
function sagOf(pts) {
  if (pts.length < 8) return null;
  const x0 = pts[0][0],
    x1 = pts[pts.length - 1][0];
  const mid = (x0 + x1) / 2,
    half = (x1 - x0) / 2;
  let s = [0, 0, 0, 0, 0],
    t = [0, 0, 0];
  for (const [x, y] of pts) {
    const u = (x - mid) / half;
    let p = 1;
    for (let k = 0; k < 5; k++) {
      s[k] += p;
      if (k < 3) t[k] += p * y;
      p *= u;
    }
  }
  // normal equations for [c0, c1, c2]
  const A = [
    [s[0], s[1], s[2]],
    [s[1], s[2], s[3]],
    [s[2], s[3], s[4]],
  ];
  const det = (m) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const d = det(A);
  if (Math.abs(d) < 1e-9) return null;
  const col = (i) => A.map((row, r) => row.map((v, c) => (c === i ? t[r] : v)));
  const c2 = det(col(2)) / d;
  // at u = 0 the parabola lies c2 off the chord between u = -1 and u = 1
  return { sag: c2, length: x1 - x0 };
}
for (const f of loadInventory()) {
  const dir = `${root}/${f.family}`;
  if (!existsSync(dir)) continue;
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.png'))) {
    let png;
    try {
      png = PNG.sync.read(readFileSync(`${dir}/${name}`));
    } catch {
      continue;
    }
    const m = measureBase(png);
    if (!m) continue;
    const tol = Math.max(3, Math.round((m.maxX - m.minX) * 0.006));
    [0, 1].forEach((side) => {
      if (!m.sure[side]) return;
      const a = m.slopes[side];
      const [from, to] = side === 0 ? [m.w[0], m.s[0]] : [m.s[0], m.e[0]];
      const pts = [];
      for (let x = Math.ceil(from); x <= Math.floor(to); x++) {
        if (m.low[x] < 0) continue;
        const on = m.s[1] + a * (x - m.s[0]);
        if (Math.abs(m.low[x] - on) <= tol * 2) pts.push([x, m.low[x]]);
      }
      const b = sagOf(pts);
      if (b) rows.push({ name, side, slope: a, sag: b.sag, length: b.length, share: Math.abs(b.sag) / b.length });
    });
  }
}
rows.sort((p, q) => q.share - p.share);
console.log(`${rows.length} wall feet; the 20 that bow most (sag in px, + is downwards in the middle):`);
for (const r of rows.slice(0, 20))
  console.log(
    `${r.name.padEnd(34)} ${r.side ? 'right' : 'left '} slope ${r.slope.toFixed(3).padStart(6)}  sag ${r.sag.toFixed(1).padStart(6)} px over ${Math.round(r.length)} px  = ${(r.share * 100).toFixed(2)}%`,
  );
const bands = [0.2, 0.4, 0.6, 0.8, 1, 1.5, 2, 99];
const n = bands.map(() => 0);
for (const r of rows) n[bands.findIndex((b) => r.share * 100 < b)]++;
console.log('bow as % of the foot\'s length, feet per band:', bands.map((b, i) => `<${b}: ${n[i]}`).join('  '));
