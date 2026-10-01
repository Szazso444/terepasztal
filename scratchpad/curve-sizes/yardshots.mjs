// Track showcase renders: the catalogue, a close-up of every piece, and trains on the loop.
//   BASE_URL=http://127.0.0.1:5175 node scratchpad/curve-sizes/yardshots.mjs
import { launch, baseURL } from '../runtime.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const out = process.env.OUT ?? 'scratchpad/curve-sizes/yardshots';
mkdirSync(out, { recursive: true });
const browser = await launch();
const report = { errors: [], cells: [], states: [] };
try {
  const page = await browser.newPage({ viewport: { width: 2000, height: 1300 } });
  page.on('pageerror', (e) => report.errors.push(e.message));
  await page.goto(`${baseURL('after')}/scratchpad/curve-sizes/yard/`);
  await page.waitForFunction(() => typeof window.qa?.shoot === 'function', null, { timeout: 180000 });
  await page.evaluate(() => qa.catalogue());
  await page.screenshot({ path: `${out}/catalogue.png` });
  const cells = await page.evaluate(() => qa.cells);
  for (let i = 0; i < cells.length; i++) {
    await page.evaluate((i) => qa.shoot(i), i);
    await page.screenshot({ path: `${out}/cell-${i}.png`, clip: { x: 1000 - 260, y: 650 - 190, width: 520, height: 380 } });
    report.cells.push(cells[i]);
  }
  // trains: 72 frames of the whole loop, 0.2 s apart
  for (let f = 0; f < 72; f++) {
    await page.evaluate(() => (qa.step(12), qa.loop(0.8)));
    await page.screenshot({ path: `${out}/loop-${String(f).padStart(2, '0')}.png`, clip: { x: 200, y: 130, width: 1600, height: 1040 } });
    if (f % 12 === 0) report.states.push(await page.evaluate(() => qa.states()));
  }
  report.marks = await page.evaluate(() => qa.marks);
} finally {
  await browser.close();
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 1));
  console.log(report.errors.length ? report.errors.slice(0, 5) : 'no errors', report.cells.length, 'cells');
}
