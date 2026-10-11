// Scratch: every loco through the first curve, now (origin/main) and on Ladder A and Ladder B.
//   node scratchpad/curve-sizes/ladder-capture.mjs   (ladder-explore on 5177, main-view on 5178)
import { launch } from '../runtime.mjs';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';

const out = 'scratchpad/curve-sizes/ladder';
mkdirSync(out, { recursive: true });
const LADDER = 'http://127.0.0.1:5177/scratchpad/curve-sizes/';
const MAIN = 'http://127.0.0.1:5178/scratchpad/sizes-now/';
const gear = JSON.parse(readFileSync('src/data/gear.json', 'utf8'));
const mainLocos = JSON.parse(
  readFileSync('C:/Users/Zso/terepasztal-mainview/src/data/locomotives.json', 'utf8'),
);
const NARROW = new Set(['rocket', 'bm50', 'muki', 'c50', 'mav490', 'mk45', 'mk48', 'rezet']);
const ids = Object.keys(gear);
const regular = ids.filter((id) => !NARROW.has(id));
const narrow = ids.filter((id) => NARROW.has(id));
const big = ids.filter((id) => gear[id].dbSize >= 4);
const inMain = new Map(mainLocos.map((d) => [d.id, d]));
const mainSmall = ids.filter((id) => inMain.has(id) && inMain.get(id).size !== 'large');
const mainLarge = ids.filter((id) => inMain.has(id) && inMain.get(id).size === 'large');

// [name, base url, query, ids]
const RUNS = [
  ['now', MAIN, 'cls=regular', mainSmall],
  ['now', MAIN, 'cls=high_speed', mainLarge],
  ['A', LADDER, 'cls=regular&ladder=A', regular],
  ['A', LADDER, 'cls=high_speed&ladder=A', narrow],
  ['B', LADDER, 'cls=regular&ladder=B', big],
  ['B3', LADDER, 'cls=high_speed&hsn=3&ladder=B', big],
  ['Bhalves', LADDER, 'cls=regular&ladder=B&halves=koutetsujou,dda40x', ['koutetsujou', 'dda40x']],
  ['Ahalves', LADDER, 'cls=regular&ladder=A&halves=koutetsujou,dda40x', ['koutetsujou', 'dda40x']],
];
const browser = await launch();
const report = { errors: [], shots: [] };
try {
  for (const [name, base, query, list] of RUNS) {
    if (!list.length) continue;
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('pageerror', (e) => report.errors.push(`${name} ${query}: ${e.message}`));
    await page.goto(`${base}?${query}&ids=${list.join(',')}`);
    await page.waitForFunction(() => typeof window.qa?.show === 'function', null, { timeout: 180000 });
    const order = await page.evaluate(() => qa.ids);
    for (let i = 0; i < order.length; i++) {
      const r = await page.evaluate(([i]) => qa.show(i, 'loco', 1.5), [i]);
      const file = `${order[i]}-${name}.png`;
      await page.screenshot({ path: `${out}/${file}`, clip: { x: 270, y: 170, width: 900, height: 620 } });
      report.shots.push({ id: order[i], name, query, file, loco: r.lengths.loco, state: r.state });
    }
    await page.close();
  }
} finally {
  await browser.close();
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 1));
  console.log(report.errors.length ? report.errors : 'no errors', report.shots.length, 'shots');
}
