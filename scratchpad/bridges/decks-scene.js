// Scratch: bridge decks set by hand (click raises, right-click lowers), every case on one empty
// map, built through the game's own rules (builder.placeBuilding / changeDeck / placeTrack).
//   ?axis=x|y   spans run along tile x (screen lower right) or along tile y (screen lower left)
//   ?proc=1     the `bridges` atlas group is made unavailable: the plain procedural swatches
//   qa.sites    every site with its tiles; qa.view(cx, cy, zoom) frames a tile
//   qa.trainAt  a train with its head at a fractional position on a site's line
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
const { TrackGraph, footprintOf } = await import('/src/world/track.ts');
const { railLevel } = await import('/src/world/railProfile.ts');
const { Train } = await import('/src/sim/trains.ts');
const { content } = await import('/src/data/content.ts');
const { daySeconds } = await import('/src/sim/rules.ts');
const { findPath } = await import('/src/world/pathfinding.ts');
const { Graphics } = await import('pixi.js');

const label = document.getElementById('qa-label');
const W = 150,
  H = 150;
const map = emptyMap(7412, W, H);
/** (along, across) -> tile. */
const T = (l, w) => (AXIS === 'x' ? { x: l, y: w } : { x: w, y: l });
const CODE = { g: 0, f: 1, h: 2, w: 3 };
const SITES = [];
const rowW = (row) => 12 + row * 9;
const run = (a, n) => Array.from({ length: n }, (_, i) => a + i);

/**
 * A site: `pattern` is the terrain along the line (g grass, h hill, w water), stamped over the
 * across band. Each line is one row of platforms at across offset `w`: `decks` maps an along
 * index to a deck height ('a' = an automatic platform), `track` says whether straight track runs
 * the whole pattern, `after` builds as a player would click on a finished bridge (platforms, rail,
 * then raise tile by tile) instead of setting the bare platforms first.
 */
function site(id, row, l0, pattern, lines, opts = {}) {
  const w0 = rowW(row),
    band = opts.band ?? [-2, 2];
  for (let i = 0; i < pattern.length; i++)
    for (let w = band[0]; w <= band[1]; w++) {
      const t = T(l0 + i, w0 + w);
      map.terrain[t.y * W + t.x] = CODE[pattern[i]];
    }
  SITES.push({ id, row, l0, w0, pattern, lines, ...opts });
  return l0 + pattern.length + (opts.gap ?? 4);
}
const decks = (from, levels) => Object.fromEntries(levels.map((d, i) => [from + i, d]));
const g = (n) => 'g'.repeat(n);

