import { launch, baseURL } from '../runtime.mjs';
const browser = await launch();
try {
  const page = await browser.newPage();
  await page.goto(`${baseURL('after')}/scratchpad/curve-sizes/?cls=regular`);
  await page.waitForFunction(() => typeof window.qa?.show === 'function', null, { timeout: 240000 });
  console.log(await page.evaluate(() => {
    const r = qa.show(qa.ids.indexOf('gg1'), 'loco', 2.6);
    const t = qa.g.fleet.trains[0];
    return JSON.stringify({ state: r.state, progress: r.progress, msg: t.lastMessage, engaged: t.locos.map((l) => l.engaged) });
  }));
} finally { await browser.close(); }
