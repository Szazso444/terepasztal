// Round 4 captures: summit shading, land bridges (stone and wood), supported pieces.
// ONLY=peaks|bridges.
const { chromium } = await import(
  process.env.PLAYWRIGHT ??
    '/tmp/claude-0/-home-user-terepasztal/5d15a916-29ff-5ce3-8d79-4b98fa4fa891/scratchpad/pw/node_modules/playwright-core/index.mjs'
);
import fs from 'node:fs';
const out = 'scratchpad/hill-levels/renders/';
const SIDE = (32 * Math.SQRT2 * Math.sqrt(3)) / 2;
const SHIPPED = { step: SIDE / 4, maxRise: 1, faces: true, shape: 'terraces', bank: 0.5, rims: true, bankGrass: { tone: 'dark', amount: 1 }, heightLight: 0.06, snow: true, biomeTops: true };
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
    g.render(1, 0);
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
    window.supportDemo = await import('/scratchpad/hill-levels/support.js');
  });
  const hills = await page.evaluate(() => worldReview.views.find((v) => v.id === '10-connected-hills'));
  if (!only || only === 'peaks') {
    for (const [name, extra] of [['original', {}], ['lit', { summitMatch: 0 }], ['match-half', { summitMatch: 0.5 }], ['match-full', { summitMatch: 1 }]]) {
      await style({ ...SHIPPED, ...extra });
      await shot(`summit-z2-${name}`, { ...hills, zoom: 2 });
      await shot(`summit-z3-${name}`, { ...hills, x: hills.x + 1, y: hills.y + 1, zoom: 3.2 });
    }
    await style(SHIPPED);
  }
  if (!only || only === 'bridges') {
    const report = {};
    for (const [material, id] of [['stone', 'bridge_stone'], ['wood', 'bridge_wood']]) {
      const site = await page.evaluate(async (id) => incline.stamp(worldReview.g, id), id);
      await settle();
      const results = await page.evaluate(([site, id]) => supportDemo.support(worldReview.g, site, id), [site, id]);
      await settle();
      report[material] = { site, results };
      console.log(material, JSON.stringify(results));
      const at = (dx, dy, zoom) => ({ id: 'b', title: 'b', x: site.x0 + dx, y: site.y + dy, zoom });
      await shot(`land-${material}-dip-z4`, at(12, 0, 4));
      await shot(`land-${material}-support-z3`, at(12, 1.5, 3));
      await shot(`land-${material}-curve-z5`, at(15, 2, 5));
    }
    for (const [material, id] of [['stone', 'bridge_stone'], ['wood', 'bridge_wood']]) {
      const site = await page.evaluate(async (id) => incline.valley(worldReview.g, id), id);
      await settle();
      report[material + '-valley'] = site;
      console.log('valley', material, JSON.stringify(site.levels));
      await shot(`land-${material}-valley-z4`, { id: 'v', title: 'v', x: site.x0 + 8, y: site.y, zoom: 4 });
    }
    fs.writeFileSync(out + 'support.json', JSON.stringify(report, null, 2));
  }
} finally {
  await browser.close();
}
if (errors.length) throw new Error(errors.join('\n'));
