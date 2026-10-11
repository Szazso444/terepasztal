// Spike renders: every locomotive at its proposed length, on the straight and mid-curve.
//   BASE_URL=http://127.0.0.1:5175 node scratchpad/curve-sizes/models.mjs
import { launch, baseURL } from '../runtime.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const out = 'scratchpad/curve-sizes/models';
mkdirSync(out, { recursive: true });
const browser = await launch();
const report = { errors: [], shots: [] };
try {
  for (const cls of ['regular', 'high_speed']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('pageerror', (e) => report.errors.push(`${cls}: ${e.message}`));
    await page.goto(`${baseURL('after')}/scratchpad/curve-sizes/?cls=${cls}`);
    await page.waitForFunction(() => typeof window.qa?.show === 'function', null, { timeout: 180000 });
    if (!process.env.ONLY || process.env.OVERVIEW) await page.evaluate(() => qa.overview(0.7));
    if (!process.env.ONLY || process.env.OVERVIEW) await page.screenshot({ path: `${out}/${cls}-overview.png` });
    const ids = await page.evaluate(() => qa.ids);
    const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
    for (let i = 0; i < ids.length; i++) {
      if (only && !only.includes(ids[i])) continue;
      for (const what of ['straight', 'loco', 'train']) {
        const r = await page.evaluate(([i, w]) => qa.show(i, w, w === 'train' ? 1.7 : 2.6), [i, what]);
        const file = `${ids[i]}-${what}.png`;
        const clip = what === 'train' ? { x: 250, y: 190, width: 940, height: 620 } : { x: 370, y: 260, width: 700, height: 470 };
        await page.screenshot({ path: `${out}/${file}`, clip });
        report.shots.push({ cls, id: ids[i], what, file, progress: r.progress, state: r.state, lengths: r.lengths });
      }
      }
    await page.close();
  }
} finally {
  await browser.close();
  writeFileSync(`${out}/report${process.env.ONLY ? '-only' : ''}.json`, JSON.stringify(report, null, 1));
  console.log(report.errors.length ? report.errors.slice(0, 5) : 'no errors', report.shots.length, 'shots');
}
