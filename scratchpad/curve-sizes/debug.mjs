import { launch, baseURL } from '../runtime.mjs';
const browser = await launch();
try {
  const page = await browser.newPage();
  const logs = [];
  page.on('pageerror', (e) => logs.push('pageerror ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') logs.push('console ' + m.text()); });
  await page.goto(`${baseURL('after')}/scratchpad/curve-sizes/?cls=regular`);
  const ok = await page.waitForFunction(() => typeof window.qa?.show === 'function', null, { timeout: 240000 }).then(() => true).catch(() => false);
  console.log('ready', ok);
  console.log(logs.slice(0, 10).join('\n'));
  if (ok) console.log(await page.evaluate(() => JSON.stringify(qa.ids)));
} finally { await browser.close(); }
