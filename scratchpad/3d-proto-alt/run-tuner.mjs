// node scratchpad/3d-proto-alt/run-tuner.mjs gpu|igpu|sw [query]  -> shots/tuner-*.png + latencies
import { launch } from '../runtime.mjs';
import { launchGpu } from './launch-gpu.mjs';
import { writeFileSync } from 'node:fs';
const [kind = 'gpu', query = 'mode=B&glb=_r025'] = process.argv.slice(2);
const browser = kind === 'gpu' ? await launchGpu() : kind === 'igpu' ? await launchGpu(['--force_low_power_gpu']) : await launch();
const page = await browser.newPage({ viewport: { width: 1620, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(`http://127.0.0.1:5177/scratchpad/3d-proto-alt/tuner.html?${query}`);
await page.waitForFunction(() => window.ready, null, { timeout: 120000 });
const tag = `${kind}-${query.replace(/[^a-z0-9]+/gi, '_')}`;
const shot = (n) => page.screenshot({ path: `scratchpad/3d-proto-alt/shots/tuner-${tag}-${n}.png` });
const out = { kind, query };
await shot('1-as-exported');
out.stand = await page.evaluate(() => window.tuner.standOnWheels());
await shot('2-stood-on-wheels');
out.fitStandard = await page.evaluate(() => window.tuner.fitGauge());
await shot('3-fit-standard-gauge');
// the owner drags: 40 steps on each slider, the redraw time of every step
out.drag = await page.evaluate(() => {
  const res = {};
  const sweep = (id, a, b) => { const ms = []; for (let i = 0; i <= 40; i++) ms.push(window.tuner.drag(id, a + ((b - a) * i) / 40)); ms.sort((x, y) => x - y); res[id] = { median: +ms[20].toFixed(2), worst: +ms[40].toFixed(2) }; };
  sweep('sx', 1, 1.25); sweep('sz', 1, 1.15); sweep('heading', 20, 200); sweep('grade', 0, 22.8); sweep('lift', 0, 0.2); sweep('lift', 0.2, 0);
  return res;
});
await shot('4-longer-taller-on-a-climb');
out.narrow = await page.evaluate(() => {
  document.getElementById('gauge').value = '760'; document.getElementById('gauge').dispatchEvent(new Event('change'));
  window.tuner.drag('grade', 0); window.tuner.drag('heading', 20);
  return window.tuner.fitGauge();
});
await shot('5-760mm');
out.modeA = await page.evaluate(() => { document.getElementById('mode').value = 'A'; document.getElementById('mode').dispatchEvent(new Event('change')); const ms = []; for (let i = 0; i <= 40; i++) ms.push(window.tuner.drag('heading', 20 + i)); ms.sort((x, y) => x - y); return { median: +ms[20].toFixed(2), worst: +ms[40].toFixed(2) }; });
await shot('6-direct-mesh');
out.json = await page.evaluate(() => window.tuner.json());
out.errors = errors;
console.log(JSON.stringify(out, null, 1));
writeFileSync(`scratchpad/3d-proto-alt/shots/tuner-${tag}.json`, JSON.stringify(out, null, 1));
await browser.close();
