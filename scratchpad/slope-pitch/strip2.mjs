// Scratch: one engine through the foot, the slope and the top of a climb, then down the far side.
//   node scratchpad/slope-pitch/strip2.mjs <port> <consist> <line> <out.png>
import { launch } from '../runtime.mjs';
import { PNG } from 'pngjs';
import { writeFileSync } from 'node:fs';
const [port, consist, line, out] = process.argv.slice(2);
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto(`http://127.0.0.1:${port}/scratchpad/slope-pitch/`);
await page.waitForFunction(() => typeof window.qa?.start === 'function', null, { timeout: 180000 });
await page.waitForFunction(() => qa.settled(), null, { timeout: 180000, polling: 200 });
await page.evaluate(([l, c]) => qa.start(l, 1, c), [line, Number(consist)]);
const W = 520, H = 340, shots = [];
for (const p of [4.6, 5.4, 6.2, 7.0, 7.8, 8.6, 12.6, 13.4, 14.2, 15.0, 15.8, 16.6]) {
  await page.evaluate(([p]) => qa.frame(p, 3, 'engine'), [p]);
  await page.waitForFunction(() => { qa.g.render(1, 0); return qa.g.world.landscape.sharpReady || qa.g.world.landscape.failed; }, null, { timeout: 60000, polling: 100 });
  await page.evaluate(() => qa.g.app.renderer.render(qa.g.app.stage));
  shots.push(PNG.sync.read(await page.screenshot({ clip: { x: 720 - W / 2, y: 500 - H / 2 - 20, width: W, height: H } })));
}
const cols = 6, rows = Math.ceil(shots.length / cols);
const sheet = new PNG({ width: cols * W, height: rows * H });
shots.forEach((s, i) => PNG.bitblt(s, sheet, 0, 0, W, H, (i % cols) * W, Math.floor(i / cols) * H));
writeFileSync(out, PNG.sync.write(sheet));
await browser.close();
