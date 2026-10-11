// Review scratch (independent of the implementer's scenes): bridges built through the game's own
// rules on one empty map, for fresh renders.
//   ?axis=x|y  spans run along tile x (screen lower right) or tile y (screen lower left)
//   ?proc=1    the packed bridges atlas answers 404: procedural swatches
const params = new URLSearchParams(location.search);
const AXIS = params.get('axis') === 'y' ? 'y' : 'x';
const PROC = params.get('proc') === '1';
if (PROC) {
  const real = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (/\/assets\/bridges\.json/.test(url)) return Promise.resolve(new Response('', { status: 404 }));
    return real(input, init);
  };
}
const { Game } = await import('/src/game.ts');
const { emptyMap } = await import('/src/world/mapgen.ts');
const { levelFromMap } = await import('/src/world/level.ts');
const { levelAt } = await import('/src/world/elevation.ts');
const { tileToWorld } = await import('/src/engine/iso.ts');
const { railLevel } = await import('/src/world/railProfile.ts');
const { Train } = await import('/src/sim/trains.ts');
const { content } = await import('/src/data/content.ts');
const { findPath } = await import('/src/world/pathfinding.ts');
const { Graphics } = await import('pixi.js');

const label = document.getElementById('qa-label');
const W = 180,
  H = 180;
const map = emptyMap(90210, W, H);
const T = (l, w) => (AXIS === 'x' ? { x: l, y: w } : { x: w, y: l });
const CODE = { g: 0, f: 1, h: 2, w: 3 };
const SITES = [];
const rowW = (row) => 12 + row * 10;
const run = (a, n) => Array.from({ length: n }, (_, i) => a + i);
const g = (n) => 'g'.repeat(n),
  w = (n) => 'w'.repeat(n),
  h = (n) => 'h'.repeat(n);

/**
 * pattern: terrain along the line; lines: [{ w, material, on: [along indices with a platform],
 * track: true|false, decks: {i: level} (clicked after everything is built) }]
 */
function site(id, row, l0, pattern, lines, opts = {}) {
  const w0 = rowW(row),
    band = opts.band ?? [-2, 2];
  for (let i = 0; i < pattern.length; i++)
    for (let ww = band[0]; ww <= band[1]; ww++) {
      const t = T(l0 + i, w0 + ww);
      map.terrain[t.y * W + t.x] = CODE[pattern[i]];
    }
  SITES.push({ id, row, l0, w0, pattern, lines, ...opts });
  return l0 + pattern.length + (opts.gap ?? 3);
}

