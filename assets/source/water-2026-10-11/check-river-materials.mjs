import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

// Review copies only. Source paintings are never rewritten.
const root = path.dirname(fileURLToPath(import.meta.url));
const prompts = JSON.parse(
  fs.readFileSync(path.join(root, 'river-prompts-additions.json'), 'utf8'),
);
const preview = path.join(root, 'review', 'river');
fs.mkdirSync(preview, { recursive: true });
const report = [],
  hashes = new Set();
for (const entry of prompts) {
  if (entry.file === null) continue; // Unretained response; dimensions cannot be verified.
  const bytes = fs.readFileSync(path.join(root, entry.file));
  const png = PNG.sync.read(bytes);
  if (bytes[25] !== 6) throw new Error(`${entry.file}: expected RGBA PNG`);
  entry.returned = [png.width, png.height];
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  if (hashes.has(hash)) throw new Error(`${entry.file}: duplicate painting`);
  hashes.add(hash);
  let transparent = 0,
    partial = 0;
  for (let i = 3; i < png.data.length; i += 4) {
    if (png.data[i] === 0) transparent++;
    else if (png.data[i] < 255) partial++;
  }
  const small = new PNG({ width: 128, height: 128 });
  for (let y = 0; y < 128; y++)
    for (let x = 0; x < 128; x++) {
      const loX = Math.floor((x * png.width) / 128),
        hiX = Math.floor(((x + 1) * png.width) / 128);
      const loY = Math.floor((y * png.height) / 128),
        hiY = Math.floor(((y + 1) * png.height) / 128);
      const sum = [0, 0, 0, 0];
      let count = 0;
      for (let sy = loY; sy < hiY; sy++)
        for (let sx = loX; sx < hiX; sx++) {
          const i = (sy * png.width + sx) * 4,
            a = png.data[i + 3] / 255;
          for (let c = 0; c < 3; c++) sum[c] += png.data[i + c] * a;
          sum[3] += a;
          count++;
        }
      const i = (y * 128 + x) * 4;
      for (let c = 0; c < 3; c++) small.data[i + c] = sum[3] ? Math.round(sum[c] / sum[3]) : 0;
      small.data[i + 3] = Math.round((sum[3] / count) * 255);
    }
  const target = path.join(preview, entry.file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, PNG.sync.write(small));
  report.push({
    file: entry.file,
    returned: entry.returned,
    rgba: true,
    transparent,
    partial,
    sha256: hash,
  });
}
// Read shared journal immediately before merging, retaining the other material jobs.
const sharedPath = path.join(root, 'prompts.json');
const shared = fs.existsSync(sharedPath) ? JSON.parse(fs.readFileSync(sharedPath, 'utf8')) : [];
const byId = new Map(shared.map((entry) => [entry.id, entry]));
for (const entry of prompts) byId.set(entry.id, entry);
fs.writeFileSync(sharedPath, JSON.stringify([...byId.values()], null, 2) + '\n');
fs.writeFileSync(path.join(preview, 'png-check.json'), JSON.stringify(report, null, 2) + '\n');
console.log(
  JSON.stringify(
    report.map(({ file, returned, rgba, transparent, partial }) => ({
      file,
      returned,
      rgba,
      transparent,
      partial,
    })),
    null,
    2,
  ),
);
