// Count pixels that differ between two PNGs of one size (below the label strip).
//   node scratchpad/bridges/pngdiff.mjs <a.png> <b.png> [tolerance=24] [diff.png]
import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
const [a, b, tol = '24', out] = process.argv.slice(2);
const p = PNG.sync.read(readFileSync(a)),
  q = PNG.sync.read(readFileSync(b));
if (p.width !== q.width || p.height !== q.height) throw new Error('sizes differ');
let n = 0,
  box = [Infinity, Infinity, -1, -1];
const d = new PNG({ width: p.width, height: p.height });
for (let y = 44; y < p.height; y++)
  for (let x = 0; x < p.width; x++) {
    const k = (y * p.width + x) * 4,
      diff = Math.abs(p.data[k] - q.data[k]) + Math.abs(p.data[k + 1] - q.data[k + 1]) + Math.abs(p.data[k + 2] - q.data[k + 2]);
    d.data[k] = d.data[k + 1] = d.data[k + 2] = p.data[k] >> 2;
    d.data[k + 3] = 255;
    if (diff > +tol) {
      n++;
      d.data[k] = 255;
      box = [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)];
    }
  }
if (out) writeFileSync(out, PNG.sync.write(d));
console.log(`${n} pixels differ`, n ? `within ${box.join(',')}` : '');
