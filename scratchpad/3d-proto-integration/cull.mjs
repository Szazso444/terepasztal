import { launch } from '../runtime.mjs';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log('ERR', e.message));
await page.goto('http://127.0.0.1:5177/scratchpad/3d-proto-integration/index.html?sprites=B&ladder=B');
await page.waitForFunction(() => typeof window.qa?.frame === 'function', null, { timeout: 180000 });
await page.waitForFunction(() => qa.settled(), null, { timeout: 180000, polling: 200 });
await page.evaluate(() => qa.frame(3.2, 3));
console.log(JSON.stringify(await page.evaluate(() => qa.tests.cullTest())));
console.log(JSON.stringify(await page.evaluate(() => qa.tests.timing(500))));
// the game's own render path: does anything else touch train sprites? list properties set on them
console.log(JSON.stringify(await page.evaluate(() => {
  const s = qa.g.trainRenderer.cars.get(qa.t.id)[0].parts[0];
  return { cullable: s.cullable, roundPixels: s.roundPixels, blend: s.blendMode, label: s.label, parent: s.parent === qa.g.world.objects, renderer: qa.g.app.renderer.name, roundPixelsGlobal: qa.g.app.renderer._roundPixels, tickerStarted: qa.g.app.ticker.started };
})));
await browser.close();
