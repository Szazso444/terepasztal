import { launchGpu } from './launch-gpu.mjs';
const browser = await launchGpu(process.argv[2] === 'igpu' ? ['--force_low_power_gpu'] : []);
for (const pref of ['webgl', 'webgpu']) {
  const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:5177/scratchpad/3d-proto-alt/thumb.html?pref=${pref}`);
  try { await page.waitForFunction(() => window.result, null, { timeout: 60000 }); console.log(JSON.stringify(await page.evaluate(() => window.result))); await page.waitForTimeout(300); await page.screenshot({ path: `scratchpad/3d-proto-alt/shots/thumb-${pref}.png` }); }
  catch (e) { console.log(pref, 'FAILED', String(e).slice(0, 120), errors.slice(0, 3)); }
  await page.close();
}
await browser.close();
