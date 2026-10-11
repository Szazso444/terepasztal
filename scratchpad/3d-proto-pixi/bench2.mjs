// node scratchpad/3d-proto-pixi/bench2.mjs [gpu]   -> extra cases: zoom / devicePixelRatio / MSAA / supersample
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const gpu = process.argv[2] === 'gpu';
let browser;
if (gpu) {
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
const cases = [
  // fill cost: the same 20 engines at zoom 4 on a devicePixelRatio 2 screen
  { approach: 'direct', n: 20, model: 'full', zoom: 4, dpr: 2 },
  { approach: 'direct', n: 20, model: 'd10', zoom: 4, dpr: 2 },
  { approach: 'atlas', n: 20, model: 'full', zoom: 4, dpr: 2 },
  { approach: 'atlas', n: 20, model: 'd10', zoom: 4, dpr: 2 },
  { approach: 'static', n: 20, model: 'd10', zoom: 4, dpr: 2 },
  { approach: 'separate', n: 20, model: 'd10', zoom: 4, dpr: 2 },
  { approach: 'atlas', n: 100, model: 'd10', zoom: 4, dpr: 2 },
  { approach: 'separate', n: 100, model: 'd10', zoom: 4, dpr: 2 },
  { approach: 'direct', n: 100, model: 'd10', zoom: 4, dpr: 2 },
  // antialiased impostors: 4x MSAA target, or 2x supersample shown at half size
  { approach: 'atlas', n: 20, model: 'd10', zoom: 1, dpr: 1, msaa: 1 },
  { approach: 'atlas', n: 100, model: 'd10', zoom: 1, dpr: 1, msaa: 1 },
  { approach: 'separate', n: 100, model: 'd10', zoom: 1, dpr: 1, msaa: 1 },
  { approach: 'atlas', n: 100, model: 'd10', zoom: 1, dpr: 1, ss: 2 },
  { approach: 'atlas', n: 100, model: 'full', zoom: 1, dpr: 1, msaa: 1 },
  { approach: 'atlas', n: 20, model: 'd10', zoom: 4, dpr: 2, msaa: 1 },
  // the lighter models
  { approach: 'direct', n: 100, model: 'd25', zoom: 1, dpr: 1 },
  { approach: 'direct', n: 100, model: 'd03', zoom: 1, dpr: 1 },
];
const results = [];
for (const c of cases) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: c.dpr });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 600)));
  const q = `scene=bench&approach=${c.approach}&n=${c.n}&model=${c.model}&zoom=${c.zoom}&frames=${gpu ? 60 : 12}` + (c.msaa ? '&msaa=1' : '') + (c.ss ? `&ss=${c.ss}` : '');
  await page.goto(`http://127.0.0.1:5177/scratchpad/3d-proto-pixi/page.html?${q}`);
  await page.waitForFunction(() => window.ready || window.fail, null, { timeout: 600000 });
  const r = await page.evaluate(() => window.report ?? { fail: window.fail });
  r.case = c;
  results.push(r);
  console.log(JSON.stringify(r));
  await ctx.close();
}
writeFileSync(`${dir}bench2-results${gpu ? '-gpu' : ''}.json`, JSON.stringify(results, null, 1));
await browser.close();
