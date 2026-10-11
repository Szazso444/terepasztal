// Scratch: every bridge case on one empty map, for the bridge audit.
//   ?axis=x|y   spans run along tile x (screen lower right) or along tile y (screen lower left);
//               the y scene is the exact transpose of the x scene
//   ?proc=1     the `bridges` atlas group is made unavailable (its json answers 404), so the game
//               falls back to the procedural spans of src/art/bridges.ts
//   ?rev=1     platforms and parallel lines are built front to back (the reverse click order)
//   qa.sites    every site with its centre tile; qa.view(cx, cy, zoom) frames a tile
//   qa.grid(on) overlays the ideal tile diamond of every bridge tile at its deck height
const params = new URLSearchParams(location.search);
const AXIS = params.get('axis') === 'y' ? 'y' : 'x';
const PROC = params.get('proc') === '1';
const REV = params.get('rev') === '1';
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
const { Graphics } = await import('pixi.js');

const label = document.getElementById('qa-label');
const W = 120,
  H = 120;
const map = emptyMap(7412, W, H);
/** (along, across) -> tile. */
const T = (l, w) => (AXIS === 'x' ? { x: l, y: w } : { x: w, y: l });
const CODE = { g: 0, f: 1, h: 2, w: 3 };
const SITES = [];
const rowW = (row) => 12 + row * 9;

/**
 * A site: `pattern` gives the terrain along the line (g grass, h hill, w water), stamped over the
 * across band; `bridge` lists the along indices that get a platform; `lines` are the parallel
 * tracks (across offset and material).
 */
function site(id, row, l0, pattern, bridge, lines, band = [-2, 2]) {
  const w0 = rowW(row);
  for (let i = 0; i < pattern.length; i++)
    for (let w = band[0]; w <= band[1]; w++) {
      const t = T(l0 + i, w0 + w);
      map.terrain[t.y * W + t.x] = CODE[pattern[i]];
    }
  SITES.push({ id, row, l0, w0, pattern, bridge, lines, band, kind: 'line' });
  return l0 + pattern.length + 3;
}
const water = (n) => 'ggg' + 'w'.repeat(n) + 'ggg';
const run = (a, n) => Array.from({ length: n }, (_, i) => a + i);

