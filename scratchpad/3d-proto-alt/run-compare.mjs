// node scratchpad/3d-proto-alt/run-compare.mjs [query]   -> shots/compare-*.png + numbers
import { launch } from '../runtime.mjs';
import { launchGpu } from './launch-gpu.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const out = 'scratchpad/3d-proto-alt/shots';
mkdirSync(out, { recursive: true });
const runs = process.argv.slice(2).length ? process.argv.slice(2) : ['part=engine', 'part=tender'];
const GPU = process.env.GPU;
const browser = GPU ? await launchGpu(GPU === 'igpu' ? ['--force_low_power_gpu'] : []) : await launch();
const all = {};
for (const query of runs) {
  const page = await browser.newPage({ viewport: { width: 1700, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errors.push(m.text()));
  await page.goto(`http://127.0.0.1:5177/scratchpad/3d-proto-alt/compare.html?${query}`);
  try {
    await page.waitForFunction(() => window.result, null, { timeout: 120000 });
  } catch (e) {
    console.log(query, 'FAILED', errors.slice(0, 8));
    await page.screenshot({ path: `${out}/compare-${query.replace(/[^a-z0-9]+/gi, '_')}-fail.png` });
    await page.close();
    continue;
  }
  const r = await page.evaluate(() => window.result);
  const name = (GPU ? GPU + '-' : '') + query.replace(/[^a-z0-9]+/gi, '_');
  await page.screenshot({ path: `${out}/compare-${name}.png` });
  all[query] = r;
  console.log(query, r.renderer, 'tris', r.tris, 'tex', r.texDim, 'mean', JSON.stringify(r.mean), 'worst', JSON.stringify(r.worst), errors.length ? errors.slice(0, 4) : '');
  await page.close();
}
writeFileSync(`${out}/compare.json`, JSON.stringify(all, null, 1));
await browser.close();
