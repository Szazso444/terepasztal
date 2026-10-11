// Review: does placing a bridge platform change the nature drawn on the tiles around it?
import { launch } from '../runtime.mjs';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on('dialog', (d) => d.accept());
await page.goto('http://127.0.0.1:5183/#seed=4242&new');
await page.waitForFunction(() => window.game?.fleet, null, { timeout: 240000 });
await page.waitForFunction(() => window.game.world.landscape.ready, null, { timeout: 240000 });
await page.waitForTimeout(1000);
const out = await page.evaluate(() => {
  const g = window.game, w = g.world, m = g.map, b = g.builder;
  g.settings.autosave = false;
  b.free = true;
  const snap = (x, y) => {
    const res = {};
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const i = (y + dy) * m.w + x + dx;
      const list = [...(w.scatterSprites.get(i) ?? []).map((e) => 's:' + e.s.tint.toString(16) + '@' + e.s.x + ',' + e.s.y), ...(w.propSprites.get(i) ?? []).map((s) => 'p:' + s.tint.toString(16) + '@' + s.x + ',' + s.y)];
      res[`${dx},${dy}`] = list.sort().join(' | ');
    }
    return res;
  };
  const diff = (a, c) => Object.keys(a).filter((k) => a[k] !== c[k]).map((k) => `${k}: [${a[k]}] -> [${c[k]}]`);
  const rows = [];
  for (const [x, y] of [[66, 85], [79, 74], [70, 80], [60, 88], [85, 80]]) {
    if (!b.checkBuilding(x, y, 'bridge_stone').ok) { rows.push(`${x},${y}: cannot place`); continue; }
    const a = snap(x, y);
    b.placeBuilding(x, y, 'bridge_stone');
    g.render(1, 0);
    const c = snap(x, y);
    const d1 = diff(a, c);
    const p = b.bridgeAt(x, y);
    b.changeDeck(p, 1); b.changeDeck(p, 1);
    g.render(1, 0);
    const e = snap(x, y);
    const d2 = diff(c, e);
    b.removeBuilding?.(x, y) ?? g.build.removeAt?.(x, y);
    g.render(1, 0);
    const f = snap(x, y);
    const d3 = diff(a, f);
    rows.push(`${x},${y}: placing changed ${d1.length} of 25 tiles; raising changed ${d2.length}; after removal ${d3.length} differ from the start (platform still there: ${!!b.bridgeAt(x, y)})`);
    for (const l of d1.slice(0, 6)) rows.push('   place  ' + l);
    for (const l of d3.slice(0, 6)) rows.push('   remove ' + l);
  }
  return rows;
});
console.log(out.join('\n'));
await browser.close();
