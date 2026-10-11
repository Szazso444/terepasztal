// Review: zoom-8 details with my own reference lines (magenta: the tile diamonds at deck height
// computed from tile coordinates and the rail profile; cyan: verticals from deck corners to the
// tile's ground level). Shows angle, size and joints against the game's projection.
import { launch } from '../runtime.mjs';
import { mkdirSync } from 'node:fs';
const [axis = 'x'] = process.argv.slice(2);
const out = process.env.REVIEW_OUT ?? 'scratchpad/bridges/review/';
mkdirSync(out, { recursive: true });
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto(`http://127.0.0.1:5183/scratchpad/bridges/review.html?axis=${axis}`);
await page.waitForFunction(() => window.qa, null, { timeout: 300000 });
const sites = Object.fromEntries((await page.evaluate(() => qa.sites.map((s) => ({ id: s.id, cx: s.cx, cy: s.cy })))).map((s) => [s.id, s]));
const shot = async (name, id, zoom, dl = 0, dw = 0, grid = true, verticals = false) => {
  const s = sites[id];
  const [cx, cy] = axis === 'x' ? [s.cx + dl, s.cy + dw] : [s.cx + dw, s.cy + dl];
  await page.evaluate(([g, v]) => qa.grid(g, v), [grid, verticals]);
  await page.evaluate(([cx, cy, zoom, text]) => qa.view(cx, cy, zoom, text), [cx, cy, zoom, `${axis} · ${name} · zoom ${zoom}${grid ? ' · magenta = ideal tile diamonds at deck height' : ''}`]);
  await page.screenshot({ path: `${out}grid-${axis}-${name}.png` });
  console.log('SHOT', `grid-${axis}-${name}`);
};
for (const m of ['stone', 'wood']) {
  await shot(`W3-${m}`, `W3-${m}`, 8, 0, 0.3);
  await shot(`W3-${m}-nogrid`, `W3-${m}`, 8, 0, 0.3, false);
  await shot(`W1-${m}`, `W1-${m}`, 8, 0, 0.3);
  await shot(`L3-${m}`, `L3-${m}`, 8, 0, 0.3);
  await shot(`WR2-${m}`, `WR2-${m}`, 6, 0, 0.3, true, true);
  await shot(`WR2-${m}-nogrid`, `WR2-${m}`, 6, 0, 0.3, false);
  await shot(`LR4-${m}-top`, `LR4-${m}`, 6, 0, 0.2, true, true);
  await shot(`LR4-${m}-top-nogrid`, `LR4-${m}`, 6, 0, 0.2, false);
  await shot(`LR3-${m}-foot`, `LR3-${m}`, 8, -3.6, 0.2);
  await shot(`LR3-${m}-foot-nogrid`, `LR3-${m}`, 8, -3.6, 0.2, false);
  await shot(`LR3-${m}-end-nogrid`, `LR3-${m}`, 8, 3.8, 0.2, false);
  await shot(`DW20-${m}`, `DW20-${m}`, 6, 0, 0.2, true, true);
}
await shot('SS-water', 'SS-water', 6, 0, 0.3);
await shot('SW-water-nogrid', 'SW-water', 6, 0, 0.3, false);
await shot('HI-front', 'HI-front', 6, 0, 0.3, true, true);
await browser.close();
