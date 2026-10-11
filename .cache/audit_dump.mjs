// For an audit of the camera measure: every made picture of some families as the tools read it,
// and laid onto its footprint twice, corrected and as drawn (scale and place only), the four
// views of an age brought to one size as the game's atlas has them.
//   node .cache/audit_dump.mjs <buildings-v2 folder> <out folder> <family> [<family> ...]
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { PNG } from 'pngjs';
import { FOOTPRINTS, loadInventory, wallBase } from '../tools/building-kit.mjs';
import { cameraOff, fitGroup, fitPicture, normalisePicture } from '../tools/building-fit.mjs';

const [root, out, ...families] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const queue = JSON.parse(readFileSync(`${root}/queue.json`, 'utf8'));
const rows = {};
for (const f of loadInventory().filter((x) => families.includes(x.family))) {
  const fp = FOOTPRINTS[f.footprint];
  for (let age = f.firstAge; age < f.firstAge + f.ages; age++) {
    const ids = [0, 1, 2, 3].map((rot) => `${f.family}-a${age}-r${rot}`);
    const pngs = ids.map((id) => {
      const file = `${root}/${f.family}/${id}.png`;
      const e = queue.entries.find((x) => x.id === id);
      const made = e && (e.status === 'generated' || e.status === 'approved');
      return made && existsSync(file) ? PNG.sync.read(readFileSync(file)) : null;
    });
    if (!pngs.some(Boolean)) continue;
    const groups = { new: fitGroup(pngs, f.footprint, { rectify: true }), raw: fitGroup(pngs, f.footprint, { rectify: false }) };
    ids.forEach((id, rot) => {
      if (!pngs[rot]) return;
      const own = fitPicture(pngs[rot], f.footprint, rot);
      const off = cameraOff(own);
      const e = queue.entries.find((x) => x.id === id);
      const target = wallBase(fp, rot);
      for (const look of ['new', 'raw'])
        writeFileSync(`${out}/${id}-${look}.png`, PNG.sync.write(normalisePicture(pngs[rot], groups[look][rot], f.footprint, 1)));
      rows[id] = {
        family: f.family,
        age,
        rot,
        footprint: f.footprint,
        size: [pngs[rot].width, pngs[rot].height],
        method: own.method,
        sure: own.sure,
        measured: own.measured,
        used: own.slopes,
        vertical: own.vertical,
        shear: own.shear,
        base: own.base,
        camera: own.camera,
        off,
        attempts: e.attempts,
        kept: e.kept ?? null,
        repaint: !!e.repaint,
        canvas: fp.canvas,
        centre: fp.centre,
        target: { w: target.w, s: target.s, e: target.e },
        scaleNew: groups.new[rot].scale,
        scaleRaw: groups.raw[rot].scale,
      };
    });
  }
}
writeFileSync(`${out}/audit.json`, JSON.stringify(rows, null, 1));
console.log(Object.keys(rows).length, 'pictures in', out);
