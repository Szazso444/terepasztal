// How well does each wall foot the tool found lie along the picture's lowest pixels? For every
// made picture and each of its two feet: the share of the columns between the corners whose
// lowest pixel is on the line (within the tool's own tolerance), and the longest unbroken run of
// such columns as a share of the side. A plain wall's foot is on its line nearly all the way; a
// line through the feet of things that stand before a wall touches it here and there.
//   node .cache/audit_feet.mjs <buildings-v2 folder> <audit folder>
import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { measureBase } from '../tools/building-fit.mjs';

const [root, audit] = process.argv.slice(2);
const rows = JSON.parse(readFileSync(`${audit}/measured.json`, 'utf8'));
for (const [id, r] of Object.entries(rows)) {
  const png = PNG.sync.read(readFileSync(`${root}/${r.family}/${id}.png`));
  const m = measureBase(png);
  const tol = Math.max(3, Math.round((m.maxX - m.minX) * 0.006));
  r.feet = [0, 1].map((side) => {
    const a = m.slopes[side];
    const [from, to] = side === 0 ? [m.w[0], m.s[0]] : [m.s[0], m.e[0]];
    let cols = 0,
      on = 0,
      run = 0,
      best = 0;
    for (let x = Math.ceil(from); x <= Math.floor(to); x++) {
      if (m.low[x] < 0) continue;
      cols++;
      if (Math.abs(m.low[x] - (m.s[1] + a * (x - m.s[0]))) <= tol) {
        on++;
        run++;
        best = Math.max(best, run);
      } else run = 0;
    }
    // how much of the picture's whole side the foot between the corners covers
    const side_ = side === 0 ? m.s[0] - m.minX : m.maxX - m.s[0];
    return {
      share: cols ? +(on / cols).toFixed(2) : 0,
      run: cols ? +(best / cols).toFixed(2) : 0,
      covers: +((to - from) / Math.max(1, side_)).toFixed(2),
    };
  });
}
writeFileSync(`${audit}/measured.json`, JSON.stringify(rows, null, 1));
for (const [id, r] of Object.entries(rows)) {
  const i = r.inner;
  const d = i && i.pos[0] && i.neg[0] ? [r.measured[0] - i.pos[0][0], r.measured[1] - i.neg[0][0]] : [NaN, NaN];
  console.log(
    `${id.padEnd(15)} L share ${r.feet[0].share} run ${r.feet[0].run} covers ${r.feet[0].covers} diff ${d[0].toFixed(3).padStart(6)} | R share ${r.feet[1].share} run ${r.feet[1].run} covers ${r.feet[1].covers} diff ${d[1].toFixed(3).padStart(6)} | sure ${r.sure.map(Number).join('')}`,
  );
}
