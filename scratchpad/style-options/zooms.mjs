// Captures current / both sharp / both smooth at every game zoom step, full frame at 1440×900.
// Run `node scratchpad/style-options/smooth-sheet.mjs` first. PLAYWRIGHT and CHROME override the
// cloud-container defaults.
const { chromium } = await import(
  process.env.PLAYWRIGHT ??
    '/tmp/claude-0/-home-user-terepasztal/5d15a916-29ff-5ce3-8d79-4b98fa4fa891/scratchpad/pw/node_modules/playwright-core/index.mjs'
);
import fs from 'node:fs';
const out = 'scratchpad/style-options/zooms/';
fs.mkdirSync(out, { recursive: true });
const ZOOMS = [0.5, 0.75, 1, 1.5, 2, 3, 4];
const SCENES = ['03-town-station', '10-connected-hills'];
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors = [];
async function open(smoothGround) {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  if (smoothGround)
    await page.route('**/assets/terrain-surfaces.png', (route) =>
      route.fulfill({ path: 'scratchpad/style-options/terrain-surfaces-smooth.png', contentType: 'image/png' }),
    );
  await page.goto('http://127.0.0.1:5190/scratchpad/terrain-production/');
  await page.waitForFunction(() => typeof window.worldReview?.render === 'function', null, { timeout: 180000 });
  await page.evaluate(() => import('/scratchpad/style-options/options.js').then((m) => (window.styleOptions = m)));
  return page;
}
async function capture(page, variant, apply) {
  for (const id of SCENES)
    for (const zoom of ZOOMS) {
      await page.evaluate(
        async ([id, zoom, apply]) => {
          const g = worldReview.g;
          await worldReview.render({ ...worldReview.views.find((v) => v.id === id), zoom });
          if (apply) styleOptions[apply](g);
          g.app.renderer.render(g.app.stage);
        },
        [id, zoom, apply],
      );
      await page.screenshot({ path: `${out}${id}-z${zoom}-${variant}.jpg`, type: 'jpeg', quality: 90 });
      console.log('CAPTURED', id, zoom, variant);
    }
}
try {
  const page = await open(false);
  await capture(page, 'a-current', '');
  await capture(page, 'b-sharp', 'sharp');
  await capture(await open(true), 'c-smooth', 'smooth');
} finally {
  await browser.close();
}
if (errors.length) throw new Error(errors.join('\n'));