for (const [m, material] of [
  [0, 'stone'],
  [1, 'wood'],
]) {
  let l = 10;
  // A ramp to the top and down again on flat land, raised by clicks on the finished bridge.
  l = site(`RAMP-${material}`, m, l, g(15), [
    { w: 0, material, decks: decks(3, [1, 2, 3, 4, 4, 4, 3, 2, 1]), track: true, after: true },
  ]);
  // The same ramp set on bare platforms, track laid over it afterwards.
  l = site(`RAMPB-${material}`, m, l, g(15), [
    { w: 0, material, decks: decks(3, [1, 2, 3, 4, 4, 4, 3, 2, 1]), track: true },
  ]);
  // Raised one, two and three levels on flat land, track climbing onto it; a one-tile hump.
  l = 10;
  l = site(`R1-${material}`, 2 + m, l, g(9), [{ w: 0, material, decks: decks(3, [1, 1, 1]), track: true, after: true }]);
  l = site(`R2-${material}`, 2 + m, l, g(11), [{ w: 0, material, decks: decks(3, [1, 2, 2, 2, 1]), track: true, after: true }]);
  l = site(`R3-${material}`, 2 + m, l, g(13), [
    { w: 0, material, decks: decks(3, [1, 2, 3, 3, 3, 2, 1]), track: true, after: true },
  ]);
  l = site(`HUMP-${material}`, 2 + m, l, g(7), [{ w: 0, material, decks: decks(3, [1]), track: true, after: true }]);
  // A lake crossed at height 2, ramps on the banks.
  l = 10;
  l = site(`LAKE2-${material}`, 4 + m, l, g(4) + 'wwww' + g(4), [
    { w: 0, material, decks: decks(3, [1, 2, 2, 2, 2, 1]), track: true, after: true },
  ]);
  // Over water, automatic: the capture raises and lowers it (qa.click).
  l = site(`WUP-${material}`, 4 + m, l, g(3) + 'www' + g(3), [{ w: 0, material, decks: decks(3, ['a', 'a', 'a']), track: true }]);
  // A one-tile creek: automatic, and one level up.
  l = site(`CREEK-${material}`, 4 + m, l, g(3) + 'w' + g(3), [{ w: 0, material, decks: decks(3, ['a']), track: true }]);
  l = site(`CREEK1-${material}`, 4 + m, l, g(3) + 'w' + g(3), [{ w: 0, material, decks: decks(3, [1]), track: true, after: true }]);
  // A river between level-1 banks: automatic (the deck takes level 1), and one level higher.
  l = site(`RIVER-${material}`, 4 + m, l, 'gghhhhwwwhhhhgg', [{ w: 0, material, decks: decks(6, ['a', 'a', 'a']), track: true }]);
  l = site(`RIVER2-${material}`, 4 + m, l, 'gghhhhwwwhhhhgg', [
    { w: 0, material, decks: decks(6, [2, 2, 2]), track: true },
  ]);
}
// Parallel bridges: equal heights make one double deck; different heights keep their own.
{
  let l = 10;
  const up = decks(3, [1, 2, 2, 2, 1]),
    low = decks(3, [1, 1, 1, 1, 1]);
  l = site('PAR-EQ', 6, l, g(11), [
    { w: 0, material: 'stone', decks: up, track: true },
    { w: 1, material: 'stone', decks: up, track: true },
  ], { band: [-2, 3] });
  l = site('PAR-HIGH-BEHIND', 6, l, g(11), [
    { w: 0, material: 'stone', decks: up, track: true },
    { w: 1, material: 'wood', decks: low, track: true },
  ], { band: [-2, 3] });
  l = site('PAR-HIGH-FRONT', 6, l, g(11), [
    { w: 0, material: 'wood', decks: low, track: true },
    { w: 1, material: 'stone', decks: up, track: true },
  ], { band: [-2, 3] });
  l = site('PAR-EQ-wood', 6, l, g(11), [
    { w: 0, material: 'wood', decks: up, track: true },
    { w: 1, material: 'wood', decks: up, track: true },
  ], { band: [-2, 3] });
}
// Stepped platforms without rail, and a small terrace of them.
{
  let l = 10;
  for (const material of ['stone', 'wood']) {
    l = site(`STEPS-${material}`, 7, l, g(9), [
      { w: 0, material, decks: decks(2, [0, 1, 2, 3, 4]) },
      { w: 1, material, decks: decks(2, [1, 1, 2, 2, 3]) },
    ], { band: [-2, 3] });
    l = site(`BLOCK-${material}`, 7, l, g(7), [
      { w: -1, material, decks: decks(2, [1, 1, 1]) },
      { w: 0, material, decks: decks(2, [1, 2, 1]) },
      { w: 1, material, decks: decks(2, [1, 1, 1]) },
    ]);
  }
  // Over water without rail: at the waterline and raised.
  l = site('WBARE', 7, l, g(2) + 'wwww' + g(2), [
    { w: 0, material: 'stone', decks: decks(2, ['a', 1, 2, 3]) },
    { w: 1, material: 'wood', decks: decks(2, ['a', 1, 2, 3]) },
  ], { band: [-2, 3] });
}
// A height-3 viaduct with scenery and ground tracks behind and in front of it.
for (const [m, material] of [
  [0, 'stone'],
  [1, 'wood'],
]) {
  site(`VIA3-${material}`, 8, 10 + m * 22, g(15), [
    { w: -2, track: true },
    { w: 0, material, decks: decks(3, [1, 2, 3, 3, 3, 3, 3, 2, 1]), track: true },
    { w: 2, track: true },
  ], { band: [-3, 3], scenery: true });
  // Ground-level and level-1 bridges on flat land with ground tracks directly behind and in front.
  site(`G0-${material}`, 9, 10 + m * 40, g(9), [
    { w: -1, track: true },
    { w: 0, material, decks: decks(3, ['a', 'a', 'a']), track: true },
    { w: 1, track: true },
  ]);
  site(`G1-${material}`, 9, 23 + m * 40, g(9), [
    { w: -1, track: true },
    { w: 0, material, decks: decks(3, [1, 1, 1]), track: true },
    { w: 1, track: true },
  ]);
  // A signal and wires on a raised span.
  site(`SIG-${material}`, 10, 10 + m * 16, g(11), [
    { w: 0, material, decks: decks(3, [1, 2, 2, 2, 1]), track: true, wires: true, signal: 5 },
  ]);
}
// Curves and a switch on pads at height 2 on flat land.
const PADS = [];
function pad(id, row, l0, kind, material) {
  PADS.push({ id, row, l0, w0: rowW(row) + 1, kind, material });
  return l0 + 16;
}
{
  let l = 12;
  l = pad('CURVE2-stone', 11, l, 'curve', 'stone');
  l = pad('CURVE2-wood', 11, l, 'curve', 'wood');
  l = pad('SWITCH2-stone', 11, l, 'switch', 'stone');
}

