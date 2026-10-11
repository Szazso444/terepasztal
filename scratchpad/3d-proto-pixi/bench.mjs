// node scratchpad/3d-proto-pixi/bench.mjs [gpu]   -> bench-results[-gpu].json
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const gpu = process.argv[2] === 'gpu';
let browser;
if (gpu) {
  // same Playwright the runtime uses, but with the machine's GPU instead of SwiftShader
  const pw = await import(new URL('../../terepasztal-scratch/node_modules/playwright/index.mjs', pathToFileURL(process.cwd() + '/scratchpad/')).href)
    .catch(() => import('playwright'));
  browser = await pw.chromium.launch({
    executablePath: `${process.env.ProgramFiles}/Google/Chrome/Application/chrome.exe`,
    headless: true,
    args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'],
  });
} else {
  browser = await (await import('../runtime.mjs')).launch();
}
const dir = new URL('.', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const results = [];
const only = process.argv[3];
const cases = [];
for (const model of ['full', 'd10'])
  for (const n of [1, 20, 100])
    for (const approach of ['direct', 'atlas', 'each', 'separate', 'static']) cases.push({ approach, n, model });
for (const c of cases) {
  if (only && !only.split(',').includes(c.approach)) continue;
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 600)));
  const q = `scene=bench&approach=${c.approach === 'static' ? 'static' : c.approach}&n=${c.n}&model=${c.model}&frames=${gpu ? 60 : 20}`;
  await page.goto(`http://127.0.0.1:5177/scratchpad/3d-proto-pixi/page.html?${q}`);
  await page.waitForFunction(() => window.ready || window.fail, null, { timeout: 600000 });
  const r = await page.evaluate(() => window.report ?? { fail: window.fail });
  results.push(r);
  console.log(JSON.stringify(r));
  if (c.n === 100 && c.model === 'full' && ['direct', 'atlas'].includes(c.approach))
    await page.screenshot({ path: `${dir}bench-${c.approach}-100${gpu ? '-gpu' : ''}.png` });
  await page.close();
}
writeFileSync(`${dir}bench-results${gpu ? '-gpu' : ''}.json`, JSON.stringify(results, null, 1));
await browser.close();
