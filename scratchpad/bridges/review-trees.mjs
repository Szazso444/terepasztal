// Review: trees right beside and beyond the ends of raised bridges, pushed to the tile corner
// nearest the bridge (the largest offset a prop takes), both axes.
//   node scratchpad/bridges/review-trees.mjs [axis]
import { launch } from '../runtime.mjs';
import { mkdirSync } from 'node:fs';
const out = process.env.REVIEW_OUT ?? 'scratchpad/bridges/review2/';
mkdirSync(out, { recursive: true });
const [axis = 'x'] = process.argv.slice(2);
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://127.0.0.1:5183/scratchpad/bridges/review.html?axis=${axis}`);
await page.waitForFunction(() => window.qa, null, { timeout: 300000 });
// bare platforms raised to 2 so trees can also stand beyond the ends
await page.evaluate(() => {
  for (const id of ['B4-stone', 'B4-wood']) qa.setDecks(id, { 2: 2, 3: 2, 4: 2, 5: 2 });
});
const placed = await page.evaluate(() => {
  const g = qa.g, m = g.map, out = {};
  const put = (l, w, dl, dw, variant, kind = 'tree') => {
    const t = qa.T(l, w), o = qa.T(dl, dw);
    if (g.builder.buildingAt(t.x, t.y) || g.track.has(t.x, t.y)) return false;
    m.props.set(t.y * m.w + t.x, [{ kind, variant, ox: o.x, oy: o.y }]);
    g.world.rebuildProps(t.x, t.y);
    return true;
  };
  for (const id of ['LR3-stone', 'LR3-wood', 'WR2-stone', 'L3-stone', 'B4-stone', 'B4-wood', 'W3-wood']) {
    const s = qa.sites.find((s) => s.id === id), on = s.lines[0].on;
    let n = 0;
    for (const i of on) {
      // behind the bridge, pushed toward it; in front of the bridge, pushed toward it
      if (i % 2 === 0) n += put(s.l0 + i, s.w0 - 1, 0, 0.42, i % 3) ? 1 : 0;
      else n += put(s.l0 + i, s.w0 + 1, 0, -0.42, i % 3) ? 1 : 0;
    }
    // beyond the two ends (only where no track runs on), pushed toward the bridge
    n += put(s.l0 + on[0] - 1, s.w0, 0.42, 0, 1) ? 1 : 0;
    n += put(s.l0 + on[on.length - 1] + 1, s.w0, -0.42, 0, 2) ? 1 : 0;
    // the four diagonal neighbours of the two ends, pushed toward the bridge corner
    n += put(s.l0 + on[0] - 1, s.w0 - 1, 0.42, 0.42, 0) ? 1 : 0;
    n += put(s.l0 + on[0] - 1, s.w0 + 1, 0.42, -0.42, 1) ? 1 : 0;
    n += put(s.l0 + on[on.length - 1] + 1, s.w0 - 1, -0.42, 0.42, 2) ? 1 : 0;
    n += put(s.l0 + on[on.length - 1] + 1, s.w0 + 1, -0.42, -0.42, 0) ? 1 : 0;
    out[id] = n;
  }
  return out;
});
console.log('trees placed', JSON.stringify(placed));
await page.evaluate(() => qa.settle());
const sites = Object.fromEntries((await page.evaluate(() => qa.sites.map((s) => ({ id: s.id, cx: s.cx, cy: s.cy })))).map((s) => [s.id, s]));
for (const [id, zoom] of [['LR3-stone', 3], ['LR3-wood', 3], ['WR2-stone', 4], ['L3-stone', 4], ['B4-stone', 4], ['B4-wood', 4], ['W3-wood', 4]]) {
  const s = sites[id];
  await page.evaluate(([cx, cy, zoom, text]) => qa.view(cx, cy, zoom, text), [s.cx, s.cy, zoom, `${axis} · trees around ${id} · zoom ${zoom}`]);
  await page.screenshot({ path: `${out}trees-${axis}-${id}.png` });
  console.log('SHOT', `trees-${axis}-${id}`);
}
console.log('page errors', JSON.stringify(errors));
await browser.close();
