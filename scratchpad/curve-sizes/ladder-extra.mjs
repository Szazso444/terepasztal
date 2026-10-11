// Scratch: renders for the open questions (General/Jupiter as Frigates, Crocodile as a Battleship).
import { launch } from '../runtime.mjs';
const out = 'scratchpad/curve-sizes/ladder';
const LADDER = 'http://127.0.0.1:5177/scratchpad/curve-sizes/';
const RUNS = [
  ['frigate', 'cls=regular&len=general:1,jupiter:1', ['general', 'jupiter']],
  ['A25', 'cls=regular&len=crocodile:2.5', ['crocodile']],
  ['B3t', 'cls=regular&len=crocodile:3', ['crocodile']],
];
const browser = await launch();
const errors = [];
try {
  for (const [name, query, list] of RUNS) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
    await page.goto(`${LADDER}?${query}&ids=${list.join(',')}`);
    await page.waitForFunction(() => typeof window.qa?.show === 'function', null, { timeout: 180000 });
    const order = await page.evaluate(() => qa.ids);
    for (let i = 0; i < order.length; i++) {
      const r = await page.evaluate(([i]) => qa.show(i, 'loco', 1.5), [i]);
      await page.screenshot({ path: `${out}/${order[i]}-${name}.png`, clip: { x: 270, y: 170, width: 900, height: 620 } });
      console.log(order[i], name, r.lengths.loco);
    }
    await page.close();
  }
} finally {
  await browser.close();
  console.log(errors.length ? errors : 'no errors');
}
