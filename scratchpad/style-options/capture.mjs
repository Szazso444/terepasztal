// Captures the style options in the actual game renderer. Paths are for the cloud container; set
// PLAYWRIGHT and CHROME to run elsewhere.
import { chromium } from '/tmp/claude-0/-home-user-terepasztal/5d15a916-29ff-5ce3-8d79-4b98fa4fa891/scratchpad/pw/node_modules/playwright-core/index.mjs';
const out = 'scratchpad/style-options/renders/';
const browser = await chromium.launch({
  headless: true,
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors = [];
try {
  const page = await (await browser.newContext({ viewport: { width: 1920, height: 1200 } })).newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:5190/scratchpad/terrain-production/');
  await page.waitForFunction(() => typeof window.worldReview?.render === 'function', null, { timeout: 180000 });
  await page.evaluate(() => import('/scratchpad/style-options/options.js').then((m) => (window.styleOptions = m)));
  const views = await page.evaluate(() => {
    const v = worldReview.views;
    return ['03-town-station', '04-industry', '05-farm-halt'].map((id) => ({ ...v.find((x) => x.id === id), zoom: 3 }));
  });
  for (const [variant, apply] of [
    ['a-current', ''],
    ['b-blend', 'blend'],
    ['c-blend-pixel', 'pixelMatch'],
  ]) {
    if (apply === 'blend') await page.evaluate(() => styleOptions.blend(worldReview.g));
    for (const view of views) {
      await page.evaluate(async (v) => {
        await worldReview.render(v);
        if (window.pixelMode) styleOptions.pixelMatch(worldReview.g);
        worldReview.g.app.renderer.render(worldReview.g.app.stage);
      }, view);
      if (apply === 'pixelMatch' && !(await page.evaluate(() => window.pixelMode))) {
        await page.evaluate(() => {
          window.pixelMode = true;
          styleOptions.pixelMatch(worldReview.g);
          worldReview.g.app.renderer.render(worldReview.g.app.stage);
        });
      }
      await page.screenshot({ path: out + view.id + '-' + variant + '.png', clip: { x: 360, y: 225, width: 1200, height: 750 } });
      console.log('CAPTURED', view.id, variant);
    }
  }
} finally {
  await browser.close();
}
if (errors.length) throw new Error(errors.join('\n'));
