import { Game } from '/src/game.ts';
import { generateMap } from '/src/world/mapgen.ts';
import { levelFromMap } from '/src/world/level.ts';
import { tileToWorld } from '/src/engine/iso.ts';
import { pieceLinks } from '/src/world/track.ts';
import { Train } from '/src/sim/trains.ts';
import { content } from '/src/data/content.ts';
import { visualScale } from '../art-world/lots.js';
import { createMaterials } from './materials.js';
import { installTerrainRails } from './rails.js';

const seed = 7412,
  map = generateMap(seed, { w: 128, h: 128 });
const hash = (a) => {
  let h = 2166136261;
  for (const v of a) {
    h ^= v;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};
const hashes = (m) => ({
  terrain: hash(m.terrain),
  biome: hash(m.biome),
  variant: hash(m.variant),
});
const before = hashes(map),
  naturalProps = new Map([...map.props].map(([k, v]) => [k, v.map((p) => ({ ...p }))]));
const g = new Game({ kind: 'level', seed, level: levelFromMap(map, 'Generated world 128 × 128') });
window.game = g;
await g.init();
g.loop.stop();
g.app.ticker.stop();
g.closeMenus();
Object.assign(g.settings, { autosave: false, weather: false, dayNight: false, smoke: false });
g.clock.setSpeed(0);
g.builder.free = true;
for (let i = 0; i < g.regions.unlocked.length; i++) g.regions.own(i);
g.world.rebuildFog();
const propKeys = new Set([...g.map.props.keys(), ...naturalProps.keys()]);
g.map.props = naturalProps;
for (const k of propKeys) g.world.rebuildProps(k % 128, Math.floor(k / 128));
for (const name of [
  '../../scratchpad/asset-qa/candidate/rolling',
  '../../scratchpad/full-style-stills/assets/people',
])
  await g.atlas.load([
    { name, generate: () => ({ image: document.createElement('canvas'), frames: {} }) },
  ]);

const dirs = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ],
  key = (x, y) => y * 128 + x;
const dry = (x, y) =>
  x > 3 && y > 3 && x < 124 && y < 124 && ![3, 4, 6].includes(g.map.terrain[key(x, y)]);
function component(start, minX, maxX) {
  const queue = [start],
    seen = new Set([key(...start)]);
  for (let i = 0; i < queue.length; i++)
    for (const [dx, dy] of dirs) {
      const x = queue[i][0] + dx,
        y = queue[i][1] + dy,
        k = key(x, y);
      if (x >= minX && x <= maxX && dry(x, y) && !seen.has(k)) {
        seen.add(k);
        queue.push([x, y]);
      }
    }
  return queue;
}
const nearest = (points, x, y) =>
  points.reduce((a, p) =>
    Math.hypot(p[0] - x, p[1] - y) < Math.hypot(a[0] - x, a[1] - y) ? p : a,
  );
const west = nearest(component([44, 48], 4, 44), 22, 30),
  east = nearest(component([52, 48], 52, 123), 92, 76);
