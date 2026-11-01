/** Assemble only diagnostic looks; source paintings are never written. */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
const folder = dirname(fileURLToPath(import.meta.url));
const specs = JSON.parse(readFileSync(join(folder, 'specifications.json'), 'utf8'));
const rows = {};
for (let i = 0; i < specs.length; i += 5) {
  const group = specs.slice(i, i + 5);
  const name = 'checks/review-' + (1 + i / 5) + '.png';
  const out = new PNG({ width: 1760, height: group.length * 480 });
  group.forEach((spec, row) => {
    const src = PNG.sync.read(
      readFileSync(join(folder, 'checks', spec.file.slice(0, -4) + '-look.png')),
    );
    PNG.bitblt(src, out, 0, 0, 1760, 480, 0, row * 480);
  });
  writeFileSync(join(folder, name), PNG.sync.write(out));
  rows[name] = group.map((s) => s.file);
}
writeFileSync(join(folder, 'checks/review-rows.json'), JSON.stringify(rows, null, 2) + '\n');
