// Today's renderer on a busy scene: N locomotives (real game boot via the lineup scene), cost of
// trainRenderer.update and of the whole frame, draw calls with and without the trains.
//   node scratchpad/3d-proto-alt/run-busy.mjs gpu|igpu|sw [n]
import { launch } from '../runtime.mjs';
import { launchGpu } from './launch-gpu.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
const [kind = 'gpu', nArg = '40'] = process.argv.slice(2);
const N = Number(nArg);
const have = Object.keys(JSON.parse(readFileSync('G:/DEV/Terepasztal/pipeline-out-ladder/lengths-B2.json', 'utf8')));
const rows = Array.from({ length: N }, (_, i) => have[i % have.length]);
const browser = kind === 'gpu' ? await launchGpu() : kind === 'igpu' ? await launchGpu(['--force_low_power_gpu']) : await launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://127.0.0.1:5177/scratchpad/curve-sizes/lineup.html?sprites=B&ladder=B&rows=${rows.join(',')}&zoom=1`);
await page.waitForFunction(() => typeof window.qa?.shot === 'function', null, { timeout: 240000 });
const res = await page.evaluate(async () => {
  const g = window.game;
  const gl = g.app.renderer.gl;
  let draws = 0, tris = 0, binds = 0;
  for (const fn of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
    const orig = gl[fn].bind(gl);
    gl[fn] = (...a) => { draws++; tris += (fn.startsWith('drawElements') ? a[1] : a[2]) / 3; return orig(...a); };
  }
  const px = new Uint8Array(4);
  const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const out = { renderer: g.app.renderer.name, resolution: g.app.renderer.resolution };
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  out.gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '?';
  out.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  const trains = g.fleet.trains.slice();
  out.trains = trains.length;
  out.vehicles = trains.reduce((a, t) => a + t.vehiclePoses.length, 0);
  out.parts = trains.reduce((a, t) => a + t.vehiclePoses.reduce((b, v) => b + v.segments.length, 0), 0);
  out.bogies = trains.reduce((a, t) => a + t.vehiclePoses.reduce((b, v) => b + v.segments.reduce((c, s) => c + s.bogies.length, 0), 0), 0);
  const measure = (zoom, label) => {
    window.qa.shot(zoom);
    for (let i = 0; i < 5; i++) { g.render(1, 0); g.app.renderer.render(g.app.stage); sync(); }
    let upd = 0, frame = 0, total = 0; const F = 60;
    draws = 0; tris = 0;
    for (let i = 0; i < F; i++) {
      const t0 = performance.now();
      g.trainRenderer.update(g.fleet.trains, 1, 1 / 60);
      const t1 = performance.now();
      g.render(1, 0);
      g.app.renderer.render(g.app.stage);
      const t2 = performance.now();
      sync();
      const t3 = performance.now();
      upd += t1 - t0; frame += t2 - t1; total += t3 - t0;
    }
    out[label] = { zoom, trainUpdateMs: +(upd / F).toFixed(3), renderCpuMs: +(frame / F).toFixed(3), totalMs: +(total / F).toFixed(3), draws: +(draws / F).toFixed(1), tris: Math.round(tris / F) };
  };
  measure(1, 'withTrains_z1');
  measure(0.5, 'withTrains_z05');
  measure(2, 'withTrains_z2');
  // objects layer stats
  out.objectsChildren = g.world.objects.children.length;
  for (const t of trains) g.trainRenderer.remove(t.id);
  g.fleet.trains = [];
  measure(1, 'bare_z1');
  measure(0.5, 'bare_z05');
  out.objectsChildrenBare = g.world.objects.children.length;
  return out;
});
console.log(JSON.stringify(res, null, 1), errors.slice(0, 5));
writeFileSync(`scratchpad/3d-proto-alt/shots/busy-${kind}-${N}.json`, JSON.stringify(res, null, 1));
await page.screenshot({ path: `scratchpad/3d-proto-alt/shots/busy-${kind}-${N}.png` });
await browser.close();
