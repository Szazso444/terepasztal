// Rendered rolling stock on a real climb in the generated review world, new against current.
//   node scratchpad/train-models/hills.mjs rocket:wooden_coach flying_scotsman:steel_coach sd40:boxcar
// Writes scratchpad/train-models/renders/hills/<locos>-z<zoom>-{new,current}.png and hills.json.
import { launch, baseURL } from '../runtime.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

// --high-speed lays the climb in high-speed track (large stock may use nothing else)
const cls = process.argv.includes('--high-speed') ? 'high_speed' : 'regular';
const consists = process.argv
  .slice(2)
  .filter((a) => !a.startsWith('--'))
  .map((a) => a.split(':').map((s) => s.split('+')));
const out = 'scratchpad/train-models/renders/hills';
mkdirSync(out, { recursive: true });
const browser = await launch();
const errors = [];
const report = [];
try {
  const page = await (
    await browser.newContext({ viewport: { width: 1440, height: 900 } })
  ).newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${baseURL('after')}/scratchpad/terrain-production/`);
  await page.waitForFunction(() => typeof window.worldReview?.render === 'function', null, {
    timeout: 240000,
  });
  const supplied = await page.evaluate(async () => {
    const m = await import('/scratchpad/train-models/hills.js');
    window.hills = m;
    return m.loadSupplied(worldReview.g);
  });
  for (const [locos, wagons = []] of consists) {
    const run = await page.evaluate(
      ([l, w, c]) => {
        const r = hills.standOnClimb(worldReview.g, l, w, c);
        worldReview.g.world.animate(0);
        return r;
      },
      [locos, wagons, cls],
    );
    for (const zoom of [2, 4]) {
      for (const which of ['new', 'current']) {
        await page.evaluate(
          async ([on, r, z]) => {
            hills.useNew(worldReview.g, on);
            await worldReview.render({ id: 'climb', title: 'climb', x: r.x, y: r.y, zoom: z });
          },
          [which === 'new', run, zoom],
        );
        await page.screenshot({
          path: `${out}/${locos.join('+')}-z${zoom}-${which}.png`,
          clip: { x: 320, y: 170, width: 800, height: 500 },
        });
      }
    }
    report.push({ locos, wagons, run });
  }
  writeFileSync(`${out}/hills.json`, JSON.stringify({ supplied, report, errors }, null, 2));
} finally {
  await browser.close();
}
console.log(JSON.stringify({ consists: report.length, errors: errors.length }));
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
}
