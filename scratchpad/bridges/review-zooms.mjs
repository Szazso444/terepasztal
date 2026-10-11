// Review: the same bridges at every zoom step of the game (0.5 .. 4), kit and procedural.
//   node scratchpad/bridges/review-zooms.mjs [axis=x] [proc]
import { launch } from '../runtime.mjs';
import { mkdirSync } from 'node:fs';
const [axis = 'x', procArg] = process.argv.slice(2);
const proc = procArg === 'proc';
const out = process.env.REVIEW_OUT ?? 'scratchpad/bridges/review/';
mkdirSync(out, { recursive: true });
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const sheetPage = await browser.newPage({ viewport: { width: 400, height: 300 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://127.0.0.1:5183/scratchpad/bridges/review.html?axis=${axis}${proc ? '&proc=1' : ''}`);
await page.waitForFunction(() => window.qa, null, { timeout: 300000 });
const sites = Object.fromEntries((await page.evaluate(() => qa.sites.map((s) => ({ id: s.id, cx: s.cx, cy: s.cy })))).map((s) => [s.id, s]));
console.log('origin', await page.evaluate(() => qa.origin));
const tag = `${axis}${proc ? '-proc' : ''}`;
async function clip(id, zoom, wTiles = 9, hWorld = 150) {
  const s = sites[id];
  const at = await page.evaluate(([cx, cy, zoom]) => qa.view(cx, cy, zoom, ''), [s.cx, s.cy, zoom]);
  const w = Math.min(1440, Math.round(wTiles * 32 * zoom)),
    h = Math.min(1000, Math.round(hWorld * zoom));
  const x = Math.max(0, Math.min(1440 - w, Math.round(at.x - w / 2))),
    y = Math.max(0, Math.min(1000 - h, Math.round(at.y - h * 0.6)));
  return { png: await page.screenshot({ clip: { x, y, width: w, height: h } }), w, h, caption: `${id} · zoom ${zoom}` };
}
async function sheet(name, cols, items, title = '') {
  const html = `<!doctype html><html><body style="margin:0;background:#1b2420;color:#eee6cf;font:600 13px/1.5 system-ui">
<div style="padding:4px 8px;background:#0e1411">${tag} · ${name}${title ? ' · ' + title : ''}</div>
<div style="display:grid;grid-template-columns:repeat(${cols},max-content);gap:6px;padding:6px;align-items:start">
${items.map((it) => `<figure style="margin:0"><img style="display:block" width="${it.w}" height="${it.h}" src="data:image/png;base64,${it.png.toString('base64')}"><figcaption style="padding:1px 4px">${it.caption}</figcaption></figure>`).join('\n')}</div></body></html>`;
  await sheetPage.setViewportSize({ width: 200, height: 100 });
  await sheetPage.setContent(html);
  const size = await sheetPage.evaluate(() => ({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight }));
  await sheetPage.setViewportSize({ width: size.w, height: size.h });
  await sheetPage.screenshot({ path: `${out}${tag}-${name}.png`, fullPage: true });
  console.log('SHEET', `${out}${tag}-${name}.png`, `${size.w}x${size.h}`);
}
// low zooms: every listed site on one sheet per zoom
const IDS = ['W4-stone', 'W4-wood', 'LR3-stone', 'LR3-wood', 'WR3-stone', 'WR3-wood'];
for (const zoom of [0.5, 0.75, 1, 1.5]) {
  const items = [];
  for (const id of IDS) items.push(await clip(id, zoom, id.startsWith('W4') ? 12 : 16, id.startsWith('W4') ? 150 : 220));
  await sheet(`zooms-${String(zoom).replace('.', '_')}`, zoom < 1 ? 3 : 2, items, `the game's zoom step ${zoom}`);
}
for (const zoom of [2, 3]) {
  const items = [];
  for (const id of proc ? IDS : ['LR3-stone', 'LR3-wood']) items.push(await clip(id, zoom, id.startsWith('W4') ? 10 : 15, id.startsWith('W4') ? 150 : 220));
  await sheet(`zooms-${zoom}`, proc && zoom === 2 ? 2 : 1, items, `the game's zoom step ${zoom}`);
}
console.log('page errors', JSON.stringify(errors));
await browser.close();
