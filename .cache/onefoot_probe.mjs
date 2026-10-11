// Which pictures would a "trust the good foot" rule let through? For every picture: the camera
// as read from both feet, and whether each foot alone lies within what a camera near the game's
// draws. A picture whose two feet give a camera far off while one foot alone is fine is either a
// building with something standing before one wall (a silo at the corner), or a coincidence.
//   node .cache/onefoot_probe.mjs <buildings-v2 folder> [degrees, default 8]
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { PNG } from 'pngjs';
import { loadInventory } from '../tools/building-kit.mjs';
import { FIT, cameraOff, fitPicture } from '../tools/building-fit.mjs';

const root = process.argv[2];
const far = Number(process.argv[3] ?? 8);
const rad = (d) => (d * Math.PI) / 180;
const flat = Math.sin(rad(30 - FIT.camera)) * Math.tan(rad(45 - FIT.camera)),
  steep = Math.sin(rad(30 + FIT.camera)) * Math.tan(rad(45 + FIT.camera));
const fine = (slope) => Math.abs(slope) >= flat && Math.abs(slope) <= steep;
console.log(`one foot alone is fine between ${flat.toFixed(3)} and ${steep.toFixed(3)}`);
const rows = [];
for (const f of loadInventory()) {
  const dir = `${root}/${f.family}`;
  if (!existsSync(dir)) continue;
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.png'))) {
    const m = /-a(\d)-r(\d)(\..*)?\.png$/.exec(name);
    if (!m) continue;
    let png;
    try {
      png = PNG.sync.read(readFileSync(`${dir}/${name}`));
    } catch {
      continue;
    }
    const fit = fitPicture(png, f.footprint, Number(m[2]));
    if (!fit || !fit.sure[0] || !fit.sure[1]) continue;
    const off = cameraOff(fit);
    if (!off || off.by < far) continue;
    rows.push({ name, by: off.by, el: off.elevation, turn: off.turn, s: fit.measured, ok: fit.measured.map(fine) });
  }
}
rows.sort((a, b) => b.by - a.by);
for (const r of rows)
  console.log(
    `${r.name.padEnd(34)} off by ${String(r.by).padStart(5)} (height ${String(r.el).padStart(6)}, turn ${String(r.turn).padStart(6)})  feet ${r.s.map((v) => v.toFixed(3)).join(' ')}  fine alone: ${r.ok.map((v) => (v ? 'yes' : 'no ')).join(' ')}  ${r.ok[0] !== r.ok[1] ? '<- one foot fine' : ''}`,
  );
console.log(`${rows.length} pictures read ${far} degrees or more off`);
