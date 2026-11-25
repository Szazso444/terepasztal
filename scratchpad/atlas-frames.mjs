// Size and anchor of every frame the running game registered, so a generator change can show that
// frame counts and anchors did not move (art-sheets.mjs draws the frames but does not list them).
// usage: node scratchpad/atlas-frames.mjs <label>        writes shots/<label>/frames.json
//        node scratchpad/atlas-frames.mjs diff <a> <b>   keys added, removed and moved
import { launch, openGame } from './runtime.mjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const file = (label) => new URL(`./shots/${label}/frames.json`, import.meta.url);

if (process.argv[2] === 'diff') {
  const [a, b] = process.argv.slice(3).map((l) => JSON.parse(readFileSync(file(l), 'utf8')));
  const group = (keys) =>
    keys.reduce((n, k) => ((n[k.split('/')[0]] = (n[k.split('/')[0]] ?? 0) + 1), n), {});
  const moved = Object.keys(a).filter(
    (k) => k in b && JSON.stringify(a[k]) !== JSON.stringify(b[k]),
  );
  console.log('frames', Object.keys(a).length, '->', Object.keys(b).length);
  console.log('by group', group(Object.keys(a)), '->', group(Object.keys(b)));
  console.log(
    'added',
    Object.keys(b)
      .filter((k) => !(k in a))
      .map((k) => [k, b[k]]),
  );
  console.log(
    'removed',
    Object.keys(a).filter((k) => !(k in b)),
  );
  console.log(
    'moved',
    moved.map((k) => [k, a[k], b[k]]),
  );
} else {
  const label = process.argv[2] ?? 'after';
  const browser = await launch();
  try {
    const page = await openGame(browser, label);
    const frames = await page.evaluate(() => {
      const atlas = window.game.atlas;
      const out = {};
      for (const k of atlas.keys('')) {
        const f = atlas.get(k);
        const round = (v) => Math.round(v * 1000) / 1000;
        out[k] = { w: f.w, h: f.h, ax: round(f.anchorX * f.w), ay: round(f.anchorY * f.h) };
      }
      return out;
    });
    mkdirSync(new URL(`./shots/${label}/`, import.meta.url), { recursive: true });
    writeFileSync(file(label), JSON.stringify(frames, null, 1));
    console.log('wrote', Object.keys(frames).length, 'frames');
  } finally {
    await browser.close();
  }
}