function path(start, end, minX, maxX) {
  const open = [start],
    prev = new Map(),
    cost = new Map([[key(...start), 0]]),
    closed = new Set();
  while (open.length) {
    let best = 0;
    for (let i = 1; i < open.length; i++) {
      const score = (p) => cost.get(key(...p)) + Math.abs(p[0] - end[0]) + Math.abs(p[1] - end[1]);
      if (score(open[i]) < score(open[best])) best = i;
    }
    const p = open.splice(best, 1)[0],
      k = key(...p);
    if (closed.has(k)) continue;
    closed.add(k);
    if (p[0] === end[0] && p[1] === end[1]) {
      const out = [p];
      let at = k;
      while (prev.has(at)) {
        const q = prev.get(at);
        out.push(q);
        at = key(...q);
      }
      return out.reverse();
    }
    for (const [dx, dy] of dirs) {
      const q = [p[0] + dx, p[1] + dy],
        qk = key(...q);
      if (q[0] < minX || q[0] > maxX || !dry(...q) || closed.has(qk)) continue;
      const t = g.map.terrain[qk],
        prior = prev.get(k),
        turn = prior && (p[0] - prior[0] !== dx || p[1] - prior[1] !== dy) ? 0.28 : 0;
      const c = cost.get(k) + 1 + (t === 1 ? 0.12 : t === 2 ? 0.5 : 0) + turn;
      if (c < (cost.get(qk) ?? Infinity)) {
        cost.set(qk, c);
        prev.set(qk, p);
        open.push(q);
      }
    }
  }
  throw new Error('No dry rail route');
}
const route = [
  ...path(west, [44, 48], 4, 44),
  ...Array.from({ length: 8 }, (_, i) => [45 + i, 48]),
  ...path([52, 48], east, 52, 123).slice(1),
];
const direction = (a, b) => dirs.findIndex(([dx, dy]) => b[0] - a[0] === dx && b[1] - a[1] === dy);
const segments = [];
for (let i = 0; i < route.length; i++) {
  const p = route[i],
    inn = i ? direction(p, route[i - 1]) : (direction(p, route[i + 1]) + 2) % 4,
    out = i < route.length - 1 ? direction(p, route[i + 1]) : (inn + 2) % 4;
  const kind = (inn + 2) % 4 === out ? 'straight' : 'curve';
  let rot = -1;
  for (let r = 0; r < 4; r++)
    if (
      pieceLinks(kind, r).some(([a, b]) => (a === inn && b === out) || (a === out && b === inn))
    ) {
      rot = r;
      break;
    }
  if (rot < 0 || !g.builder.placeTrackKind(...p, kind, rot))
    throw new Error('Invalid track ' + p + ' ' + kind + ' ' + rot);
  segments.push({ x: p[0], y: p[1], in: inn, out });
}
g.track.resolveRoutes(segments);
const placed = [];
function put(type, id, x, y) {
  if (g.map.terrain[key(x, y)] === 2) return null; // leave real hills intact around districts
  const result =
    type === 'station'
      ? g.builder.placeStation(x, y, id, 0)
      : type === 'building'
        ? g.builder.placeBuilding(x, y, id)
        : g.builder.placeDecor(x, y, id, 0);
  if (!result) return null;
  placed.push({ type, id, x, y });
  g.map.props.delete(key(x, y));
  g.world.rebuildProps(x, y);
  return result;
}
function near(type, id, cx, cy, radius = 6) {
  for (let r = 0; r <= radius; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = cx + dx,
          y = cy + dy;
        if (
          !dry(x, y) ||
          placed.some((p) => Math.hypot(p.x - x, p.y - y) < 2.2) ||
          g.track.has(x, y)
        )
          continue;
        if (
          type === 'building' &&
          ['refinery', 'power_plant', 'grinder', 'substation', 'kiln'].includes(id) &&
          (g.map.terrain[key(x, y)] === 1 ||
            dirs.some(([dx, dy]) => g.map.terrain[key(x + dx, y + dy)] === 3))
        )
          continue;
        if (put(type, id, x, y)) return [x, y];
      }
  throw new Error('Could not place ' + id);
}
const hub = near('station', 'station', 48, 47);
near('station', 'town', 43, 47);
near('station', 'warehouse', 52, 49);
for (const p of [
  [46, 44],
  [49, 43],
  [52, 44],
  [44, 45],
])
  near('decor', 'townhouse', ...p);
near('decor', 'water_tower', 50, 50);
near('decor', 'fuel_stop', 54, 50);
const farm = near('station', 'farm', west[0] + 1, west[1] + 1, 8);
near('building', 'windmill', farm[0] - 2, farm[1] - 2);
near('decor', 'townhouse', farm[0] + 2, farm[1] - 3);
const industry = near('station', 'warehouse', east[0] - 1, east[1] - 1, 9);
near('station', 'lumber', industry[0] - 4, industry[1], 10);
for (const [id, dx, dy] of [
  ['kiln', -3, -3],
  ['grinder', 0, -4],
  ['refinery', 3, -3],
  ['power_plant', 4, 1],
  ['substation', 2, 3],
])
  near('building', id, industry[0] + dx, industry[1] + dy, 9);
near('decor', 'water_tower', industry[0] - 2, industry[1] + 3);

const t = new Train(
  [{ uid: 86001, def: content.locomotives.find((d) => d.id === 'rocket'), level: 0 }],
  'Rocket',
  86001,
);
if (!t.spawnAt(g.track, 48, 48, 3)) throw new Error('Rocket spawn failed');
t.coal = t.coalCap;
t.water = t.waterCap;
g.fleet.trains = [t];
g.people.persons = [
  {
    id: 99001,
    x: hub[0] + 0.65,
    y: hub[1] + 0.4,
    home: 'preview',
    outfit: 0,
    state: 'idle',
    timer: 99999,
    path: [],
    step: 0,
    transient: false,
    stationId: null,
  },
];
// Only trunks in occupied tiles are cleared; surrounding generated vegetation stays.
for (const k of g.track.pieces.keys()) {
  g.map.props.delete(k);
  g.world.rebuildProps(k % 128, Math.floor(k / 128));
}
for (const p of placed) {
  const position = tileToWorld(p.x, p.y),
    frame = 'structures/' + (p.type === 'station' ? p.id + '_1' : p.id);
  for (const s of g.world.objects.children)
    if (Math.abs(s.x - position.x) < 1 && Math.abs(s.y - position.y) < 1)
      s.scale.set(visualScale(frame));
}
const materials = await createMaterials(g, placed),
  rails = installTerrainRails(g, materials);
