// The ground inside a depot's portals, measured over a narrower or a wider middle of each opening.
import { readFileSync, readdirSync } from 'node:fs';
import { PNG } from 'pngjs';
import { FIT, fitPicture } from '../tools/building-fit.mjs';
import { FOOTPRINTS, wallBase } from '../tools/building-kit.mjs';
import { openingsOf, portalWall } from '../tools/building-guides.mjs';
const root = process.argv[2];
const bad = new Set(['depot-a1-r1', 'depot-a4-r2', 'depot-a4-r3', 'depot-a5-r2']);
for (const inner of [0.2, 0.3, 0.35]) {
  for (const [lo, hi] of [[0.04, 0.22], [0.04, 0.14], [0.08, 0.3]]) {
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
      const spans = openingsOf('t2x2', rot).filter((o) => o.kind === 'side' && o.wall === wall).map((o) => {
        const [a, b] = [o.pts[0], o.pts[1]].map((p) => (p[0] - gf[0]) / (gt[0] - gf[0])).sort((x, y) => x - y);
        return [a + (b - a) * inner, b - (b - a) * inner];
      });
      const [from, to] = wall === 0 ? [fit.base.w, fit.base.s] : [fit.base.s, fit.base.e];
      const up = (fit.base.e[0] - fit.base.w[0]) * 0.16;
      const shares = spans.map(([a, b]) => {
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
      });
      rows.push({ id: name.replace('.png', ''), shares });
    }
    const of = (set, f) => rows.filter((r) => bad.has(r.id) === set).map((r) => f(r.shares));
    const fmt = (v) => v.map((x) => x.toFixed(2)).join(' ');
    console.log(`inner ${inner} band ${lo}-${hi}: bad min-of-portals [${fmt(of(true, (s) => Math.min(...s)))}]  good min: max ${Math.max(...of(false, (s) => Math.min(...s))).toFixed(2)}  good max-of-portals: max ${Math.max(...of(false, (s) => Math.max(...s))).toFixed(2)}`);
  }
}
