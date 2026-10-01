// Spike renders, part two: each consist running through the curve frame by frame, and its
// locomotive mid-curve close up, on the 2x2 regular and the 3x3 high-speed loop.
//   BASE_URL=http://127.0.0.1:5175 node scratchpad/curve-sizes/animate.mjs
import { launch, baseURL } from '../runtime.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const out = 'scratchpad/curve-sizes/frames';
mkdirSync(out, { recursive: true });
const FRAMES = 30;
const browser = await launch();
const report = { errors: [], consists: [] };
try {
  for (const cls of ['regular', 'high_speed']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('pageerror', (e) => report.errors.push(`${cls}: ${e.message}`));
    await page.goto(`${baseURL('after')}/scratchpad/curve-sizes/?cls=${cls}`);
    await page.waitForFunction(() => typeof window.qa?.prepare === 'function', null, {
      timeout: 120000,
    });
    const count = await page.evaluate(() => qa.consists.length);
    for (let i = 0; i < count; i++) {
      // close-up still: the locomotive in the middle of the curve
      await page.evaluate((i) => qa.show(i, 'loco', 2.6), i);
      await page.screenshot({
        path: `${out}/${cls}-${i + 1}-still.png`,
        clip: { x: 270, y: 230, width: 900, height: 600 },
      });
      const info = await page.evaluate((i) => qa.prepare(i), i);
      const from = info.curve.start - 1.5;
      const to = info.curve.end + info.lengths.train + 1;
      for (let f = 0; f < FRAMES; f++) {
        const arc = from + ((to - from) * f) / (FRAMES - 1);
        await page.evaluate(([a, txt]) => qa.runTo(a, 1.5, txt), [arc, '']);
        await page.screenshot({
          path: `${out}/${cls}-${i + 1}-${String(f).padStart(2, '0')}.png`,
          clip: { x: 240, y: 200, width: 960, height: 640 },
        });
      }
      if (cls === 'regular') report.consists.push({ i, ...info });
    }
    await page.close();
  }
} finally {
  await browser.close();
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 1));
  console.log(report.errors.length ? report.errors : 'no errors', report.consists.length, 'consists');
}
