// Renders of bridge decks set by hand (scratchpad/bridges/decks.html), at fixed cameras.
//   node scratchpad/bridges/decks-capture.mjs [label=after] [config filter] [shot filter]
// Writes scratchpad/bridges/renders-<label>/decks-<mode>-<axis>-<shot>.png and decks-info.json.
import { launch } from '../runtime.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const [label = 'after', cfgFilter = '.', shotFilter = '.'] = process.argv.slice(2);
const out = `scratchpad/bridges/renders-${label}/`;
mkdirSync(out, { recursive: true });
const cfgRe = new RegExp(cfgFilter),
  shotRe = new RegExp(shotFilter);

// [name, site, along offset from the site centre, across offset, zoom, grid]
const DETAILS = [
  ['RAMP-stone-foot', 'RAMP-stone', -4.6, 0.2, 7, true],
  ['RAMP-stone-climb', 'RAMP-stone', -2.6, 0.4, 7, true],
  ['RAMP-stone-top', 'RAMP-stone', 0, 0.8, 6, false],
  ['RAMP-wood-foot', 'RAMP-wood', -4.6, 0.2, 7, true],
  ['RAMP-wood-climb', 'RAMP-wood', -2.6, 0.4, 7, false],
  ['RAMP-wood-top', 'RAMP-wood', 0, 0.8, 6, false],
  ['R1-stone-end', 'R1-stone', 1.6, 0.2, 8, true],
  ['R1-stone-start', 'R1-stone', -1.6, 0.2, 8, false],
  ['R1-wood-end', 'R1-wood', 1.6, 0.2, 8, false],
  ['R2-stone-end', 'R2-stone', 2.4, 0.3, 7, false],
  ['R3-stone-mid', 'R3-stone', 0, 0.8, 6, true],
  ['R3-wood-mid', 'R3-wood', 0, 0.8, 6, false],
  ['HUMP-stone', 'HUMP-stone', 0, 0.2, 8, true],
  ['HUMP-wood', 'HUMP-wood', 0, 0.2, 8, false],
  ['LAKE2-stone-bank', 'LAKE2-stone', 2.4, 0.4, 7, false],
  ['LAKE2-wood-bank', 'LAKE2-wood', -2.4, 0.4, 7, false],
  ['CREEK-stone', 'CREEK-stone', 0, 0.2, 8, false],
  ['CREEK1-stone', 'CREEK1-stone', 0, 0.2, 8, false],
  ['CREEK1-wood', 'CREEK1-wood', 0, 0.2, 8, false],
  ['RIVER2-stone', 'RIVER2-stone', 0, 0.3, 6, false],
  ['PAR-EQ', 'PAR-EQ', 0, 0.8, 6, true],
  ['STEPS-stone', 'STEPS-stone', 0, 0.8, 6, false],
  ['STEPS-wood', 'STEPS-wood', 0, 0.8, 6, false],
  ['BLOCK-stone', 'BLOCK-stone', 0, 0.4, 7, false],
  ['WBARE', 'WBARE', 0, 0.8, 6, false],
  ['SIG-stone', 'SIG-stone', 0, 0.4, 6, false],
  ['SIG-wood', 'SIG-wood', 0, 0.4, 6, false],
];
// Trains: [name, site, zoom, [[line offset, head along index, loco, wagons, direction], ...]]
const five = (w, from, step, loco, wagons, dir = 1) =>
  [0, 1, 2, 3, 4].map((k) => [[w, from + k * step, loco, wagons, dir]]);
