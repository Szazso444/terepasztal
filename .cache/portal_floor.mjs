// How open is the ground in a depot's portals? For each picture: the share of opaque pixels in a
// thin band just above the wall's foot, inside each portal's span.
//   node .cache/portal_floor.mjs <buildings-v2 folder> [family]
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { PNG } from 'pngjs';
import { FIT, fitPicture } from '../tools/building-fit.mjs';
import { portalWall } from '../tools/building-guides.mjs';

const root = process.argv[2];
const family = process.argv[3] ?? 'depot';
const fpId = family === 'depot' ? 't2x2' : 't1x2';
// where the portals are along the wall, as fractions of its length (the middle of each opening)
const SPANS =
  fpId === 't2x2'
    ? [
        [0.16, 0.31],
        [0.69, 0.84],
      ]
    : [[0.36, 0.64]];
for (const name of readdirSync(`${root}/${family}`).sort()) {
  const m = new RegExp(`^${family}-a(\\d)-r(\\d)\\.png$`).exec(name);
  if (!m) continue;
  const rot = Number(m[2]);
  const png = PNG.sync.read(readFileSync(`${root}/${family}/${name}`));
  const fit = fitPicture(png, fpId, rot);
  const wall = portalWall(fpId, rot);
  if (!fit || wall === null) continue;
  const [from, to] = wall === 0 ? [fit.base.w, fit.base.s] : [fit.base.s, fit.base.e];
  const up = (fit.base.e[0] - fit.base.w[0]) * 0.16;
  const shares = SPANS.map(([a, b]) => {
    let seen = 0,
      opaque = 0;
    const steps = Math.round(Math.abs(to[0] - from[0]));
    for (let i = Math.round(steps * a); i <= steps * b; i++) {
      const x = Math.round(from[0] + ((to[0] - from[0]) * i) / steps);
      const foot = from[1] + ((to[1] - from[1]) * i) / steps;
      for (let h = Math.round(up * 0.04); h < up * 0.22; h++) {
        const y = Math.round(foot - h);
        if (x < 0 || y < 0 || x >= png.width || y >= png.height) continue;
        seen++;
        if (png.data[(y * png.width + x) * 4 + 3] > FIT.alpha) opaque++;
      }
    }
    return seen ? opaque / seen : 0;
  });
  console.log(name.padEnd(20), `wall ${wall}`, shares.map((s) => s.toFixed(2)).join('  '));
}
