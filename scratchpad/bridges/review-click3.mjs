// Review 3: what a right click does on a railed platform that already stands at its floor
// (real game, real mouse): the natural "lower the whole bridge in passes" gesture.
import { launch } from '../runtime.mjs';
const out = process.env.REVIEW_OUT ?? 'scratchpad/bridges/review2/';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('dialog', (d) => d.accept());
await page.goto('http://127.0.0.1:5183/#seed=4242&new');
await page.waitForFunction(() => window.game?.fleet, null, { timeout: 240000 });
await page.waitForFunction(() => window.game.world.landscape.ready, null, { timeout: 240000 });
await page.waitForTimeout(1500);
const R = await page.evaluate(async () => {
  const { levelAt } = await import('/src/world/elevation.ts');
  const g = window.game, m = g.map, b = g.builder;
  g.settings.autosave = false; g.settings.edgeScroll = false;
  const depot = b.stations.find((s) => s.def.depot);
  let best = null;
  for (let y = 4; y < m.h - 4; y++) for (let x = 6; x < m.w - 6; x++) {
    let ok = true;
    for (let i = -3; i <= 3 && ok; i++) for (let dy = -1; dy <= 1 && ok; dy++) ok = m.terrain[(y + dy) * m.w + x + i] === 0 && levelAt(m, x + i, y + dy) === 0 && !b.buildingAt(x + i, y + dy) && !b.stationAt(x + i, y + dy) && !g.track.has(x + i, y + dy) && !m.props.get((y + dy) * m.w + x + i)?.length && b.checkBuilding(x + i, y, 'bridge_stone').ok;
    if (!ok) continue;
    const d = Math.abs(x - depot.x) + Math.abs(y - depot.y);
    if (d > 4 && (!best || d < best.d)) best = { x, y, d };
  }
  return best;
});
console.log('row', JSON.stringify(R));
const frames = (n = 6) => page.waitForTimeout(n * 40);
const at = (x, y, surface = true) => page.evaluate(async ([x, y, surface]) => {
  const { tileToWorld } = await import('/src/engine/iso.ts');
  const g = window.game, p = tileToWorld(x, y), w = surface ? g.world.surfacePoint(x, y) : { x: p.x, y: p.y + g.world.elevationOf(x, y) }, s = g.camera.worldToScreen(w.x, w.y), r = g.app.canvas.getBoundingClientRect();
  return { x: r.left + s.x, y: r.top + s.y };
}, [x, y, surface]);
const move = async (x, y) => { const p = await at(x, y); await page.mouse.move(p.x, p.y, { steps: 5 }); await frames(); };
const click = async (button = 'left') => { await page.mouse.down({ button }); await page.mouse.up({ button }); await frames(); };
const pick = async (name) => {
  if (!(await page.locator('#toolbar .tb-item', { hasText: name }).count())) await page.locator('#toolbar .tb-cat', { hasText: /^Track$/ }).click();
  await frames();
  await page.locator('#toolbar .tb-item', { hasText: name }).first().click();
  await frames();
};
const row = () => page.evaluate(([x, y]) => {
  const g = window.game;
  return [-2, -1, 0, 1, 2].map((i) => { const b = g.builder.bridgeAt(x + i, y), t = g.track.get(x + i, y); return `${b ? 'P' + g.builder.deckLevel(b) : '--'}${t ? 't' : '.'}`; }).join(' ') + ' | stone ' + Math.floor(g.stock.get('stone')) + ' wood ' + Math.floor(g.stock.get('wood')) + ' iron ' + Math.floor(g.stock.get('iron')) + ' | status "' + (document.querySelector('#toolbar .tb-statusrow')?.firstElementChild?.textContent ?? '') + '"';
}, [R.x, R.y]);
await page.evaluate(async ([x, y]) => {
  const { tileToWorld } = await import('/src/engine/iso.ts');
  const g = window.game, p = tileToWorld(x, y);
  g.camera.zoomIndex = 4; g.camera.zoom = g.camera.targetZoom; g.camera.centerOn(p.x, p.y);
}, [R.x, R.y]);
await frames(10);
await pick('Stone Bridge');
for (const dx of [-1, 0, 1]) { await move(R.x + dx, R.y); await click(); }
await pick(/^1?Straight/);
{ const p0 = await at(R.x - 2, R.y, false), p1 = await at(R.x + 2, R.y, false);
  await page.mouse.move(p0.x, p0.y, { steps: 4 }); await frames(); await page.mouse.down(); await page.mouse.move(p1.x, p1.y, { steps: 12 }); await frames(); await page.mouse.up(); await frames(10); }
await pick('Stone Bridge');
console.log('built            :', await row());
for (const dx of [-1, 0, 1]) { await move(R.x + dx, R.y); await click(); }
console.log('each clicked up  :', await row());
// lower in passes: left, middle, right; then the same again (a player sweeping the bridge down)
for (const dx of [-1, 0, 1]) { await move(R.x + dx, R.y); await click('right'); }
console.log('pass 1 right-clk :', await row());
await page.screenshot({ path: `${out}click3-0-lowered.png`, clip: { x: 420, y: 300, width: 600, height: 400 } });
for (const dx of [-1, 0, 1]) { await move(R.x + dx, R.y); await click('right'); console.log(`pass 2, right click on span ${dx}:`, await row()); }
await page.screenshot({ path: `${out}click3-1-pass2.png`, clip: { x: 420, y: 300, width: 600, height: 400 } });
for (const dx of [-1, 0, 1]) { await move(R.x + dx, R.y); await click('right'); console.log(`pass 3, right click on span ${dx}:`, await row()); }
await page.screenshot({ path: `${out}click3-2-pass3.png`, clip: { x: 420, y: 300, width: 600, height: 400 } });
console.log('tool after:', await page.evaluate(() => window.game.build.tool.kind));
console.log('page errors', JSON.stringify(errors));
await browser.close();
