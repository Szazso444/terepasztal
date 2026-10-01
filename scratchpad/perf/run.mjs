// node scratchpad/perf/run.mjs <out-dir>: benchmark + screenshots of fixed views.
import fs from 'node:fs';
const out = process.argv[2];
fs.mkdirSync(out, { recursive: true });
// PLAYWRIGHT: path to a playwright(-core) index.mjs; CHROME: a Chromium binary (optional).
const { chromium } = await import(process.env.PLAYWRIGHT ?? 'playwright-core');
const browser = await chromium.launch({
  executablePath: process.env.CHROME,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto('http://127.0.0.1:5190/scratchpad/perf/');
await page.waitForFunction(() => !!window.bench, null, { timeout: 600000 });
const report = await page.evaluate(() => window.bench.report);
const views = [
  [64, 64, 2],
  [40, 80, 2],
  [64, 64, 4],
  [90, 40, 6],
];
report.views = [];
for (const [x, y, z] of views) {
  report.views.push(await page.evaluate(([x, y, z]) => window.bench.view(x, y, z), [x, y, z]));
  await page.screenshot({ path: `${out}/view-${x}-${y}-z${z}.png` });
}
report.edit = await page.evaluate(() => window.bench.edit());
await page.evaluate(([x, y]) => window.bench.view(x, y, 4), report.edit.placed[0]);
await page.screenshot({ path: `${out}/edit.png` });
report.errors = errors;
console.log(JSON.stringify(report, null, 1));
fs.writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 1));
await browser.close();
