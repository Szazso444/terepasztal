// Close-ups of chosen pieces at a high zoom, for comparing two versions of the track art.
//   TAG=a KEYS="switch_regular r1 S;curve_narrow r1" ZOOM=5 node scratchpad/rails/closeups.mjs
import { launch, baseURL } from '../runtime.mjs';
import { mkdirSync } from 'node:fs';
const tag = process.env.TAG ?? 'a';
const zoom = Number(process.env.ZOOM ?? 5);
const keys = (process.env.KEYS ?? '').split(';').filter(Boolean);
const out = 'scratchpad/rails/out/r2';
mkdirSync(out, { recursive: true });
const browser = await launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  page.on('pageerror', (e) => console.log('ERR', e.message));
  await page.goto(`${baseURL('after')}/scratchpad/rails/yard/`);
  await page.waitForFunction(() => typeof window.qa?.shoot === 'function', null, {
    timeout: 240000,
  });
  const cells = await page.evaluate(() => qa.cells);
  await page.evaluate(() => qa.shoot(1, 5));
  await page.waitForTimeout(2500);
  for (const k of keys) {
    const i = cells.findIndex((c) => c.key === k);
    if (i < 0) {
      console.log('no cell', k);
      continue;
    }
    await page.evaluate(([i, z]) => qa.shoot(i, z), [i, zoom]);
    await page.waitForTimeout(250);
    await page.screenshot({
      path: `${out}/${tag}-${k.replace(/ /g, '_')}.png`,
      clip: { x: 200, y: 130, width: 800, height: 540 },
    });
  }
  // the snap demo with its parallel straight laid, so the S lane is seen joining a real track
  if (process.env.AREAS) await page.evaluate(() => qa.snap('on'));
  for (const a of (process.env.AREAS ?? '').split(';').filter(Boolean)) {
    const [name, z] = a.split('@');
    await page.evaluate(([n, z]) => qa.area(n, z), [name, Number(z ?? 2.4)]);
    await page.waitForTimeout(250);
    await page.screenshot({
      path: `${out}/${tag}-area-${name}.png`,
      clip: { x: 200, y: 130, width: 800, height: 540 },
    });
  }
  console.log('shot', tag, keys.length);
} finally {
  await browser.close();
}
