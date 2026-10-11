// node scratchpad/3d-proto-export/capture.mjs <id> [runDir] [query] [label]   (from the repo root; dev server on 5177)
//   <id>      a locomotive exported into G:/DEV/Terepasztal/pipeline-out-ladder/mesh-proto/out/<id>
//   [runDir]  '' for the default export, or a sweep folder such as b12000_t1024
//   [query]   extra viewer parameters, e.g. "&rails=1&pitch=3"
//   [label]   suffix for the files written (so variants do not overwrite each other)
// Copies the GLB and the Blender reference renders into data/<tag>/, draws the GLB with viewer.js in
// headless Chrome and saves every canvas as shots/<tag>[_label]_webgl_y<yaw>.png plus a page screenshot.
// SOFT=1 uses SwiftShader as ../runtime.mjs does; the default is the machine's GPU (ANGLE D3D11).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch as launchSoft } from '../runtime.mjs';
import { launchGpu } from '../3d-proto-alt/launch-gpu.mjs';

const launch = process.env.SOFT ? launchSoft : launchGpu;
const here = path.dirname(fileURLToPath(import.meta.url));
const id = process.argv[2] ?? 'black_five';
const sub = process.argv[3] ?? '';
const extra = process.argv[4] ?? '';
const label = process.argv[5] ? `_${process.argv[5]}` : '';
const out = `G:/DEV/Terepasztal/pipeline-out-ladder/mesh-proto/out/${id}`;
const tag = sub ? `${id}_${sub}` : id;
const data = path.join(here, 'data', tag);
fs.mkdirSync(data, { recursive: true });
fs.mkdirSync(path.join(here, 'shots'), { recursive: true });
fs.copyFileSync(path.join(out, sub, `${id}.glb`), path.join(data, `${id}.glb`));
let view = null;
for (const name of fs.readdirSync(out).filter((n) => /^report.*\.json$/.test(n))) {
  const rep = JSON.parse(fs.readFileSync(path.join(out, name), 'utf8'));
  if (!rep.compare) continue;
  const v = rep.compare.views[0];
  const i = rep.runs.findIndex((r) => path.resolve(r.dir) === path.resolve(path.join(out, sub)));
  if (i < 0) continue;
  view = { yaws: rep.compare.yaws, size: v.size, anchor: v.anchor, ss: v.ss, px_per_tile: v.px_per_tile, hi: [], low: [], raw: [] };
  for (const [k, files] of [['hi', v.hi], ['low', v.low[i].files], ['raw', v.hi_as_processed ?? []]]) {
    for (const f of files) { fs.copyFileSync(f, path.join(data, path.basename(f))); view[k].push(path.basename(f)); }
  }
  if (!view.raw.length) delete view.raw;
}
if (!view) throw new Error(`no report lists ${path.join(out, sub)}`);
fs.writeFileSync(path.join(data, 'view.json'), JSON.stringify(view));

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1700, height: 900 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:5177/scratchpad/3d-proto-export/index.html?id=${id}&dir=data/${tag}${extra}`);
await page.waitForFunction('window.done || window.failed', null, { timeout: 60000 });
const failed = await page.evaluate('window.failed');
if (failed) throw new Error(failed);
console.log(JSON.stringify(await page.evaluate('window.stats')));
console.log(await page.evaluate('document.getElementById("info").textContent'));
const shots = await page.evaluate(() => [...document.querySelectorAll('canvas')].map((c) => [c.dataset.yaw, c.toDataURL('image/png')]));
for (const [yaw, url] of shots) fs.writeFileSync(path.join(here, 'shots', `${tag}${label}_webgl_y${yaw}.png`), Buffer.from(url.split(',')[1], 'base64'));
await page.screenshot({ path: path.join(here, 'shots', `${tag}${label}_page.png`), fullPage: true });
await browser.close();
