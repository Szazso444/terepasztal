// Close-up animations that follow single trains through the showcase loop.
import { launch, baseURL } from '../runtime.mjs';
import { mkdirSync } from 'node:fs';
const out = 'scratchpad/curve-sizes/follow';
mkdirSync(out, { recursive: true });
const browser = await launch();
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${baseURL('after')}/scratchpad/curve-sizes/yard/`);
  await page.waitForFunction(() => typeof window.qa?.follow === 'function', null, { timeout: 180000 });
  // all trains advance together; each clip films one of them
  const clips = [
    ['f7', 1, 64, 9],
    ['john_bull', 2, 64, 9],
    ['class08', 3, 64, 9],
    ['black_five', 0, 110, 9],
  ];
  // films are taken one after another from the same start: reload between them
  for (const [name, k, frames, ticks] of clips) {
    await page.reload();
    await page.waitForFunction(() => typeof window.qa?.follow === 'function', null, { timeout: 180000 });
    for (let f = 0; f < frames; f++) {
      await page.evaluate(([k, t]) => (qa.step(t), qa.follow(k, 2.2)), [k, ticks]);
      await page.screenshot({ path: `${out}/${name}-${String(f).padStart(3, '0')}.png`, clip: { x: 320, y: 250, width: 800, height: 520 } });
    }
  }
} finally {
  await browser.close();
  console.log(errors.length ? errors.slice(0, 3) : 'no errors');
}
