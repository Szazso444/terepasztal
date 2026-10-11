// Scratch: close views of the hump and the two-level step (heights-scene.js, humpAndJump), and of
// the one-level end of a raised bridge on flat land.
import { launch } from '../runtime.mjs';
const out = 'scratchpad/bridges/renders/';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://127.0.0.1:5183/scratchpad/bridges/heights.html');
await page.waitForFunction(() => typeof window.qa?.view === 'function', null, { timeout: 240000 });
console.log(JSON.stringify(await page.evaluate(() => qa.scenes.humpAndJump())));
for (const [name, x, y, zoom] of [
  ['hump', 34, 92, 4],
  ['jump', 44.5, 92, 4],
]) {
  await page.evaluate(([x, y, z]) => qa.view(x, y, z), [x, y, zoom]);
  await page.screenshot({ path: `${out}heights-${name}.png`, clip: { x: 220, y: 150, width: 1000, height: 700 } });
}
console.log(JSON.stringify(await page.evaluate(() => qa.scenes.rampOnLand())));
await page.evaluate(() => qa.view(32, 60, 4));
await page.screenshot({ path: `${out}heights-rampEnd.png`, clip: { x: 220, y: 150, width: 1000, height: 700 } });
if (errors.length) console.log('PAGE ERRORS', errors);
await browser.close();
