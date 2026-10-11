// Review 2: deck clicks in the REAL game with the browser's own mouse, cases the first script
// left out: a railed bridge over water, the pointer on the visible top of a high deck, the
// browser context menu, a train on the bridge, zoom 4.
//   node scratchpad/bridges/review-click2.mjs
import { launch } from '../runtime.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const out = process.env.REVIEW_OUT ?? 'scratchpad/bridges/review2/';
mkdirSync(out, { recursive: true });
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const sheetPage = await browser.newPage({ viewport: { width: 800, height: 600 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('dialog', (d) => d.accept());
await page.goto('http://127.0.0.1:5183/#seed=4242&new');
await page.waitForFunction(() => window.game?.fleet, null, { timeout: 240000 });
await page.waitForFunction(() => window.game.world.landscape.ready, null, { timeout: 240000 });
await page.waitForTimeout(1500);
const log = [];
const say = (...a) => {
  console.log(...a);
  log.push(a.join(' '));
};
// context menu: does the page cancel the browser's menu on a right click on the canvas?
await page.evaluate(() => {
  window.__ctx = [];
  window.addEventListener('contextmenu', (e) => window.__ctx.push(e.defaultPrevented), false);
});

const found = await page.evaluate(async () => {
  const { levelAt } = await import('/src/world/elevation.ts');
  const g = window.game,
    m = g.map,
    b = g.builder;
  g.settings.autosave = false;
  g.settings.edgeScroll = false;
  for (let i = 0; i < g.regions.unlocked.length; i++) g.regions.own(i);
  g.world.rebuildFog();
  const T = (x, y) => m.terrain[y * m.w + x];
  const land = (x, y) => T(x, y) !== 3 && levelAt(m, x, y) === 0 && !b.buildingAt(x, y) && !b.stationAt(x, y) && !g.track.has(x, y);
  const water = (x, y) => T(x, y) === 3 && b.checkBuilding(x, y, 'bridge_stone').ok;
  const depot = b.stations.find((s) => s.def.depot) ?? { x: m.w >> 1, y: m.h >> 1 };
  // along x: 3 land, k water (k = 3, else 2), 3 land; the rows beside it free of buildings
  let best = null;
  for (const k of [3, 2])
    for (let y = 4; y < m.h - 4; y++)
      for (let x = 6; x < m.w - 10; x++) {
        let ok = true;
        for (let i = -3; i < 0 && ok; i++) ok = land(x + i, y);
        for (let i = 0; i < k && ok; i++) ok = water(x + i, y);
        for (let i = k; i < k + 3 && ok; i++) ok = land(x + i, y);
        if (!ok) continue;
        const d = Math.abs(x - depot.x) + Math.abs(y - depot.y);
        if (!best || k > best.k || (k === best.k && d < best.d)) best = { x, y, k, d };
      }
  return { cross: best, stock: { stone: Math.floor(g.stock.get('stone')), wood: Math.floor(g.stock.get('wood')) } };
});
say('targets', JSON.stringify(found));
if (!found.cross) {
  say('NO WATER CROSSING FOUND');
  await browser.close();
  process.exit(0);
}
const frames = (n = 6) => page.waitForTimeout(n * 40);
const centre = async (x, y, zoomIndex = 4) => {
  await page.evaluate(
    async ([x, y, zi]) => {
      const { tileToWorld } = await import('/src/engine/iso.ts');
      const g = window.game,
        p = tileToWorld(x, y);
      g.camera.zoomIndex = zi;
      g.camera.zoom = g.camera.targetZoom;
      g.camera.centerOn(p.x, p.y + g.world.elevationOf(x, y));
    },
    [x, y, zoomIndex],
  );
  await frames(10);
};
const at = (x, y, surface = false) =>
  page.evaluate(
    async ([x, y, surface]) => {
      const { tileToWorld } = await import('/src/engine/iso.ts');
      const g = window.game,
        p = tileToWorld(x, y),
        w = surface ? g.world.surfacePoint(x, y) : { x: p.x, y: p.y + g.world.elevationOf(x, y) },
        s = g.camera.worldToScreen(w.x, w.y),
        r = g.app.canvas.getBoundingClientRect();
      return { x: r.left + s.x, y: r.top + s.y };
    },
    [x, y, surface],
  );
const state = (x, y) =>
  page.evaluate(
    async ([x, y]) => {
      const { levelAt } = await import('/src/world/elevation.ts');
      const g = window.game,
        b = g.builder.bridgeAt(x, y);
      return {
        platform: b ? `${b.id.replace('bridge_', '')} set=${b.deck ?? 'auto'} height=${g.builder.deckLevel(b)}` : 'none',
        height: b ? g.builder.deckLevel(b) : null,
        ground: levelAt(g.map, x, y),
        track: g.track.get(x, y)?.kind ?? null,
        hover: `${g.hoverTile.x},${g.hoverTile.y}`,
        tool: g.build.tool.kind === 'building' ? g.build.tool.defId : g.build.tool.kind,
        status: document.querySelector('#toolbar .tb-statusrow')?.firstElementChild?.textContent ?? '',
      };
    },
    [x, y],
  );
const results = [];
async function note(event, x, y, expect = {}) {
  await frames();
  const s = await state(x, y);
  const bad = Object.entries(expect).filter(([k, v]) => (v instanceof RegExp ? !v.test(String(s[k])) : s[k] !== v));
  results.push({ event, tile: [x, y], ...s, ok: !bad.length });
  say(`${bad.length ? 'FAIL' : 'ok  '} ${event.padEnd(70)} | ${s.platform} | track=${s.track} | hover=${s.hover} | "${s.status}"${bad.length ? ' | WANTED ' + bad.map(([k, v]) => `${k}=${v}`).join(', ') : ''}`);
  return s;
}
const move = async (x, y, surface = false) => {
  const p = await at(x, y, surface);
  await page.mouse.move(p.x, p.y, { steps: 5 });
  await frames();
  return p;
};
const away = async () => {
  await page.mouse.move(300, 200, { steps: 4 });
  await frames();
};
const click = async (button = 'left') => {
  await page.mouse.down({ button });
  await page.mouse.up({ button });
  await frames();
};
const pick = async (name) => {
  if (!(await page.locator('#toolbar .tb-item', { hasText: name }).count())) await page.locator('#toolbar .tb-cat', { hasText: /^Track$/ }).click();
  await frames();
  await page.locator('#toolbar .tb-item', { hasText: name }).first().click();
  await frames();
};
const shots = [];
async function snap(caption, x, y, full = null, w = 640, h = 420) {
  await frames(8);
  const p = await at(x, y);
  const cx = Math.max(0, Math.min(1440 - w, Math.round(p.x - w / 2))),
    cy = Math.max(0, Math.min(1000 - h, Math.round(p.y - h * 0.62)));
  shots.push({ caption, w, h, png: await page.screenshot({ clip: { x: cx, y: cy, width: w, height: h } }) });
  if (full) await page.screenshot({ path: `${out}click2-${full}.png` });
}
async function strip(name, cols, title) {
  const html = `<!doctype html><html><body style="margin:0;background:#1b2420;color:#eee6cf;font:600 13px/1.5 system-ui">
<div style="padding:4px 8px;background:#0e1411">real game · ${title}</div>
<div style="display:grid;grid-template-columns:repeat(${cols},max-content);gap:6px;padding:6px">
${shots.map((it) => `<figure style="margin:0"><img style="display:block" width="${it.w}" height="${it.h}" src="data:image/png;base64,${it.png.toString('base64')}"><figcaption style="padding:1px 4px;max-width:${it.w - 8}px">${it.caption}</figcaption></figure>`).join('\n')}</div></body></html>`;
  await sheetPage.setViewportSize({ width: 200, height: 100 });
  await sheetPage.setContent(html);
  const size = await sheetPage.evaluate(() => ({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight }));
  await sheetPage.setViewportSize({ width: size.w, height: size.h });
  await sheetPage.screenshot({ path: `${out}click2-${name}.png`, fullPage: true });
  say('STRIP', `${out}click2-${name}.png`, `${size.w}x${size.h}`);
  shots.length = 0;
}
const decks = (xs, y) => page.evaluate(([xs, y]) => xs.map((x) => { const b = window.game.builder.bridgeAt(x, y); return b ? window.game.builder.deckLevel(b) : '-'; }).join(' '), [xs, y]);

// =============================================================== A. a railed bridge over water
const C = found.cross,
  y = C.y,
  first = C.x - 1, // one platform on each bank as the ramp
  last = C.x + C.k,
  plats = Array.from({ length: last - first + 1 }, (_, i) => first + i),
  mid = C.x + (C.k >> 1);
await centre(mid, y);
await pick('Stone Bridge');
for (const x of plats) {
  await move(x, y);
  await click();
}
say('A: platforms placed by clicks, decks', await decks(plats, y));
await pick(/^1?Straight/);
{
  const p0 = await at(C.x - 3, y),
    p1 = await at(C.x + C.k + 2, y);
  await page.mouse.move(p0.x, p0.y, { steps: 4 });
  await frames();
  await page.mouse.down();
  await page.mouse.move(p1.x, p1.y, { steps: 16 });
  await frames();
  await page.mouse.up();
  await frames(10);
}
const all = Array.from({ length: C.k + 6 }, (_, i) => C.x - 3 + i);
let laid = await page.evaluate(([xs, y]) => xs.map((x) => (window.game.track.get(x, y)?.kind ?? '-')[0]).join(''), [all, y]);
say('A: track after dragging the Straight tool:', laid);
if (/-/.test(laid)) {
  laid = await page.evaluate(([xs, y]) => {
    const g = window.game,
      was = g.builder.free;
    g.builder.free = true;
    for (const x of xs) if (!g.track.has(x, y)) g.builder.placeTrackKind(x, y, 'straight', 1);
    g.builder.free = was;
    return xs.map((x) => (g.track.get(x, y)?.kind ?? '-')[0]).join('');
  }, [all, y]);
  say('A: completed through the builder (setup):', laid);
}
await away();
await snap(`1. ${plats.length} platforms (${C.k} over water, one on each bank), rail laid`, mid, y, 'water-0-built');
await pick('Stone Bridge');
// raise every platform by one, left to right, pointer on the visible deck
for (const x of plats) {
  await move(x, y, true);
  await click();
  await note(`A: left click on platform x=${x} -> 1`, x, y, { height: 1, track: 'straight' });
}
await away();
await snap('2. every platform left-clicked once: decks ' + (await decks(plats, y)), mid, y, 'water-1-all');
// the ones over water to 2
for (let x = C.x; x < C.x + C.k; x++) {
  await move(x, y, true);
  await click();
  await note(`A: left click on water platform x=${x} -> 2`, x, y, { height: 2 });
}
await away();
await snap('3. the water spans clicked again: decks ' + (await decks(plats, y)), mid, y, 'water-2-mid');
// the middle to 3 (allowed only when both neighbours stand at 2)
await move(mid, y, true);
await click();
const m3 = await note(`A: left click on the middle x=${mid} -> 3 ${C.k >= 3 ? '' : '(may be refused)'}`, mid, y, C.k >= 3 ? { height: 3 } : {});
await away();
await snap(`4. the middle span clicked a third time: decks ${await decks(plats, y)}`, mid, y, 'water-3-top');
// a bank platform cannot go to 2 while the ground rail beside it is at 0
await move(first, y, true);
await click();
await note(`A: left click on the bank platform x=${first} at 1 -> refused (ground rail beside it)`, first, y, { height: 1, status: /Cannot raise/ });
// right click on the middle, pointer on the visible deck: down again
await page.waitForTimeout(2400);
await move(mid, y, true);
for (let h = m3.height - 1; h >= 0; h--) {
  await click('right');
  await note(`A: right click on the middle -> ${h}${h === 0 ? ' (may be refused: neighbours at 2)' : ''}`, mid, y, h >= 1 ? { height: h } : {});
}
await away();
await snap('5. the middle right-clicked down as far as the rules allow: decks ' + (await decks(plats, y)), mid, y);
// lower everything back, outside in is refused, so inside out
for (let pass = 0; pass < 4; pass++)
  for (const x of [...plats].sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid))) {
    await move(x, y, true);
    await click('right');
    await frames(3);
  }
say('A: after right-clicking every platform four times, decks', await decks(plats, y));
await away();
await page.waitForTimeout(600);
await snap('6. everything right-clicked back down: decks ' + (await decks(plats, y)), mid, y);
const stillThere = await page.evaluate(([xs, y]) => xs.map((x) => (window.game.builder.bridgeAt(x, y) ? 'P' : '-')).join(''), [plats, y]);
say('A: platforms still standing after the lowering clicks:', stillThere, '| track:', await page.evaluate(([xs, y]) => xs.map((x) => (window.game.track.get(x, y)?.kind ?? '-')[0]).join(''), [all, y]));
await strip('A-water-rail', 2, 'a railed stone bridge over water (zoom 2)');
say('contextmenu events cancelled by the page:', JSON.stringify(await page.evaluate(() => window.__ctx)));

// =============================================================== B. pointer on the top of a high bare deck, zoom 4
{
  const spot = await page.evaluate(async ([cx, cy]) => {
    const { levelAt } = await import('/src/world/elevation.ts');
    const g = window.game,
      m = g.map,
      b = g.builder;
    let best = null;
    for (let y = 4; y < m.h - 4; y++)
      for (let x = 4; x < m.w - 4; x++) {
        let ok = true;
        for (let dy = -2; dy <= 2 && ok; dy++)
          for (let dx = -2; dx <= 2 && ok; dx++)
            ok = m.terrain[(y + dy) * m.w + x + dx] === 0 && levelAt(m, x + dx, y + dy) === 0 && !b.buildingAt(x + dx, y + dy) && !g.track.has(x + dx, y + dy) && !b.stationAt(x + dx, y + dy) && !m.props.get((y + dy) * m.w + x + dx)?.length;
        if (!ok) continue;
        const d = Math.abs(x - cx) + Math.abs(y - cy);
        if (d > 6 && (!best || d < best.d)) best = { x, y, d };
      }
    return best;
  }, [mid, y]);
  say('B: spot', JSON.stringify(spot));
  if (spot) {
    const { x: bx, y: by } = spot;
    await centre(bx, by, 6);
    await pick('Wooden Bridge');
    // two platforms: one behind (bx, by - 1) and the one in front (bx, by)
    for (const [x, yy] of [[bx, by - 1], [bx, by]]) {
      await move(x, yy);
      await click();
    }
    await move(bx, by);
    for (const h of [1, 2, 3]) {
      await click();
      await note(`B: left click on the front platform -> ${h}`, bx, by, { height: h });
    }
    await away();
    await snap('1. zoom 4: front platform clicked to 3, the one behind on the ground', bx, by, 'high-0', 700, 520);
    // pointer on the visible top of the high deck
    await move(bx, by, true);
    await note('B: pointer on the visible top of the height-3 deck: which tile is hovered?', bx, by, { hover: `${bx},${by}` });
    await click();
    await note('B: left click there -> 4', bx, by, { height: 4 });
    await away();
    await move(bx, by, true);
    await click('right');
    await note('B: away and back onto the visible top, right click -> 3', bx, by, { height: 3 });
    // pointer on the ground diamond of the raised tile (under the deck)
    await away();
    await move(bx, by, false);
    const under = await note('B: pointer on the ground diamond under the height-3 deck: hovered tile?', bx, by);
    await click();
    const after = await state(bx, by),
      behind = await state(bx, by - 1);
    say(`B: left click on the ground under the deck: front platform height ${after.height} (was 3), platform behind height ${behind.height}; hovered ${under.hover}`);
    // the platform behind is partly hidden by the high deck: click its visible part
    await away();
    await move(bx, by - 1, false);
    const hb = await note('B: pointer on the ground-level platform behind the high one', bx, by - 1);
    await click();
    await note('B: left click -> the platform behind rises to 1', bx, by - 1, { height: 1 });
    await away();
    await snap('2. after the clicks: front ' + (await state(bx, by)).height + ', behind ' + (await state(bx, by - 1)).height, bx, by, 'high-1', 700, 520);
    await strip('B-high-deck', 2, 'pointer on a high deck (zoom 4)');
  }
}
const failed = results.filter((r) => !r.ok);
say(failed.length ? `FAILED ${failed.length} of ${results.length}` : `ALL ${results.length} EXPECTATIONS MET`);
say('page errors', JSON.stringify(errors));
writeFileSync(`${out}click2-log.json`, JSON.stringify({ found, results, log, errors }, null, 1));
await browser.close();
