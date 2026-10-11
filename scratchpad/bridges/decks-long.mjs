// A three-tile engine on the height-3 viaduct with trees in front of and behind it, and on the
// back one of two parallel bridges while a train stands beside its tail on the front one.
//   node scratchpad/bridges/decks-long.mjs [label=wip] [axis=x]
import { launch } from '../runtime.mjs';
import { mkdirSync } from 'node:fs';
const [label = 'wip', axis = 'x'] = process.argv.slice(2);
const out = `scratchpad/bridges/renders-${label}/`;
mkdirSync(out, { recursive: true });
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://127.0.0.1:5183/scratchpad/bridges/decks.html?axis=${axis}`);
await page.waitForFunction(() => window.qa, null, { timeout: 240000 });
const SHOTS = [
  ['VIA3-stone', 5, [[0, 6.3, 'big_boy', []]], 'long-VIA3-stone-a'],
  ['VIA3-stone', 5, [[0, 7.7, 'big_boy', []]], 'long-VIA3-stone-b'],
  ['VIA3-stone', 5, [[0, 9.1, 'big_boy', []]], 'long-VIA3-stone-c'],
  ['VIA3-wood', 5, [[0, 7.7, 'big_boy', []]], 'long-VIA3-wood-b'],
  ['PAR-HIGH-BEHIND', 5, [[0, 7.6, 'big_boy', []], [1, 5.2, 'adler', ['wooden_coach']]], 'long-PAR-back-ahead'],
  ['PAR-HIGH-BEHIND', 5, [[0, 7.6, 'big_boy', []], [1, 6.0, 'big_boy', []]], 'long-PAR-back-ahead-b'],
  ['G1-stone', 6, [[0, 5.6, 'big_boy', []], [1, 4.2, 'adler', ['wooden_coach']]], 'long-G1-front-train'],
];
for (const [id, zoom, trains, name] of SHOTS) {
  await page.evaluate(
    ([id, zoom, trains, text]) => {
      const s = qa.sites.find((s) => s.id === id);
      qa.clearTrains();
      for (const [w, head, loco, wagons] of trains) qa.trainAt(id, w, head, loco, wagons, 1);
      qa.g.trainRenderer.update(qa.g.fleet.trains, 1, 0);
      const d = qa.T(0, 0.5);
      qa.view(s.cx + d.x, s.cy + d.y, zoom, text);
    },
    [id, zoom, trains, `${label} · ${axis} · ${name} · zoom ${zoom}`],
  );
  await page.screenshot({ path: `${out}decks-${axis}-${name}.png` });
  console.log('CAPTURED', name);
}
console.log('errors', JSON.stringify(errors));
await browser.close();
