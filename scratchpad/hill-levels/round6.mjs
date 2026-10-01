// Bridge round 6: the kit, the procedural spans and the procedural shapes in the kit's surfaces,
// on land and water; then the stacking options for a river through a ridge.
// PLAYWRIGHT / CHROME env as in round5.mjs. ONLY=styles|stacks.
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
page.on(
  'console',
  (m) => m.type() === 'error' && !m.text().includes('404') && errors.push(m.text()),
);
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
const style = (s) =>
  page.evaluate((s) => {
    const g = worldReview.g;
    g.world.bridgeStyle = s;
    g.refreshBridges();
  }, s);
const shot = async (name, view) => {
  await page.evaluate((v) => worldReview.render(v), view);
  await page.screenshot({ path: `${out}${name}.jpg`, type: 'jpeg', quality: 90 });
  console.log('CAPTURED', name);
};
const only = process.env.ONLY;
try {
  await page.goto('http://127.0.0.1:5190/scratchpad/terrain-production/');
  await page.waitForFunction(() => typeof window.worldReview?.render === 'function', null, {
    timeout: 180000,
  });
  await page.evaluate(async () => {
    window.incline = await import('/scratchpad/hill-levels/incline.js');
    window.stack = await import('/scratchpad/hill-levels/stack.js');
    window.supportDemo = await import('/scratchpad/hill-levels/support.js');
    if (!(await worldReview.g.world.loadBridgeSurfaces())) throw Error('surfaces');
  });
  const sites = {};
  if (only !== 'stacks') {
    for (const [material, id] of [
      ['stone', 'bridge_stone'],
      ['wood', 'bridge_wood'],
    ]) {
      sites[`${material}-valley`] = await page.evaluate(
        (id) => incline.valley(worldReview.g, id),
        id,
      );
      await settle();
      const s = await page.evaluate((id) => incline.stamp(worldReview.g, id), id);
      await settle();
      await page.evaluate(([s, id]) => supportDemo.support(worldReview.g, s, id), [s, id]);
      sites[`${material}-support`] = s;
      sites[`${material}-river`] = await page.evaluate(
        (id) => incline.river(worldReview.g, id),
        id,
      );
      await settle();
    }
    for (const s of ['textured', 'procedural', 'kit']) {
      await style(s);
      await settle();
      for (const material of ['stone', 'wood']) {
        const v = sites[`${material}-valley`],
          c = sites[`${material}-support`],
          r = sites[`${material}-river`];
        await shot(`r6-${s}-${material}-valley`, {
          id: 'v',
          title: 'v',
          x: v.x0 + 8,
          y: v.y,
          zoom: 4,
        });
        await shot(`r6-${s}-${material}-river`, {
          id: 'r',
          title: 'r',
          x: r.x0 + r.n / 2 + 0.5,
          y: r.y,
          zoom: 4,
        });
        if (s === 'textured')
          await shot(`r6-${s}-${material}-curve`, {
            id: 'c',
            title: 'c',
            x: c.x0 + 14,
            y: c.y + 1.5,
            zoom: 4,
          });
      }
    }
  }
  if (only !== 'styles') {
    await style('textured');
    // A river through a level-2 ridge, three ways, in stone and timber.
    for (const [material, id] of [
      ['stone', 'bridge_stone'],
      ['wood', 'bridge_wood'],
    ]) {
      const cases = {
        water: { bridged: [8, 9, 10], decks: {} },
        span: { bridged: [7, 8, 9, 10, 11], decks: {} },
        raised: { bridged: [7, 8, 9, 10, 11], decks: { 7: 3, 8: 3, 9: 3, 10: 3, 11: 3 } },
      };
      for (const [name, c] of Object.entries(cases)) {
        const site = await page.evaluate(
          ([id, b]) => stack.ridgeRiver(worldReview.g, id, b),
          [id, c.bridged],
        );
        sites[`stack-${material}-${name}`] = site;
        await page.evaluate(
          ([site, decks]) => {
            const g = worldReview.g;
            // Each preview keeps its own decks; the map holds every scene's at once.
            for (const [i, level] of Object.entries(decks))
              g.bridgeDecks.set(site.y * g.map.w + site.x0 + Number(i), level);
            g.railsDirty = true;
          },
          [site, c.decks],
        );
        await settle();
        await shot(`r6-stack-${material}-${name}`, {
          id: 's',
          title: 's',
          x: site.x0 + 9,
          y: site.y,
          zoom: 3,
        });
      }
    }
  }
  fs.writeFileSync(out + 'r6-sites.json', JSON.stringify(sites, null, 2));
} finally {
  await browser.close();
}
if (errors.length) throw new Error(errors.join('\n'));
