// The ground inside each portal as the most open of three windows across the opening's middle.
import { readFileSync, readdirSync } from 'node:fs';
import { PNG } from 'pngjs';
import { FIT, fitPicture } from '../tools/building-fit.mjs';
import { FOOTPRINTS, wallBase } from '../tools/building-kit.mjs';
import { openingsOf, portalWall } from '../tools/building-guides.mjs';
const root = process.argv[2];
const bad = new Set(['depot-a1-r1', 'depot-a4-r2', 'depot-a4-r3', 'depot-a5-r2']);
const WINDOWS = [[0.2, 0.4], [0.4, 0.6], [0.6, 0.8]];
for (const [lo, hi] of [[0.04, 0.22], [0.08, 0.3], [0.06, 0.26]]) {
  const rows = [];
  for (const name of readdirSync(`${root}/depot`).sort()) {
    const m = /^depot-a(\d)-r(\d)\.png$/.exec(name);
    if (!m) continue;
    const rot = Number(m[2]);
    const png = PNG.sync.read(readFileSync(`${root}/depot/${name}`));
    const fit = fitPicture(png, 't2x2', rot);
    const wall = portalWall('t2x2', rot);
    const base = wallBase(FOOTPRINTS.t2x2, rot);
    const [gf, gt] = wall === 0 ? [base.w, base.s] : [base.s, base.e];
    const [from, to] = wall === 0 ? [fit.base.w, fit.base.s] : [fit.base.s, fit.base.e];
    const up = (fit.base.e[0] - fit.base.w[0]) * 0.16;
    const share = (a, b) => {
      let seen = 0, painted = 0;
      const steps = Math.round(Math.abs(to[0] - from[0]));
      for (let i = Math.round(steps * a); i <= steps * b; i++) {
        const x = Math.round(from[0] + ((to[0] - from[0]) * i) / steps);
        const foot = from[1] + ((to[1] - from[1]) * i) / steps;
        for (let h = Math.round(up * lo); h < up * hi; h++) {
          const y = Math.round(foot - h);
          if (x < 0 || y < 0 || x >= png.width || y >= png.height) continue;
          seen++;
          if (png.data[(y * png.width + x) * 4 + 3] > FIT.alpha) painted++;
        }
      }
      return seen ? painted / seen : 0;
    };
    const portals = openingsOf('t2x2', rot).filter((o) => o.kind === 'side' && o.wall === wall).map((o) => {
      const [a, b] = [o.pts[0], o.pts[1]].map((p) => (p[0] - gf[0]) / (gt[0] - gf[0])).sort((x, y) => x - y);
      return Math.min(...WINDOWS.map(([p, q]) => share(a + (b - a) * p, a + (b - a) * q)));
    });
    rows.push({ id: name.replace('.png', ''), portals });
  }
  const fmt = (v) => v.map((x) => x.toFixed(2)).join(' ');
  console.log(`band ${lo}-${hi}`);
  console.log('  bad :', rows.filter((r) => bad.has(r.id)).map((r) => `${r.id.slice(6)}[${fmt(r.portals)}]`).join('  '));
  console.log('  good: worst portal of each:', fmt(rows.filter((r) => !bad.has(r.id)).map((r) => Math.max(...r.portals))));
}
