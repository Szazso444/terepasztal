// Bridge kit renders: the illustrated kit against the procedural bridges, on land and water.
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
const kit = (on) =>
  page.evaluate((on) => {
    const g = worldReview.g;
    Object.defineProperty(g.world, 'bridgeKit', { get: () => on, configurable: true });
    g.refreshBridges();
  }, on);
const shot = async (name, view) => {
  await page.evaluate((v) => worldReview.render(v), view);
  await page.screenshot({ path: `${out}${name}.jpg`, type: 'jpeg', quality: 90 });
  console.log('CAPTURED', name);
};
try {
  await page.goto('http://127.0.0.1:5190/scratchpad/terrain-production/');
  await page.waitForFunction(() => typeof window.worldReview?.render === 'function', null, { timeout: 180000 });
  await page.evaluate(async () => {
    window.incline = await import('/scratchpad/hill-levels/incline.js');
    window.supportDemo = await import('/scratchpad/hill-levels/support.js');
  });
  const sites = {};
  for (const [material, id] of [['stone', 'bridge_stone'], ['wood', 'bridge_wood']]) {
    sites[`${material}-valley`] = await page.evaluate(async (id) => incline.valley(worldReview.g, id), id);
    await settle();
    const s = await page.evaluate(async (id) => incline.stamp(worldReview.g, id), id);
    await settle();
    await page.evaluate(([s, id]) => supportDemo.support(worldReview.g, s, id), [s, id]);
    sites[`${material}-support`] = s;
    sites[`${material}-river`] = await page.evaluate((id) => incline.river(worldReview.g, id), id);
    await settle();
  }
  fs.writeFileSync(out + 'kit-sites.json', JSON.stringify(sites, null, 2));
  for (const on of (process.env.ONLY_KIT ? [true] : [true, false])) {
    await kit(on);
    await settle();
    const tag = on ? (process.env.TAG ?? "kit") : "old";
    for (const material of ['stone', 'wood']) {
      const v = sites[`${material}-valley`],
        s = sites[`${material}-support`],
        r = sites[`${material}-river`];
      await shot(`${tag}-${material}-valley-z4`, { id: 'v', title: 'v', x: v.x0 + 8, y: v.y, zoom: 4 });
      await shot(`${tag}-${material}-curve-z4`, { id: 'c', title: 'c', x: s.x0 + 14, y: s.y + 1.5, zoom: 4 });
      await shot(`${tag}-${material}-river-z4`, { id: 'r', title: 'r', x: r.x0 + r.n / 2 + 0.5, y: r.y, zoom: 4 });
    }
  }
} finally {
  await browser.close();
}
if (errors.length) throw new Error(errors.join('\n'));