for (const [m, material] of [
  [0, 'stone'],
  [1, 'wood'],
]) {
  // Over water, banks level: 1, 2, 3 and 6 tiles.
  let l = 10;
  for (const n of [1, 2, 3, 6]) l = site(`W${n}-${material}`, m, l, water(n), run(3, n), [{ w: 0, material }]);
  // Over a land dip. L1, L2: only the level-0 floor is bridged (deck 1). L3, L6: the level-1
  // shoulders too (deck 2).
  l = 10;
  l = site(`L1-${material}`, 2 + m, l, 'gghhhhghhhhgg', [6], [{ w: 0, material }]);
  l = site(`L2-${material}`, 2 + m, l, 'gghhhhgghhhhgg', [6, 7], [{ w: 0, material }]);
  l = site(`L3-${material}`, 2 + m, l, 'gghhhhghhhhgg', [5, 6, 7], [{ w: 0, material }]);
  l = site(`L6-${material}`, 2 + m, l, 'gghhhhgggghhhhgg', run(5, 6), [{ w: 0, material }]);
  // Banks at different levels.
  l = 10;
  // 2 on the left, 1 on the right, over land
  l = site(`DL21-${material}`, 4 + m, l, 'gghhhhghhgg', [5, 6], [{ w: 0, material }]);
  // 2 on the left, 0 on the right, over land
  l = site(`DL20-${material}`, 4 + m, l, 'gghhhhggggg', [5, 6, 7], [{ w: 0, material }]);
  // water, bank 1 on the left, 0 on the right
  l = site(`DW10-${material}`, 4 + m, l, 'gghhhhwwwggg', [6, 7, 8], [{ w: 0, material }]);
  // water, bank 1 on both sides
  l = site(`DW11-${material}`, 4 + m, l, 'gghhhhwwwhhhhgg', [6, 7, 8], [{ w: 0, material }]);
}
// Side by side: three parallel lines over water, two pairs over a land dip.
{
  let l = 10;
  l = site('SW', 6, l, water(3), run(3, 3), [
    { w: -1, material: 'stone' },
    { w: 0, material: 'wood' },
    { w: 1, material: 'stone' },
  ], [-3, 3]);
  l = site('SL-stone', 6, l, 'gghhhhgghhhhgg', run(5, 4), [
    { w: 0, material: 'stone' },
    { w: 1, material: 'stone' },
  ], [-2, 3]);
  l = site('SL-wood', 6, l, 'gghhhhgghhhhgg', run(5, 4), [
    { w: 0, material: 'wood' },
    { w: 1, material: 'wood' },
  ], [-2, 3]);
  l = site('SL-mixed', 6, l, 'gghhhhgghhhhgg', run(5, 4), [
    { w: 0, material: 'wood' },
    { w: 1, material: 'stone' },
  ], [-2, 3]);
}
// Curves and switches on platforms: a pond (water) and a pit in a hill (land).
const PADS = [];
function pad(id, row, l0, kind, terrain, material) {
  const w0 = rowW(row) + 1;
  // 10 x 10 block: hill or grass, with the hollow (water or grass) in the middle
  for (let i = 0; i < 12; i++)
    for (let w = -5; w <= 6; w++) {
      const t = T(l0 + i, w0 + w),
        inner = i >= 4 && i <= 7 && w >= -1 && w <= 2;
      map.terrain[t.y * W + t.x] =
        terrain === 'water' ? (inner ? 3 : 0) : inner && i >= 5 && i <= 6 && w >= 0 && w <= 1 ? 0 : 2;
    }
  PADS.push({ id, row, l0, w0, kind, terrain, material });
  return l0 + 15;
}
{
  let l = 10;
  l = pad('CW-stone', 8, l, 'curve', 'water', 'stone');
  l = pad('CW-wood', 8, l, 'curve', 'water', 'wood');
  l = pad('SWI-stone', 8, l, 'switch', 'water', 'stone');
  l = pad('CL-stone', 8, l, 'curve', 'land', 'stone');
  l = pad('CL-wood', 8, l, 'curve', 'land', 'wood');
}

const level = levelFromMap(map, 'Bridges');
const g = new Game({ kind: 'level', seed: 7412, level });
window.game = g;
await g.init();
g.loop.stop();
g.app.ticker.stop();
g.closeMenus();
g.settings.autosave = false;
g.settings.weather = false;
g.settings.dayNight = false;
g.settings.smoke = false;
g.clock.setSpeed(0);
g.builder.free = true;
for (let i = 0; i < g.regions.unlocked.length; i++) g.regions.own(i);
g.world.rebuildFog();
const m = g.map;
for (const k of [...m.props.keys()]) {
  m.props.delete(k);
  g.world.removeProps(k % m.w, Math.floor(k / m.w));
}

