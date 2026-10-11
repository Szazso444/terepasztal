// Scratch: what the 2D UI shows for a locomotive today, and the extract route a 3D thumbnail would take.
import { launch } from '../runtime.mjs';
import { writeFileSync } from 'node:fs';
const out = 'scratchpad/3d-proto-integration/out';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log('ERR', e.message));
await page.goto('http://127.0.0.1:5177/scratchpad/3d-proto-integration/index.html?sprites=B&ladder=B');
await page.waitForFunction(() => typeof window.qa?.frame === 'function', null, { timeout: 180000 });
await page.waitForFunction(() => qa.settled(), null, { timeout: 180000, polling: 200 });
await page.evaluate(() => qa.frame(3.2, 3));
const save = (name, url) => writeFileSync(`${out}/${name}.png`, Buffer.from(url.split(',')[1], 'base64'));
// 1. card art (inventory, roster, gacha, crafting, depot, train screen) and the turntable: vehicle/<id>_f<n>
for (const id of ['black_five', 'koutetsujou', 'm62']) save(`ui-card-${id}`, await page.evaluate(([i]) => qa.previewUrl(i, 0, 3), [id]));
// 2. the field train card (buildInfo.ts:68): locoFrame(atlas, def, 3) with the default part 'body'
const card = await page.evaluate(async () => {
  const g = qa.g;
  g.selectFieldTrain(qa.t);
  g.buildInfo.showTrain(qa.t);
  const img = g.buildInfo.root.querySelector('.bi-art');
  return { src: img?.src ?? null, w: img?.naturalWidth, h: img?.naturalHeight, tag: img?.tagName, html: g.buildInfo.root.innerHTML.slice(0, 300), frame: (await import('/src/art/frames.ts')).locoFrame(g.atlas, qa.t.locoDef, 3), has: g.atlas.has((await import('/src/art/frames.ts')).locoFrame(g.atlas, qa.t.locoDef, 3)) };
});
if (card.src) save('ui-buildinfo-black_five', card.src);
// 3. overview icon source (game.ts:318-337)
const ov = await page.evaluate(() => qa.g.overviewSource.trains().map((t) => ({ frame: t.frame, flip: t.flip, heading: t.heading })));
// 4. extract: a render texture of the stand-in to a data URL, as a 3D thumbnail would be made
const ex = await page.evaluate(async () => {
  qa.standin('rt', 0, true);
  const t0 = performance.now();
  const e = await qa.extractStandin();
  return { w: e.w, h: e.h, ms: performance.now() - t0, url: e.url };
});
save('ui-extract-standin', ex.url);
console.log(JSON.stringify({ card: { ...card, src: (card.src ?? "").slice(0, 40) }, overview: ov, extract: { w: ex.w, h: ex.h, ms: ex.ms } }, null, 1));
await browser.close();