const level = levelFromMap(map, 'Bridge decks');
const game = new Game({ kind: 'level', seed: 7412, level });
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

const problems = [];
/** A straight along the scene axis (or across it). */
function straight(x, y, along = true) {
  const want = (AXIS === 'x') === along ? [1, 3] : [0, 2];
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
/** Click platforms up or down until each stands at its target; what no click can reach is a problem. */
function raise(id, targets) {
  for (let pass = 0; pass < 12; pass++) {
    let moved = false;
    for (const { x, y, deck } of targets) {
      const p = b.bridgeAt(x, y),
        now = b.deckLevel(p);
      if (now === deck) continue;
      if (b.changeDeck(p, Math.sign(deck - now))) moved = true;
    }
    if (!moved) break;
  }
  for (const { x, y, deck, i } of targets) {
    const p = b.bridgeAt(x, y);
    if (b.deckLevel(p) !== deck)
      problems.push({
        site: id,
        what: 'deck',
        i,
        want: deck,
        got: b.deckLevel(p),
        reason: b.checkDeck(p, Math.sign(deck - b.deckLevel(p))).reason,
      });
  }
}
for (const s of SITES) {
  s.tiles = [];
  for (const line of s.lines) {
    const targets = [];
    for (const [key, deck] of Object.entries(line.decks ?? {})) {
      const i = +key,
        t = T(s.l0 + i, s.w0 + line.w);
      if (!b.placeBuilding(t.x, t.y, 'bridge_' + line.material)) {
        problems.push({ site: s.id, what: 'platform', i, reason: b.checkBuilding(t.x, t.y, 'bridge_' + line.material).reason });
        continue;
      }
      s.tiles.push({ ...t, i, w: line.w, material: line.material, want: deck });
      if (deck !== 'a') targets.push({ ...t, i, deck });
    }
    if (!line.after) raise(s.id, targets);
    if (line.track)
      for (let i = 0; i < s.pattern.length; i++) {
        const t = T(s.l0 + i, s.w0 + line.w),
          r = straight(t.x, t.y);
        if (r !== true) problems.push({ site: s.id, what: 'track', i, w: line.w, reason: r });
      }
    if (line.after) raise(s.id, targets);
    if (line.wires)
      for (let i = 0; i < s.pattern.length; i++) {
        const t = T(s.l0 + i, s.w0 + line.w);
        if (!b.placeSupply(t.x, t.y, 'catenary')) problems.push({ site: s.id, what: 'wire', i });
      }
    if (line.signal !== undefined) {
      const t = T(s.l0 + line.signal, s.w0 + line.w);
      // The rules refuse decor on a platform tile; older saves can hold a signal there, so the
      // scene sets one as loading does: the renderer has to stand it on the deck.
      const d = { id: 'signal', x: t.x, y: t.y, rot: AXIS === 'x' ? 1 : 2 };
      s.signalRule = b.checkDecor(t.x, t.y, 'signal').reason ?? 'allowed';
      b.decor.set(t.y * m.w + t.x, d);
      b.onDecorChanged(d, false);
    }
  }
  const on = s.tiles.map((t) => t.i),
    mid = T(s.l0 + (Math.min(...on) + Math.max(...on)) / 2, s.w0);
  s.cx = mid.x;
  s.cy = mid.y;
  if (s.scenery) {
    // Trees and rocks on the tiles behind and in front of the viaduct, one tree pushed to the
    // near corner of the tile behind (the largest offset a prop takes).
    for (const i of on.slice(2, -2))
      for (const w of [-1, 1]) {
        const t = T(s.l0 + i, s.w0 + w),
          o = T(0.42, 0.42);
        m.props.set(t.y * m.w + t.x, [
          i % 2
            ? { kind: 'tree', variant: (i + w + 3) % 3, ox: w < 0 && i === on[3] ? o.x : 0, oy: w < 0 && i === on[3] ? o.y : 0 }
            : { kind: 'rock', variant: i % 2, ox: 0, oy: 0 },
        ]);
        game.world.rebuildProps(t.x, t.y);
      }
  }
}
// Curves / switches on pads: every platform set to height 2 first, the approaches step down.
for (const p of PADS) {
  const a = T(p.l0 + 5, p.w0),
    item = { kind: p.kind, cls: 'regular', cls2: 'regular' };
  p.tiles = [];
  p.tries = [];
  let done = false;
  for (const rot of [0, 1, 2, 3]) {
    if (done) break;
    const fp = footprintOf(a.x, a.y, p.kind, rot, 'regular'),
      probe = new TrackGraph(m.w, m.h);
    probe.place(a.x, a.y, p.kind, rot, 'regular', 'regular');
    const inside = new Set(fp.map((t) => t.y * m.w + t.x)),
      exits = [];
    for (const t of fp)
      for (const link of probe.get(t.x, t.y)?.links ?? [])
        for (const d of link) {
          const nx = t.x + [0, 1, 0, -1][d],
            ny = t.y + [-1, 0, 1, 0][d];
          if (!inside.has(ny * m.w + nx)) exits.push({ x: nx, y: ny, d });
        }
    const placed = [],
      targets = [];
    const platform = (x, y, deck) => {
      if (!b.bridgeAt(x, y) && b.placeBuilding(x, y, 'bridge_' + p.material)) {
        placed.push({ x, y });
        targets.push({ x, y, deck, i: 0 });
      }
    };
    for (const t of fp) platform(t.x, t.y, 2);
    // Approaches: one span level with the pad, one a level lower, then the ground.
    const approach = [];
    for (const e of exits)
      for (let k = 0; k < 5; k++) {
        const x = e.x + [0, 1, 0, -1][e.d] * k,
          y = e.y + [-1, 0, 1, 0][e.d] * k;
        approach.push({ x, y, d: e.d });
        if (k < 2) platform(x, y, 2 - k);
      }
    raise(p.id + ':' + rot, targets);
    const laid = [];
    for (const t of approach) {
      const alongX = t.d === 1 || t.d === 3,
        r = straight(t.x, t.y, (AXIS === 'x') === alongX);
      if (r === true) laid.push(t);
      else p.tries.push({ rot, approach: [t.x, t.y], reason: r });
    }
    const c = b.checkTrack(a.x, a.y, item, rot);
    p.tries.push({ rot, ok: c.ok, reason: c.reason });
    if (c.ok && b.placeTrack(a.x, a.y, item, rot)) {
      done = true;
      p.rot = rot;
      p.tiles = placed.map((t) => ({ ...t, material: p.material }));
      p.footprint = fp;
    } else {
      for (const t of laid) b.removeTrack(t.x, t.y);
      for (const t of placed) b.removeBuilding(t.x, t.y);
    }
  }
  p.placed = done;
  const c = T(p.l0 + 5.5, p.w0 + 0.5);
  p.cx = c.x;
  p.cy = c.y;
}

async function settle() {
  game.render(1, 0);
  let n = 0;
  while (!game.world.landscape.ready && n++ < 400) {
    await new Promise((r) => setTimeout(r, 50));
    game.render(1, 0);
  }
  game.render(1, 0);
  return game.world.landscape.ready;
}
function view(cx, cy, zoom, text = '') {
  const at = tileToWorld(cx, cy);
  game.camera.centerOn(at.x, at.y + game.world.elevationOf(Math.round(cx), Math.round(cy)) / 2);
  game.camera.zoom = zoom;
  game.render(1, 0);
  game.app.renderer.render(game.app.stage);
  label.textContent = text;
}
/** What the game knows about every bridge tile of a site. */
function facts(s) {
  return s.tiles.map((t) => {
    const k = t.y * m.w + t.x,
      bed = game.fleet.railBeds?.get(k),
      p = b.bridgeAt(t.x, t.y);
    return {
      x: t.x,
      y: t.y,
      ground: levelAt(m, t.x, t.y),
      water: m.terrain[k] === 3,
      set: p?.deck ?? null,
      deck: p ? b.deckLevel(p) : null,
      rail: bed ? +railLevel(bed, bed.axis === 'x' ? t.x : t.y).toFixed(3) : null,
      lift: +(game.world.deckLift?.(t.x, t.y) ?? 0).toFixed(2),
    };
  });
}
let gridG = null;
/** The ideal diamond of every bridge tile at its deck centre height. */
function grid(on) {
  gridG?.destroy();
  gridG = null;
  if (!on) return;
  gridG = new Graphics();
  game.world.overlay.addChild(gridG);
  for (const s of [...SITES, ...PADS])
    for (const t of s.tiles ?? []) {
      const p = game.world.surfacePoint(t.x, t.y);
      gridG.poly([p.x, p.y - 16, p.x + 32, p.y, p.x, p.y + 16, p.x - 32, p.y]).stroke({ width: 0.5, color: 0xff00ff, alpha: 0.9 });
    }
}
let uid = 99000;
const LOCO = (id) => content.locomotives.find((d) => d.id === id),
  WAGON = (id) => content.wagons.find((d) => d.id === id);
/**
 * A train standing on the line of site `id` at across offset `w`, its head at along index `head`
 * (fractional) and pointing toward +along (dir 1) or -along (dir -1).
 */
function trainAt(id, w, head, loco = 'adler', wagons = ['wooden_coach'], dir = 1) {
  const s = SITES.find((s) => s.id === id),
    t = new Train([{ uid: ++uid, def: LOCO(loco), level: 0 }], 'Deck', uid);
  t.wagons = wagons.map((wid) => ({ uid: ++uid, def: WAGON(wid), level: 0, cargo: null, amount: 0 }));
  const tile = T(Math.round(s.l0 + head), s.w0 + w),
    entry = AXIS === 'x' ? (dir > 0 ? 3 : 1) : dir > 0 ? 0 : 2;
  if (!t.spawnAt(game.track, tile.x, tile.y, entry)) return false;
  const pts = [],
    out = (entry + 2) % 4;
  for (let d = t.length + 2; d >= -1e-9; d -= 0.125) {
    const l = s.l0 + head - d * dir,
      at = T(l, s.w0 + w),
      on = T(Math.round(l), s.w0 + w);
    pts.push([at.x, at.y, on.x, on.y, entry, out]);
  }
  t.restoreTrail(pts, false);
  game.fleet.trains = [...game.fleet.trains, t];
  return true;
}
let now = 0;
/**
 * A train that drives: spawned with its head on tile `head` (entered through edge `entry`) and
 * sent along the track to tile `target`. qa.step() moves it.
 */
function runTrain(loco, wagons, head, entry, target) {
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
/** Advance the simulation by `ticks` sixtieths of a second and draw a frame. */
function step(ticks = 1) {
  for (let i = 0; i < ticks; i++) game.fleet.tick(1 / 60, (now += 1 / 60));
  game.render(1, ticks / 60);
}
function clearTrains() {
  game.fleet.trains = [];
  game.trainRenderer.update(game.fleet.trains, 1, 0);
}
/** Deep night (true) or noon (false) for the next frames. */
function night(on) {
  game.settings.dayNight = true;
  game.clock.time = (Math.floor(game.clock.days) + (on ? 0.04 : 0.5)) * daySeconds();
  return { fraction: game.clock.dayFraction };
}
/** One deck click on along index `i` of a site's line: +1 raises, -1 lowers. */
function click(id, i, delta, w = 0) {
  const s = SITES.find((s) => s.id === id),
    t = T(s.l0 + i, s.w0 + w),
    p = b.bridgeAt(t.x, t.y),
    c = b.checkDeck(p, delta);
  return { ok: b.changeDeck(p, delta), reason: c.reason, deck: b.deckLevel(p) };
}
await settle();
window.qa = {
  g: game,
  axis: AXIS,
  proc: PROC,
  kit: game.world.atlas.groupOrigin.get('bridges') !== 'procedural',
  origin: game.world.atlas.groupOrigin.get('bridges'),
  sites: SITES,
  pads: PADS,
  problems,
  view,
  settle,
  facts,
  grid,
  trainAt,
  runTrain,
  advance: step,
  clearTrains,
  night,
  click,
  T,
  step: game.world.landscape.step,
};
