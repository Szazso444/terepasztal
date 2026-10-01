// Round 3 captures: biome tops pilot, painted peaks, track placement rules.
// PLAYWRIGHT and CHROME override the cloud-container defaults. ONLY=biomes|peaks|rules.
const { chromium } = await import(
  process.env.PLAYWRIGHT ??
    '/tmp/claude-0/-home-user-terepasztal/5d15a916-29ff-5ce3-8d79-4b98fa4fa891/scratchpad/pw/node_modules/playwright-core/index.mjs'
);
import fs from 'node:fs';
const out = 'scratchpad/hill-levels/renders/';
const SIDE = (32 * Math.SQRT2 * Math.sqrt(3)) / 2;
const SHIPPED = { step: SIDE / 4, maxRise: 1, faces: true, shape: 'terraces', bank: 0.5, rims: true, bankGrass: { tone: 'dark', amount: 1 }, heightLight: 0.06, snow: true };
const only = process.env.ONLY;
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
    g.render(1, 0);
    while (!l.ready) {
      await new Promise((r) => setTimeout(r, 50));
      g.render(1, 0);
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
    window.incline = await import('/scratchpad/hill-levels/incline.js');
    window.trackRules = await import('/scratchpad/hill-levels/rules.js');
  });
  const hills = await page.evaluate(() => worldReview.views.find((v) => v.id === '10-connected-hills'));
  if (!only || only === 'peaks') {
    for (const [name, extra] of [['sprites', {}], ['painted-2', { paintedPeaks: 2 }], ['painted-3', { paintedPeaks: 3 }]]) {
      await style({ ...SHIPPED, ...extra });
      await shot(`peaks-z2-${name}`, { ...hills, zoom: 2 });
      await shot(`peaks-z3-${name}`, { ...hills, x: hills.x + 1, y: hills.y + 1, zoom: 3.2 });
    }
  }
  if (!only || only === 'biomes') {
    // Pilot: the whole view switched to one biome, mountain ground between stones in its colour.
    const original = await page.evaluate(() => Array.from(worldReview.g.map.biome));
    for (const [biome, name] of [[0, 'plains'], [1, 'forest'], [2, 'desert'], [3, 'taiga'], [4, 'swamp']]) {
      await page.evaluate(([biome, v]) => {
        const m = worldReview.g.map;
        for (let y = 0; y < m.h; y++)
          for (let x = 0; x < m.w; x++) if (Math.abs(x - v.x) + Math.abs(y - v.y) < 30) m.biome[y * m.w + x] = biome;
      }, [biome, hills]);
      await style({ ...SHIPPED, biomeTops: true });
      await shot(`biome-z1-${name}`, { ...hills, zoom: 1 });
    }
    await page.evaluate((b) => worldReview.g.map.biome.set(b), original);
    await style(SHIPPED);
  }
  if (!only || only === 'rules') {
    const site = await page.evaluate(async () => incline.stamp(worldReview.g));
    await settle();
    const results = await page.evaluate((site) => trackRules.rules(worldReview.g, site), site);
    await settle();
    console.log('RULES', JSON.stringify(results));
    fs.writeFileSync(out + 'rules.json', JSON.stringify({ site, results }, null, 2));
    await shot('rules-z2', { id: 'rules', title: 'rules', x: site.x0 + 8, y: site.y + 1, zoom: 2 });
    await shot('rules-z3', { id: 'rules', title: 'rules', x: site.x0 + 8, y: site.y + 1, zoom: 3 });
    await shot('rules-crossing-z5', { id: 'rules', title: 'rules', x: site.x0 + 6, y: site.y, zoom: 5 });
    await shot('rules-bridge-z4', { id: 'rules', title: 'rules', x: site.x0 + 15, y: site.y + 2, zoom: 4 });
  }
} finally {
  await browser.close();
}
if (errors.length) throw new Error(errors.join('\n'));
