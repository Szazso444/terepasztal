// Scratch (resumed run): shed hiding, a long part sorted in slices, and a busy field's object counts.
//   cd C:/Users/Zso/terepasztal-ladder && node scratchpad/3d-proto-integration/more.mjs
import { launch } from '../runtime.mjs';
import { writeFileSync } from 'node:fs';
const out = 'scratchpad/3d-proto-integration/out';
const BASE = 'http://127.0.0.1:5177/scratchpad/3d-proto-integration/index.html?sprites=B&ladder=B';
const CLIP = { x: 240, y: 150, width: 800, height: 500 };
const browser = await launch();
const report = {};
async function open(q = '') {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => console.log('ERR', e.message));
  await page.goto(BASE + q);
  // other work in the repo makes Vite reload the page now and then: wait on one predicate
  await page.waitForFunction(() => typeof window.qa?.tests?.busy === 'function' && window.qa.settled(), null, { timeout: 180000, polling: 200 });
  return page;
}
// 1. hideAt
{
  const page = await open();
  await page.evaluate(() => qa.frame(3.2, 3));
  report.hide = await page.evaluate(() => {
    const e = qa.t.vehiclePoses[0].segments[0];
    const tile = Math.floor(e.x + 0.5);
    const r = qa.tests.hideTest(tile, tile);
    return { shedTile: tile, cars: r.out };
  });
  await page.screenshot({ path: `${out}/hide-engine-tile.png`, clip: CLIP });
  await page.evaluate(() => { qa.g.trainRenderer.hideAt = null; qa.draw(); });
  // 3. busy
  report.busy = {};
  for (const [n, w] of [[10, 8], [30, 8], [30, 16], [60, 8]]) report.busy[`${n}x${w}`] = await page.evaluate(([nn, ww]) => qa.tests.busy(nn, ww), [n, w]);
  await page.close();
  writeFileSync(`${out}/more.json`, JSON.stringify(report, null, 1));
}
// 2. slices under a four-tile body
{
  const page = await open('&loco=koutetsujou&wagons=');
  report.slice = {};
  for (const p of [5.4, 6.2, 7.0]) {
    await page.evaluate(([pp]) => qa.frame(pp, 2.5), [p]);
    await page.waitForFunction(() => window.qa?.settled?.(), null, { timeout: 60000, polling: 200 });
    await page.evaluate(([pp]) => qa.frame(pp, 2.5), [p]);
    const tag = String(p).replace('.', '_');
    for (const n of [1, 4, 8]) {
      report.slice[`${p}/${n}`] = await page.evaluate(([nn]) => qa.tests.sliceTest(nn), [n]);
      await page.screenshot({ path: `${out}/slice-${tag}-n${n}.png`, clip: CLIP });
    }
    await page.evaluate(() => qa.tests.sliceTest(0));
  }
  report.sliceScenery = await page.evaluate(() => qa.objects().order.filter((o) => o.who.startsWith('probe')));
  await page.close();
}
writeFileSync(`${out}/more.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
await browser.close();
