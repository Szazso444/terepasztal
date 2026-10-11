// Scratch: the Koutetsujou with its bogies spread evenly, through the first curve.
import { launch } from '../runtime.mjs';
const out = 'scratchpad/curve-sizes/ladder';
const B = 'http://127.0.0.1:5177/scratchpad/curve-sizes/';
const RUNS = [
  ['Aspread', 'cls=regular&ladder=A&spread=koutetsujou:0.125'],
  ['Bspread', 'cls=regular&ladder=B&spread=koutetsujou:0.125'],
  ['B3spread', 'cls=high_speed&hsn=3&ladder=B&spread=koutetsujou:0.125'],
];
const b = await launch();
const errs = [];
for (const [name, q] of RUNS) {
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`${B}?${q}&ids=koutetsujou`);
  await p.waitForFunction(() => typeof window.qa?.show === 'function', null, { timeout: 180000 });
  const r = await p.evaluate(() => qa.show(0, 'loco', 1.5));
  await p.screenshot({ path: `${out}/koutetsujou-${name}.png`, clip: { x: 270, y: 170, width: 900, height: 620 } });
  console.log(name, r.lengths.loco);
  await p.close();
}
await b.close();
console.log(errs.length ? errs : 'no errors');
