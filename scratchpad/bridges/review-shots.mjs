// Review renders from the running build: contact sheets of native-resolution clips.
//   node scratchpad/bridges/review-shots.mjs <axis=x|y> [stage regexp] [proc]
// Writes scratchpad/bridges/review/<axis>-<sheet>.png
import { launch } from '../runtime.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const [axis = 'x', stageFilter = '.', procArg] = process.argv.slice(2);
const proc = procArg === 'proc';
const out = process.env.REVIEW_OUT ?? 'scratchpad/bridges/review/';
mkdirSync(out, { recursive: true });
const stageRe = new RegExp(stageFilter);
const browser = await launch();
const VW = 1440,
  VH = 1000;
const page = await browser.newPage({ viewport: { width: VW, height: VH } });
const sheetPage = await browser.newPage({ viewport: { width: 800, height: 600 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://127.0.0.1:5183/scratchpad/bridges/review.html?axis=${axis}${proc ? '&proc=1' : ''}`);
await page.waitForFunction(() => window.qa, null, { timeout: 300000 });
const tag = `${axis}${proc ? '-proc' : ''}`;
const sites = Object.fromEntries(
  (await page.evaluate(() => qa.sites.map((s) => ({ id: s.id, cx: s.cx, cy: s.cy, n: s.tiles.length, lines: s.lines.length })))).map((s) => [s.id, s]),
);
const STEP = await page.evaluate(() => qa.step);
console.log('problems', JSON.stringify(await page.evaluate(() => qa.problems)));

/** A clip of the view centred on a tile: PNG buffer. `up` shifts the clip up, in world pixels. */
async function clip(cx, cy, zoom, w, h, up = 0, grid = false, verticals = false) {
  await page.evaluate(([grid, verticals]) => qa.grid(grid, verticals), [grid, verticals]);
  const at = await page.evaluate(([cx, cy, zoom]) => qa.view(cx, cy, zoom, ''), [cx, cy, zoom]);
  w = Math.min(VW, Math.round(w));
  h = Math.min(VH, Math.round(h));
  const x = Math.max(0, Math.min(VW - w, Math.round(at.x - w / 2))),
    y = Math.max(0, Math.min(VH - h, Math.round(at.y - h / 2 - up * zoom)));
  return { png: await page.screenshot({ clip: { x, y, width: w, height: h } }), w, h };
}
/** A clip of one site: its bridge with `pad` tiles of approach on each side. */
async function siteClip(id, zoom, opts = {}) {
  const s = sites[id];
  if (!s) throw new Error('no site ' + id);
  const spans = opts.spans ?? s.n / s.lines,
    pad = opts.pad ?? 1.6,
    deck = opts.deck ?? 0,
    across = (s.lines - 1) * 1 + (opts.across ?? 0),
    w = (spans + 2 * pad + across) * 32 * zoom + 30,
    h = (spans + 2 * pad + across) * 16 * zoom + (deck * STEP + 34) * zoom + 30,
    c = await clip(s.cx + (opts.dx ?? 0), s.cy + (opts.dy ?? 0), zoom, opts.w ?? w, opts.h ?? h, (deck * STEP) / 2 + 4, opts.grid, opts.verticals);
  return { ...c, caption: `${opts.label ?? id} · zoom ${zoom}${opts.note ? ' · ' + opts.note : ''}` };
}
/** Lay clips out in a grid with captions and write one PNG. */
async function sheet(name, cols, items, title = '') {
  const cell = (it) =>
    `<figure><img width="${it.w}" height="${it.h}" src="data:image/png;base64,${it.png.toString('base64')}"><figcaption>${it.caption}</figcaption></figure>`;
  const html = `<!doctype html><html><body style="margin:0;background:#1b2420;color:#eee6cf;font:600 13px/1.5 system-ui">
<div style="padding:4px 8px;background:#0e1411">${tag} · ${name}${title ? ' · ' + title : ''}</div>
<div style="display:grid;grid-template-columns:repeat(${cols},max-content);gap:6px;padding:6px;align-items:start">
${items.map(cell).join('\n')}</div>
<style>figure{margin:0}img{display:block;image-rendering:pixelated}figcaption{padding:1px 4px}</style></body></html>`;
  await sheetPage.setViewportSize({ width: 200, height: 100 });
  await sheetPage.setContent(html);
  const size = await sheetPage.evaluate(() => ({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight }));
  await sheetPage.setViewportSize({ width: Math.max(200, size.w), height: Math.max(100, size.h) });
  const file = `${out}${tag}-${name}.png`;
  await sheetPage.screenshot({ path: file, fullPage: true });
  console.log('SHEET', file, `${size.w}x${size.h}`);
}
const settle = () => page.evaluate(() => qa.settle());
const setDecks = async (id, levels, w = 0) => {
  const left = await page.evaluate(([id, levels, w]) => qa.setDecks(id, levels, w), [id, levels, w]);
  if (left.length) console.log('NOT REACHED', id, JSON.stringify(left));
  return left;
};
const facts = (id) => page.evaluate((id) => qa.facts(qa.sites.find((s) => s.id === id)).map((f) => `${f.deck}${f.set === 'auto' ? 'a' : ''}`).join(' '), id);
const stage = async (name, fn) => {
  if (!stageRe.test(name)) return;
  console.log('STAGE', name);
  await fn();
};
const MATS = ['stone', 'wood'];
const N = [1, 2, 3, 4, 5, 6];

// ---------------------------------------------------------------- as built: water, land dip
for (const [kind, deck, what] of [
  ['W', 0, 'over water, banks level'],
  ['L', 1, 'over a land dip between level-1 banks'],
]) {
  await stage(`${kind}-z2`, async () => {
    for (const m of MATS) {
      const items = [];
      for (const n of N) items.push(await siteClip(`${kind}${n}-${m}`, 2, { deck, w: 560, h: 330 }));
      await sheet(`${kind}-${m}-z2`, 2, items, what);
    }
  });
  await stage(`${kind}-z4`, async () => {
    for (const m of MATS) {
      await sheet(`${kind}-${m}-z4-n12`, 2, [await siteClip(`${kind}1-${m}`, 4, { deck, w: 640, h: 440 }), await siteClip(`${kind}2-${m}`, 4, { deck, w: 760, h: 440 })], what);
      await sheet(`${kind}-${m}-z4-n34`, 1, [await siteClip(`${kind}3-${m}`, 4, { deck, w: 900, h: 500 }), await siteClip(`${kind}4-${m}`, 4, { deck, w: 1030, h: 560 })], what);
      await sheet(`${kind}-${m}-z4-n56`, 1, [await siteClip(`${kind}5-${m}`, 4, { deck, w: 1150, h: 620 }), await siteClip(`${kind}6-${m}`, 4, { deck, w: 1280, h: 680 })], what);
    }
  });
}
// ---------------------------------------------------------------- banks at different levels
const BANKS = ['DW10', 'DW11', 'DW20', 'DL21', 'DL20', 'DL10'];
await stage('banks-z2', async () => {
  for (const m of MATS) {
    const items = [];
    for (const id of BANKS) items.push(await siteClip(`${id}-${m}`, 2, { deck: 2, w: 620, h: 400 }));
    await sheet(`banks-${m}-z2`, 2, items, 'banks at different levels (W water, L land; digits = bank levels left/right)');
  }
});
await stage('banks-z4', async () => {
  for (const m of MATS)
    for (const id of BANKS)
      await sheet(`banks-${id}-${m}-z4`, 1, [await siteClip(`${id}-${m}`, 4, { deck: 2, w: 1100, h: 700 })], 'banks at different levels');
});
// ---------------------------------------------------------------- flat land: as built, raised, lowered
const PYRAMID = { 1: [1], 2: [1, 1], 3: [1, 2, 1], 4: [1, 2, 2, 1], 5: [1, 2, 3, 2, 1], 6: [1, 2, 3, 3, 2, 1] };
const flat = {};
await stage('flat', async () => {
  for (const m of MATS) {
    const items = [];
    for (const n of N) {
      const c = await siteClip(`F${n}-${m}`, 2, { deck: 3, w: 600, h: 400, note: 'as built, deck ' + (await facts(`F${n}-${m}`)) });
      flat[`F${n}-${m}`] = c.png;
      items.push(c);
    }
    await sheet(`flat-${m}-0-built-z2`, 2, items, 'platforms on plain flat land with rail, as built (deck 0)');
  }
  // one level everywhere it is allowed, then the pyramid
  for (const m of MATS) for (const n of N) await setDecks(`F${n}-${m}`, Object.fromEntries(PYRAMID[n].map((_, i) => [3 + i, 1])));
  await settle();
  for (const m of MATS) {
    const items = [];
    for (const n of N) items.push(await siteClip(`F${n}-${m}`, 2, { deck: 3, w: 600, h: 400, note: 'decks ' + (await facts(`F${n}-${m}`)) }));
    await sheet(`flat-${m}-1-raised1-z2`, 2, items, 'every platform clicked up one level');
    await sheet(`flat-${m}-1-raised1-z4-n12`, 2, [await siteClip(`F1-${m}`, 4, { deck: 1, w: 640, h: 440 }), await siteClip(`F2-${m}`, 4, { deck: 1, w: 760, h: 440 })], 'clicked up one level');
    await sheet(`flat-${m}-1-raised1-z4-n36`, 1, [await siteClip(`F3-${m}`, 4, { deck: 1, w: 900, h: 480 }), await siteClip(`F6-${m}`, 4, { deck: 1, w: 1280, h: 680 })], 'clicked up one level');
  }
  for (const m of MATS) for (const n of N) await setDecks(`F${n}-${m}`, Object.fromEntries(PYRAMID[n].map((d, i) => [3 + i, d])));
  await settle();
  for (const m of MATS) {
    const items = [];
    for (const n of N) items.push(await siteClip(`F${n}-${m}`, 2, { deck: 3, w: 600, h: 400, note: 'decks ' + (await facts(`F${n}-${m}`)) }));
    await sheet(`flat-${m}-2-pyramid-z2`, 2, items, 'clicked up as far as the rail rules allow (1, 2, 3 levels)');
    await sheet(`flat-${m}-2-pyramid-z4-n34`, 1, [await siteClip(`F3-${m}`, 4, { deck: 2, w: 900, h: 520 }), await siteClip(`F4-${m}`, 4, { deck: 2, w: 1030, h: 580 })], 'decks 1 2 1 and 1 2 2 1');
    await sheet(`flat-${m}-2-pyramid-z4-n56`, 1, [await siteClip(`F5-${m}`, 4, { deck: 3, w: 1150, h: 660 }), await siteClip(`F6-${m}`, 4, { deck: 3, w: 1280, h: 720 })], 'decks 1 2 3 2 1 and 1 2 3 3 2 1');
  }
  // lowered again, right down to the ground
  for (const m of MATS) for (const n of N) await setDecks(`F${n}-${m}`, Object.fromEntries(PYRAMID[n].map((_, i) => [3 + i, 0])));
  await settle();
  const { PNG } = await import('pngjs');
  for (const m of MATS) {
    const items = [];
    for (const n of N) {
      const c = await siteClip(`F${n}-${m}`, 2, { deck: 3, w: 600, h: 400, note: 'lowered again, deck ' + (await facts(`F${n}-${m}`)) });
      const a = PNG.sync.read(flat[`F${n}-${m}`]),
        b = PNG.sync.read(c.png);
      let diff = 0;
      for (let k = 0; k < a.data.length; k += 4)
        if (Math.abs(a.data[k] - b.data[k]) + Math.abs(a.data[k + 1] - b.data[k + 1]) + Math.abs(a.data[k + 2] - b.data[k + 2]) > 24) diff++;
      c.caption += ` · ${diff} px differ from as built`;
      console.log('LOWERED', `F${n}-${m}`, diff, 'pixels differ from as built');
      items.push(c);
    }
    await sheet(`flat-${m}-3-lowered-z2`, 2, items, 'every platform right-clicked back down to the ground');
  }
});
// ---------------------------------------------------------------- bare platforms as blocks
await stage('blocks', async () => {
  const built = {};
  for (const m of MATS) for (const n of N) built[`B${n}-${m}`] = (await siteClip(`B${n}-${m}`, 2, { deck: 3, w: 560, h: 380 })).png;
  for (const [k, heights] of [
    [1, [1, 2, 3, 1, 2, 3]],
    [2, [2, 3, 1, 2, 3, 1]],
    [3, [3, 1, 2, 3, 1, 2]],
  ]) {
    for (const m of MATS) for (const n of N) await setDecks(`B${n}-${m}`, Object.fromEntries(Array.from({ length: n }, (_, i) => [2 + i, heights[n - 1]])));
    await settle();
    for (const m of MATS) {
      const items = [];
      for (const n of N) items.push(await siteClip(`B${n}-${m}`, 2, { deck: 3, w: 560, h: 380, note: 'no rail, decks ' + (await facts(`B${n}-${m}`)) }));
      await sheet(`blocks-${m}-${k}-z2`, 2, items, 'bare platforms on flat land clicked up');
      if (k === 1) {
        await sheet(`blocks-${m}-${k}-z4-a`, 2, [await siteClip(`B1-${m}`, 4, { deck: 1, w: 560, h: 420 }), await siteClip(`B2-${m}`, 4, { deck: 2, w: 700, h: 480 })], 'bare platforms');
        await sheet(`blocks-${m}-${k}-z4-b`, 1, [await siteClip(`B3-${m}`, 4, { deck: 3, w: 860, h: 560 }), await siteClip(`B6-${m}`, 4, { deck: 3, w: 1240, h: 720 })], 'bare platforms');
      }
    }
  }
  for (const m of MATS) for (const n of N) await setDecks(`B${n}-${m}`, Object.fromEntries(Array.from({ length: n }, (_, i) => [2 + i, 0])));
  await settle();
  const { PNG } = await import('pngjs');
  for (const m of MATS) {
    const items = [];
    for (const n of N) {
      const c = await siteClip(`B${n}-${m}`, 2, { deck: 3, w: 560, h: 380, note: 'lowered again, decks ' + (await facts(`B${n}-${m}`)) });
      const a = PNG.sync.read(built[`B${n}-${m}`]),
        b = PNG.sync.read(c.png);
      let diff = 0;
      for (let k = 0; k < a.data.length; k += 4)
        if (Math.abs(a.data[k] - b.data[k]) + Math.abs(a.data[k + 1] - b.data[k + 1]) + Math.abs(a.data[k + 2] - b.data[k + 2]) > 24) diff++;
      c.caption += ` · ${diff} px differ from as built`;
      console.log('LOWERED', `B${n}-${m}`, diff, 'pixels differ from as built');
      items.push(c);
    }
    await sheet(`blocks-${m}-4-lowered-z2`, 2, items, 'bare platforms lowered back onto the ground');
  }
});
// ---------------------------------------------------------------- raised over water and long ramps
await stage('raised', async () => {
  for (const m of MATS) {
    await sheet(
      `raised-${m}-z2-a`,
      2,
      [
        await siteClip(`WR1-${m}`, 2, { deck: 1, w: 560, h: 360, note: 'decks ' + (await facts(`WR1-${m}`)) }),
        await siteClip(`WR2-${m}`, 2, { deck: 2, w: 660, h: 420, note: 'decks ' + (await facts(`WR2-${m}`)) }),
        await siteClip(`WR3-${m}`, 2, { deck: 3, w: 700, h: 480, pad: 1, note: 'decks ' + (await facts(`WR3-${m}`)) }),
      ],
      'raised by clicks over water',
    );
    await sheet(
      `raised-${m}-z2-b`,
      1,
      [
        await siteClip(`LR3-${m}`, 2, { deck: 3, w: 800, h: 500, pad: 1, note: 'decks ' + (await facts(`LR3-${m}`)) }),
        await siteClip(`LR4-${m}`, 2, { deck: 4, w: 800, h: 520, pad: 1, note: 'decks ' + (await facts(`LR4-${m}`)) }),
      ],
      'ramps on plain land',
    );
    await sheet(`raised-${m}-z4-WR1`, 1, [await siteClip(`WR1-${m}`, 4, { deck: 1, w: 1000, h: 600 })], 'three spans over water, each clicked up one level');
    await sheet(`raised-${m}-z4-WR2`, 1, [await siteClip(`WR2-${m}`, 4, { deck: 2, w: 1200, h: 720 })], 'decks 1 2 2 2 1, the middle three over water');
    await sheet(`raised-${m}-z4-WR3`, 1, [await siteClip(`WR3-${m}`, 4, { deck: 3, w: 1440, h: 860, pad: 0.6 })], 'decks 1 2 3 3 3 2 1, the middle three over water');
    await sheet(`raised-${m}-z4-LR3-left`, 1, [await siteClip(`LR3-${m}`, 4, { deck: 3, w: 1300, h: 800, dx: axis === 'x' ? -2.4 : 0, dy: axis === 'x' ? 0 : -2.4, label: `LR3-${m} first half` })], 'decks 1 2 3 3 3 3 3 2 1 on plain land');
    await sheet(`raised-${m}-z4-LR3-right`, 1, [await siteClip(`LR3-${m}`, 4, { deck: 3, w: 1300, h: 800, dx: axis === 'x' ? 2.4 : 0, dy: axis === 'x' ? 0 : 2.4, label: `LR3-${m} second half` })], 'decks 1 2 3 3 3 3 3 2 1 on plain land');
    await sheet(`raised-${m}-z4-LR4-mid`, 1, [await siteClip(`LR4-${m}`, 4, { deck: 4, w: 1300, h: 860, label: `LR4-${m} middle` })], 'decks 1 2 3 4 4 4 3 2 1 on plain land');
  }
});
// ---------------------------------------------------------------- side by side
const SIDE_W = ['SS-water', 'WW-water', 'SW-water', 'WS-water', 'GAP-water'],
  SIDE_UP = ['SS-up', 'WW-up', 'HI-behind', 'HI-front', 'MIX-up'];
await stage('side', async () => {
  const a = [],
    b = [];
  for (const id of SIDE_W) a.push(await siteClip(id, 2, { w: 620, h: 400, spans: 4, across: id === 'GAP-water' ? 1 : 0 }));
  for (const id of SIDE_UP) b.push(await siteClip(id, 2, { deck: 2, w: 680, h: 440, spans: 5, note: 'decks ' + (await facts(id)) }));
  await sheet('side-water-z2', 2, a, 'two bridges side by side over water (S stone, W wood; first named is behind)');
  await sheet('side-up-z2', 2, b, 'two raised bridges side by side on plain land');
  for (const id of SIDE_W) await sheet(`side-${id}-z4`, 1, [await siteClip(id, 4, { w: 1200, h: 720, spans: 4, across: id === 'GAP-water' ? 1 : 0 })], 'side by side over water');
  for (const id of SIDE_UP) await sheet(`side-${id}-z4`, 1, [await siteClip(id, 4, { deck: 2, w: 1320, h: 800, spans: 5, note: 'decks ' + (await facts(id)) })], 'side by side, raised');
});
// ---------------------------------------------------------------- trains
await stage('trains', async () => {
  const pose = async (id, w, head, loco, wagons, dir = 1) => {
    const ok = await page.evaluate(([id, w, head, loco, wagons, dir]) => qa.trainAt(id, w, head, loco, wagons, dir), [id, w, head, loco, wagons, dir]);
    if (!ok) console.log('TRAIN NOT PLACED', id, head, loco);
  };
  const clear = () => page.evaluate(() => qa.clearTrains());
  for (const m of MATS) {
    // a short train and a long engine at three places on the ramp: climbing, on top, descending
    const items2 = [],
      items4 = [];
    for (const [k, head, loco, wagons] of [
      ['climbing', 5.3, 'rocket', ['wooden_coach', 'wooden_coach']],
      ['on top', 8.2, 'rocket', ['wooden_coach', 'wooden_coach']],
      ['descending', 11.4, 'rocket', ['wooden_coach', 'wooden_coach']],
      ['long engine climbing', 5.6, m === 'stone' ? 'big_boy' : 'crocodile', []],
      ['long engine on top', 8.4, m === 'stone' ? 'big_boy' : 'crocodile', []],
      ['long engine descending', 11.6, m === 'stone' ? 'big_boy' : 'crocodile', []],
    ]) {
      await clear();
      await pose(`LR3-${m}`, 0, head, loco, wagons);
      items2.push(await siteClip(`LR3-${m}`, 2, { deck: 3, w: 700, h: 460, pad: 1, label: `LR3-${m} · ${k}` }));
      items4.push(await siteClip(`LR3-${m}`, 4, { deck: 3, w: 1100, h: 700, dx: axis === 'x' ? head - 8 : 0, dy: axis === 'x' ? 0 : head - 8, label: `LR3-${m} · ${k}` }));
    }
    await sheet(`trains-LR3-${m}-z2`, 2, items2, 'a train on a bridge raised to 3');
    for (let i = 0; i < items4.length; i++) await sheet(`trains-LR3-${m}-z4-${i}`, 1, [items4[i]], 'a train on a bridge raised to 3');
    await clear();
    await pose(`WR3-${m}`, 0, 6.3, 'rocket', ['wooden_coach', 'wooden_coach']);
    await sheet(`trains-WR3-${m}`, 1, [await siteClip(`WR3-${m}`, 2, { deck: 3, w: 700, h: 480, pad: 1 }), await siteClip(`WR3-${m}`, 4, { deck: 3, w: 1300, h: 800, pad: 0.6 })], 'a train over water at height 3');
    await clear();
    await pose(`W3-${m}`, 0, 5.2, 'rocket', ['wooden_coach', 'wooden_coach']);
    await pose(`L3-${m}`, 0, 6.2, 'rocket', ['wooden_coach', 'wooden_coach']);
    await sheet(`trains-auto-${m}`, 1, [await siteClip(`W3-${m}`, 4, { w: 900, h: 500 }), await siteClip(`L3-${m}`, 4, { deck: 1, w: 900, h: 500 })], 'a train on automatic bridges');
  }
  // side by side, raised: a train on each line
  for (const id of ['SS-up', 'HI-behind', 'HI-front', 'MIX-up']) {
    await clear();
    await pose(id, 0, 6.2, 'rocket', ['wooden_coach', 'wooden_coach']);
    await pose(id, 1, 5.4, 'rocket', ['wooden_coach'], 1);
    await sheet(`trains-${id}`, 1, [await siteClip(id, 4, { deck: 2, w: 1320, h: 800, spans: 5 })], 'trains on two raised bridges side by side');
  }
  await clear();
});
console.log('page errors', JSON.stringify(errors));
await browser.close();
