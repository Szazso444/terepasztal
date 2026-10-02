// Scratch: two stills (climbing, descending) to confirm the pitch after a rebase.
import { launch } from '../runtime.mjs';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://127.0.0.1:5182/scratchpad/slope-pitch/');
await page.waitForFunction(() => typeof window.qa?.start === 'function', null, { timeout: 180000 });
await page.waitForFunction(() => qa.settled(), null, { timeout: 180000, polling: 200 });
for (const [line, dir] of [['x', 1], ['y', 1]]) {
  await page.evaluate(([l, d]) => qa.start(l, d, 1), [line, dir]);
  for (const [label, p] of [['up', 7.2], ['down', 17.2]]) {
    const r = await page.evaluate(([p]) => qa.frame(p, 3, true), [p]);
    await page.screenshot({ path: `scratchpad/slope-pitch/frames/quick-${line}-${label}.png`, clip: { x: 320, y: 250, width: 800, height: 500 } });
    console.log(line, label, JSON.stringify(r));
  }
}
await browser.close();
console.log(errors.length ? errors : 'no errors');
