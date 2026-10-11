import { launch, baseURL } from '../runtime.mjs';
const browser = await launch();
try {
  const page = await browser.newPage();
  await page.goto(`${baseURL('after')}/scratchpad/curve-sizes/?cls=regular`);
  await page.waitForFunction(() => typeof window.qa?.show === 'function', null, { timeout: 240000 });
  console.log(await page.evaluate(() => {
    const i = qa.ids.indexOf('crocodile');
    qa.show(i, 'loco', 2.6);
    const t = qa.g.fleet.trains[0];
    return JSON.stringify(t.vehiclePoses[0].segments.map((s) => ({ part: s.part, x: s.x, y: s.y, a: s.angle, L: s.L, b: s.bogies.map((b) => [b.x, b.y, b.hidden]) })));
  }));
} finally { await browser.close(); }
