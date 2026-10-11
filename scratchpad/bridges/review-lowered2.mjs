// Review: a railed bridge on flat land raised (1 2 1) and lowered again: does the ground return
// to what it was? Captures straight after settle() and again after waiting, with diff images.
import { launch } from '../runtime.mjs';
import { writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
const out = process.env.REVIEW_OUT ?? 'scratchpad/bridges/review/';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto('http://127.0.0.1:5183/scratchpad/bridges/review.html?axis=x');
await page.waitForFunction(() => window.qa, null, { timeout: 300000 });
const diff = (a, b, name) => {
  let n = 0, box = [1e9, 1e9, -1, -1];
  const d = new PNG({ width: a.width, height: a.height });
  for (let k = 0; k < a.data.length; k += 4) {
    const v = Math.abs(a.data[k] - b.data[k]) + Math.abs(a.data[k + 1] - b.data[k + 1]) + Math.abs(a.data[k + 2] - b.data[k + 2]);
    d.data[k] = d.data[k + 1] = d.data[k + 2] = b.data[k] >> 1; d.data[k + 3] = 255;
    if (v > 24) { n++; d.data[k] = 255; d.data[k + 1] = 0; d.data[k + 2] = 255; const p = k / 4, x = p % a.width, y = (p / a.width) | 0; box = [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)]; }
  }
  if (name) writeFileSync(`${out}${name}.png`, PNG.sync.write(d));
  return { n, box };
};
for (const id of process.argv.slice(2).length ? process.argv.slice(2) : ['F3-stone', 'F3-wood', 'F6-wood', 'F5-stone']) {
  const s = await page.evaluate((id) => { const s = qa.sites.find((s) => s.id === id); return { cx: s.cx, cy: s.cy, n: s.tiles.length }; }, id);
  const shot = async (name) => {
    await page.evaluate(([cx, cy]) => qa.view(cx, cy, 4, ''), [s.cx, s.cy]);
    const buf = await page.screenshot({ clip: { x: 170, y: 150, width: 1100, height: 700 } });
    if (name) writeFileSync(`${out}low2-${id}-${name}.png`, buf);
    return PNG.sync.read(buf);
  };
  const up = { 1: [1], 2: [1, 1], 3: [1, 2, 1], 4: [1, 2, 2, 1], 5: [1, 2, 3, 2, 1], 6: [1, 2, 3, 3, 2, 1] }[s.n];
  const a = await shot('0-built');
  for (let round = 0; round < 3; round++) {
    await page.evaluate(([id, l]) => qa.setDecks(id, l), [id, Object.fromEntries(up.map((d, i) => [3 + i, d]))]);
    await page.evaluate(() => qa.settle());
    await page.evaluate(([id, l]) => qa.setDecks(id, l), [id, Object.fromEntries(up.map((d, i) => [3 + i, 0]))]);
    const ready0 = await page.evaluate(() => qa.g.world.landscape.ready);
    await page.evaluate(() => qa.settle());
    const b0 = await shot(round === 0 ? '1-lowered-settled' : null);
    const d0 = diff(a, b0, round === 0 ? `low2-${id}-2-diff-settled` : null);
    await page.waitForTimeout(1500);
    await page.evaluate(() => qa.settle());
    const b1 = await shot(null);
    const d1 = diff(a, b1, null);
    console.log(id, 'round', round, 'ready right after the clicks:', ready0, '| after settle:', JSON.stringify(d0), '| 1.5 s later:', JSON.stringify(d1));
  }
}
await browser.close();
