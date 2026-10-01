import { launch, baseURL } from '../runtime.mjs';
const browser = await launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  await page.goto(`${baseURL('after')}/scratchpad/rails/yard/`);
  await page.waitForFunction(() => typeof window.qa?.shoot === 'function', null, { timeout: 240000 });
  const cells = await page.evaluate(() => qa.cells);
  const pick = (k) => cells.findIndex((c) => c.key === k);
  for (const k of ['crossing_narrow_regular r0', 'curve_narrow r1', 'switch_narrow r1', 'straight_regular r1']) {
    await page.evaluate((i) => qa.shoot(i, 6), pick(k));
    await page.screenshot({ path: `scratchpad/rails/out/zoom-${k.replace(/ /g, '_')}.png`, clip: { x: 350, y: 250, width: 500, height: 300 } });
  }
} finally { await browser.close(); }