for (const [m, material] of [
  [0, 'stone'],
  [1, 'wood'],
]) {
  // Over water, banks level: 1..6 tiles.
  let l = 8;
  for (const n of [1, 2, 3, 4, 5, 6])
    l = site(`W${n}-${material}`, m, l, g(3) + w(n) + g(3), [{ w: 0, material, on: run(3, n), track: true }]);
  // Over a land dip between hills: 1..6 tiles of floor, platforms on the floor (deck one level up).
  l = 8;
  for (const n of [1, 2, 3, 4, 5, 6])
    l = site(`L${n}-${material}`, 2 + m, l, g(2) + h(2) + g(n) + h(2) + g(2), [{ w: 0, material, on: run(4, n), track: true }]);
  // On plain flat land: 1..6 platforms with rail over them (deck 0), raised by the capture.
  l = 8;
  for (const n of [1, 2, 3, 4, 5, 6])
    l = site(`F${n}-${material}`, 4 + m, l, g(n + 6), [{ w: 0, material, on: run(3, n), track: true }]);
  // Plain land, bare platforms (no rail): 1..6, raised as blocks by the capture.
  l = 8;
  for (const n of [1, 2, 3, 4, 5, 6])
    l = site(`B${n}-${material}`, 6 + m, l, g(n + 4), [{ w: 0, material, on: run(2, n), track: false }], { gap: 2 });
  // Banks at different levels.
  l = 8;
  // water, bank 1 left, 0 right
  l = site(`DW10-${material}`, 8 + m, l, g(2) + h(3) + w(3) + g(3), [{ w: 0, material, on: run(5, 3), track: true }]);
  // water, bank 1 both sides
  l = site(`DW11-${material}`, 8 + m, l, g(2) + h(3) + w(3) + h(3) + g(2), [{ w: 0, material, on: run(5, 3), track: true }]);
  // water, bridged from the level-2 hill over its level-1 shoulder and the water to level-0 land
  l = site(`DW20-${material}`, 8 + m, l, g(2) + h(4) + w(3) + g(3), [{ w: 0, material, on: run(5, 4), track: true }]);
  // land: 2 on the left, 1 on the right
  l = site(`DL21-${material}`, 8 + m, l, g(2) + h(4) + g(1) + h(2) + g(2), [{ w: 0, material, on: run(5, 2), track: true }]);
  // land: 2 on the left, 0 on the right
  l = site(`DL20-${material}`, 8 + m, l, g(2) + h(4) + g(5), [{ w: 0, material, on: run(5, 3), track: true }]);
  // land: 1 on the left, 0 on the right
  l = site(`DL10-${material}`, 8 + m, l, g(2) + h(2) + g(6), [{ w: 0, material, on: run(4, 3), track: true }]);
  // Raised over water by clicks: three spans one level up; a lake crossed at 2 and at 3.
  l = 8;
  l = site(`WR1-${material}`, 10 + m, l, g(3) + w(3) + g(3), [
    { w: 0, material, on: run(3, 3), track: true, decks: { 3: 1, 4: 1, 5: 1 } },
  ]);
  l = site(`WR2-${material}`, 10 + m, l, g(4) + w(3) + g(4), [
    { w: 0, material, on: run(3, 5), track: true, decks: { 3: 1, 4: 2, 5: 2, 6: 2, 7: 1 } },
  ]);
  l = site(`WR3-${material}`, 10 + m, l, g(5) + w(3) + g(5), [
    { w: 0, material, on: run(3, 7), track: true, decks: { 3: 1, 4: 2, 5: 3, 6: 3, 7: 3, 8: 2, 9: 1 } },
  ]);
  // The same over plain land: a long ramp up to 3 and down, for trains.
  l = site(`LR3-${material}`, 10 + m, l, g(15), [
    { w: 0, material, on: run(3, 9), track: true, decks: { 3: 1, 4: 2, 5: 3, 6: 3, 7: 3, 8: 3, 9: 3, 10: 2, 11: 1 } },
  ]);
  // ... and to the top (4).
  l = site(`LR4-${material}`, 10 + m, l, g(15), [
    { w: 0, material, on: run(3, 9), track: true, decks: { 3: 1, 4: 2, 5: 3, 6: 4, 7: 4, 8: 4, 9: 3, 10: 2, 11: 1 } },
  ]);
}
// Two (and three) bridges side by side.
{
  let l = 8;
  const band = [-2, 3];
  l = site('SS-water', 12, l, g(3) + w(4) + g(3), [
    { w: 0, material: 'stone', on: run(3, 4), track: true },
    { w: 1, material: 'stone', on: run(3, 4), track: true },
  ], { band });
  l = site('WW-water', 12, l, g(3) + w(4) + g(3), [
    { w: 0, material: 'wood', on: run(3, 4), track: true },
    { w: 1, material: 'wood', on: run(3, 4), track: true },
  ], { band });
  l = site('SW-water', 12, l, g(3) + w(4) + g(3), [
    { w: 0, material: 'stone', on: run(3, 4), track: true },
    { w: 1, material: 'wood', on: run(3, 4), track: true },
  ], { band });
  l = site('WS-water', 12, l, g(3) + w(4) + g(3), [
    { w: 0, material: 'wood', on: run(3, 4), track: true },
    { w: 1, material: 'stone', on: run(3, 4), track: true },
  ], { band });
  // One free tile between the two bridges.
  l = site('GAP-water', 12, l, g(3) + w(4) + g(3), [
    { w: -1, material: 'stone', on: run(3, 4), track: true },
    { w: 1, material: 'wood', on: run(3, 4), track: true },
  ], { band: [-3, 3] });
  l = 8;
  const up = { 3: 1, 4: 2, 5: 2, 6: 2, 7: 1 },
    low = { 3: 1, 4: 1, 5: 1, 6: 1, 7: 1 };
  l = site('SS-up', 13, l, g(11), [
    { w: 0, material: 'stone', on: run(3, 5), track: true, decks: up },
    { w: 1, material: 'stone', on: run(3, 5), track: true, decks: up },
  ], { band });
  l = site('WW-up', 13, l, g(11), [
    { w: 0, material: 'wood', on: run(3, 5), track: true, decks: up },
    { w: 1, material: 'wood', on: run(3, 5), track: true, decks: up },
  ], { band });
  l = site('HI-behind', 13, l, g(11), [
    { w: 0, material: 'stone', on: run(3, 5), track: true, decks: up },
    { w: 1, material: 'stone', on: run(3, 5), track: true, decks: low },
  ], { band });
  l = site('HI-front', 13, l, g(11), [
    { w: 0, material: 'wood', on: run(3, 5), track: true, decks: low },
    { w: 1, material: 'wood', on: run(3, 5), track: true, decks: up },
  ], { band });
  l = site('MIX-up', 13, l, g(11), [
    { w: 0, material: 'stone', on: run(3, 5), track: true, decks: up },
    { w: 1, material: 'wood', on: run(3, 5), track: true, decks: up },
  ], { band });
}

