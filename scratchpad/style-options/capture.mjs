// Captures the current look, "both sharp" and "both smooth" in the actual game renderer.
// Run `node scratchpad/style-options/smooth-sheet.mjs` first. PLAYWRIGHT and CHROME override the
// cloud-container defaults.
const { chromium } = await import(
  process.env.PLAYWRIGHT ??
    '/tmp/claude-0/-home-user-terepasztal/5d15a916-29ff-5ce3-8d79-4b98fa4fa891/scratchpad/pw/node_modules/playwright-core/index.mjs'
);
import fs from 'node:fs';
const out = 'scratchpad/style-options/renders/';
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors = [],
  trains = {};
async function open(smoothGround) {
  const page = await (await browser.newContext({ viewport: { width: 1920, height: 1200 } })).newPage();
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
  const views = await page.evaluate(() =>
    ['03-town-station', '05-farm-halt', '10-connected-hills'].map((id) => ({
      ...worldReview.views.find((x) => x.id === id),
      zoom: 3,
    })),
  );
  for (const view of views) {
    const train = await page.evaluate(
      async ([v, apply]) => {
        const g = worldReview.g;
        await worldReview.render(v);
        if (apply) styleOptions[apply](g);
        g.app.renderer.render(g.app.stage);
        const car = [...g.trainRenderer.cars.values()][0]?.[0]?.parts[0];
        const p = car?.getGlobalPosition();
        return p && { x: Math.round(p.x), y: Math.round(p.y) };
      },
      [view, apply],
    );
    if (view.id === '03-town-station') trains[variant] = train;
    await page.screenshot({ path: `${out}${view.id}-${variant}.png`, clip: { x: 360, y: 225, width: 1200, height: 750 } });
    console.log('CAPTURED', view.id, variant, JSON.stringify(train));
  }
}
try {
  const page = await open(false);
  await capture(page, 'a-current', '');
  await capture(page, 'b-sharp', 'sharp');
  await capture(await open(true), 'c-smooth', 'smooth');
  fs.writeFileSync(out + 'train.json', JSON.stringify(trains));
} finally {
  await browser.close();
}
if (errors.length) throw new Error(errors.join('\n'));
