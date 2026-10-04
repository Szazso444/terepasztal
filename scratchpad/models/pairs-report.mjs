// Rebuilds out/report-pairs.json from the pair images on disk (pairs.mjs run for a few ids overwrites it).
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
const out = 'scratchpad/models/out';
const pairs = {};
for (const f of readdirSync(out)) {
  const m = /^pair-(.+)\.png$/.exec(f);
  if (!m) continue;
  const png = PNG.sync.read(readFileSync(`${out}/${f}`));
  pairs[m[1]] = { size: [png.width, png.height] };
}
writeFileSync(`${out}/report-pairs.json`, JSON.stringify({ errors: [], pairs }, null, 1));
console.log(Object.keys(pairs).length, 'pairs');
