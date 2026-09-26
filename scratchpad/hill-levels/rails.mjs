// Captures a train on real track climbing a hill, with the shipped 1/4-side relief.
// PLAYWRIGHT and CHROME override the cloud-container defaults.
const { chromium } = await import(
  process.env.PLAYWRIGHT ??
    '/tmp/claude-0/-home-user-terepasztal/5d15a916-29ff-5ce3-8d79-4b98fa4fa891/scratchpad/pw/node_modules/playwright-core/index.mjs'
);
import fs from 'node:fs';
const out = 'scratchpad/hill-levels/renders/';
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors = [];
try {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:5190/scratchpad/terrain-production/');
  await page.waitForFunction(() => typeof window.worldReview?.render === 'function', null, { timeout: 180000 });
  const run = await page.evaluate(async () => {
    const m = await import('/scratchpad/hill-levels/rails.js'),
      g = worldReview.g,
      l = g.world.landscape;
    const run = m.climb(g);
    g.world.animate(0);
    while (!l.ready) {
      await new Promise((r) => setTimeout(r, 50));
      g.world.animate(0);
    }
    return run;
  });
  console.log('RUN', JSON.stringify(run));
  for (const zoom of [1, 2, 3]) {
    await page.evaluate(
      async ([run, zoom]) =>
        worldReview.render({ id: 'climb', title: 'climb', x: run.x0 + run.len / 2, y: run.y, zoom }),
      [run, zoom],
    );
    await page.screenshot({ path: `${out}rails-climb-z${zoom}.jpg`, type: 'jpeg', quality: 90 });
    console.log('CAPTURED', zoom);
  }
  fs.writeFileSync(out + 'rails-climb.json', JSON.stringify(run, null, 2));
} finally {
  await browser.close();
}
if (errors.length) throw new Error(errors.join('\n'));
