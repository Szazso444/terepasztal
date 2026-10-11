// Review: do bare platforms look the same after being raised and lowered back to the ground?
import { launch } from '../runtime.mjs';
import { writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
const out = process.env.REVIEW_OUT ?? 'scratchpad/bridges/review/';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto('http://127.0.0.1:5183/scratchpad/bridges/review.html?axis=x');
await page.waitForFunction(() => window.qa, null, { timeout: 300000 });
const id = process.argv[2] ?? 'B3-stone';
const s = await page.evaluate((id) => { const s = qa.sites.find((s) => s.id === id); return { cx: s.cx, cy: s.cy, n: s.tiles.length }; }, id);
const shot = async (name) => {
  await page.evaluate(([cx, cy]) => qa.view(cx, cy, 4, ''), [s.cx, s.cy]);
  const buf = await page.screenshot({ clip: { x: 270, y: 250, width: 900, height: 500 } });
  writeFileSync(`${out}lowered-${id}-${name}.png`, buf);
  return PNG.sync.read(buf);
};
const state = () => page.evaluate((id) => qa.sites.find((s) => s.id === id).tiles.map((t) => { const b = qa.g.builder.bridgeAt(t.x, t.y); return { deck: b.deck ?? 'auto', level: qa.g.builder.deckLevel(b) }; }), id);
console.log('as built', JSON.stringify(await state()));
const a = await shot('0-built');
const lv = (d) => Object.fromEntries(Array.from({ length: s.n }, (_, i) => [2 + i, d]));
await page.evaluate(([id, l]) => qa.setDecks(id, l), [id, lv(2)]);
await page.evaluate(() => qa.settle());
console.log('raised', JSON.stringify(await state()));
await shot('1-raised');
await page.evaluate(([id, l]) => qa.setDecks(id, l), [id, lv(0)]);
await page.evaluate(() => qa.settle());
console.log('lowered', JSON.stringify(await state()));
const b = await shot('2-lowered');
let n = 0;
const d = new PNG({ width: a.width, height: a.height });
for (let k = 0; k < a.data.length; k += 4) {
  const diff = Math.abs(a.data[k] - b.data[k]) + Math.abs(a.data[k + 1] - b.data[k + 1]) + Math.abs(a.data[k + 2] - b.data[k + 2]);
  d.data[k] = d.data[k + 1] = d.data[k + 2] = b.data[k] >> 1;
  d.data[k + 3] = 255;
  if (diff > 24) { n++; d.data[k] = 255; d.data[k + 1] = 0; d.data[k + 2] = 255; }
}
writeFileSync(`${out}lowered-${id}-3-diff.png`, PNG.sync.write(d));
console.log(n, 'pixels differ');
await browser.close();
