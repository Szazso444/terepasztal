// Rail showcase captures.
//   BASE_URL=http://127.0.0.1:5176 OUT=scratchpad/rails/out/after MODE=pieces node scratchpad/rails/shots.mjs
// MODE: pieces (catalogue, every piece, the areas, the snap) | follow (train films, see FILMS)
import { launch, baseURL } from '../runtime.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const out = process.env.OUT ?? 'scratchpad/rails/out/after';
const mode = process.env.MODE ?? 'pieces';
mkdirSync(out, { recursive: true });
const browser = await launch();
const report = { errors: [], cells: [], snap: [], films: {} };
const open = async (page) => {
  await page.goto(`${baseURL('after')}/scratchpad/rails/yard/`);
  await page.waitForFunction(() => typeof window.qa?.shoot === 'function' || window.qaError, null, {
    timeout: 240000,
  });
};
try {
  const page = await browser.newPage({ viewport: { width: 2000, height: 1300 } });
  page.on('pageerror', (e) => report.errors.push(e.message));
  await open(page);
  report.info = await page.evaluate(() => ({ ...qa.info, areas: qa.areas() }));
  if (mode === 'pieces') {
    await page.evaluate(() => qa.catalogue());
    await page.screenshot({ path: `${out}/catalogue.png` });
    const cells = await page.evaluate(() => qa.cells);
    for (let i = 0; i < cells.length; i++) {
      await page.evaluate((i) => qa.shoot(i), i);
      await page.screenshot({
        path: `${out}/cell-${i}.png`,
        clip: { x: 740, y: 460, width: 520, height: 380 },
      });
      report.cells.push(cells[i]);
    }
    for (const a of report.info.areas) {
      await page.evaluate((a) => qa.area(a, a === 'loop' ? 0.8 : 1.6), a);
      await page.screenshot({
        path: `${out}/area-${a}.png`,
        clip: { x: 200, y: 130, width: 1600, height: 1040 },
      });
    }
    if (report.info.HAS_FORMS)
      for (const st of ['off', 'on', 'off']) {
        const form = await page.evaluate((st) => qa.snap(st), st);
        await page.evaluate(() => qa.area('snap', 2.4));
        await page.screenshot({
          path: `${out}/snap-${report.snap.length}-${st}.png`,
          clip: { x: 500, y: 330, width: 1000, height: 640 },
        });
        report.snap.push({ st, form });
      }
  }
  if (mode === 'follow') {
    // every film starts from a fresh load, all trains running, the camera on one of them
    const names = await page.evaluate(() => qa.spawnTrains());
    const only = process.env.ONLY ? process.env.ONLY.split(',') : names;
    for (let k = 0; k < names.length; k++) {
      if (!only.includes(names[k])) continue;
      if (k > 0 || report.films[names[0]]) {
        await open(page);
        await page.evaluate(() => qa.spawnTrains());
      }
      const frames = Number(process.env.FRAMES ?? 72);
      report.films[names[k]] = [];
      for (let f = 0; f < frames; f++) {
        await page.evaluate(([k]) => (qa.step(9), qa.follow(k, 2.2)), [k]);
        await page.screenshot({
          path: `${out}/film-${names[k]}-${String(f).padStart(3, '0')}.png`,
          clip: { x: 600, y: 390, width: 800, height: 520 },
        });
        if (f % 24 === 0) report.films[names[k]].push(await page.evaluate(() => qa.states()));
      }
    }
  }
} finally {
  await browser.close();
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 1));
  console.log(
    report.errors.length ? report.errors.slice(0, 5) : 'no errors',
    report.cells.length,
    'cells',
    JSON.stringify(report.snap),
  );
}
