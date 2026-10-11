// node scratchpad/3d-proto-alt/run-perf.mjs gpu|sw [query ...]
import { launch } from '../runtime.mjs';
import { launchGpu } from './launch-gpu.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
const [kind, ...queries] = process.argv.slice(2);
const browser = kind === 'gpu' ? await launchGpu() : kind === 'igpu' ? await launchGpu(['--force_low_power_gpu']) : await launch();
mkdirSync('scratchpad/3d-proto-alt/shots', { recursive: true });
const out = [];
for (const query of queries) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`http://127.0.0.1:5177/scratchpad/3d-proto-alt/perf.html?${query}`);
  try {
    await page.waitForFunction(() => window.result, null, { timeout: Number(process.env.TMO ?? 90000) });
    const r = await page.evaluate(() => window.result);
    out.push({ kind, query, ...r });
    console.log(kind, query.padEnd(46), `cpu ${r.cpuMs} ms  total ${r.totalMs} ms  worst ${r.worstMs}  draws ${r.drawsPerFrame}  tris ${r.trisPerFrame}  impostors/frame ${r.impostorRendersPerFrame}  cache ${r.cacheEntries} (${r.cacheMB} MB)  [${r.renderer} ${r.gpu.slice(0, 60)}]`);
    if (process.env.SHOT) await page.screenshot({ path: `scratchpad/3d-proto-alt/shots/perf-${kind}-${query.replace(/[^a-z0-9]+/gi, '_')}.png` });
  } catch (e) {
    console.log(kind, query, 'FAILED', String(e).slice(0, 100), errors.slice(0, 5));
  }
  await page.close();
}
writeFileSync(`scratchpad/3d-proto-alt/shots/perf-${kind}-${Date.now()}.json`, JSON.stringify(out, null, 1));
await browser.close();
