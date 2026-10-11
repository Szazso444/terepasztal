// Scratch: a four-tile body (one depth key at its centre) passing a building that stands in front of the line.
import { launch } from '../runtime.mjs';
import { writeFileSync } from 'node:fs';
const out = 'scratchpad/3d-proto-integration/out';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://127.0.0.1:5177/scratchpad/3d-proto-integration/index.html?sprites=B&ladder=B&loco=koutetsujou&wagons=');
await page.waitForFunction(() => typeof window.qa?.frame === 'function', null, { timeout: 180000 });
await page.waitForFunction(() => qa.settled(), null, { timeout: 180000, polling: 200 });
const report = { errors, frames: {} };
for (const p of [4.6, 5.4, 6.2]) {
  await page.evaluate(([pp]) => qa.frame(pp, 2.5), [p]);
  await page.waitForFunction(() => qa.settled(), null, { timeout: 60000, polling: 200 });
  await page.evaluate(([pp]) => qa.frame(pp, 2.5), [p]);
  await page.screenshot({ path: `${out}/longbody-${String(p).replace('.', '_')}.png`, clip: { x: 240, y: 150, width: 800, height: 500 } });
  report.frames[p] = await page.evaluate(() => ({ order: qa.objects().order, seg: qa.dump().vehicles[0].segments.map((s) => ({ part: s.part, L: s.pose.L, x: s.pose.x, z: s.sprite.zIndex, logical: s.sprite.logical })) }));
}
writeFileSync(`${out}/longbody.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
await browser.close();
