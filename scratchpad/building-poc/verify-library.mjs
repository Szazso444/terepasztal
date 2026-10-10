import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { launch } from '../runtime.mjs';
const root = 'scratchpad/building-poc',
  m = JSON.parse(readFileSync(`${root}/sprites/manifest.json`));
const complete = process.argv.includes('--require-all');
if (complete) assert.equal(m.buildings.length, 26);
const checks = [];
for (const b of m.buildings) {
  const hashes = new Set();
  for (let r = 0; r < 4; r++) {
    const key = `${b.key}-${r}`,
      f = m.frames[key];
    assert.ok(f, key);
    assert.equal(f.tiles, b.tiles);
    const bytes = readFileSync(`${root}/sprites/${key}.png`),
      p = PNG.sync.read(bytes);
    assert.equal(p.width, f.w * 4);
    assert.equal(p.height, f.h * 4);
    let clear = 0,
      solid = 0;
    for (let i = 3; i < p.data.length; i += 4) {
      if (p.data[i] === 0) clear++;
      if (p.data[i] >= 240) solid++;
    }
    assert.ok(clear && solid, `${key} alpha`);
    hashes.add(createHash('sha256').update(bytes).digest('hex'));
  }
  checks.push({ key: b.key, distinctFiles: hashes.size });
  assert.equal(hashes.size, 4, `${b.key}: duplicate images`);
}
const browser = await launch();
try {
  const page = await browser.newPage({ viewport: { width: 1680, height: 1100 } }),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:5173/scratchpad/building-poc/library.html');
  await page.waitForFunction(() => window.buildingLibraryReady);
  assert.equal(await page.locator('canvas').count(), m.buildings.length * 4);
  for (const value of ['1', '2', 'all']) {
    await page.selectOption('#filter', value);
    assert.equal(
      await page.locator('section').count(),
      m.buildings.filter((b) => value === 'all' || b.tiles === Number(value)).length,
    );
  }
  for (let i = 0; i < m.buildings.length; i++)
    await page
      .locator('section')
      .nth(i)
      .screenshot({ path: `${root}/sprites/review-${m.buildings[i].key}.png` });
  await page.goto('http://127.0.0.1:5173/scratchpad/building-poc/index.html?asset=stations-farm');
  await page.waitForFunction(() => window.buildingPOCReady);
  assert.equal(await page.locator('#asset').inputValue(), 'stations-farm');
  const box = await page.locator('canvas').boundingBox();
  await page.mouse.click(box.x + (600 * box.width) / 1200, box.y + (187 * box.height) / 740);
  assert.equal(await page.evaluate(() => window.buildingPOC.site.at(1, 1)?.asset), 'stations-farm');
  await page.locator('#save').click();
  await page.locator('#reset').click();
  await page.locator('#load').click();
  assert.equal(await page.evaluate(() => window.buildingPOC.site.at(1, 1)?.asset), 'stations-farm');
  await page.uncheck('#art');
  await page.check('#art');
  assert.deepEqual(errors, []);
  writeFileSync(
    `${root}/sprites/library-verification.json`,
    JSON.stringify(
      {
        buildings: m.buildings.length,
        facings: m.buildings.length * 4,
        errors,
        checks,
        placementAndPersistence: true,
        visualProjectionCertified: false,
      },
      null,
      2,
    ),
  );
  console.log({ buildings: m.buildings.length, facings: m.buildings.length * 4, errors });
} finally {
  await browser.close();
}
