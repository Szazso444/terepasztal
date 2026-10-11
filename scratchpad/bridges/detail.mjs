// Close-ups with the ideal tile diamonds overlaid (magenta, at rail height).
// node scratchpad/bridges/detail.mjs <kit|proc> <x|y> [filter]
import { launch } from '../runtime.mjs';
const [mode = 'kit', axis = 'x', filter = '.'] = process.argv.slice(2);
const out = 'scratchpad/bridges/renders/';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto(`http://127.0.0.1:5183/scratchpad/bridges/index.html?axis=${axis}${mode === 'proc' ? '&proc=1' : ''}`);
await page.waitForFunction(() => window.qa, null, { timeout: 180000 });
// [name, site, along offset from the span centre, across offset, zoom, grid, train]
const SHOTS = [
  ['W3-stone-joint', 'W3-stone', 0, 0.2, 8, true],
  ['W3-stone-joint-nogrid', 'W3-stone', 0, 0.2, 8, false],
  ['W3-stone-end', 'W3-stone', 1.6, 0.2, 8, true],
  ['W3-stone-start', 'W3-stone', -1.6, 0.2, 8, true],
  ['W3-wood-joint', 'W3-wood', 0, 0.2, 8, true],
  ['W3-wood-joint-nogrid', 'W3-wood', 0, 0.2, 8, false],
  ['W3-wood-end', 'W3-wood', 1.6, 0.4, 8, true],
  ['L3-stone-start', 'L3-stone', -1.4, 0.2, 8, true],
  ['L3-stone-end', 'L3-stone', 1.4, 0.2, 8, true],
  ['L3-wood-mid', 'L3-wood', 0, 0.3, 8, true],
  ['L1-stone', 'L1-stone', 0, 0.2, 8, true],
  ['L1-wood', 'L1-wood', 0, 0.2, 8, true],
  ['DW11-stone', 'DW11-stone', 0, 0, 6, true],
  ['DW11-wood', 'DW11-wood', 0, 0, 6, true],
  ['DL20-stone-end', 'DL20-stone', 1.2, 0, 8, true],
  ['DL21-stone', 'DL21-stone', 0.3, 0, 8, true],
  ['SW', 'SW', 0, 0, 6, true],
  ['SL-stone', 'SL-stone', 0, 0.5, 6, true],
  ['CW-stone', 'CW-stone', 0, 0, 6, true],
  ['CL-wood', 'CL-wood', 0, 0, 6, true],
  ['W3-stone-train', 'W3-stone', 0, 0, 6, false, true],
  ['W3-wood-train', 'W3-wood', 0, 0, 6, false, true],
  ['L3-stone-train', 'L3-stone', 0, 0, 6, false, true],
];
const re = new RegExp(filter);
for (const [name, id, dl, dw, zoom, grid, train] of SHOTS) {
  if (!re.test(name)) continue;
  const ok = await page.evaluate(
    ([id, dl, dw, zoom, grid, train, text]) => {
      const s = [...qa.sites, ...qa.pads].find((s) => s.id === id);
      if (!s) return false;
      qa.grid(grid);
      qa.g.fleet.trains = [];
      if (train) {
        // head two tiles past the span centre, body trailing back over the bridge
        const a = qa.T(s.l0 + s.bridge[s.bridge.length - 1] + 1, s.w0);
        qa.train(a.x, a.y, qa.axis === 'x' ? 3 : 0);
        qa.g.trainRenderer.update(qa.g.fleet.trains, 1, 0);
      }
      const d = qa.T(dl, dw);
      qa.view(s.cx + d.x, s.cy + d.y, zoom, text);
      return true;
    },
    [id, dl, dw, zoom, grid, !!train, `${mode} · axis ${axis} · ${name} · zoom ${zoom}${grid ? ' · magenta = ideal tile diamond at rail height' : ''}`],
  );
  if (!ok) continue;
  await page.screenshot({ path: `${out}${mode}-${axis}-detail-${name}.png` });
  console.log('CAPTURED', `${mode}-${axis}-detail-${name}`);
}
await browser.close();
