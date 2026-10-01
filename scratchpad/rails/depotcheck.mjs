import { launch, baseURL } from '../runtime.mjs';
const browser = await launch();
const errs = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`${baseURL('after')}/scratchpad/rails/yard/`);
  await page.waitForFunction(() => typeof window.qa?.deployNarrow === 'function' || window.__err, null, { timeout: 240000 }).catch(() => {});
  console.log('errors', errs.slice(0, 3));
  console.log('deploy', await page.evaluate(() => qa.deployNarrow()));
  await page.evaluate(() => (qa.step(60), qa.area('depot', 2.4)));
  await page.screenshot({ path: 'scratchpad/rails/out/depot.png', clip: { x: 270, y: 200, width: 900, height: 600 } });
  await page.evaluate(() => qa.area('depotTurned', 2.4));
  await page.screenshot({ path: 'scratchpad/rails/out/depot-turned.png', clip: { x: 270, y: 200, width: 900, height: 600 } });
  for (let k = 0; k < 6; k++) await page.evaluate(() => qa.step(240));
  console.log(await page.evaluate(() => qa.states()));
  await page.evaluate(() => qa.area('narrow', 1.2));
  await page.screenshot({ path: 'scratchpad/rails/out/narrow-run.png', clip: { x: 120, y: 100, width: 1200, height: 800 } });
} finally { await browser.close(); }
