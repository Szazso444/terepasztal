import { launchGpu } from './launch-gpu.mjs';
const browser = await launchGpu();
for (const pref of ['webgl', 'webgpu']) {
  const page = await browser.newPage({ viewport: { width: 1500, height: 920 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errors.push(m.text()));
  await page.goto(`http://127.0.0.1:5177/scratchpad/3d-proto-alt/sheet.html?pref=${pref}&parts=mk48_body_r025,big_boy_engine_r025,big_boy_tender_r025,black_five_engine_r025,black_five_tender_r025`);
  try { await page.waitForFunction(() => window.result, null, { timeout: 90000 }); console.log(pref, JSON.stringify(await page.evaluate(() => window.result)), errors.filter((e) => !/404/.test(e)).slice(0, 4)); await page.screenshot({ path: `scratchpad/3d-proto-alt/shots/sheet-${pref}.png` }); }
  catch (e) { console.log(pref, 'FAILED', String(e).slice(0, 100), errors.slice(0, 4)); }
  await page.close();
}
await browser.close();