const views = [
  { id: '01-whole-map', title: 'Generated 128 × 128 map', x: 63.5, y: 63.5, zoom: 0.215 },
  {
    id: '02-railway-region',
    title: 'Railway through the generated landscape',
    x: 54,
    y: 48,
    zoom: 0.8,
  },
  { id: '03-town-station', title: 'Town station · small ground patches', x: 48, y: 47, zoom: 3 },
  {
    id: '04-industry',
    title: 'Industry · terrain at the building bases',
    x: industry[0],
    y: industry[1],
    zoom: 2.7,
  },
  {
    id: '05-farm-halt',
    title: 'Farm halt · natural vegetation',
    x: farm[0],
    y: farm[1],
    zoom: 2.7,
  },
];
const materialChange =
  rails.find(
    (r, i) => i > 10 && r.terrain !== rails[0].terrain && Math.hypot(r.x - 48, r.y - 48) > 12,
  ) || rails[Math.floor(rails.length * 0.7)];
views.push({
  id: '06-track-ground',
  title: 'Rails blending with their underlying tiles',
  x: materialChange.x,
  y: materialChange.y,
  zoom: 3,
});
function render(view) {
  g.camera.viewW = g.app.screen.width;
  g.camera.viewH = g.app.screen.height;
  g.camera.zoom = view.zoom;
  const p = tileToWorld(view.x, view.y);
  g.camera.x = p.x;
  g.camera.y = p.y - (view.id === '01-whole-map' ? 0 : 30);
  g.render(1, 0);
  g.world.overlay.visible = false;
  materials.draw();
  g.app.renderer.render(g.app.stage);
  const train = g.trainRenderer.cars.get(t.id)?.[0]?.parts[0];
  if (!train || Math.abs(train.scale.x) !== 1 || train.scale.y !== 1)
    throw new Error('Rocket stretched or missing');
  const human = g.peopleRenderer.sprites.get(99001);
  if (
    !human ||
    human.texture !== g.atlas.get('people/walker_0_f0').texture ||
    human.texture.orig.height !== 11
  )
    throw new Error('Human reference size or asset changed');
  return { view, worldRect: g.camera.viewRect() };
}
const after = hashes(g.map);
if (JSON.stringify(before) !== JSON.stringify(after))
  throw new Error('Generated terrain was changed');
if ([...g.track.pieces.keys()].some((k) => g.map.terrain[k] === 3))
  throw new Error('Unbridged track on water');
const counts = (a) =>
  Object.fromEntries([...new Set(a)].map((v) => [v, a.reduce((n, t) => n + (t === v), 0)]));
const patchExtent = Math.max(
  ...materials.patches.map(
    (p) => Math.hypot(p.x - p.owner.x, p.y - p.owner.y) + Math.max(p.rx, p.ry) * 1.15,
  ),
);
if (patchExtent > 0.95) throw new Error('A building patch escaped its local ground area');
for (let i = 1; i < segments.length; i++) {
  const a = segments[i - 1],
    b = segments[i];
  if (!g.track.opensTo(a.x, a.y, a.out) || !g.track.opensTo(b.x, b.y, b.in))
    throw new Error('Disconnected rail route');
}
window.worldReview = {
  g,
  views,
  render,
  report: {
    seed,
    size: [128, 128],
    generator: 'generateMap(seed, { w:128, h:128 }); every other generation parameter is default',
    before,
    after,
    terrainCounts: counts(g.map.terrain),
    biomeCounts: counts(g.map.biome),
    placed,
    railPieces: rails.length,
    railMaterials: rails,
    patchCount: materials.patches.length,
    patchMaxRadius: materials.patchMaxRadius,
    patches: materials.patches,
    trackOnWater: 0,
    generatedTerrainUnmodified: true,
    maximumPatchDistanceFromAnchor: patchExtent,
    connectedRoute: true,
    humanLogicalHeight: 11,
    trainBodyUnstretched: true,
  },
};
render(views[2]);
