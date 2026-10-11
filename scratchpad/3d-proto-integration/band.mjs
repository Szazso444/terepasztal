// Scratch (resumed run): depth between two overlapping 3D parts: geometric (global) depth against a
// depth band per part in draw order, with the draw order as the geometry has it and swapped.
import { launch } from '../runtime.mjs';
import { writeFileSync } from 'node:fs';
const out = 'scratchpad/3d-proto-integration/out';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log('ERR', e.message));
await page.goto('http://127.0.0.1:5177/scratchpad/3d-proto-integration/index.html?sprites=B&ladder=B');
await page.waitForFunction(() => typeof window.qa?.tests?.busy === 'function' && window.qa.settled(), null, { timeout: 180000, polling: 200 });
await page.evaluate(() => qa.frame(3.2, 3));
const report = {};
for (const mode of ['global', 'band']) for (const swap of [false, true]) {
  report[`${mode}${swap ? '-swapped' : ''}`] = await page.evaluate(([m, s]) => qa.tests.twinTest(m, s), [mode, swap]);
  await page.screenshot({ path: `${out}/band-${mode}${swap ? '-swapped' : ''}.png`, clip: { x: 640, y: 250, width: 400, height: 300 } });
}
console.log(JSON.stringify(report));
writeFileSync(`${out}/band.json`, JSON.stringify(report, null, 1));
await browser.close();
