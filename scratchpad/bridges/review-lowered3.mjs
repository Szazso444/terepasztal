// Review: raise a bridge by clicks and lower it again; where does the picture differ from before?
//   node scratchpad/bridges/review-lowered3.mjs [axis] <site> <site> ...
// Writes review2/low3-<axis>-<site>-{0-built,1-raised,2-lowered,3-diff}.png (zoom 4 clips).
import { launch } from '../runtime.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { PNG } from 'pngjs';
const out = process.env.REVIEW_OUT ?? 'scratchpad/bridges/review2/';
mkdirSync(out, { recursive: true });
const [axis = 'x', ...ids] = process.argv.slice(2);
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://127.0.0.1:5183/scratchpad/bridges/review.html?axis=${axis}`);
await page.waitForFunction(() => window.qa, null, { timeout: 300000 });
const diff = (a, b, name) => {
  let n = 0,
    box = [1e9, 1e9, -1, -1];
  const d = new PNG({ width: a.width, height: a.height });
  for (let k = 0; k < a.data.length; k += 4) {
    const v = Math.abs(a.data[k] - b.data[k]) + Math.abs(a.data[k + 1] - b.data[k + 1]) + Math.abs(a.data[k + 2] - b.data[k + 2]);
    d.data[k] = d.data[k + 1] = d.data[k + 2] = b.data[k] >> 1;
    d.data[k + 3] = 255;
    if (v > 24) {
      n++;
      d.data[k] = 255;
      d.data[k + 1] = 0;
      d.data[k + 2] = 255;
      const p = k / 4,
        x = p % a.width,
        y = (p / a.width) | 0;
      box = [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)];
    }
  }
  if (name) writeFileSync(`${out}${name}.png`, PNG.sync.write(d));
  return { n, box };
};
for (const id of ids) {
  const s = await page.evaluate((id) => {
    const s = qa.sites.find((s) => s.id === id);
    return { cx: s.cx, cy: s.cy, on: s.lines[0].on, track: s.lines[0].track };
  }, id);
  const shot = async (name) => {
    await page.evaluate(([cx, cy]) => qa.view(cx, cy, 4, ''), [s.cx, s.cy]);
    const buf = await page.screenshot({ clip: { x: 170, y: 150, width: 1100, height: 700 } });
    if (name) writeFileSync(`${out}low3-${axis}-${id}-${name}.png`, buf);
    return PNG.sync.read(buf);
  };
  const n = s.on.length;
  const up = s.track ? { 1: [1], 2: [1, 1], 3: [1, 2, 1], 4: [1, 2, 2, 1], 5: [1, 2, 3, 2, 1], 6: [1, 2, 3, 3, 2, 1] }[n] : s.on.map(() => 2);
  const a = await shot('0-built');
  await page.evaluate(([id, l]) => qa.setDecks(id, l), [id, Object.fromEntries(up.map((d, i) => [s.on[i], d]))]);
  await page.evaluate(() => qa.settle());
  await shot('1-raised');
  await page.evaluate(([id, l]) => qa.setDecks(id, l), [id, Object.fromEntries(up.map((d, i) => [s.on[i], 0]))]);
  await page.evaluate(() => qa.settle());
  await page.waitForTimeout(1500);
  await page.evaluate(() => qa.settle());
  const b = await shot('2-lowered');
  const d = diff(a, b, `low3-${axis}-${id}-3-diff`);
  const facts = await page.evaluate((id) => qa.facts(qa.sites.find((s) => s.id === id)).map((f) => `${f.deck}${f.set === 'auto' ? 'a' : ''}`).join(' '), id);
  console.log(id, 'decks after lowering:', facts, '| differing pixels:', JSON.stringify(d));
}
console.log('page errors', JSON.stringify(errors));
await browser.close();