const problems = [];
/** A straight along the scene axis (or across it). */
function straight(x, y, along = true) {
  const want = (AXIS === 'x') === along ? [1, 3] : [0, 2];
  for (const r of [0, 1]) {
    const c = g.builder.checkTrack(x, y, { kind: 'straight', cls: 'regular', cls2: 'regular' }, r);
    if (!c.ok) {
      var reason = c.reason;
      continue;
    }
    if (!g.builder.placeTrackKind(x, y, 'straight', r)) continue;
    const link = g.track.get(x, y).links[0];
    if (want.every((d) => link.includes(d))) return true;
    g.builder.removeTrack(x, y);
  }
  return reason ?? 'no rotation fits';
}
for (const s of SITES) {
  s.tiles = [];
  s.levels = Array.from(s.pattern, (_, i) => {
    const t = T(s.l0 + i, s.w0);
    return levelAt(m, t.x, t.y);
  });
  for (const line of REV ? [...s.lines].reverse() : s.lines) {
    for (const i of REV ? [...s.bridge].reverse() : s.bridge) {
      const t = T(s.l0 + i, s.w0 + line.w);
      if (!g.builder.placeBuilding(t.x, t.y, 'bridge_' + line.material)) {
        const c = g.builder.checkBuilding(t.x, t.y, 'bridge_' + line.material);
        problems.push({ site: s.id, what: 'platform', i, reason: c.reason });
      } else s.tiles.push({ ...t, material: line.material });
    }
    for (let i = 0; i < s.pattern.length; i++) {
      const t = T(s.l0 + i, s.w0 + line.w),
        r = straight(t.x, t.y);
      if (r !== true) problems.push({ site: s.id, what: 'track', i, reason: r });
    }
  }
  const mid = T(s.l0 + (s.bridge[0] + s.bridge[s.bridge.length - 1]) / 2, s.w0);
  s.cx = mid.x;
  s.cy = mid.y;
}
// Curves / switches on platforms.
for (const p of PADS) {
  const a = T(p.l0 + 5, p.w0);
  const item = { kind: p.kind, cls: 'regular', cls2: 'regular' };
  p.tiles = [];
  p.tries = [];
  let done = false;
  for (const rot of [0, 1, 2, 3]) {
    if (done) break;
    const fp = footprintOf(a.x, a.y, p.kind, rot, 'regular');
    const probe = new TrackGraph(m.w, m.h);
    probe.place(a.x, a.y, p.kind, rot, 'regular', 'regular');
    const inside = new Set(fp.map((t) => t.y * m.w + t.x));
    // exits: links that leave the footprint
    const exits = [];
    for (const t of fp)
      for (const link of probe.get(t.x, t.y)?.links ?? [])
        for (const d of link) {
          const nx = t.x + [0, 1, 0, -1][d],
            ny = t.y + [-1, 0, 1, 0][d];
          if (!inside.has(ny * m.w + nx)) exits.push({ x: nx, y: ny, d });
        }
    const placed = [];
    for (const t of fp)
      if (!g.builder.buildingAt(t.x, t.y) && g.builder.placeBuilding(t.x, t.y, 'bridge_' + p.material)) placed.push(t);
    // approach straights: platforms where the ground is water or below the surrounding hill
    const approach = [];
    for (const e of exits)
      for (let k = 0; k < 5; k++) {
        const x = e.x + [0, 1, 0, -1][e.d] * k,
          y = e.y + [-1, 0, 1, 0][e.d] * k;
        approach.push({ x, y, d: e.d });
        if (m.terrain[y * m.w + x] === 3 && !g.builder.buildingAt(x, y) && g.builder.placeBuilding(x, y, 'bridge_' + p.material))
          placed.push({ x, y });
      }
    // approaches first (the curve's deck is the level of the rails it meets), then the piece
    const laid = [];
    for (const t of approach) {
      const alongX = t.d === 1 || t.d === 3;
      const r = straight(t.x, t.y, (AXIS === 'x') === alongX);
      if (r === true) laid.push(t);
    }
    const c = g.builder.checkTrack(a.x, a.y, item, rot);
    p.tries.push({ rot, ok: c.ok, reason: c.reason });
    if (c.ok && g.builder.placeTrack(a.x, a.y, item, rot)) {
      done = true;
      p.rot = rot;
      p.tiles = placed.map((t) => ({ ...t, material: p.material }));
      p.footprint = fp;
    } else {
      for (const t of laid) g.builder.removeTrack(t.x, t.y);
      for (const t of placed) g.builder.removeBuilding(t.x, t.y);
    }
  }
  p.placed = done;
  const c = T(p.l0 + 5.5, p.w0 + 0.5);
  p.cx = c.x;
  p.cy = c.y;
  p.kindOf = 'pad';
}
// Trees beside the land spans, for sorting: one in front of and one behind each dip.
for (const s of SITES)
  if (/^L[36]/.test(s.id))
    for (const i of s.bridge.slice(1, -1))
      for (const w of [-1, 1]) {
        const t = T(s.l0 + i, s.w0 + w);
        m.props.set(t.y * m.w + t.x, [{ kind: 'tree', variant: (i + w + 3) % 3, ox: 0, oy: 0 }]);
        g.world.rebuildProps(t.x, t.y);
      }

