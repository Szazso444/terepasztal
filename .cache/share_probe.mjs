// How the measured foot of each picture divides at its near corner, against how the footprint
// divides: a wall foot that is far shorter than the footprint's is likely not the wall's at all
// (a silo standing at the corner). Every picture under a buildings-v2 folder, attempts included.
//   node .cache/share_probe.mjs <buildings-v2 folder> [family ...]
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { PNG } from 'pngjs';
import { FOOTPRINTS, loadInventory, wallBase } from '../tools/building-kit.mjs';
import { measureBase, cameraOff, fitPicture } from '../tools/building-fit.mjs';

const [root, ...only] = process.argv.slice(2);
const inv = loadInventory();
const rows = [];
for (const f of inv) {
  if (only.length && !only.includes(f.family)) continue;
  const dir = `${root}/${f.family}`;
  if (!existsSync(dir)) continue;
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.png'))) {
    const m = /-a(\d)-r(\d)(\..*)?\.png$/.exec(name);
    if (!m) continue;
    const rot = Number(m[2]);
    let png;
    try {
      png = PNG.sync.read(readFileSync(`${dir}/${name}`));
    } catch {
      continue;
    }
    const base = measureBase(png);
    if (!base) continue;
    const t = wallBase(FOOTPRINTS[f.footprint], rot);
    const want = (t.e[0] - t.s[0]) / (t.e[0] - t.w[0]);
    const got = (base.e[0] - base.s[0]) / (base.e[0] - base.w[0]);
    const fit = fitPicture(png, f.footprint, rot);
    const off = fit && cameraOff(fit);
    rows.push({
      name,
      sure: base.sure.map((s) => (s ? 1 : 0)).join(''),
      slopes: base.slopes.map((s) => s.toFixed(3)).join(' '),
      want: want.toFixed(2),
      got: got.toFixed(2),
      left: ((1 - got) / (1 - want)).toFixed(2),
      right: (got / want).toFixed(2),
      by: off?.by ?? null,
    });
  }
}
rows.sort((a, b) => Math.min(a.left, a.right) - Math.min(b.left, b.right));
console.log(`${rows.length} pictures; the 25 whose shorter side is furthest from the footprint's:`);
for (const r of rows.slice(0, 25))
  console.log(
    `${r.name.padEnd(34)} sure ${r.sure}  slopes ${r.slopes.padEnd(14)} right share ${r.got} (footprint ${r.want})  left x${r.left} right x${r.right}  camera off by ${r.by}`,
  );
const bins = [0.5, 0.7, 0.85, 1.15, 1.3, 1.5, 9];
const count = bins.map(() => 0);
for (const r of rows) count[bins.findIndex((b) => Math.min(r.left, r.right) < b)]++;
console.log('shorter side as a share of the footprint\'s, pictures per band:', bins.map((b, i) => `<${b}: ${count[i]}`).join('  '));
