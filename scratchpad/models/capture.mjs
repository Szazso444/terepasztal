// Scratch: every engine's rendered model in the game, in sheet-ID order: side by side on straight
// track (day and night) and through the curve of its own gauge.
//   node scratchpad/models/capture.mjs [lineup|curve|all]     (the demo build on 5182)
import { launch } from '../runtime.mjs';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const what = process.argv[2] ?? 'all';
const out = 'scratchpad/models/out';
mkdirSync(out, { recursive: true });
const BASE = 'http://127.0.0.1:5182/scratchpad/models/';
// sheet ID -> game id (locomotive-wheels-bogies: 9 and 10 are deprecated)
const SHEET = ['rocket', 'bm50', 'muki', 'c50', 'mav490', 'mk45', 'mk48', 'rezet', null, null, 'mav375', 'j94', 'class08',
  'general', 'jupiter', 'kando_v40', 'sw1', 'black_five', 'crocodile', 'deltic', 'drg01', 'f7', 'flying_scotsman', 'ice1',
  'k4s', 'm62', 'mallard', 're460', 'taurus', 'tgv', 'v63', 'daylight', 'dda40x', 'gg1', 'mav424', 'nine_f', 'sd40',
  'big_boy', 'koutetsujou'];
const numbered = SHEET.map((id, i) => ({ id, n: i + 1 })).filter((e) => e.id);
const GROUPS = [
  { name: 'ids-01-08', from: 1, to: 8, zoom: 3, gap: 1 },
  { name: 'ids-11-17', from: 11, to: 17, zoom: 3, gap: 2 },
  { name: 'ids-18-24', from: 18, to: 24, zoom: 3, gap: 2 },
  { name: 'ids-25-31', from: 25, to: 31, zoom: 3, gap: 2 },
  { name: 'ids-32-39', from: 32, to: 39, zoom: 3, gap: 2 },
  { name: 'all', from: 1, to: 39, zoom: 1.5, gap: 1 },
];
const W = 2400, H = 1400;
const browser = await launch();
const report = { errors: [], lineups: {}, curves: [] };
try {
  if (what !== 'curve')
    for (const grp of GROUPS) {
      const es = numbered.filter((e) => e.n >= grp.from && e.n <= grp.to);
      const q = `rows=${es.map((e) => e.id).join(',')}&ids=${es.map((e) => e.n).join(',')}&zoom=${grp.zoom}&gap=${grp.gap}`;
      const shots = {};
      let placed = null, box = null;
      for (const night of [0, 1]) {
        const page = await browser.newPage({ viewport: { width: W, height: H } });
        page.on('pageerror', (e) => report.errors.push(`${grp.name}: ${e.message}`));
        await page.goto(`${BASE}?${q}&night=${night}`);
        await page.waitForFunction(() => typeof window.qa?.shot === 'function', null, { timeout: 240000 });
        ({ placed, box } = await page.evaluate(() => qa.shot()));
        if (!(await page.evaluate(() => qa.settle()))) report.errors.push(`${grp.name}: the painted ground was not ready`);
        shots[night ? 'night' : 'day'] = PNG.sync.read(await page.screenshot());
        await page.close();
      }
      const x0 = Math.max(0, Math.floor(box.x0)), y0 = Math.max(0, Math.floor(box.y0));
      const x1 = Math.min(W - 1, Math.ceil(box.x1)), y1 = Math.min(H - 1, Math.ceil(box.y1));
      if (box.x0 < 0 || box.y0 < 0 || box.x1 > W || box.y1 > H) report.errors.push(`${grp.name}: the lineup does not fit the viewport at zoom ${grp.zoom}`);
      const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
      for (const k of ['day', 'night']) {
        const crop = new PNG({ width: cw, height: ch });
        PNG.bitblt(shots[k], crop, x0, y0, cw, ch, 0, 0);
        writeFileSync(`${out}/lineup-${grp.name}-${k}.png`, PNG.sync.write(crop));
      }
      report.lineups[grp.name] = { size: [cw, ch], zoom: grp.zoom, engines: es, placed };
      console.log('lineup', grp.name, cw, ch, placed.filter((p) => !p.sprite).map((p) => p.id).join(',') || 'all sprites');
    }
  if (what !== 'lineup') {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('pageerror', (e) => report.errors.push(`curve: ${e.message}`));
    await page.goto(`${BASE}?rows=`);
    await page.waitForFunction(() => typeof window.qa?.shot === 'function', null, { timeout: 240000 });
    for (const e of numbered) {
      const r = await page.evaluate(([id]) => qa.curve(id, 3), [e.id]);
      await page.evaluate(() => qa.settle());
      await page.screenshot({ path: `${out}/curve-${e.id}.png`, clip: { x: 400, y: 260, width: 640, height: 480 } });
      report.curves.push({ ...e, ...r });
    }
    await page.close();
    console.log('curves', report.curves.length);
  }
} finally {
  await browser.close();
  writeFileSync(`${out}/report-${what}.json`, JSON.stringify(report, null, 1));
  console.log(report.errors.length ? report.errors : 'no errors');
}
