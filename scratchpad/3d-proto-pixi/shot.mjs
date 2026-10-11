// node scratchpad/3d-proto-pixi/shot.mjs <out.png> "<query>" [dpr] [w] [h]
import { launch } from '../runtime.mjs';
const [out, query = '', dpr = '1', w = '1280', h = '800'] = process.argv.slice(2);
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: +w, height: +h }, deviceScaleFactor: +dpr });
const page = await ctx.newPage();
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) console.log('[console]', m.type(), m.text().slice(0, 600)); });
page.on('response', (r) => { if (r.status() >= 400) console.log('[http]', r.status(), r.url()); });
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 1200)));
await page.goto(`http://127.0.0.1:5177/scratchpad/3d-proto-pixi/page.html?${query}`);
await page.waitForFunction(() => window.ready || window.fail, null, { timeout: 120000 });
const fail = await page.evaluate(() => window.fail);
if (fail) console.log('[fail]', fail);
const info = await page.evaluate(() => ({ gl: window.proto?.app.glInfo, report: window.report }));
console.log(JSON.stringify(info));
await page.screenshot({ path: new URL(out, import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1') });
await browser.close();
