// Review: the deck click in the REAL game (main page, a new generated world), driven by the
// browser's own mouse (Playwright page.mouse: trusted pointer + mouse events on the canvas).
//   node scratchpad/bridges/review-click.mjs
// Writes scratchpad/bridges/review/click-*.png and review/click-log.json
import { launch } from '../runtime.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const out = process.env.REVIEW_OUT ?? 'scratchpad/bridges/review/';
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

// ---- find tiles a player could use, nearest to the middle of the starting area
const found = await page.evaluate(async () => {
  const { levelAt } = await import('/src/world/elevation.ts');
  const g = window.game,
    m = g.map,
    b = g.builder;
  g.settings.autosave = false;
  g.settings.edgeScroll = false;
  const depot = b.stations.find((s) => s.def.depot) ?? { x: m.w >> 1, y: m.h >> 1 };
  const ok = (x, y) => x > 2 && y > 2 && x < m.w - 3 && y < m.h - 3 && b.checkBuilding(x, y, 'bridge_stone').ok;
  const near = (pred) => {
    let best = null;
    for (let y = 3; y < m.h - 3; y++)
      for (let x = 3; x < m.w - 3; x++) {
        if (!pred(x, y)) continue;
        const d = Math.abs(x - depot.x) + Math.abs(y - depot.y);
        if (d > 4 && (!best || d < best.d)) best = { x, y, d };
      }
    return best;
  };
  const T = (x, y) => m.terrain[y * m.w + x];
  const bare = (x, y) => !m.props.get(y * m.w + x)?.length;
  const first = {
    land: near((x, y) => T(x, y) === 0 && levelAt(m, x, y) === 0 && ok(x, y) && bare(x, y)),
    water: near((x, y) => T(x, y) === 3 && ok(x, y)),
    hill: near((x, y) => T(x, y) === 2 && levelAt(m, x, y) >= 1 && ok(x, y)),
  };
  // Nothing of a kind inside the starting chunks: own every chunk (setup only; noted in the log).
  let ownedAll = false;
  if (!first.water || !first.hill) {
    for (let i = 0; i < g.regions.unlocked.length; i++) g.regions.own(i);
    g.world.rebuildFog();
    ownedAll = true;
  }
  const res = {
    ownedAll,
    depot: { x: depot.x, y: depot.y },
    land: first.land,
    water: near((x, y) => T(x, y) === 3 && ok(x, y)),
    hill: near((x, y) => T(x, y) === 2 && levelAt(m, x, y) >= 1 && ok(x, y)),
    // a row of 7 flat bare grass tiles along x for the rail case
    row: near((x, y) => {
      for (let i = -3; i <= 3; i++) if (!(T(x + i, y) === 0 && levelAt(m, x + i, y) === 0 && ok(x + i, y) && bare(x + i, y))) return false;
      for (let i = -3; i <= 3; i++) for (const dy of [-1, 1]) if (levelAt(m, x + i, y + dy) !== 0 || T(x + i, y + dy) === 3) return false;
      return true;
    }),
    stock: { stone: Math.floor(g.stock.get('stone')), wood: Math.floor(g.stock.get('wood')) },
  };
  for (const k of ['land', 'water', 'hill', 'row']) if (res[k]) res[k].level = levelAt(m, res[k].x, res[k].y);
  return res;
});
say('targets', JSON.stringify(found));

const frames = (n = 6) => page.waitForTimeout(n * 40);
/** Put the camera on a tile at a zoom step of the game (as panning and the wheel would). */
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
/** Page pixel of a tile: its ground diamond centre, or the visible surface (deck top). */
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
        set: b ? (b.deck ?? 'auto') : null,
        ground: levelAt(g.map, x, y),
        track: g.track.get(x, y)?.kind ?? null,
        hover: `${g.hoverTile.x},${g.hoverTile.y}`,
        tool: g.build.tool.kind === 'building' ? g.build.tool.defId : g.build.tool.kind,
        status: document.querySelector('#toolbar .tb-statusrow')?.firstElementChild?.textContent ?? '',
        selected: g.build.selectedBuilding ? `${g.build.selectedBuilding.x},${g.build.selectedBuilding.y}` : null,
      };
    },
    [x, y],
  );
