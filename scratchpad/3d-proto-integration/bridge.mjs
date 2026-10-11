// Scratch: screenshots and z order of a train on a bridge.  node scratchpad/3d-proto-integration/bridge.mjs
import { launch } from '../runtime.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const out = 'scratchpad/3d-proto-integration/out';
mkdirSync(out, { recursive: true });
const browser = await launch();
const report = {};
for (const axis of ['x', 'y']) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:5177/scratchpad/3d-proto-integration/bridge.html?sprites=B&ladder=B&axis=${axis}`);
  await page.waitForFunction(() => typeof window.qa?.frame === 'function', null, { timeout: 180000 });
  await page.waitForFunction(() => qa.settled(), null, { timeout: 180000, polling: 200 });
  report[axis] = { errors, levels: await page.evaluate(() => qa.levels), bridgeKit: await page.evaluate(() => !!qa.bridgeKit), frames: {} };
  for (const p of [3.2, 3.7, 4.2, 4.7, 5.2]) {
    const r = await page.evaluate(([pp]) => qa.frame(pp, 3), [p]);
    await page.waitForFunction(() => qa.settled(), null, { timeout: 60000, polling: 200 });
    await page.evaluate(([pp]) => qa.frame(pp, 3), [p]);
    await page.screenshot({ path: `${out}/bridge-${axis}-${String(p).replace('.', '_')}.png`, clip: { x: 240, y: 150, width: 800, height: 500 } });
    report[axis].frames[p] = { ...r, order: await page.evaluate(() => qa.order()) };
  }
  await page.close();
}
writeFileSync(`${out}/bridge.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
await browser.close();