const TRAINS = [
  // A small engine with one coach and a three-tile engine, five positions along a height-2 span.
  ...five(0, 3.2, 0.8, 'adler', ['wooden_coach']).map((t, k) => [`R2-stone-small-${k}`, 'R2-stone', 6, t]),
  ...five(0, 4.0, 1.1, 'big_boy', []).map((t, k) => [`R2-stone-long-${k}`, 'R2-stone', 6, t]),
  ...five(0, 3.3, 0.8, 'adler', ['wooden_coach']).map((t, k) => [`R2-wood-small-${k}`, 'R2-wood', 6, t]),
  ...five(0, 4.0, 1.1, 'big_boy', []).map((t, k) => [`R2-wood-long-${k}`, 'R2-wood', 6, t]),
  ...five(0, 5.6, 0.9, 'big_boy', [], -1).map((t, k) => [`R2-stone-long-back-${k}`, 'R2-stone', 6, t]),
  // On the ramp to the top.
  ['RAMP-stone-train', 'RAMP-stone', 4, [[0, 5.4, 'adler', ['wooden_coach', 'wooden_coach']], [0, 10.2, 'big_boy', []]]],
  ['RAMP-wood-train', 'RAMP-wood', 4, [[0, 5.4, 'adler', ['wooden_coach', 'wooden_coach']], [0, 10.2, 'big_boy', []]]],
  // Two parallel bridges at different heights, a train on each, in both orders.
  ['PAR-HIGH-BEHIND-trains', 'PAR-HIGH-BEHIND', 5, [[0, 6.2, 'adler', ['wooden_coach']], [1, 5.7, 'adler', ['wooden_coach']]]],
  ['PAR-HIGH-BEHIND-trains-b', 'PAR-HIGH-BEHIND', 5, [[0, 5.2, 'big_boy', []], [1, 6.9, 'big_boy', []]]],
  ['PAR-HIGH-FRONT-trains', 'PAR-HIGH-FRONT', 5, [[0, 6.2, 'adler', ['wooden_coach']], [1, 5.7, 'adler', ['wooden_coach']]]],
  ['PAR-HIGH-FRONT-trains-b', 'PAR-HIGH-FRONT', 5, [[0, 5.2, 'big_boy', []], [1, 6.9, 'big_boy', []]]],
  ['PAR-EQ-trains', 'PAR-EQ', 5, [[0, 6.2, 'adler', ['wooden_coach']], [1, 5.7, 'big_boy', []]]],
  // Ground trains directly behind and in front of a level-0 and a level-1 bridge.
  ...['G0-stone', 'G1-stone', 'G0-wood', 'G1-wood'].flatMap((id) => [
    [`${id}-ground-trains`, id, 6, [[-1, 4.6, 'adler', ['wooden_coach']], [1, 4.1, 'adler', ['wooden_coach']]]],
    [`${id}-ground-trains-b`, id, 6, [[-1, 5.3, 'big_boy', []], [1, 5.6, 'big_boy', []], [0, 4.4, 'adler', []]]],
  ]),
  // The viaduct: trains under way on the ground behind and in front, and one on top.
  ['VIA3-stone-trains', 'VIA3-stone', 4, [[-2, 7.2, 'big_boy', []], [2, 6.4, 'adler', ['wooden_coach', 'wooden_coach']], [0, 7.6, 'adler', ['wooden_coach']]]],
  ['VIA3-wood-trains', 'VIA3-wood', 4, [[-2, 7.2, 'big_boy', []], [2, 6.4, 'adler', ['wooden_coach', 'wooden_coach']], [0, 7.6, 'adler', ['wooden_coach']]]],
];
const CONFIGS = [
  ['kit', 'x', { sites: '.', detail: '.', trains: '.', clicks: true, night: true, pads: true }],
  ['kit', 'y', { sites: '.', detail: 'RAMP|R1|HUMP|LAKE2|PAR|STEPS|WBARE|CREEK1', trains: 'R2-(stone|wood)-(small|long)-[024]|PAR|G1|VIA3', pads: true }],
  ['proc', 'x', { sites: '^(RAMP|R2|LAKE2|PAR-EQ|STEPS|VIA3|WBARE)', detail: 'RAMP-(stone|wood)-(foot|top)|HUMP', pads: true }],
];
const browser = await launch();
const report = {};
for (const [mode, axis, what] of CONFIGS) {
  const tag = `${mode}-${axis}`;
  if (!cfgRe.test(tag)) continue;
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:5183/scratchpad/bridges/decks.html?axis=${axis}${mode === 'proc' ? '&proc=1' : ''}`);
  await page.waitForFunction(() => window.qa, null, { timeout: 240000 });
  const info = await page.evaluate(() => ({
    kit: qa.kit,
    origin: qa.origin,
    problems: qa.problems,
    sites: qa.sites.map((s) => ({ id: s.id, cx: s.cx, cy: s.cy, n: s.pattern.length, facts: qa.facts(s) })),
    pads: qa.pads.map((p) => ({ id: p.id, cx: p.cx, cy: p.cy, placed: p.placed, tries: p.tries })),
  }));
  if ((mode === 'proc') === info.kit) throw new Error(`mode ${mode} but kit=${info.kit}`);
  report[tag] = info;
  const file = (name) => `${out}decks-${tag}-${name}.png`;
  const snap = async (name) => {
    await page.screenshot({ path: file(name) });
    console.log('CAPTURED', `decks-${tag}-${name}`);
  };
  const reset = () =>
    page.evaluate(() => {
      qa.grid(false);
      qa.clearTrains();
    });
  await reset();
  if (what.sites) {
    const re = new RegExp(what.sites);
    for (const s of info.sites) {
      if (!re.test(s.id) || !shotRe.test(`site-${s.id}`)) continue;
      const zoom = s.n > 12 ? 3 : 4;
      await page.evaluate(([cx, cy, zoom, text]) => qa.view(cx, cy, zoom, text), [
        s.cx,
        s.cy,
        zoom,
        `${label} · ${tag} · ${s.id} · decks ${s.facts.map((f) => f.deck).join(' ')} · zoom ${zoom}`,
      ]);
      await snap(`site-${s.id}`);
    }
  }
  if (what.pads)
    for (const p of info.pads) {
      if (!shotRe.test(`pad-${p.id}`)) continue;
      for (const zoom of [3, 5]) {
        await page.evaluate(([cx, cy, zoom, text]) => qa.view(cx, cy, zoom, text), [
          p.cx,
          p.cy,
          zoom,
          `${label} · ${tag} · ${p.id} on platforms at deck height 2 · zoom ${zoom}`,
        ]);
        await snap(`pad-${p.id}-z${zoom}`);
      }
    }
  if (what.detail) {
    const re = new RegExp(what.detail);
    for (const [name, id, dl, dw, zoom, grid] of DETAILS) {
      if (!re.test(name) || !shotRe.test(`detail-${name}`)) continue;
      await page.evaluate(
        ([id, dl, dw, zoom, grid, text]) => {
          const s = qa.sites.find((s) => s.id === id),
            d = qa.T(dl, dw);
          qa.grid(grid);
          qa.view(s.cx + d.x, s.cy + d.y, zoom, text);
        },
        [id, dl, dw, zoom, grid, `${label} · ${tag} · ${name} · zoom ${zoom}${grid ? ' · magenta = tile diamond at deck height' : ''}`],
      );
      await snap(`detail-${name}`);
    }
    await reset();
  }
  if (what.trains) {
    const re = new RegExp(what.trains);
    for (const [name, id, zoom, trains] of TRAINS) {
      if (!re.test(name) || !shotRe.test(`train-${name}`)) continue;
      const ok = await page.evaluate(
        ([id, zoom, trains, text]) => {
          const s = qa.sites.find((s) => s.id === id);
          qa.clearTrains();
          const placed = trains.map(([w, head, loco, wagons, dir]) => qa.trainAt(id, w, head, loco, wagons, dir ?? 1));
          qa.g.trainRenderer.update(qa.g.fleet.trains, 1, 0);
          const d = qa.T(0, 0.5);
          qa.view(s.cx + d.x, s.cy + d.y, zoom, text);
          return placed;
        },
        [id, zoom, trains, `${label} · ${tag} · ${name} · zoom ${zoom}`],
      );
      if (ok.some((v) => !v)) console.log('TRAIN NOT PLACED', name, ok);
      await snap(`train-${name}`);
    }
    await reset();
  }
  if (what.night && shotRe.test('night')) {
    for (const [name, id, trains] of [
      ['night-R2-stone', 'R2-stone', [[0, 5.3, 'adler', ['wooden_coach']]]],
      ['night-R3-wood', 'R3-wood', [[0, 6.6, 'big_boy', []]]],
      ['night-WUP-stone', 'WUP-stone', [[0, 4.6, 'adler', ['wooden_coach']]]],
    ]) {
      await page.evaluate(
        ([id, trains, text]) => {
          const s = qa.sites.find((s) => s.id === id);
          qa.clearTrains();
          qa.night(true);
          for (const [w, head, loco, wagons] of trains) qa.trainAt(id, w, head, loco, wagons, 1);
          // Light pools ease in over a few frames (the camera eases its zoom meanwhile).
          for (let i = 0; i < 12; i++) qa.g.render(1, 0.05);
          const d = qa.T(0, 0.5);
          qa.view(s.cx + d.x, s.cy + d.y, 5, text);
        },
        [id, trains, `${label} · ${tag} · ${name} · deep night, head lamp and light pool · zoom 5`],
      );
      await snap(name);
    }
    await page.evaluate(() => {
      qa.night(false);
      qa.g.settings.dayNight = false;
      qa.clearTrains();
      qa.g.render(1, 0);
    });
    // Smoke leaves the chimney, wherever the rail carries the engine.
    for (const [name, id, head] of [
      ['smoke-R3-stone', 'R3-stone', 6.4],
      ['smoke-ground', 'R3-stone', 12.2],
    ]) {
      await page.evaluate(
        ([id, head, text]) => {
          const s = qa.sites.find((s) => s.id === id),
            g = qa.g;
          qa.clearTrains();
          qa.trainAt(id, 0, head, 'adler', ['wooden_coach'], 1);
          const t = g.fleet.trains[0];
          t.state = 'moving';
          t.speed = 1;
          g.settings.smoke = true;
          for (let i = 0; i < 14; i++) g.smoke.update(g.fleet.trains, 0.12, true);
          const at = qa.T(s.l0 + head, s.w0 + 0.3);
          qa.view(at.x, at.y, 6, text);
          t.state = 'idle';
          t.speed = 0;
        },
        [id, head, `${label} · ${tag} · ${name} · smoke from the chimney · zoom 6`],
      );
      await snap(name);
    }
    await page.evaluate(() => {
      qa.g.settings.smoke = false;
      qa.g.smoke.update([], 10, false);
      qa.clearTrains();
      // Let the notices catch up with the trains that are gone (their markers go with them).
      for (let i = 0; i < 14; i++) qa.g.render(1, 0.05);
    });
  }
  if (what.clicks && shotRe.test('click')) {
    // Over water: raised and lowered again, one click at a time.
    for (const id of ['WUP-stone', 'WUP-wood']) {
      const steps = [
        ['0-as-built', []],
        ['1-all-raised', [[3, 1], [4, 1], [5, 1]]],
        ['2-middle-raised-again', [[4, 1]]],
        ['3-middle-lowered', [[4, -1]]],
        ['4-all-lowered', [[3, -1], [4, -1], [5, -1]]],
      ];
      const log = [];
      for (const [step, clicks] of steps) {
        const res = await page.evaluate(
          ([id, clicks, text]) => {
            const s = qa.sites.find((s) => s.id === id),
              res = clicks.map(([i, delta]) => qa.click(id, i, delta));
            qa.g.render(1, 0);
            return qa.settle().then(() => {
              const d = qa.T(0, 0.3);
              qa.view(s.cx + d.x, s.cy + d.y, 6, `${text} · decks ${qa.facts(s).map((f) => f.deck).join(' ')}`);
              return { res, facts: qa.facts(s) };
            });
          },
          [id, clicks, `${label} · ${tag} · ${id} · ${step}`],
        );
        log.push({ step, ...res });
        await snap(`click-${id}-${step}`);
      }
      report[tag][`clicks-${id}`] = log;
    }
  }
  if (what.clicks && shotRe.test('hover')) {
    // A train on a deck three heights up is picked where it is drawn, not where the ground is.
    const hover = await page.evaluate(() => {
      const g = qa.g,
        s = qa.sites.find((s) => s.id === 'R3-stone');
      qa.clearTrains();
      qa.trainAt('R3-stone', 0, 6.4, 'adler', ['wooden_coach'], 1);
      const at = qa.T(s.l0 + 6, s.w0 + 0.3);
      qa.view(at.x, at.y, 4, '');
      const t = g.fleet.trains[0],
        pose = t.poses[0],
        w = { x: (pose.x - pose.y) * 32, y: (pose.x + pose.y) * 16 },
        dz = g.world.railAt(pose.x, pose.y).dz,
        pick = (wy) => {
          const sc = g.camera.worldToScreen(w.x, wy);
          g.input.mouseX = sc.x;
          g.input.mouseY = sc.y;
          return g.trainUnderMouse()?.id ?? null;
        };
      const out = { railDz: +dz.toFixed(2), onTheTrain: pick(w.y + dz - 10), onTheGroundUnderIt: pick(w.y - 10), id: t.id };
      qa.clearTrains();
      return out;
    });
    report[tag].hover = hover;
    console.log('HOVER', JSON.stringify(hover), hover.onTheTrain === hover.id && hover.onTheGroundUnderIt === null ? 'ok' : 'WRONG');
  }
  if (what.night && shotRe.test('failed-painter')) {
    // Without the terrain painter everything lies on the fallback ground: rails, trains and decks.
    await page.evaluate((text) => {
      const g = qa.g,
        s = qa.sites.find((s) => s.id === 'R2-stone');
      qa.clearTrains();
      g.world.landscape.fail();
      g.render(1, 0);
      qa.trainAt('R2-stone', 0, 5.3, 'adler', ['wooden_coach'], 1);
      g.trainRenderer.update(g.fleet.trains, 1, 0);
      const d = qa.T(0, 0.5);
      qa.view(s.cx + d.x, s.cy + d.y, 5, text);
    }, `${label} · ${tag} · terrain painter failed: deck, rail and train on the fallback ground · zoom 5`);
    await snap('failed-painter-R2-stone');
  }
  if (errors.length) console.log('PAGE ERRORS', tag, errors);
  report[tag].errors = errors;
  await page.close();
}
writeFileSync(`${out}decks-info.json`, JSON.stringify(report, null, 1));
await browser.close();
