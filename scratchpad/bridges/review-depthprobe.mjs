// Review: depth keys of nature sprites behind a land bridge vs the slices of a train on it.
import { launch } from '../runtime.mjs';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto('http://127.0.0.1:5183/scratchpad/bridges/review.html?axis=x');
await page.waitForFunction(() => window.qa, null, { timeout: 300000 });
await page.evaluate(() => qa.trainAt('L3-stone', 0, 6.2, 'rocket', ['wooden_coach', 'wooden_coach']));
const out = await page.evaluate(async () => {
  const { tileToWorld, depthKey } = await import('/src/engine/iso.ts');
  const g = qa.g, w = g.world, m = g.map, s = qa.sites.find((s) => s.id === 'L3-stone');
  qa.view(s.cx, s.cy, 4, '');
  const nature = new Map();
  for (const [name, map] of [['scatter', w.scatterSprites], ['prop', w.propSprites]])
    for (const [i, list] of map) for (const e of list) nature.set(e.s ?? e, `${name} on tile (${(i % m.w) - s.l0},${Math.floor(i / m.w) - s.w0})`);
  const bridge = new Map();
  for (const i of s.lines[0].on) {
    const t = qa.T(s.l0 + i, s.w0), r = w.bridges.get(t.y * m.w + t.x);
    for (const k of ['body', 'near', 'sunk']) for (const q of r[k]) bridge.set(q, `bridge ${k} tile ${i}`);
  }
  // the engine: world position of the rail point under its chimney (head 6.2, chimney near the front)
  const res = { rows: {}, hits: [] };
  for (const i of [4, 5, 6, 7]) res.rows[i] = depthKey(s.l0 + i, s.w0);
  res.rows['5,-1'] = depthKey(s.l0 + 5, s.w0 - 1);
  res.rows['6,-1'] = depthKey(s.l0 + 6, s.w0 - 1);
  const flower = [...nature.entries()].filter(([sp, n]) => /\((4|5|6|7),-1\)/.test(n));
  for (const [sp, n] of flower) {
    const b = sp.getBounds();
    const hit = [];
    for (const c of w.objects.children) {
      if (!c.visible || c === sp) continue;
      const cb = c.getBounds();
      if (cb.maxX < b.minX || cb.minX > b.maxX || cb.maxY < b.minY || cb.minY > b.maxY) continue;
      hit.push({ what: nature.get(c) ?? bridge.get(c) ?? (c.texture?.label || c.label || c.constructor.name), z: +c.zIndex.toFixed(2), over: c.zIndex > sp.zIndex });
    }
    res.hits.push({ n, z: +sp.zIndex.toFixed(2), screen: [Math.round(b.minX), Math.round(b.minY), Math.round(b.maxX), Math.round(b.maxY)], world: [sp.x, sp.y], overlapping: hit.sort((a, b) => a.z - b.z) });
  }
  return res;
});
console.log('rows', JSON.stringify(out.rows));
for (const h of out.hits) {
  console.log(`${h.n} z=${h.z} screen=${h.screen}`);
  for (const o of h.overlapping) console.log(`    ${o.over ? 'ABOVE it' : 'below it'}  z=${o.z}  ${o.what}`);
}
await page.screenshot({ path: 'scratchpad/bridges/review2/depthprobe-L3.png' });
await browser.close();
