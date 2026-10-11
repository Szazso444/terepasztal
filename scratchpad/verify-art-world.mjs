import { launch } from './runtime.mjs';
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const browser = await launch();
try {
  const page = await browser.newPage({ viewport: { width: 1460, height: 1100 } }),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:5173/scratchpad/art-world/index.html');
  await page.waitForFunction(() => window.artWorldReady);
  for (const mode of ['village', 'industry', 'terrain']) {
    await page.selectOption('#mode', mode);
    await page.waitForTimeout(300);
    await page.locator('#scene').screenshot({ path: `scratchpad/art-world/${mode}.png` });
  }
  await page.selectOption('#mode', 'village');
  const lots = await page.evaluate(() => window.artWorldLots);
  assert.ok(lots.some((l) => l.material === 'stone'));
  assert.ok(lots.some((l) => l.material === 'dirt'));
  assert.ok(lots.some((l) => l.material === 'gravel'));
  assert.ok(lots.every((l) => l.scale > 0 && l.footprint.every((v) => v >= 2)));
  await page.uncheck('#yards');
  await page.uncheck('#people');
  await page.check('#yards');
  await page.check('#people');
  await page.uncheck('#width');
  await page.check('#grid');
  await page.waitForFunction(() =>
    [...document.querySelectorAll('article img')].every((i) => i.complete && i.naturalWidth > 0),
  );
  const result = { errors, catalogSources: await page.locator('article').count(), scenes: 3 };
  writeFileSync('scratchpad/art-world/verification.json', JSON.stringify(result, null, 2));
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log(result);
} finally {
  await browser.close();
}
