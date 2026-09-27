// Captures: slope grass tones, lighter levels, biome snow; and the worked incline example with
// trains. PLAYWRIGHT and CHROME override the cloud-container defaults. ONLY=looks|rails.
const { chromium } = await import(
  process.env.PLAYWRIGHT ??
    '/tmp/claude-0/-home-user-terepasztal/5d15a916-29ff-5ce3-8d79-4b98fa4fa891/scratchpad/pw/node_modules/playwright-core/index.mjs'
);
import fs from 'node:fs';
const out = 'scratchpad/hill-levels/renders/';
const SIDE = (32 * Math.SQRT2 * Math.sqrt(3)) / 2;
const BASE = { step: SIDE / 4, maxRise: 1, faces: true, shape: 'terraces', bank: 0.5, rims: true };
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
const only = process.env.ONLY;
try {
  await page.goto('http://127.0.0.1:5190/scratchpad/terrain-production/');
  await page.waitForFunction(() => typeof window.worldReview?.render === 'function', null, { timeout: 180000 });
  await page.evaluate(async () => {
    window.hillOptions = await import('/scratchpad/hill-levels/options.js');
    window.incline = await import('/scratchpad/hill-levels/incline.js');
  });
  if (!only || only === 'looks') {
    const hills = await page.evaluate(() => worldReview.views.find((v) => v.id === '10-connected-hills'));
    // A mountain in each biome with one, for the snow line.
    const peaks = await page.evaluate(() => {
      const m = worldReview.g.map,
        seen = {};
      for (let k = 0; k < m.terrain.length; k++)
        if (m.terrain[k] === 6 && !(m.biome[k] in seen)) seen[m.biome[k]] = { x: k % m.w, y: Math.floor(k / m.w) };
      return seen;
    });
    console.log('PEAKS', JSON.stringify(peaks));
    const LOOKS = [
      ['locked', { everyBankRock: true }, [1, 2]],
      ['shipped', {}, [1, 2]],
      ['bank-dry', { bankGrass: { tone: 'dry', amount: 0.6 } }, [2]],
      ['bank-dry-strong', { bankGrass: { tone: 'dry', amount: 1.2 } }, [2]],
      ['bank-dark', { bankGrass: { tone: 'dark', amount: 1 } }, [2]],
      ['bank-lush', { bankGrass: { tone: 'lush', amount: 1 } }, [2]],
      ['light-3', { heightLight: 0.03 }, [1, 2]],
      ['light-6', { heightLight: 0.06 }, [1, 2]],
      ['snow', { snow: true }, [1, 2]],
      ['light-4-snow', { heightLight: 0.04, snow: true }, [1, 2]],
    ];
    for (const [name, extra, zooms] of LOOKS) {
      await style({ ...BASE, ...extra });
      for (const zoom of zooms) await shot(`look2-z${zoom}-${name}`, { ...hills, zoom });
      if (extra.snow)
        for (const [biome, p] of Object.entries(peaks))
          await shot(`look2-peak-b${biome}-${name}`, { id: 'peak', title: 'peak', x: p.x + 2, y: p.y + 2, zoom: 1.5 });
    }
    await style(BASE);
  }
  if (!only || only === 'rails') {
    const site = await page.evaluate(async () => incline.stamp(worldReview.g));
    console.log('SITE', JSON.stringify(site));
    await settle();
    fs.writeFileSync(out + 'incline.json', JSON.stringify(site, null, 2));
    const at = (i, zoom) => ({ id: 'incline', title: 'incline', x: site.x0 + i, y: site.y, zoom });
    await page.evaluate(() => worldReview.g.fleet.trains = worldReview.g.fleet.trains.filter((t) => t.name !== 'Climber'));
    await shot('incline-empty-z2', at(9, 2));
    await shot('incline-empty-z3', at(9, 3));
    await shot('incline-ramp-z5', at(7, 5));
    await shot('incline-bridge-z4', at(13, 4));
    for (const [size, head] of [['small', 10], ['medium', 11], ['large', 11], ['large', 17]]) {
      await page.evaluate(([site, size, head]) => incline.place(worldReview.g, site, size, head), [site, size, head]);
      await shot(`incline-${size}-h${head}-z3`, at(head - 3, 3));
    }
  }
} finally {
  await browser.close();
}
if (errors.length) throw new Error(errors.join('\n'));
