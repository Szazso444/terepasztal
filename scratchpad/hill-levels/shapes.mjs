// Captures hill shapes for readability: level height, corner slopes vs terraces, rim light.
// PLAYWRIGHT and CHROME override the cloud-container defaults.
const { chromium } = await import(
  process.env.PLAYWRIGHT ??
    '/tmp/claude-0/-home-user-terepasztal/5d15a916-29ff-5ce3-8d79-4b98fa4fa891/scratchpad/pw/node_modules/playwright-core/index.mjs'
);
const out = 'scratchpad/hill-levels/renders/';
const SIDE = (32 * Math.SQRT2 * Math.sqrt(3)) / 2;
const STYLES = [
  ['now', null],
  ['corners-half', { step: SIDE / 2, maxRise: 1, faces: true }],
  ['corners-half-rims', { step: SIDE / 2, maxRise: 1, faces: true, rims: true }],
  ['terraces-quarter', { step: SIDE / 4, maxRise: 1, faces: true, shape: 'terraces', bank: 0.5, rims: true }],
  ['terraces-half', { step: SIDE / 2, maxRise: 1, faces: true, shape: 'terraces', bank: 0.5, rims: true }],
  ['terraces-half-narrow', { step: SIDE / 2, maxRise: 1, faces: true, shape: 'terraces', bank: 0.3, rims: true }],
  ['terraces-quarter-grassy', { step: SIDE / 4, maxRise: 1, faces: true, shape: 'terraces', bank: 0.6, rims: true, rockFaces: false }],
  ['terraces-half-grassy', { step: SIDE / 2, maxRise: 1, faces: true, shape: 'terraces', bank: 0.6, rims: true, rockFaces: false }],
].filter(([name]) => !process.env.ONLY || process.env.ONLY.split(',').includes(name));
const VIEWS = [
  ['hills', '10-connected-hills', 1],
  ['hills', '10-connected-hills', 2],
];
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
  await page.evaluate(() => import('/scratchpad/hill-levels/options.js').then((m) => (window.hillOptions = m)));
  for (const [name, style] of STYLES) {
    if (style)
      await page.evaluate(async (style) => {
        const g = worldReview.g,
          l = g.world.landscape;
        hillOptions.reliefStyle(g, style);
        g.world.animate(0);
        while (!l.ready) {
          await new Promise((r) => setTimeout(r, 50));
          g.world.animate(0);
        }
      }, style);
    for (const [label, id, zoom] of VIEWS) {
      await page.evaluate(
        async ([id, zoom]) =>
          worldReview.render({ ...worldReview.views.find((v) => v.id === id), zoom }),
        [id, zoom],
      );
      await page.screenshot({ path: `${out}shape-${label}-z${zoom}-${name}.jpg`, type: 'jpeg', quality: 90 });
      console.log('CAPTURED', label, zoom, name);
    }
  }
} finally {
  await browser.close();
}
if (errors.length) throw new Error(errors.join('\n'));
