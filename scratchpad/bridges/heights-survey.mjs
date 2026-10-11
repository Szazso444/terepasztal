// Scratch: renders for the bridge deck height survey (see heights-scene.js).
//   cd C:/Users/Zso/terepasztal-bridges && node scratchpad/bridges/heights-survey.mjs [scene ...]
import { launch } from '../runtime.mjs';
import fs from 'node:fs';
const out = 'scratchpad/bridges/renders/';
fs.mkdirSync(out, { recursive: true });
const wanted = process.argv.slice(2);
const SCENES = [
  ['riverInHills'],
  ['landBridgeReload', 'landBridgeReloadApply'],
  ['rampOnLand'],
  ['raisedOverWater'],
  ['humpAndJump'],
];
const browser = await launch();
for (const group of SCENES) {
  if (wanted.length && !group.some((s) => wanted.includes(s))) continue;
  // One page per group: every group starts from the untouched empty map.
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:5183/scratchpad/bridges/heights.html');
  await page.waitForFunction(() => typeof window.qa?.view === 'function', null, { timeout: 240000 });
  for (const name of group) {
    const info = await page.evaluate((n) => qa.scenes[n](), name);
    await page.evaluate(() => qa.settle());
    await page.screenshot({ path: `${out}heights-${name}.png`, clip: { x: 220, y: 150, width: 1000, height: 700 } });
    console.log(name, JSON.stringify(info));
  }
  if (errors.length) console.log('PAGE ERRORS', errors);
  await page.close();
}
await browser.close();
