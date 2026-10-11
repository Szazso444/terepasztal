import { launch } from '../../runtime.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const label = process.argv[2];
if (!['before', 'after', 'painted', 'corrected', 'handbuilt'].includes(label)) throw new Error('Pass before, after, painted or corrected');
const out = `scratchpad/models/handover-review/c50-fix/${label}`;
mkdirSync(out, { recursive: true });
const browser = await launch();
const errors = [], records = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:5182/scratchpad/models/?rows=');
  await page.waitForFunction(() => typeof window.qa?.start === 'function', null, { timeout: 240000 });
  await page.evaluate(async () => {
    const { L } = qa.start('c50', [], 0);
    qa.start('c50', [], 17.2 + L / 2);
    qa.roll(0, 7);
    await qa.settle();
  });
  await page.mouse.move(5, 995);
  for (let i = 0; i < 24; i++) {
    records.push(await page.evaluate(() => qa.roll(8, 7)));
    for (const rear of [false, true]) {
      await page.evaluate(rear => {
        qa.g.fleet.trains[0].reversed = rear;
        qa.roll(0, 7);
      }, rear);
      await page.screenshot({ clip: { x: 360, y: 210, width: 720, height: 480 },
        path: `${out}/${rear ? 'rear' : 'front'}-${String(i).padStart(2, '0')}.png` });
    }
    await page.evaluate(() => { qa.g.fleet.trains[0].reversed = false; });
  }
} finally { await browser.close(); }
writeFileSync(`${out}/report.json`, JSON.stringify({ errors, records }, null, 2));
if (errors.length) throw new Error(JSON.stringify(errors));
console.log(`Captured ${label}: 24 matched poses, front and rear orientations`);
