// The real game from its front door: a new game on the main page, a few seconds of play, a bridge
// placed and raised through the builder. Lists failed requests and page errors.
//   node scratchpad/bridges/smoke-main.mjs [label=after]
import { launch } from '../runtime.mjs';
import { mkdirSync } from 'node:fs';
const [label = 'after'] = process.argv.slice(2);
const out = `scratchpad/bridges/renders-${label}/`;
mkdirSync(out, { recursive: true });
const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const failed = [];
context.on('response', (r) => r.status() >= 400 && failed.push(`${r.status()} ${r.url().replace('http://127.0.0.1:5183', '')}`));
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://127.0.0.1:5183/#seed=4242&new');
await page.waitForFunction(() => window.game?.fleet, null, { timeout: 240000 });
await page.waitForTimeout(2500);
const info = await page.evaluate(() => {
  const g = window.game;
  g.closeMenus?.();
  g.settings.autosave = false;
  // The first buildable grass tile near the depot with a free neighbour: a bridge, raised twice.
  const d = g.builder.depots()[0],
    b = g.builder;
  b.free = true;
  let placed = null;
  for (let r = 3; r < 12 && !placed; r++)
    for (let dx = -r; dx <= r && !placed; dx++) {
      const x = d.x + dx,
        y = d.y + r;
      if (b.checkBuilding(x, y, 'bridge_stone').ok && b.checkBuilding(x + 1, y, 'bridge_stone').ok) {
        const p = b.placeBuilding(x, y, 'bridge_stone');
        b.placeBuilding(x + 1, y, 'bridge_wood');
        b.changeDeck(p, 1);
        b.changeDeck(p, 1);
        placed = { x, y, deck: p.deck, beside: b.bridgeAt(x + 1, y).deck ?? 'automatic' };
      }
    }
  b.free = false;
  if (placed) {
    const w = { x: (placed.x - placed.y) * 32, y: (placed.x + placed.y) * 16 };
    g.camera.centerOn(w.x, w.y);
  }
  g.clock.setSpeed(1);
  return { mode: g.mode, placed, origin: g.atlas.groupOrigin.get('bridges') };
});
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}smoke-main.png` });
console.log(JSON.stringify(info));
console.log('failed requests', JSON.stringify(failed));
console.log('page errors', JSON.stringify(errors));
await browser.close();
