import fs from 'node:fs';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('./', import.meta.url));
const report = JSON.parse(fs.readFileSync(root + 'renders/report.json', 'utf8'));
assert.deepEqual(report.size, [128, 128]);
assert.deepEqual(report.before, report.after);
assert.equal(report.errors.length, 0);
assert.equal(report.trackOnWater, 0);
assert.equal(report.views.length, 6);
assert(report.connectedRoute);
assert(report.trainBodyUnstretched);
assert.equal(report.humanLogicalHeight, 11);
assert(report.maximumPatchDistanceFromAnchor < 0.95);
assert(Object.keys(report.biomeCounts).length === 6);
assert(new Set(report.railMaterials.map((r) => r.terrain)).size >= 3);
for (const v of report.views) {
  const p = PNG.sync.read(fs.readFileSync(root + 'renders/' + v.id + '.png'));
  assert.equal(p.width, 1920);
  assert.equal(p.height, 1200);
}
const views = [
  report.views[2],
  report.views[3],
  report.views[5],
  report.views[4],
  report.views[1],
  report.views[0],
];
fs.writeFileSync(
  root + 'gallery.html',
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Terepasztal — generated world v2</title><style>*{box-sizing:border-box}body{margin:0;background:#19271f;color:#e4d5b5;font:16px/1.55 system-ui}main{max-width:1480px;margin:auto;padding:35px 28px}h1{font:500 36px Georgia,serif;margin:10px 0}p,small{color:#bac3ac}nav{display:flex;gap:9px;flex-wrap:wrap;margin:24px 0}a{color:#e4d5b5}nav a{border:1px solid #53664e;padding:7px 12px;border-radius:25px;text-decoration:none}figure{margin:30px 0 55px}figcaption{font:500 25px Georgia,serif;margin-bottom:12px}img{display:block;width:100%;height:auto;border:1px solid #53664e}</style></head><body><main><small>TEREPASZTAL / GENERATED WORLD / V2</small><h1>Small ground patches. Rails that belong to the landscape.</h1><p>One normally generated 128 × 128 map · Seed 7412 · Six actual game screenshots.</p><nav>${views.map((v) => `<a href="#${v.id}">${v.title.split(' · ')[0]}</a>`).join('')}</nav>${views.map((v) => `<figure id="${v.id}"><figcaption>${v.title}</figcaption><a href="renders/${v.id}.png"><img loading="lazy" src="renders/${v.id}.png" alt="${v.title}"></a></figure>`).join('')}<p>Generated terrain data is preserved. Construction and preview material rendering are documented in <a href="README.md">the review notes</a>.</p></main></body></html>`,
);
const dest = 'G:/DEV/Terepasztal/renders/generated-world-v2';
fs.mkdirSync(dest, { recursive: true });
for (const name of [
  'index.html',
  'gallery.html',
  'scene.js',
  'materials.js',
  'rails.js',
  'capture.mjs',
  'publish.mjs',
  'README.md',
])
  fs.copyFileSync(root + name, dest + '/' + name);
fs.cpSync(root + 'renders', dest + '/renders', { recursive: true });
console.log(
  JSON.stringify({
    files: 6,
    dimensions: '1920x1200',
    seed: report.seed,
    railMaterials: [...new Set(report.railMaterials.map((r) => r.terrain))],
    maxPatchExtent: report.maximumPatchDistanceFromAnchor,
    delivery: dest,
  }),
);