const results = [];
/** Record the state of a tile after an event and compare with what the owner expects. */
async function note(event, x, y, expect = {}) {
  await frames();
  const s = await state(x, y);
  const bad = Object.entries(expect).filter(([k, v]) => (v instanceof RegExp ? !v.test(String(s[k])) : s[k] !== v));
  results.push({ event, tile: [x, y], ...s, ok: !bad.length, expected: Object.fromEntries(Object.entries(expect).map(([k, v]) => [k, String(v)])) });
  say(`${bad.length ? 'FAIL' : 'ok  '} ${event.padEnd(64)} | ${s.platform} | track=${s.track} | hover=${s.hover} | tool=${s.tool} | "${s.status}"${bad.length ? ' | WANTED ' + bad.map(([k, v]) => `${k}=${v}`).join(', ') : ''}`);
  return s;
}
const move = async (x, y, surface = false) => {
  const p = await at(x, y, surface);
  await page.mouse.move(p.x, p.y, { steps: 5 });
  await frames();
  return p;
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
/** A clip around a tile (native pixels) for the film strip, and optionally a full screenshot. */
async function snap(caption, x, y, full = null, w = 460, h = 330) {
  await frames(8);
  const p = await at(x, y);
  const cx = Math.max(0, Math.min(1440 - w, Math.round(p.x - w / 2))),
    cy = Math.max(0, Math.min(1000 - h, Math.round(p.y - h * 0.62)));
  shots.push({ caption, w, h, png: await page.screenshot({ clip: { x: cx, y: cy, width: w, height: h } }) });
  if (full) await page.screenshot({ path: `${out}click-${full}.png` });
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
  await sheetPage.screenshot({ path: `${out}click-${name}.png`, fullPage: true });
  say('STRIP', `${out}click-${name}.png`, `${size.w}x${size.h}`);
  shots.length = 0;
}

// =============================================================== 1. plain land, no rail
{
  const L = found.land;
  await centre(L.x, L.y);
  await pick('Stone Bridge');
  await move(L.x, L.y);
  await note('LAND: stone bridge tool held, pointer on empty grass', L.x, L.y, { platform: 'none', tool: 'bridge_stone' });
  await snap('1. tool held, ghost on plain grass', L.x, L.y, 'land-0-ghost');
  await click();
  await note('LAND: left click 1 -> platform placed', L.x, L.y, { height: L.level, set: 'auto' });
  await snap('2. left click: platform placed on the ground', L.x, L.y);
  for (const h of [1, 2, 3, 4]) {
    await click();
    await note(`LAND: left click -> raised to ${h}`, L.x, L.y, { height: L.level + h });
    await snap(`${2 + h}. left click: deck height ${h}`, L.x, L.y, h === 3 ? 'land-3-raised' : null);
  }
  await click();
  await note('LAND: left click at the top -> refused', L.x, L.y, { height: L.level + 4, status: /Cannot raise/ });
  await snap('7. left click at height 4: refused (status line says why)', L.x, L.y, 'land-4-refused');
  for (const h of [3, 2, 1, 0]) {
    await click('right');
    await note(`LAND: right click -> lowered to ${h}`, L.x, L.y, { height: L.level + h });
    await snap(`right click: deck height ${h}`, L.x, L.y);
  }
  await click('right');
  const guarded = await note('LAND: right click on the ground straight after -> ?', L.x, L.y);
  await snap(`right click at the floor straight after: ${guarded.platform === 'none' ? 'REMOVED' : 'kept, says why'}`, L.x, L.y);
  await page.waitForTimeout(2600);
  await click('right');
  const later = await note('LAND: right click at the floor 2.6 s later -> ?', L.x, L.y);
  await snap(`right click at the floor 2.6 s later: ${later.platform === 'none' ? 'platform removed' : 'still there'}`, L.x, L.y);
  await strip('1-land', 4, 'plain land: left click raises, right click lowers (zoom 2)');
}
// =============================================================== 2. over water
if (found.water) {
  const Wt = found.water;
  await centre(Wt.x, Wt.y);
  await pick('Stone Bridge');
  await move(Wt.x, Wt.y);
  await note('WATER: pointer on a water tile', Wt.x, Wt.y, { platform: 'none' });
  await snap('1. ghost over water', Wt.x, Wt.y);
  await click();
  await note('WATER: left click -> platform placed at the waterline', Wt.x, Wt.y, { height: 0, set: 'auto' });
  await snap('2. placed at the waterline', Wt.x, Wt.y);
  for (const h of [1, 2, 3]) {
    await click();
    await note(`WATER: left click -> raised to ${h}`, Wt.x, Wt.y, { height: h });
    await snap(`left click: ${h} above the water`, Wt.x, Wt.y, h === 2 ? 'water-2-raised' : null);
  }
  for (const h of [2, 1, 0]) {
    await click('right');
    await note(`WATER: right click -> lowered to ${h}`, Wt.x, Wt.y, { height: h });
    await snap(`right click: ${h} above the water`, Wt.x, Wt.y);
  }
  // wooden bridge next to it, raised by the wooden tool
  await pick('Wooden Bridge');
  await move(Wt.x, Wt.y);
  await click();
  await note('WATER: wooden tool, left click on the stone platform -> raised', Wt.x, Wt.y, { height: 1 });
  await snap('wooden tool on the stone platform: it raises too', Wt.x, Wt.y);
  await strip('2-water', 4, 'over water: left click raises, right click lowers (zoom 2)');
} else say('NO WATER TILE FOUND');
// =============================================================== 3. on a hill
if (found.hill) {
  const Hh = found.hill;
  await centre(Hh.x, Hh.y);
  await pick('Stone Bridge');
  await move(Hh.x, Hh.y);
  await note('HILL: pointer on a hill tile', Hh.x, Hh.y, { platform: 'none' });
  await snap(`1. ghost on a hill tile (ground level ${Hh.level})`, Hh.x, Hh.y);
  await click();
  await note('HILL: left click -> platform placed on the hill', Hh.x, Hh.y, { height: Hh.level });
  await snap('2. placed', Hh.x, Hh.y);
  const max = Math.min(2, 4 - Hh.level);
  for (let h = 1; h <= max; h++) {
    await click();
    await note(`HILL: left click -> raised to ${Hh.level + h}`, Hh.x, Hh.y, { height: Hh.level + h });
    await snap(`left click: deck height ${Hh.level + h} (${h} above the hill)`, Hh.x, Hh.y);
  }
  for (let h = max - 1; h >= 0; h--) {
    await click('right');
    await note(`HILL: right click -> lowered to ${Hh.level + h}`, Hh.x, Hh.y, { height: Hh.level + h });
    await snap(`right click: deck height ${Hh.level + h}`, Hh.x, Hh.y);
  }
  await strip('3-hill', 3, 'on a hill: left click raises, right click lowers (zoom 2)');
} else say('NO HILL TILE FOUND');
// =============================================================== 4. with rail on it
if (found.row) {
  const R = found.row;
  await centre(R.x, R.y);
  await pick('Stone Bridge');
  for (const dx of [-1, 0, 1]) {
    await move(R.x + dx, R.y);
    await click();
  }
  await note('RAIL: three platforms placed by clicks', R.x, R.y, { height: 0, set: 'auto' });
  // lay straight track over seven tiles with the real Straight tool: press on the first, drag, release
  await pick(/^1?Straight/);
  let p0 = await at(R.x - 3, R.y),
    p1 = await at(R.x + 3, R.y);
  await page.mouse.move(p0.x, p0.y, { steps: 4 });
  await frames();
  await page.mouse.down();
  await page.mouse.move(p1.x, p1.y, { steps: 14 });
  await frames();
  await page.mouse.up();
  await frames(10);
  let laid = await page.evaluate(([x, y]) => [-3, -2, -1, 0, 1, 2, 3].map((i) => (window.game.track.get(x + i, y)?.kind ?? '-')[0]).join(''), [R.x, R.y]);
  say('RAIL: track after dragging the Straight tool over 7 tiles:', laid);
  if (!/^s{7}$/.test(laid)) {
    laid = await page.evaluate(([x, y]) => {
      const g = window.game,
        was = g.builder.free;
      g.builder.free = true;
      for (let i = -3; i <= 3; i++) if (!g.track.has(x + i, y)) g.builder.placeTrackKind(x + i, y, 'straight', 1);
      g.builder.free = was;
      return [-3, -2, -1, 0, 1, 2, 3].map((i) => (g.track.get(x + i, y)?.kind ?? '-')[0]).join('');
    }, [R.x, R.y]);
    say('RAIL: completed through the builder (setup):', laid);
  }
  await snap('1. three platforms on flat land, rail laid over them', R.x, R.y, null, 620, 400);
  await pick('Stone Bridge');
  await move(R.x, R.y);
  await note('RAIL: bridge tool, pointer on the middle platform', R.x, R.y, { height: 0, track: 'straight' });
  await click();
  await note('RAIL: left click on the middle -> raised to 1, rail follows', R.x, R.y, { height: 1, track: 'straight' });
  await snap('2. left click on the middle span: 1 up, rail climbs', R.x, R.y, 'rail-1-middle', 620, 400);
  await click();
  await note('RAIL: left click again -> refused (too steep)', R.x, R.y, { height: 1, status: /Cannot raise/ });
  await snap('3. second click on it: refused, too steep', R.x, R.y, 'rail-2-refused', 620, 400);
  for (const dx of [-1, 1]) {
    await move(R.x + dx, R.y);
    await click();
    await note(`RAIL: left click on the ${dx < 0 ? 'left' : 'right'} span -> 1`, R.x + dx, R.y, { height: 1 });
  }
  await move(R.x, R.y, true);
  await click();
  await note('RAIL: left click on the middle deck (pointer on the visible deck) -> 2', R.x, R.y, { height: 2 });
  await snap('4. both end spans 1 up, middle 2 up', R.x, R.y, 'rail-3-121', 620, 400);
  await click('right');
  await note('RAIL: right click on the middle -> 1', R.x, R.y, { height: 1 });
  for (const dx of [-1, 0, 1]) {
    await move(R.x + dx, R.y, true);
    await click('right');
    await note(`RAIL: right click span ${dx} -> 0`, R.x + dx, R.y, { height: 0 });
  }
  await snap('5. all three right-clicked back to the ground', R.x, R.y, null, 620, 400);
  await move(R.x, R.y);
  await page.waitForTimeout(2600);
  await note('RAIL: status line over a railed platform at the floor', R.x, R.y, { height: 0, track: 'straight' });
  await strip('4-rail', 2, 'platforms carrying rail on flat land (zoom 2)');

  // ---- other tools keep their meaning
  await page.keyboard.press('Escape');
  await frames();
  await move(R.x, R.y);
  await click();
  await note('NO TOOL: left click on a platform -> selected, not raised', R.x, R.y, { height: 0, tool: 'none' });
  await page.screenshot({ path: `${out}click-notool-leftclick.png` });
  await pick(/^1?Straight/);
  await move(R.x, R.y);
  // (hover only: a click with the track tool would replace the piece, as it always did)
  await note('TRACK TOOL: pointer on a railed platform -> the track tool keeps its own meaning', R.x, R.y, { height: 0, status: /^Replace straight/ });
  await page.keyboard.press('Escape');
} else say('NO FLAT ROW FOUND');

// =============================================================== 5. zoom 4 view of a raised bridge in the real game
if (found.row) {
  const R = found.row;
  await pick('Stone Bridge');
  await move(R.x, R.y);
  await click();
  for (const dx of [-1, 1]) {
    await move(R.x + dx, R.y);
    await click();
  }
  await move(R.x, R.y, true);
  await click();
  await page.keyboard.press('Escape');
  await centre(R.x, R.y, 6);
  await page.mouse.move(200, 300);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}click-realgame-z4.png` });
  await centre(R.x, R.y, 4);
  await page.mouse.move(200, 300);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}click-realgame-z2.png` });
  say('final decks', JSON.stringify(await page.evaluate(([x, y]) => [-1, 0, 1].map((i) => window.game.builder.deckLevel(window.game.builder.bridgeAt(x + i, y))), [R.x, R.y])));
}
const failed = results.filter((r) => !r.ok);
say(failed.length ? `FAILED ${failed.length} of ${results.length}` : `ALL ${results.length} EXPECTATIONS MET`);
say('page errors', JSON.stringify(errors));
writeFileSync(`${out}click-log.json`, JSON.stringify({ found, results, log, errors }, null, 1));
await browser.close();
