// Bridges built live against the same world loaded from its own save: terrain, platforms, deck
// heights and rail levels must come back unchanged, and the picture with them.
//   node scratchpad/bridges/decks-reload.mjs [label=after]
// Writes renders-<label>/reload-<site>-live.png and -loaded.png, and reload-report.json.
import { launch } from '../runtime.mjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
const [label = 'after'] = process.argv.slice(2);
const out = `scratchpad/bridges/renders-${label}/`;
mkdirSync(out, { recursive: true });
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const VIEWS = [
  ['dip', 0, 0, 4],
  ['ramp', 0, 0, 4],
  ['forest', 0, 0, 4],
  ['pond', 0, 0, 4],
  ['bare', 2.5, 0, 4],
  ['pad', 0.5, -0.5, 5],
];
async function run(query, tag) {
  await page.goto(`http://127.0.0.1:5183/scratchpad/bridges/decks-reload.html${query}`);
  await page.waitForFunction(() => window.qa, null, { timeout: 240000 });
  const info = await page.evaluate(() => ({ problems: qa.problems, facts: qa.facts(), load: qa.load, loadedFrom: qa.loadedFrom }));
  for (const [site, dx, dy, zoom] of VIEWS) {
    await page.evaluate(
      ([site, dx, dy, zoom, text]) => qa.view(qa.sites[site].x + dx, qa.sites[site].y + dy, zoom, text),
      [site, dx, dy, zoom, `${label} · ${site} · ${tag} · zoom ${zoom}`],
    );
    // The terrain repaints its close-up copy after the camera moved: compare finished pictures.
    await page.evaluate(() => qa.sharp());
    await page.screenshot({ path: `${out}reload-${site}-${tag}.png` });
    console.log('CAPTURED', `reload-${site}-${tag}`);
  }
  return info;
}
const live = await run('', 'live');
const stored = await page.evaluate(() => qa.store());
const loaded = await run('?load=1', 'loaded');
const level = await run('?level=1', 'level');
// A save of the previous version: no deck heights. The automatic bridge over the dip must look
// as it did (and keep its land); the decks set by hand are not in such a save.
const old = await run('?load=13', 'v13');
const oldDip = JSON.stringify(live.facts.dip) === JSON.stringify(old.facts.dip);
console.log('version 13 save: loaded from', old.loadedFrom, '· the automatic land bridge', oldDip ? 'is unchanged' : 'DIFFERS');
if (!oldDip || old.loadedFrom !== 13) process.exitCode = 1;
console.log('build problems', JSON.stringify(live.problems));
console.log('platforms with a deck height: saved', stored.saved, '· in the editor level', stored.inLevel, '· loaded from version', loaded.loadedFrom ?? 'current');
// A level does not carry capacity upgrades (it never did): everything else must come back.
const plain = (facts) => JSON.stringify(facts).replace(/[/]L[0-9]/g, '');
for (const [site] of VIEWS) {
  const same = plain(live.facts[site]) === plain(level.facts[site]);
  console.log(site.padEnd(8), 'as editor level: terrain, decks and rail', same ? 'equal' : 'DIFFER');
  if (!same) {
    process.exitCode = 1;
    live.facts[site].forEach((row, i) =>
      row.forEach((cell, j) => {
        if (plain(cell) !== plain(level.facts[site][i][j])) console.log('   ', i, j, 'live', cell, '| level', level.facts[site][i][j]);
      }),
    );
  }
}
const report = { problems: live.problems, sites: {}, errors };
let failed = !loaded.load || live.problems.length > 0;
for (const [site] of VIEWS) {
  const a = JSON.stringify(live.facts[site]),
    b = JSON.stringify(loaded.facts[site]),
    same = a === b;
  // The label differs ("live" / "loaded"): compare below the label strip.
  const p = PNG.sync.read(readFileSync(`${out}reload-${site}-live.png`)),
    q = PNG.sync.read(readFileSync(`${out}reload-${site}-loaded.png`));
  let differ = 0;
  for (let y = 44; y < p.height; y++)
    for (let x = 0; x < p.width; x++) {
      const k = (y * p.width + x) * 4;
      if (
        Math.abs(p.data[k] - q.data[k]) + Math.abs(p.data[k + 1] - q.data[k + 1]) + Math.abs(p.data[k + 2] - q.data[k + 2]) >
        24
      )
        differ++;
    }
  report.sites[site] = { factsEqual: same, pixelsDiffering: differ };
  if (!same || differ > 0) failed = true;
  console.log(site.padEnd(8), 'facts', same ? 'equal' : 'DIFFER', '· pixels differing:', differ);
  if (!same) {
    live.facts[site].forEach((row, i) =>
      row.forEach((cell, j) => {
        if (cell !== loaded.facts[site][i][j]) console.log('   ', i, j, 'live', cell, '| loaded', loaded.facts[site][i][j]);
      }),
    );
  }
}
report.live = live.facts;
console.log(failed ? 'RELOAD DIFFERS' : 'RELOAD KEEPS EVERYTHING', '· page errors', JSON.stringify(errors));
writeFileSync(`${out}reload-report.json`, JSON.stringify(report, null, 1));
await browser.close();
