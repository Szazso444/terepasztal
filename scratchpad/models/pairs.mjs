// Scratch: each engine as it was rendered for the Ladder B review (back track) beside the engine now
// (front track), noses level, same zoom.   node scratchpad/models/pairs.mjs [id ...]
import { launch } from '../runtime.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
const out = 'scratchpad/models/out';
mkdirSync(out, { recursive: true });
const SHEET = ['rocket', 'bm50', 'muki', 'c50', 'mav490', 'mk45', 'mk48', 'rezet', null, null, 'mav375', 'j94', 'class08',
  'general', 'jupiter', 'kando_v40', 'sw1', 'black_five', 'crocodile', 'deltic', 'drg01', 'f7', 'flying_scotsman', 'ice1',
  'k4s', 'm62', 'mallard', 're460', 'taurus', 'tgv', 'v63', 'daylight', 'dda40x', 'gg1', 'mav424', 'nine_f', 'sd40',
  'big_boy', 'koutetsujou'];
const want = process.argv.slice(2);
const ids = SHEET.filter((id) => id && (!want.length || want.includes(id)));
const W = 1800, H = 1100;
const browser = await launch();
const report = { errors: [], pairs: {} };
try {
  for (const id of ids) {
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    page.on('pageerror', (e) => report.errors.push(`${id}: ${e.message}`));
    await page.goto(`http://127.0.0.1:5182/scratchpad/models/?old=1&rows=${id}__old,${id}&ids=before,now&zoom=4&gap=2`);
    await page.waitForFunction(() => typeof window.qa?.shot === 'function', null, { timeout: 240000 });
    const { placed, box } = await page.evaluate(() => qa.shot());
    await page.evaluate(() => qa.settle());
    const shot = PNG.sync.read(await page.screenshot());
    const x0 = Math.max(0, Math.floor(box.x0)), y0 = Math.max(0, Math.floor(box.y0));
    const x1 = Math.min(W - 1, Math.ceil(box.x1)), y1 = Math.min(H - 1, Math.ceil(box.y1));
    const crop = new PNG({ width: x1 - x0 + 1, height: y1 - y0 + 1 });
    PNG.bitblt(shot, crop, x0, y0, crop.width, crop.height, 0, 0);
    writeFileSync(`${out}/pair-${id}.png`, PNG.sync.write(crop));
    report.pairs[id] = { size: [crop.width, crop.height], placed };
    if (placed.some((p) => p.missing || !p.sprite)) report.errors.push(`${id}: ${JSON.stringify(placed)}`);
    await page.close();
  }
} finally {
  await browser.close();
  writeFileSync(`${out}/report-pairs.json`, JSON.stringify(report, null, 1));
  console.log(Object.keys(report.pairs).length, 'pairs;', report.errors.length ? report.errors : 'no errors');
}
