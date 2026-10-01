// Scratch: frames of trains crossing a hill, for a before/after of how they pitch.
//   node scratchpad/slope-pitch/capture.mjs <tag> [port]   -> scratchpad/slope-pitch/frames/<tag>/
import { launch } from '../runtime.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const tag = process.argv[2] ?? 'before';
const port = process.argv[3] ?? '5179';
const out = `scratchpad/slope-pitch/frames/${tag}`;
mkdirSync(out, { recursive: true });
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://127.0.0.1:${port}/scratchpad/slope-pitch/`);
await page.waitForFunction(() => typeof window.qa?.start === 'function', null, { timeout: 180000 });
await page.waitForFunction(() => qa.settled(), null, { timeout: 180000, polling: 200 });
const CLIP = { x: 320, y: 250, width: 800, height: 500 };
const report = { stills: [], anims: [] };
// [line, dir, name]
const RUNS = [
  ['x', 1, 'x-east'],
  ['x', -1, 'x-west'],
  ['y', 1, 'y-south'],
  ['y', -1, 'y-north'],
];
for (const consist of [0, 1]) {
  for (const [line, dir, name] of RUNS) {
    const info = await page.evaluate(([l, d, c]) => qa.start(l, d, c), [line, dir, consist]);
    await page.waitForFunction(() => qa.settled(), null, { timeout: 180000, polling: 200 });
    // stills: the engine on the way up, on top, and on the way down
    for (const [label, progress] of [['up', 7.2], ['top', 11], ['down', 17.2]]) {
      const r = await page.evaluate(([p]) => qa.frame(p, 3, true), [progress]);
      const file = `still-${name}-c${consist}-${label}.png`;
      await page.screenshot({ path: `${out}/${file}`, clip: CLIP });
      report.stills.push({ file, name, consist, label, loco: info.name, ...r });
    }
    if (dir < 0) continue;
    // animation: restart, then every quarter tile across the hill
    await page.evaluate(([l, d, c]) => qa.start(l, d, c), [line, dir, consist]);
    const frames = [];
    for (let p = 3, i = 0; p <= 21; p += 0.25, i++) {
      await page.evaluate(([p]) => qa.frame(p, 3, true), [p]);
      const file = `anim-${name}-c${consist}-${String(i).padStart(3, '0')}.png`;
      await page.screenshot({ path: `${out}/${file}`, clip: CLIP });
      frames.push(file);
    }
    report.anims.push({ name, consist, loco: info.name, frames });
    console.log(tag, name, 'consist', consist, info.name, frames.length, 'frames', JSON.stringify(info.levels));
  }
}
await browser.close();
writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 1));
console.log(errors.length ? errors : 'no errors');
