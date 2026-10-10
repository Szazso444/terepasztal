import { launch } from './runtime.mjs';
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const browser = await launch();
try {
  const page = await browser.newPage({ viewport: { width: 1560, height: 1000 } }),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:5173/scratchpad/yard-study/index.html');
  await page.waitForFunction(() => window.yardStudyReady);
  await page.locator('.pair').screenshot({ path: 'scratchpad/yard-study/comparison.png' });
  await page.check('#grid');
  await page.uncheck('#building');
  await page.locator('.pair').screenshot({ path: 'scratchpad/yard-study/bases-grid.png' });
  await page.uncheck('#people');
  await page.check('#building');
  const dimensions = await page
    .locator('canvas')
    .evaluateAll((cs) => cs.map((c) => [c.width, c.height]));
  assert.deepEqual(dimensions, [
    [760, 620],
    [760, 620],
  ]);
  assert.equal(errors.length, 0);
  writeFileSync(
    'scratchpad/yard-study/verification.json',
    JSON.stringify({ errors, dimensions, togglesChecked: true }, null, 2),
  );
  console.log({ errors, dimensions });
} finally {
  await browser.close();
}