async function settle() {
  g.render(1, 0);
  let n = 0;
  while (!g.world.landscape.ready && n++ < 400) {
    await new Promise((r) => setTimeout(r, 50));
    g.render(1, 0);
  }
  g.render(1, 0);
  return g.world.landscape.ready;
}
function view(cx, cy, zoom, text = '') {
  const at = tileToWorld(cx, cy);
  g.camera.centerOn(at.x, at.y + g.world.elevationOf(Math.round(cx), Math.round(cy)) / 2);
  g.camera.zoom = zoom;
  g.render(1, 0);
  g.app.renderer.render(g.app.stage);
  label.textContent = text;
}
/** What the game knows about every bridge tile of a site: ground, rail and deck heights. */
function facts(s) {
  return s.tiles.map((t) => {
    const k = t.y * m.w + t.x,
      bed = g.fleet.railBeds?.get(k);
    return {
      x: t.x,
      y: t.y,
      level: levelAt(m, t.x, t.y),
      water: m.terrain[k] === 3,
      railLevel: bed ? railLevel(bed, bed.axis === 'x' ? t.x : t.y) : null,
      railDz: +g.world.railAt(t.x, t.y).dz.toFixed(2),
      groundDz: +g.world.elevationOf(t.x, t.y).toFixed(2),
      deckLift: +(g.world.deckLift?.(t.x, t.y) ?? 0).toFixed(2),
    };
  });
}
let gridG = null;
/** The ideal diamond of every bridge tile at the rail height, and at the water/ground plane. */
function grid(on) {
  gridG?.destroy();
  gridG = null;
  if (!on) return;
  gridG = new Graphics();
  g.world.overlay.addChild(gridG);
  for (const s of [...SITES, ...PADS])
    for (const t of s.tiles ?? []) {
      const p = tileToWorld(t.x, t.y),
        dz = g.world.railAt(t.x, t.y).dz;
      gridG
        .poly([p.x, p.y - 16 + dz, p.x + 32, p.y + dz, p.x, p.y + 16 + dz, p.x - 32, p.y + dz])
        .stroke({ width: 0.5, color: 0xff00ff, alpha: 0.9 });
    }
}
let uid = 99000;
/** A short train standing on tile (x, y), entering from direction `entry`. */
function train(x, y, entry, loco = 'rocket', wagons = ['wooden_coach', 'wooden_coach']) {
  const t = new Train([{ uid: ++uid, def: content.locomotives.find((d) => d.id === loco), level: 0 }], 'Audit', uid);
  t.wagons = wagons.map((id) => ({ uid: ++uid, def: content.wagons.find((d) => d.id === id), level: 0, cargo: null, amount: 0 }));
  if (!t.spawnAt(g.track, x, y, entry)) return false;
  g.fleet.trains = [...g.fleet.trains, t];
  return true;
}
await settle();
window.qa = {
  g,
  axis: AXIS,
  proc: PROC,
  kit: g.world.atlas.groupOrigin.get('bridges') !== 'procedural',
  origin: g.world.atlas.groupOrigin.get('bridges'),
  sites: SITES,
  pads: PADS,
  problems,
  view,
  settle,
  facts,
  grid,
  train,
  T,
  step: g.world.landscape.step,
};
