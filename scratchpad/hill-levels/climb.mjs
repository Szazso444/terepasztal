// Captures trains of three sizes on a real climb at 1/4 and 1/8 levels, and the preview looks.
// PLAYWRIGHT and CHROME override the cloud-container defaults.
const { chromium } = await import(
  process.env.PLAYWRIGHT ??
    '/tmp/claude-0/-home-user-terepasztal/5d15a916-29ff-5ce3-8d79-4b98fa4fa891/scratchpad/pw/node_modules/playwright-core/index.mjs'
);
import fs from 'node:fs';
const out = 'scratchpad/hill-levels/renders/';
const SIDE = (32 * Math.SQRT2 * Math.sqrt(3)) / 2;
const BASE = { maxRise: 1, faces: true, shape: 'terraces', bank: 0.5, rims: true };
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors = [];
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
page.on('pageerror', (e) => errors.push(e.message));
const settle = () =>
  page.evaluate(async () => {
    const g = worldReview.g,
      l = g.world.landscape;
    g.world.animate(0);
    while (!l.ready) {
      await new Promise((r) => setTimeout(r, 50));
      g.world.animate(0);
    }
  });
const style = async (s) => {
  await page.evaluate((s) => hillOptions.reliefStyle(worldReview.g, s), s);
  await settle();
};
const shot = async (name, view) => {
  await page.evaluate((v) => worldReview.render(v), view);
  await page.screenshot({ path: `${out}${name}.jpg`, type: 'jpeg', quality: 90 });
  console.log('CAPTURED', name);
};
try {
  await page.goto('http://127.0.0.1:5190/scratchpad/terrain-production/');
  await page.waitForFunction(() => typeof window.worldReview?.render === 'function', null, { timeout: 180000 });
  await page.evaluate(async () => {
    window.hillOptions = await import('/scratchpad/hill-levels/options.js');
    window.climb = await import('/scratchpad/hill-levels/climb.js');
  });
  const hills = await page.evaluate(() => worldReview.views.find((v) => v.id === '10-connected-hills'));
  if (!process.env.SKIP_LOOKS) {
    const LOOKS = [
      ['every-bank-rock', { everyBankRock: true }],
      ['stacked-rock', {}],
      ['shadows', { shadows: true }],
      ['all', { shadows: true, heightLight: 0.04, snow: true }],
    ];
    for (const [name, extra] of LOOKS) {
      await style({ ...BASE, step: SIDE / 4, ...extra });
      for (const zoom of [1, 2]) await shot(`look-z${zoom}-${name}`, { ...hills, zoom });
    }
  }
  const run = await page.evaluate(() => climb.lay(worldReview.g));
  console.log('RUN', JSON.stringify(run));
  fs.writeFileSync(out + 'climb.json', JSON.stringify(run, null, 2));
  for (const [label, step] of [['quarter', SIDE / 4], ['eighth', SIDE / 8]]) {
    await style({ ...BASE, step });
    for (const size of [null, 'small', 'medium', 'large']) {
      const head = await page.evaluate(([run, size]) => climb.place(worldReview.g, run, size), [run, size]);
      const x = size ? head - 3 : run.x0 + run.len / 2;
      for (const zoom of size ? [3] : [2, 3])
        await shot(`train-${label}-${size ?? 'empty'}-z${zoom}`, { id: 'climb', title: 'climb', x, y: run.y, zoom });
    }
  }
} finally {
  await browser.close();
}
if (errors.length) throw new Error(errors.join('\n'));
