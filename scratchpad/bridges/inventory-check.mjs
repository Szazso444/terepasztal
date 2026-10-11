// Compare the atlas of the running game with docs/art-direction/frame-inventory.json: which frames
// went, which came, and which changed size or anchor (a generator change must not move the rest).
// The inventory predates the narrow-gauge work, so rolling/, track/ and packed props differ anyway;
// what matters here is the structures group, where the bridge frames lived.
//   node scratchpad/bridges/inventory-check.mjs
import { launch } from '../runtime.mjs';
import { readFileSync } from 'node:fs';
const inventory = JSON.parse(readFileSync('docs/art-direction/frame-inventory.json', 'utf8'));
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto('http://127.0.0.1:5183/scratchpad/bridges/decks.html');
await page.waitForFunction(() => window.qa, null, { timeout: 240000 });
const now = await page.evaluate(() =>
  qa.g.atlas.keys('').map((key) => {
    const f = qa.g.atlas.get(key);
    return { key, width: f.w, height: f.h, anchorX: Math.round(f.anchorX * f.w), anchorY: Math.round(f.anchorY * f.h) };
  }),
);
await browser.close();
const was = new Map(inventory.map((e) => [e.key, e])),
  is = new Map(now.map((e) => [e.key, e]));
const gone = [...was.keys()].filter((k) => !is.has(k)),
  come = [...is.keys()].filter((k) => !was.has(k)),
  changed = [...is.keys()].filter((k) => {
    const a = was.get(k),
      b = is.get(k);
    return a && (a.width !== b.width || a.height !== b.height || a.anchorX !== b.anchorX || a.anchorY !== b.anchorY);
  });
const family = (k) => k.replace(/[0-9]+/g, '#');
const count = (list) => {
  const m = new Map();
  for (const k of list) m.set(family(k), (m.get(family(k)) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} x ${k}`);
};
const structures = (list) => list.filter((k) => k.startsWith('structures/'));
console.log('inventory', inventory.length, 'now', now.length);
console.log('structures/ gone:', count(structures(gone)));
console.log('structures/ come:', count(structures(come)));
console.log(
  'structures/ changed size or anchor:',
  structures(changed).map((k) => `${k} ${was.get(k).width}x${was.get(k).height}@${was.get(k).anchorX},${was.get(k).anchorY} -> ${is.get(k).width}x${is.get(k).height}@${is.get(k).anchorX},${is.get(k).anchorY}`),
);
console.log('other groups: gone', count(gone.filter((k) => !k.startsWith('structures/'))).slice(0, 6));
console.log('other groups: come', come.filter((k) => !k.startsWith('structures/')).length, 'frames,', come.filter((k) => k.startsWith('bridgemat/')).length, 'of them bridgemat/');
