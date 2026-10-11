// Review: nature beside newly placed platforms in the real game (season tint on rebuilt sprites).
import { launch } from '../runtime.mjs';
const out = 'scratchpad/bridges/review2/';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on('dialog', (d) => d.accept());
await page.goto('http://127.0.0.1:5183/#seed=4242&new');
await page.waitForFunction(() => window.game?.fleet, null, { timeout: 240000 });
await page.waitForFunction(() => window.game.world.landscape.ready, null, { timeout: 240000 });
await page.waitForTimeout(1000);
// a row of 5 free flat tiles with the most nature sprites on the rows beside it
const spot = await page.evaluate(async () => {
  const { levelAt } = await import('/src/world/elevation.ts');
  const g = window.game, w = g.world, m = g.map, b = g.builder;
  g.settings.autosave = false; g.settings.edgeScroll = false; b.free = true;
  g.clock.setSpeed(0);
  let best = null;
  for (let y = 60; y < 100; y++) for (let x = 60; x < 100; x++) {
    let ok = true, n = 0;
    for (let i = -2; i <= 2 && ok; i++) {
      ok = m.terrain[y * m.w + x + i] === 0 && levelAt(m, x + i, y) === 0 && b.checkBuilding(x + i, y, 'bridge_wood').ok;
      for (const dy of [-1, 1]) n += (w.scatterSprites.get((y + dy) * m.w + x + i) ?? []).length;
    }
    if (ok && (!best || n > best.n)) best = { x, y, n };
  }
  return best;
});
console.log('spot', JSON.stringify(spot));
const view = async () => {
  await page.evaluate(async ([x, y]) => {
    const { tileToWorld } = await import('/src/engine/iso.ts');
    const g = window.game, p = tileToWorld(x, y);
    g.camera.zoomIndex = 6; g.camera.zoom = g.camera.targetZoom; g.camera.centerOn(p.x, p.y);
  }, [spot.x, spot.y]);
  await page.mouse.move(100, 100);
  await page.waitForTimeout(700);
};
await view();
const clip = { x: 270, y: 200, width: 900, height: 560 };
await page.screenshot({ path: out + 'tint-0-before.png', clip });
const tints = () => page.evaluate(([x, y]) => {
  const g = window.game, w = g.world, m = g.map, t = {};
  for (let dy = -1; dy <= 1; dy += 2) for (let i = -3; i <= 3; i++) for (const e of w.scatterSprites.get((y + dy) * m.w + x + i) ?? []) { const k = e.s.tint.toString(16); t[k] = (t[k] ?? 0) + 1; }
  return t;
}, [spot.x, spot.y]);
console.log('nature sprite tints beside the row before:', JSON.stringify(await tints()), '| season tint now:', await page.evaluate(() => window.game.world.propTint.toString(16)));
await page.evaluate(([x, y]) => { for (let i = -2; i <= 2; i++) window.game.builder.placeBuilding(x + i, y, 'bridge_wood'); }, [spot.x, spot.y]);
await view();
await page.screenshot({ path: out + 'tint-1-placed.png', clip });
console.log('after placing 5 platforms:', JSON.stringify(await tints()));
await browser.close();