const level = levelFromMap(map, 'Bridge review');
const game = new Game({ kind: 'level', seed: 90210, level });
window.game = game;
await game.init();
game.loop.stop();
game.app.ticker.stop();
game.closeMenus();
game.settings.autosave = false;
game.settings.weather = false;
game.settings.dayNight = false;
game.settings.smoke = false;
game.clock.setSpeed(0);
game.builder.free = true;
for (let i = 0; i < game.regions.unlocked.length; i++) game.regions.own(i);
game.world.rebuildFog();
const m = game.map,
  b = game.builder;
for (const k of [...m.props.keys()]) {
  m.props.delete(k);
  game.world.removeProps(k % m.w, Math.floor(k / m.w));
}
const STEP = game.world.landscape.step;
const problems = [];

function straight(x, y) {
  const want = AXIS === 'x' ? [1, 3] : [0, 2];
  let reason;
  for (const r of [0, 1]) {
    const c = b.checkTrack(x, y, { kind: 'straight', cls: 'regular', cls2: 'regular' }, r);
    if (!c.ok) {
      reason = c.reason;
      continue;
    }
    if (!b.placeTrackKind(x, y, 'straight', r)) continue;
    const link = game.track.get(x, y).links[0];
    if (want.every((d) => link.includes(d))) return true;
    b.removeTrack(x, y);
  }
  return reason ?? 'no rotation fits';
}
/** Click every listed platform (changeDeck, one level per call) until it stands at its target. */
function clickTo(id, targets) {
  const log = [];
  for (let pass = 0; pass < 14; pass++) {
    let moved = false;
    for (const { x, y, deck } of targets) {
      const p = b.bridgeAt(x, y);
      if (!p) continue;
      const now = b.deckLevel(p);
      if (now === deck) continue;
      const d = Math.sign(deck - now),
        c = b.checkDeck(p, d);
      if (b.changeDeck(p, d)) moved = true;
      else log.push({ x, y, want: deck, at: now, reason: c.reason });
    }
    if (!moved) break;
  }
  const left = targets
    .map((t) => ({ ...t, got: b.bridgeAt(t.x, t.y) ? b.deckLevel(b.bridgeAt(t.x, t.y)) : null }))
    .filter((t) => t.got !== t.deck);
  for (const t of left) problems.push({ site: id, what: 'deck', ...t, reason: log.filter((e) => e.x === t.x && e.y === t.y).pop()?.reason });
  return left;
}
for (const s of SITES) {
  s.tiles = [];
  for (const line of s.lines) {
    for (const i of line.on) {
      const t = T(s.l0 + i, s.w0 + line.w);
      if (!b.placeBuilding(t.x, t.y, 'bridge_' + line.material))
        problems.push({ site: s.id, what: 'platform', i, reason: b.checkBuilding(t.x, t.y, 'bridge_' + line.material).reason });
      else s.tiles.push({ ...t, i, w: line.w, material: line.material });
    }
    if (line.track)
      for (let i = 0; i < s.pattern.length; i++) {
        const t = T(s.l0 + i, s.w0 + line.w),
          r = straight(t.x, t.y);
        if (r !== true) problems.push({ site: s.id, what: 'track', i, w: line.w, reason: r });
      }
  }
  for (const line of s.lines)
    if (line.decks)
      clickTo(
        s.id,
        Object.entries(line.decks).map(([i, deck]) => ({ ...T(s.l0 + +i, s.w0 + line.w), deck })),
      );
  const on = s.tiles.map((t) => t.i),
    ws = s.lines.map((l) => l.w),
    mid = T(s.l0 + (Math.min(...on) + Math.max(...on)) / 2, s.w0 + (Math.min(...ws) + Math.max(...ws)) / 2);
  s.cx = mid.x;
  s.cy = mid.y;
}

