// Scratch: does the ground under the rail rising toward a raised bridge get its embankment?
// Same step on a map with no hill at all (relief top = 1 px) and with a hill far away.
import { launch } from '../runtime.mjs';
const out = 'scratchpad/bridges/renders/';
const browser = await launch();
for (const hill of [false, true]) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:5183/scratchpad/bridges/heights.html');
  await page.waitForFunction(() => typeof window.qa?.view === 'function', null, { timeout: 240000 });
  const info = await page.evaluate(async (hill) => {
    if (hill) {
      qa.stampRect(80, 20, 90, 30, 2);
      qa.retile(80, 20, 90, 30);
    }
    await qa.scenes.rampOnLand();
    await qa.view(31, 60, 5);
    const g = qa.g,
      l = g.world.landscape;
    return {
      top: l.relief?.top,
      // ground height (px) the painter and picking see under the rail, along the approach tile
      ground: [30.6, 31, 31.3, 31.49].map((x) => +(-g.world.groundAt(x, 60).dz).toFixed(2)),
      rail: [30.6, 31, 31.3, 31.49].map((x) => +(-g.world.railAt(x, 60).dz).toFixed(2)),
    };
  }, hill);
  console.log(hill ? 'hill on the map' : 'flat map', JSON.stringify(info));
  await page.screenshot({ path: `${out}heights-approach-${hill ? 'hill' : 'flat'}.png`, clip: { x: 220, y: 150, width: 1000, height: 700 } });
  if (errors.length) console.log('PAGE ERRORS', errors);
  await page.close();
}
await browser.close();
