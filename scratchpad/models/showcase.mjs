// Builds the engine showcase in the demo build and writes it as a save file.
//   node scratchpad/models/showcase.mjs
import { launch } from '../runtime.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const out = 'scratchpad/models/out';
mkdirSync(out, { recursive: true });
const b = await launch();
const p = await b.newPage({ viewport: { width: 1800, height: 1100 } });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://127.0.0.1:5182/scratchpad/models/showcase.html');
await p.waitForFunction(() => typeof window.qa?.build === 'function', null, { timeout: 240000 });
const made = await p.evaluate(() => qa.build());
console.log('seed', await p.evaluate(() => [qa.SEED, qa.treesAtParade(qa.SEED)]));
console.log(JSON.stringify({ trains: made.trains, skipped: made.skipped, states: made.states }, null, 1));
console.log(made.parked.map((q) => `${q.n}:${q.id}:${q.state}:L${q.L}:head${q.head}`).join(' '));
const json = await p.evaluate(() => qa.saveJson());
writeFileSync('G:/DEV/Terepasztal/saves/engine-models-demo.json', json);
console.log('save', (json.length / 1024).toFixed(0), 'kB');
for (const [name, x, y, zoom, hour] of [['parade-a', 18, 78, 1.5, 13], ['parade-b', 50, 78, 1.5, 13], ['parade-night', 18, 70, 2, 23], ['loop', 43, 32, 1, 13], ['narrow', 102, 26, 2, 13]]) {
  await p.evaluate(([x, y, zoom, hour]) => qa.view(x, y, zoom, hour), [x, y, zoom, hour]);
  await p.evaluate(() => qa.settle());
  await p.screenshot({ path: `${out}/showcase-${name}.png` });
}
console.log(errs.length ? errs : 'no errors');
await b.close();
