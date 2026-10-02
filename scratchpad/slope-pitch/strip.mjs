// Scratch: a strip of close-ups through the foot and the top of a climb.
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
const W = 420, H = 300, shots = [];
for (let p = 4.5; p <= 9.01; p += 0.5) {
  await page.evaluate(([p]) => qa.frame(p, 4, true), [p]);
  shots.push(PNG.sync.read(await page.screenshot({ clip: { x: 720 - W / 2, y: 500 - H / 2, width: W, height: H } })));
}
const cols = 5, rows = Math.ceil(shots.length / cols);
const sheet = new PNG({ width: cols * W, height: rows * H });
shots.forEach((s, i) => PNG.bitblt(s, sheet, 0, 0, W, H, (i % cols) * W, Math.floor(i / cols) * H));
writeFileSync(out, PNG.sync.write(sheet));
await browser.close();
