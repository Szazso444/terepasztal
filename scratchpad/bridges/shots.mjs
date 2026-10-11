// One fixed set of bridge scenes, shot at fixed camera positions.
//   node scratchpad/bridges/shots.mjs <before|after> [config filter regexp] [shot filter regexp]
// Writes scratchpad/bridges/renders-<label>/<mode>-<axis>-<shot>.png. Run it once on the code
// before a drawing change and once after: the names and cameras are the same.
import { launch } from '../runtime.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const [label = 'before', cfgFilter = '.', shotFilter = '.'] = process.argv.slice(2);
const out = `scratchpad/bridges/renders-${label}/`;
mkdirSync(out, { recursive: true });
const cfgRe = new RegExp(cfgFilter),
  shotRe = new RegExp(shotFilter);
// [name, site, along offset from the span centre, across offset, zoom, grid, train]
const DETAILS = [
  ['W3-stone-joint', 'W3-stone', 0, 0.2, 8, true],
  ['W3-stone-joint-nogrid', 'W3-stone', 0, 0.2, 8, false],
  ['W3-stone-end', 'W3-stone', 1.6, 0.2, 8, true],
  ['W3-stone-start', 'W3-stone', -1.6, 0.2, 8, true],
  ['W3-wood-joint', 'W3-wood', 0, 0.2, 8, true],
  ['W3-wood-joint-nogrid', 'W3-wood', 0, 0.2, 8, false],
  ['W3-wood-end', 'W3-wood', 1.6, 0.4, 8, true],
  ['W1-stone', 'W1-stone', 0, 0.2, 8, false],
  ['W1-wood', 'W1-wood', 0, 0.2, 8, false],
  ['L3-stone-start', 'L3-stone', -1.4, 0.2, 8, true],
  ['L3-stone-end', 'L3-stone', 1.4, 0.2, 8, true],
  ['L3-wood-mid', 'L3-wood', 0, 0.3, 8, true],
  ['L1-stone', 'L1-stone', 0, 0.2, 8, true],
  ['L1-wood', 'L1-wood', 0, 0.2, 8, true],
  ['DW11-stone', 'DW11-stone', 0, 0, 6, true],
  ['DW11-wood', 'DW11-wood', 0, 0, 6, true],
  ['DW10-stone', 'DW10-stone', 0, 0, 6, true],
  ['DL20-stone-end', 'DL20-stone', 1.2, 0, 8, true],
  ['DL20-wood-end', 'DL20-wood', 1.2, 0, 8, false],
  ['DL21-stone', 'DL21-stone', 0.3, 0, 8, true],
  ['SW', 'SW', 0, 0, 6, true],
  ['SL-stone', 'SL-stone', 0, 0.5, 6, true],
  ['SL-mixed', 'SL-mixed', 0, 0.5, 6, false],
  ['CW-stone', 'CW-stone', 0, 0, 6, true],
  ['CW-wood', 'CW-wood', 0, 0, 6, false],
  ['SWI-stone', 'SWI-stone', 0, 0, 6, false],
  ['CL-stone', 'CL-stone', 0, 0, 6, false],
  ['CL-wood', 'CL-wood', 0, 0, 6, true],
  ['W3-stone-train', 'W3-stone', 0, 0, 6, false, true],
  ['W3-wood-train', 'W3-wood', 0, 0, 6, false, true],
  ['L3-stone-train', 'L3-stone', 0, 0, 6, false, true],
  ['L3-wood-train', 'L3-wood', 0, 0, 6, false, true],
];
// mode, axis, what to shoot
const CONFIGS = [
  ['kit', 'x', { z2: '.', z4: '.', detail: '.', upgrade: true }],
  ['kit', 'y', { z2: '.', z4: '.', detail: '.' }],
  ['proc', 'x', { z4: '.', detail: 'W3|L3|L1|DW11|CW|CL-wood|SW$' }],
  ['proc', 'y', { z4: '^(W3|L3|CW|SW|DW11)' }],
  ['kitrev', 'x', { z4: '^(SW|W3|SL-stone)' }],
];
const browser = await launch();
const report = {};
for (const [mode, axis, what] of CONFIGS) {
  const tag = `${mode}-${axis}`;
  if (!cfgRe.test(tag)) continue;
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const proc = mode.startsWith('proc'),
    rev = mode.endsWith('rev');
  await page.goto(
    `http://127.0.0.1:5183/scratchpad/bridges/index.html?axis=${axis}${proc ? '&proc=1' : ''}${rev ? '&rev=1' : ''}`,
  );
  await page.waitForFunction(() => window.qa, null, { timeout: 240000 });
  const info = await page.evaluate(() => ({
    kit: qa.kit,
    origin: qa.origin,
    problems: qa.problems,
    sites: qa.sites.map((s) => ({ id: s.id, cx: s.cx, cy: s.cy, row: s.row, facts: qa.facts(s) })),
    pads: qa.pads.map((p) => ({ id: p.id, cx: p.cx, cy: p.cy, placed: p.placed, tries: p.tries })),
  }));
  if (proc === info.kit) throw new Error(`mode ${mode} but kit=${info.kit}`);
  report[tag] = info;
  const shot = async (name, cx, cy, zoom, text) => {
    if (!shotRe.test(name)) return;
    await page.evaluate(([cx, cy, zoom, text]) => qa.view(cx, cy, zoom, text), [cx, cy, zoom, text]);
    await page.screenshot({ path: `${out}${tag}-${name}.png` });
    console.log('CAPTURED', `${tag}-${name}`);
  };
  const T = (l, w) => (axis === 'x' ? [l, w] : [w, l]);
  const LW = (s) => (axis === 'x' ? [s.cx, s.cy] : [s.cy, s.cx]);
  await page.evaluate(() => {
    qa.grid(false);
    qa.g.fleet.trains = [];
  });
  if (what.z2) {
    const re = new RegExp(what.z2),
      pairs = new Map();
    for (const s of info.sites) {
      const base = s.id.replace(/-(stone|wood)$/, (m) => (s.row < 6 ? '' : m));
      if (!pairs.has(base)) pairs.set(base, []);
      pairs.get(base).push(s);
    }
    for (const [id, list] of pairs) {
      if (!re.test(id) || id === 'W2') continue;
      let [l, w] = LW(list[0]);
      if (list.length > 1) w = (w + LW(list[1])[1]) / 2;
      if (id === 'W1') l = 18.25;
      const [cx, cy] = T(l, w);
      await shot(
        `z2-${id === 'W1' ? 'W1+W2' : id}`,
        cx,
        cy,
        2,
        `${label} · ${tag} · ${id === 'W1' ? 'W1 + W2' : id} · zoom 2`,
      );
    }
    for (const p of info.pads)
      if (re.test(p.id)) await shot(`z2-${p.id}`, p.cx, p.cy, 2, `${label} · ${tag} · ${p.id} · zoom 2`);
  }
  if (what.z4) {
    const re = new RegExp(what.z4);
    for (const s of [...info.sites, ...info.pads])
      if (re.test(s.id)) await shot(`z4-${s.id}`, s.cx, s.cy, 4, `${label} · ${tag} · ${s.id} · zoom 4`);
  }
  if (what.detail) {
    const re = new RegExp(what.detail);
    for (const [name, id, dl, dw, zoom, grid, train] of DETAILS) {
      if (!re.test(name) || !shotRe.test(`detail-${name}`)) continue;
      const ok = await page.evaluate(
        ([id, dl, dw, zoom, grid, train, text]) => {
          const s = [...qa.sites, ...qa.pads].find((s) => s.id === id);
          if (!s) return false;
          qa.grid(grid);
          qa.g.fleet.trains = [];
          if (train) {
            const a = qa.T(s.l0 + s.bridge[s.bridge.length - 1] + 1, s.w0);
            qa.train(a.x, a.y, qa.axis === 'x' ? 3 : 0);
          }
          qa.g.trainRenderer.update(qa.g.fleet.trains, 1, 0);
          const d = qa.T(dl, dw);
          qa.view(s.cx + d.x, s.cy + d.y, zoom, text);
          return true;
        },
        [
          id,
          dl,
          dw,
          zoom,
          grid,
          !!train,
          `${label} · ${tag} · ${name} · zoom ${zoom}${grid ? ' · magenta = ideal tile diamond at rail height' : ''}`,
        ],
      );
      if (!ok) continue;
      await page.screenshot({ path: `${out}${tag}-detail-${name}.png` });
      console.log('CAPTURED', `${tag}-detail-${name}`);
    }
  }
  if (what.upgrade && shotRe.test('upgraded')) {
    for (const id of ['W3-stone', 'W3-wood']) {
      await page.evaluate(
        ([id, label, tag]) => {
          const s = qa.sites.find((s) => s.id === id),
            g = qa.g,
            levels = [];
          qa.grid(false);
          g.fleet.trains = [];
          g.trainRenderer.update(g.fleet.trains, 1, 0);
          s.tiles.forEach((t, i) => {
            const b = g.builder.buildingAt(t.x, t.y);
            for (let k = 0; k <= i; k++) g.builder.upgradeBuilding(b);
            levels.push(b.level);
          });
          g.render(1, 0);
          qa.view(
            s.cx,
            s.cy + 0.2,
            8,
            `${label} · ${tag} · ${id} · capacity upgrade levels ${levels.join(', ')} · zoom 8`,
          );
        },
        [id, label, tag],
      );
      await page.screenshot({ path: `${out}${tag}-detail-${id}-upgraded.png` });
      console.log('CAPTURED', `${tag}-detail-${id}-upgraded`);
    }
  }
  if (errors.length) console.log('PAGE ERRORS', tag, errors);
  report[tag].errors = errors;
  await page.close();
}
writeFileSync(`${out}info.json`, JSON.stringify(report, null, 1));
await browser.close();
