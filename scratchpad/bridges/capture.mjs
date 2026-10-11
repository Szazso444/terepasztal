// Bridge audit captures. node scratchpad/bridges/capture.mjs <kit|proc> <x|y> [z2|z4|all] [site id filter regexp]
import { launch } from '../runtime.mjs';
import { writeFileSync } from 'node:fs';
const [mode0 = 'kit', axis = 'x', which = 'all', filter = '.'] = process.argv.slice(2);
// mode: kit | proc | kitrev | procrev (rev: platforms built front to back)
const rev = mode0.endsWith('rev'), mode = mode0;
const proc = mode0.startsWith('proc');
const out = 'scratchpad/bridges/renders/';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://127.0.0.1:5183/scratchpad/bridges/index.html?axis=${axis}${proc ? '&proc=1' : ''}${rev ? '&rev=1' : ''}`);
await page.waitForFunction(() => window.qa, null, { timeout: 180000 });
const info = await page.evaluate(() => ({
  kit: qa.kit,
  origin: qa.origin,
  sites: qa.sites.map((s) => ({ id: s.id, cx: s.cx, cy: s.cy, row: s.row })),
  pads: qa.pads.map((p) => ({ id: p.id, cx: p.cx, cy: p.cy, placed: p.placed })),
}));
if (proc === info.kit) throw new Error(`mode ${mode} but bridgeKit=${info.kit}`);
console.log('bridges group:', info.origin, 'kit:', info.kit);
const re = new RegExp(filter);
const shot = async (name, cx, cy, zoom, text) => {
  await page.evaluate(([cx, cy, zoom, text]) => qa.view(cx, cy, zoom, text), [cx, cy, zoom, text]);
  await page.screenshot({ path: `${out}${mode}-${axis}-z${zoom}-${name}.png` });
  console.log('CAPTURED', `${mode}-${axis}-z${zoom}-${name}`);
};
const T = (l, w) => (axis === 'x' ? [l, w] : [w, l]);
const LW = (s) => (axis === 'x' ? [s.cx, s.cy] : [s.cy, s.cx]);
if (which === 'all' || which === 'z2') {
  // stone and wood of one case together: centred between their rows
  const pairs = new Map();
  for (const s of info.sites) {
    const base = s.id.replace(/-(stone|wood)$/, (m) => (s.row < 6 ? '' : m));
    if (!pairs.has(base)) pairs.set(base, []);
    pairs.get(base).push(s);
  }
  // W1 and W2 share a view
  for (const [id, list] of pairs) {
    if (!re.test(id) || id === 'W2') continue;
    let [l, w] = LW(list[0]);
    if (list.length > 1) w = (w + LW(list[1])[1]) / 2;
    if (id === 'W1') l = 18.25;
    const [cx, cy] = T(l, w);
    await shot(id === 'W1' ? 'W1+W2' : id, cx, cy, 2, `${mode} · axis ${axis} · ${id === 'W1' ? 'W1 + W2' : id} · zoom 2 (stone behind, wood in front)`);
  }
  for (const p of info.pads) if (re.test(p.id)) await shot(p.id, p.cx, p.cy, 2, `${mode} · axis ${axis} · ${p.id} · zoom 2`);
}
if (which === 'all' || which === 'z4') {
  for (const s of [...info.sites, ...info.pads]) if (re.test(s.id)) await shot(s.id, s.cx, s.cy, 4, `${mode} · axis ${axis} · ${s.id} · zoom 4`);
}
writeFileSync(`${out}${mode}-${axis}-info.json`, JSON.stringify(info, null, 1));
await browser.close();
if (errors.length) console.log('PAGE ERRORS', errors);
