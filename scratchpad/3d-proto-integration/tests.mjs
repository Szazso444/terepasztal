// Scratch: behaviour of a 3D stand-in in the object layer (depth, tint, alpha, culling), how often
// a cached per-part render would be redrawn, and the 2D UI routes.
//   cd C:/Users/Zso/terepasztal-ladder && node scratchpad/3d-proto-integration/tests.mjs
import { launch } from '../runtime.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const out = 'scratchpad/3d-proto-integration/out';
mkdirSync(out, { recursive: true });
const URL = 'http://127.0.0.1:5177/scratchpad/3d-proto-integration/index.html?sprites=B&ladder=B';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`[${m.type()}] ${m.text()}`);
});
await page.goto(URL);
await page.waitForFunction(() => typeof window.qa?.frame === 'function', null, { timeout: 180000 });
await page.waitForFunction(() => qa.settled(), null, { timeout: 180000, polling: 200 });
const CLIP = { x: 240, y: 150, width: 800, height: 500 };
const report = { errors };
const shot = (name) => page.screenshot({ path: `${out}/${name}.png`, clip: CLIP });

await page.evaluate(() => qa.frame(3.2, 3));
// depth: two overlapping parts, the nearer drawn later
for (const mode of ['none', 'local', 'global']) {
  report['twin-' + mode] = await page.evaluate(([m]) => qa.tests.twinTest(m), [mode]);
  await shot('twin-' + mode);
}
await page.evaluate(() => qa.tests.clearTwins());
await page.evaluate(() => qa.frame(3.2, 3));
// tint: selection tint, then the night tint the world lays over every object
report.tint = await page.evaluate(() => qa.tests.tintTest(0x5c6bad, true));
await shot('tint-night-selected');
report.tintDay = await page.evaluate(() => qa.tests.tintTest(0xffffff, false));
await shot('tint-day');
// the world fades out when the overview opens
report.alpha = await page.evaluate(() => qa.tests.alphaTest(0.45));
await shot('alpha-045');
report.cull = await page.evaluate(() => qa.tests.cullTest());
// zoom range: the sprite against the stand-in at zoom 1 and 4
for (const z of [1, 4]) {
  await page.evaluate(([zz]) => (qa.standin('off'), qa.frame(3.2, zz)), [z]);
  await shot(`zoom${z}-sprite`);
  await page.evaluate(() => qa.standin('rt', 0, true));
  await shot(`zoom${z}-rt`);
  report[`rt-zoom${z}`] = await page.evaluate(() => qa.state.log.slice(-1)[0]);
  await page.evaluate(() => qa.standin('off'));
}
report.extract = await page.evaluate(async () => {
  qa.standin('rt', 0, true);
  const e = await qa.extractStandin();
  qa.standin('off');
  return e && { w: e.w, h: e.h, urlBytes: e.url.length, head: e.url.slice(0, 30) };
});
report.timing = await page.evaluate(() => qa.tests.timing());
// mid-curve frame
await page.evaluate(() => qa.frame(25.3, 3));
await shot('midcurve-sprite');
report.midcurve = await page.evaluate(() => qa.dump().vehicles[0].segments.map((s) => ({ part: s.part, pose: s.pose, sprite: s.sprite })));
await page.evaluate(() => qa.standin('mesh', 0, true));
await shot('midcurve-mesh');
await page.evaluate(() => qa.standin('off'));
writeFileSync(`${out}/tests.json`, JSON.stringify(report, null, 1));
await browser.close();

// a fresh page for the whole run: how often would a cached part render be redrawn
const b2 = await launch();
const p2 = await b2.newPage({ viewport: { width: 1280, height: 800 } });
await p2.goto(URL);
await p2.waitForFunction(() => typeof window.qa?.frame === 'function', null, { timeout: 180000 });
await p2.waitForFunction(() => qa.settled(), null, { timeout: 180000, polling: 200 });
report.rerender = {
  levelStraight: await p2.evaluate(() => qa.tests.rerenderRun(1, 5)),
  overTheHill: await p2.evaluate(() => qa.tests.rerenderRun(5, 21)),
  curve: await p2.evaluate(() => qa.tests.rerenderRun(21, 28)),
  after: await p2.evaluate(() => qa.tests.rerenderRun(28, 32)),
};
writeFileSync(`${out}/tests.json`, JSON.stringify(report, null, 1));
await b2.close();
console.log(JSON.stringify(report, null, 1));
