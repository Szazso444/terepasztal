// Preview: the hills view with its mountain area switched to taiga, snow on, to show the snow
// line a level lower (patches on level 3, full snow on level 4).
const { chromium } = await import('/tmp/claude-0/-home-user-terepasztal/5d15a916-29ff-5ce3-8d79-4b98fa4fa891/scratchpad/pw/node_modules/playwright-core/index.mjs');
const out = 'scratchpad/hill-levels/renders/';
const SIDE = (32 * Math.SQRT2 * Math.sqrt(3)) / 2;
const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page.goto('http://127.0.0.1:5190/scratchpad/terrain-production/');
await page.waitForFunction(() => typeof window.worldReview?.render === 'function', null, { timeout: 180000 });
const hills = await page.evaluate(async (SIDE) => {
  const o = await import('/scratchpad/hill-levels/options.js'),
    g = worldReview.g,
    m = g.map,
    v = worldReview.views.find((v) => v.id === '10-connected-hills');
  // Every raised tile within 14 tiles of the view centre becomes taiga.
  for (let y = 0; y < m.h; y++)
    for (let x = 0; x < m.w; x++)
      if (Math.abs(x - v.x) + Math.abs(y - v.y) < 14 && (m.terrain[y * m.w + x] === 6 || m.terrain[y * m.w + x] === 2 || m.terrain[y * m.w + x] === 4)) m.biome[y * m.w + x] = 3;
  o.reliefStyle(g, { step: SIDE / 4, maxRise: 1, faces: true, shape: 'terraces', bank: 0.5, rims: true, heightLight: 0.04, snow: true });
  const l = g.world.landscape;
  g.render(1, 0);
  while (!l.ready) { await new Promise((r) => setTimeout(r, 50)); g.render(1, 0); }
  return v;
}, SIDE);
for (const zoom of [1, 2]) {
  await page.evaluate((v) => worldReview.render(v), { ...hills, zoom });
  await page.screenshot({ path: `${out}look2-z${zoom}-taiga-snow.jpg`, type: 'jpeg', quality: 90 });
}
await browser.close();