async function settle() {
  game.render(1, 0);
  let n = 0;
  while (!game.world.landscape.ready && n++ < 600) {
    await new Promise((r) => setTimeout(r, 50));
    game.render(1, 0);
  }
  game.render(1, 0);
  return game.world.landscape.ready;
}
function view(cx, cy, zoom, text = '') {
  const at = tileToWorld(cx, cy),
    wy = at.y + game.world.elevationOf(Math.round(cx), Math.round(cy)) / 2;
  game.camera.zoom = zoom;
  game.camera.centerOn(at.x, wy);
  game.render(1, 0);
  game.app.renderer.render(game.app.stage);
  label.textContent = text;
  // Where the asked point landed on screen (the camera clamps near the map edge).
  return game.camera.worldToScreen(at.x, wy);
}
function bedOf(x, y) {
  return game.fleet.railBeds?.get(y * m.w + x);
}
/** Rail/deck level at a tile position along the scene axis. */
function levelOn(x, y, fx, fy) {
  const bed = bedOf(x, y),
    p = b.bridgeAt(x, y);
  if (bed) return railLevel(bed, bed.axis === 'x' ? fx : fy);
  return p ? b.deckLevel(p) : levelAt(m, x, y);
}
function facts(s) {
  return s.tiles.map((t) => {
    const p = b.bridgeAt(t.x, t.y),
      bed = bedOf(t.x, t.y);
    return {
      i: t.i,
      w: t.w,
      x: t.x,
      y: t.y,
      ground: levelAt(m, t.x, t.y),
      water: m.terrain[t.y * m.w + t.x] === 3,
      set: p?.deck ?? 'auto',
      deck: p ? b.deckLevel(p) : null,
      rail: bed ? +railLevel(bed, bed.axis === 'x' ? t.x : t.y).toFixed(3) : null,
      track: game.track.has(t.x, t.y),
    };
  });
}
let gridG = null;
/**
 * Reference lines computed here from tile coordinates alone: the diamond of every bridge tile
 * at the deck height of its four corners (rail profile at the tile's two cross edges), in
 * magenta; a cyan vertical from each deck corner down to the ground level of the tile.
 */
function grid(on, verticals = false) {
  gridG?.destroy();
  gridG = null;
  if (!on) return;
  gridG = new Graphics();
  game.world.overlay.addChild(gridG);
  for (const s of SITES)
    for (const t of s.tiles) {
      if (!b.bridgeAt(t.x, t.y)) continue;
      const c = [
        [t.x - 0.5, t.y - 0.5],
        [t.x + 0.5, t.y - 0.5],
        [t.x + 0.5, t.y + 0.5],
        [t.x - 0.5, t.y + 0.5],
      ].map(([fx, fy]) => {
        const p = tileToWorld(fx, fy),
          z = levelOn(t.x, t.y, fx, fy) * STEP;
        return [p.x, p.y - z, p.y - levelAt(m, t.x, t.y) * STEP];
      });
      gridG.poly(c.flatMap((p) => [p[0], p[1]])).stroke({ width: 0.4, color: 0xff00ff, alpha: 0.95 });
      if (verticals)
        for (const p of c) gridG.moveTo(p[0], p[1]).lineTo(p[0], p[2]).stroke({ width: 0.3, color: 0x00ffff, alpha: 0.9 });
    }
}
/** One deck click on along index i of a site's line at across offset w: +1 raises, -1 lowers. */
function click(id, i, delta, ww = 0) {
  const s = SITES.find((s) => s.id === id),
    t = T(s.l0 + i, s.w0 + ww),
    p = b.bridgeAt(t.x, t.y);
  if (!p) return { ok: false, reason: 'no platform' };
  const c = b.checkDeck(p, delta);
  return { ok: b.changeDeck(p, delta), reason: c.reason, deck: b.deckLevel(p) };
}
/** Click a site's line to the given levels: { alongIndex: level }. */
function setDecks(id, levels, ww = 0) {
  const s = SITES.find((s) => s.id === id);
  return clickTo(
    id,
    Object.entries(levels).map(([i, deck]) => ({ ...T(s.l0 + +i, s.w0 + ww), deck })),
  );
}
let uid = 77000;
const LOCO = (id) => content.locomotives.find((d) => d.id === id),
  WAGON = (id) => content.wagons.find((d) => d.id === id);
