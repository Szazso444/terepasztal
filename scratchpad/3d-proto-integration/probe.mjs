// Scratch: run the integration probe scene headless, save data dumps and screenshots.
//   cd C:/Users/Zso/terepasztal-ladder && node scratchpad/3d-proto-integration/probe.mjs
import { launch } from '../runtime.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const out = 'scratchpad/3d-proto-integration/out';
mkdirSync(out, { recursive: true });
const URL = 'http://127.0.0.1:5177/scratchpad/3d-proto-integration/index.html?sprites=B&ladder=B';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`);
});
await page.goto(URL);
await page.waitForFunction(() => typeof window.qa?.frame === 'function', null, { timeout: 180000 });
await page.waitForFunction(() => qa.settled(), null, { timeout: 180000, polling: 200 });
const report = { errors, frames: {} };
const CLIP = { x: 240, y: 150, width: 800, height: 500 };
// level beside the scenery, climbing, on top, on the curve, after the curve
const STOPS = [
  ['level', 3.2],
  ['climb', 8.6],
  ['top', 12],
  ['curve', 23.6],
  ['south', 28],
];
for (const [name, progress] of STOPS) {
  const r = await page.evaluate(([p]) => qa.frame(p, 3), [progress]);
  await page.screenshot({ path: `${out}/${name}-sprite.png`, clip: CLIP });
  report.frames[name] = { ...r, dump: await page.evaluate(() => qa.dump()) };
  for (const mode of ['mesh', 'rt']) {
    const s = await page.evaluate(([m]) => qa.standin(m, 0, true), [mode]);
    await page.screenshot({ path: `${out}/${name}-${mode}.png`, clip: CLIP });
    report.frames[name][mode] = s;
  }
  if (name === 'level') report.objects = await page.evaluate(() => (qa.standin('mesh', 0, false), qa.objects()));
  await page.evaluate(() => qa.standin('off'));
}
report.gl = await page.evaluate(() => {
  const gl = qa.g.app.renderer.gl;
  return { version: gl.getParameter(gl.VERSION), attrs: gl.getContextAttributes(), depthBits: gl.getParameter(gl.DEPTH_BITS), stencilBits: gl.getParameter(gl.STENCIL_BITS), resolution: qa.g.app.renderer.resolution };
});
report.previews = await page.evaluate(() => qa.previews());
writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 1));
console.log('errors', errors.length, errors.slice(0, 8));
console.log('gl', JSON.stringify(report.gl));
await browser.close();
