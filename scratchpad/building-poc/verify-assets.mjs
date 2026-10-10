import { launch } from '../runtime.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import assert from 'node:assert/strict';
const root = 'scratchpad/building-poc',
  manifest = JSON.parse(readFileSync(`${root}/sprites/manifest.json`));
assert.equal(Object.keys(manifest.frames).length, 8);
for (const [key, f] of Object.entries(manifest.frames)) {
  const p = PNG.sync.read(readFileSync(`${root}/sprites/${key}.png`));
  assert.equal(p.width, f.w * 4);
  assert.equal(p.height, f.h * 4);
  assert.ok(Number.isFinite(f.ax) && Number.isFinite(f.ay));
  let transparent = 0,
    opaque = 0;
  for (let i = 3; i < p.data.length; i += 4) {
    if (p.data[i] === 0) transparent++;
    if (p.data[i] >= 240) opaque++;
  }
  assert.ok(transparent && opaque, key);
}
const browser = await launch();
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } }),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:5173/scratchpad/building-poc/assets.html');
  await page.waitForFunction(() => window.assetGalleryReady);
  assert.equal(await page.locator('canvas').count(), 8);
  await page.locator('#gallery').screenshot({ path: `${root}/sprites/in-grid.png` });
  await page.goto('http://127.0.0.1:5173/scratchpad/building-poc/index.html');
  await page.waitForFunction(() => window.buildingPOCReady);
  await page.uncheck('#art');
  await page.check('#art');
  const result = await page.evaluate(() => {
    const s = window.buildingPOC.site;
    const count = s.buildings.length;
    const placed = s.place(0, 0, 2, 0);
    const overlap = s.place(1, 0, 1, 0);
    const rotated = s.rotate(1, 0);
    const removed = s.remove(0, 1);
    return { placed, overlap, rotated, removed, restoredCount: s.buildings.length === count };
  });
  assert.deepEqual(result, {
    placed: true,
    overlap: false,
    rotated: true,
    removed: true,
    restoredCount: true,
  });
  await page.locator('#rotate').click();
  await page.locator('canvas').screenshot({ path: `${root}/illustrated-poc.png` });
  assert.deepEqual(errors, []);
  writeFileSync(
    `${root}/sprites/verification.json`,
    JSON.stringify({ assets: 8, errors, ...result }, null, 2),
  );
  console.log('Eight RGBA assets, gallery, toggle and placement checks passed.');
} finally {
  await browser.close();
}