/** A standing train on a site's line, head at along index `head` (fractional), facing +along. */
function trainAt(id, ww, head, loco = 'rocket', wagons = ['wooden_coach'], dir = 1) {
  const s = SITES.find((s) => s.id === id),
    t = new Train([{ uid: ++uid, def: LOCO(loco), level: 0 }], 'Review', uid);
  t.wagons = wagons.map((wid) => ({ uid: ++uid, def: WAGON(wid), level: 0, cargo: null, amount: 0 }));
  const tile = T(Math.round(s.l0 + head), s.w0 + ww),
    entry = AXIS === 'x' ? (dir > 0 ? 3 : 1) : dir > 0 ? 0 : 2;
  if (!t.spawnAt(game.track, tile.x, tile.y, entry)) return false;
  const pts = [],
    out = (entry + 2) % 4;
  for (let d = t.length + 2; d >= -1e-9; d -= 0.125) {
    const l = s.l0 + head - d * dir,
      at = T(l, s.w0 + ww),
      on = T(Math.round(l), s.w0 + ww);
    pts.push([at.x, at.y, on.x, on.y, entry, out]);
  }
  t.restoreTrail(pts, false);
  game.fleet.trains = [...game.fleet.trains, t];
  return true;
}
let now = 0;
/** A driving train: head on along index `from` of the site line, sent to along index `to`. */
function runTrain(id, ww, from, to, loco = 'rocket', wagons = ['wooden_coach']) {
  const s = SITES.find((s) => s.id === id),
    head = T(s.l0 + from, s.w0 + ww),
    target = T(s.l0 + to, s.w0 + ww),
    entry = AXIS === 'x' ? (to > from ? 3 : 1) : to > from ? 0 : 2;
  const t = new Train([{ uid: ++uid, def: LOCO(loco), level: 0 }], 'Runner', uid);
  for (const l of t.locos) l.inCab = true;
  t.wagons = wagons.map((wid) => ({ uid: ++uid, def: WAGON(wid), level: 0, cargo: null, amount: 0 }));
  if (!t.spawnAt(game.track, head.x, head.y, entry)) return 'spawn failed';
  const path = findPath(game.track, { x: head.x, y: head.y, in: entry }, (x, y) => x === target.x && y === target.y, 1e6, undefined, t.canUse);
  if (!path) return 'no path';
  game.track.resolveRoutes(path);
  t.coal = t.coalCap;
  t.water = t.waterCap;
  t.oil = t.oilCap;
  t.battery = t.batteryCap;
  t.fuelProblem = () => null;
  t.wireCeiling = () => null;
  t.refreshModes = () => {
    for (const l of t.locos) l.engaged = true;
  };
  t.setPath(path, game.map, game.track);
  t.trackVersion = game.track.version;
  t.nextFuelCheck = Infinity;
  t.setState('moving');
  game.fleet.trains = [...game.fleet.trains, t];
  return t.id;
}
function advance(ticks = 1) {
  for (let i = 0; i < ticks; i++) game.fleet.tick(1 / 60, (now += 1 / 60));
  game.render(1, ticks / 60);
}
function clearTrains() {
  game.fleet.trains = [];
  game.trainRenderer.update(game.fleet.trains, 1, 0);
}
/** Extra straight track before and after a site's line, as the scene lays it. */
function extend(id, ww, from, to) {
  const s = SITES.find((s) => s.id === id),
    out = [];
  for (let i = from; i <= to; i++) {
    const t = T(s.l0 + i, s.w0 + ww);
    out.push(game.track.has(t.x, t.y) ? true : straight(t.x, t.y));
  }
  return out;
}
await settle();
window.qa = {
  g: game,
  axis: AXIS,
  proc: PROC,
  origin: game.world.atlas.groupOrigin.get('bridges'),
  sites: SITES,
  problems,
  step: STEP,
  view,
  settle,
  facts,
  grid,
  click,
  setDecks,
  trainAt,
  runTrain,
  advance,
  clearTrains,
  extend,
  T,
};
