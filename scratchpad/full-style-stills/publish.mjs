import fs from 'node:fs';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('./', import.meta.url));
const entries = [
  ['village', 'Village & station'],
  ['station-detail', 'Station close-up'],
  ['industry', 'Industry & services'],
  ['countryside', 'Countryside & shoreline'],
  ['desert', 'Desert'],
  ['taiga', 'Taiga'],
  ['wetlands', 'Wetlands'],
];
const report = JSON.parse(fs.readFileSync(root + 'renders/report.json', 'utf8'));
assert.equal(report.errors.length, 0);
assert.equal(report.reports.length, 6);
for (const r of report.reports) {
  assert.equal(r.checks.trackOnWater, 0);
  assert.equal(r.checks.humanLogicalHeight, 11);
  assert.equal(r.checks.illustratedHumanLoaded, true);
  assert.deepEqual(r.checks.trainSpriteScale, [1, 1]);
}
for (const [name] of entries) {
  const p = PNG.sync.read(fs.readFileSync(root + 'renders/' + name + '.png'));
  assert.equal(p.width, 1920);
  assert.equal(p.height, 1200);
}
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Terepasztal — full-style stills</title><style>*{box-sizing:border-box}body{margin:0;background:#19271f;color:#e4d5b5;font:16px/1.55 system-ui}main{max-width:1480px;margin:auto;padding:40px 30px}h1{font:500 36px Georgia,serif;margin:8px 0}p{color:#bac3ac}nav{display:flex;gap:10px;flex-wrap:wrap;margin:28px 0}a{color:#e4d5b5}nav a{border:1px solid #53664e;padding:7px 13px;border-radius:30px;text-decoration:none}figure{margin:34px 0 60px}figcaption{font:500 25px Georgia,serif;margin-bottom:14px}img{display:block;width:100%;height:auto;border:1px solid #53664e}small{color:#bac3ac}</style></head><body><main><small>TEREPASZTAL / ART PREVIEW V1</small><h1>A consistent illustrated world</h1><p>Seven actual game-rendered stills · 1920 × 1200 · Approved source-art palette and materials.</p><nav>${entries.map(([id, title]) => `<a href="#${id}">${title}</a>`).join('')}</nav>${entries.map(([id, title]) => `<figure id="${id}"><figcaption>${title}</figcaption><a href="renders/${id}.png"><img src="renders/${id}.png" alt="${title}: actual game-rendered art preview" loading="lazy"></a></figure>`).join('')}<p>Isolated art-preview scenes. Ground and building-scale treatments are preview overrides; this is not a completed production asset rollout. <a href="README.md">Scope and reproduction notes</a>.</p></main></body></html>`;
fs.writeFileSync(root + 'gallery.html', html);
const target = 'G:/DEV/Terepasztal/renders/full-style-v1';
fs.mkdirSync(target, { recursive: true });
for (const file of [
  'index.html',
  'gallery.html',
  'scene.js',
  'ground.js',
  'capture.mjs',
  'prepare-person.mjs',
  'publish.mjs',
  'README.md',
  'passenger-prompt.md',
])
  fs.copyFileSync(root + file, target + '/' + file);
for (const dir of ['renders', 'assets'])
  fs.cpSync(root + dir, target + '/' + dir, { recursive: true });
console.log(
  JSON.stringify({
    screenshots: entries.length,
    dimensions: '1920x1200',
    browserErrors: 0,
    delivery: target,
  }),
);
