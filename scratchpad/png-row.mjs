// Puts PNGs side by side with a gap, for a before / after.
//   node scratchpad/png-row.mjs <out.png> <a.png> <b.png> [...]
import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const [out, ...files] = process.argv.slice(2);
if (!out || files.length < 2) throw new Error('usage: png-row.mjs <out.png> <a.png> <b.png> [...]');
const gap = 6;
const pngs = files.map((f) => PNG.sync.read(readFileSync(f)));
const sheet = new PNG({
  width: pngs.reduce((n, p) => n + p.width, 0) + gap * (pngs.length + 1),
  height: Math.max(...pngs.map((p) => p.height)) + 2 * gap,
});
for (let i = 0; i < sheet.data.length; i += 4) sheet.data.set([30, 34, 28, 255], i);
let x = gap;
for (const p of pngs) {
  PNG.bitblt(p, sheet, 0, 0, p.width, p.height, x, gap);
  x += p.width + gap;
}
writeFileSync(out, PNG.sync.write(sheet));
console.log('wrote', out, `${sheet.width}x${sheet.height}`);
