// Spike renders: every consist through a 2x2 regular and a 3x3 high-speed curve.
//   BASE_URL=http://127.0.0.1:5175 node scratchpad/curve-sizes/capture.mjs
import { launch, baseURL } from '../runtime.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const out = 'scratchpad/curve-sizes/renders';
mkdirSync(out, { recursive: true });
const browser = await launch();
const report = { errors: [], shots: [] };
try {
  for (const cls of ['regular', 'high_speed']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('pageerror', (e) => report.errors.push(`${cls}: ${e.message}`));
    await page.goto(`${baseURL('after')}/scratchpad/curve-sizes/?cls=${cls}`);
    await page.waitForFunction(() => typeof window.qa?.show === 'function', null, {
      timeout: 120000,
    });
    await page.evaluate(() => qa.overview(0.7));
    await page.screenshot({ path: `${out}/${cls}-overview.png` });
    const count = await page.evaluate(() => qa.consists.length);
    for (let i = 0; i < count; i++)
      for (const what of ['loco', 'train']) {
        const r = await page.evaluate(([i, w]) => qa.show(i, w, 1.5), [i, what]);
        const file = `${cls}-${i + 1}-${what}.png`;
        await page.screenshot({ path: `${out}/${file}`, clip: { x: 220, y: 150, width: 1000, height: 700 } });
        report.shots.push({ cls, i, what, file, ...r });
      }
    await page.close();
  }
} finally {
  await browser.close();
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 1));
  console.log(report.errors.length ? report.errors : 'no errors', report.shots.length, 'shots');
}
