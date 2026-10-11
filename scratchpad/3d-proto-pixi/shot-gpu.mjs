// node scratchpad/3d-proto-pixi/shot-gpu.mjs <out.png> "<query>" [dpr] [w] [h]   (hardware GPU through ANGLE D3D11)
import { pathToFileURL } from 'node:url';
const [out, query = '', dpr = '1', w = '1280', h = '800'] = process.argv.slice(2);
const pw = await import(new URL('../../terepasztal-scratch/node_modules/playwright/index.mjs', pathToFileURL(process.cwd() + '/scratchpad/')).href)
  .catch(() => import('playwright'));
const browser = await pw.chromium.launch({
  executablePath: `${process.env.ProgramFiles}/Google/Chrome/Application/chrome.exe`,
  headless: true,
  args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'],
});
const ctx = await browser.newContext({ viewport: { width: +w, height: +h }, deviceScaleFactor: +dpr });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 1200)));
await page.goto(`http://127.0.0.1:5177/scratchpad/3d-proto-pixi/page.html?${query}`);
await page.waitForFunction(() => window.ready || window.fail, null, { timeout: 120000 });
const fail = await page.evaluate(() => window.fail);
if (fail) console.log('[fail]', fail);
console.log(JSON.stringify(await page.evaluate(() => ({ gl: window.proto?.app.glInfo?.renderer, depthBits: window.proto?.app.glInfo?.depthBits, report: window.report }))));
await page.screenshot({ path: new URL(out, import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1') });
await browser.close();
