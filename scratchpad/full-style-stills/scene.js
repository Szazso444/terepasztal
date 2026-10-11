import { Game } from '/src/game.ts';
import { emptyMap } from '/src/world/mapgen.ts';
import { levelFromMap } from '/src/world/level.ts';
import { Train } from '/src/sim/trains.ts';
import { content } from '/src/data/content.ts';
import { tileToWorld } from '/src/engine/iso.ts';
import { installGround } from './ground.js';
import { visualScale } from '../art-world/lots.js';

const mode = new URLSearchParams(location.search).get('scene') || 'village';
const map = emptyMap(7412, 64, 64);
map.props.clear();
const tile = (x, y, t, b = 0) => {
  const i = y * 64 + x;
  map.terrain[i] = t;
  map.biome[i] = b;
  map.variant[i] = (x * 7 + y * 11) % 4;
};
const prop = (x, y, kind, ox = 0, oy = 0) => {
  const i = y * 64 + x;
  const a = map.props.get(i) || [];
  a.push({ kind, variant: (x + y) % 2, ox, oy });
  map.props.set(i, a);
};
for (let y = 0; y < 64; y++)
  for (let x = 0; x < 64; x++) {
    tile(x, y, 0, 1);
    const h = ((x * 197 + y * 37 + x * y * 13) % 101) / 101;
    if (h < 0.1) prop(x, y, 'flowers');
    if (h > 0.91) prop(x, y, 'bush');
    if ((x < 18 || x > 35 || y < 17 || y > 33) && h > 0.68)
      prop(x, y, (x + y) % 3 ? 'tree' : 'oak');
  }
if (mode === 'industry') {
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++) {
      if (x < 22 && y > 27) tile(x, y, 4);
      if (x < 23 && y < 24) tile(x, y, 1, 1);
      if (x > 35) {
        tile(x, y, x === 36 ? 5 : 3, 5);
        map.props.delete(y * 64 + x);
      }
    }
}
if (mode === 'countryside') {
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++) {
      const bank = 33 + Math.floor(Math.sin(y * 0.22) * 1.4);
      if (x > bank) {
        tile(x, y, x === bank + 1 ? 5 : 3, 5);
        map.props.delete(y * 64 + x);
      }
      if (y < 20 && x < 27) {
        tile(x, y, 1, 1);
        if ((x + y) % 2) prop(x, y, (x + y) % 3 ? 'pine' : 'birch');
      }
      if (x < 20 && y > 30) tile(x, y, 2, 1);
      if (x === bank && y % 3 === 0) prop(x, y, 'reeds');
    }
}
if (['desert', 'taiga', 'wetlands'].includes(mode)) {
  map.props.clear();
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++) {
      tile(x, y, 0, mode === 'desert' ? 2 : mode === 'taiga' ? 3 : 4);
      const h = (x * 197 + y * 37 + x * y * 13) % 101;
      if (h > 79)
        prop(
          x,
          y,
          mode === 'desert'
            ? h % 3
              ? 'cactus'
              : 'rock'
            : mode === 'taiga'
              ? h % 3
                ? 'spruce'
                : 'pine'
              : h % 3
                ? 'reeds'
                : 'deadtree',
        );
      if (mode === 'wetlands' && x > 34) {
        tile(x, y, 3, 5);
        map.props.delete(y * 64 + x);
      }
    }
}
if (!['desert', 'taiga', 'wetlands'].includes(mode))
  for (const [x, y] of [
    [18, 19],
    [19, 20],
    [20, 18],
    [21, 18],
    [28, 18],
    [30, 18],
    [32, 20],
    [19, 28],
    [21, 30],
    [27, 33],
    [30, 31],
    [33, 23],
  ])
    if (map.terrain[y * 64 + x] !== 3) prop(x, y, (x + y) % 3 ? 'oak' : 'birch');
const g = new Game({
  kind: 'level',
  seed: 7412,
  level: levelFromMap(map, 'Full-style still ' + mode),
});
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
// LevelData intentionally regenerates props; restore this still's authored
// arrangement after the real level loader has completed.
const propTiles = new Set([...g.map.props.keys(), ...map.props.keys()]);
g.map.props = new Map([...map.props].map(([k, v]) => [k, v.map((p) => ({ ...p }))]));
for (const k of propTiles) g.world.rebuildProps(k % 64, Math.floor(k / 64));
await g.atlas.load([
  {
    name: '../../scratchpad/asset-qa/candidate/rolling',
    generate: () => ({ image: document.createElement('canvas'), frames: {} }),
  },
]);
const placed = [];
await g.atlas.load([
  {
    name: '../../scratchpad/full-style-stills/assets/people',
    generate: () => ({ image: document.createElement('canvas'), frames: {} }),
  },
]);
const rail = (x, y, kind = 'straight', rot = 1) => {
  for (const q of g.track.place(x, y, kind, rot, 'regular')) g.onTrackChanged(q.x, q.y);
};
for (let x = 12; x <= (mode === 'countryside' ? 32 : mode === 'wetlands' ? 34 : 35); x++)
  rail(x, 26);
rail(31, 26, 'switch', 1);
for (let y = 27; y <= 32; y++) rail(31, y, 'straight', 0);
const put = (type, id, x, y) => {
  g.map.props.delete(y * 64 + x);
  g.world.rebuildProps(x, y);
  const v =
    type === 'station'
      ? g.builder.placeStation(x, y, id, 0)
      : type === 'building'
        ? g.builder.placeBuilding(x, y, id)
        : g.builder.placeDecor(x, y, id, 0);
  if (!v) throw new Error('Placement failed: ' + id + ' at ' + x + ',' + y);
  placed.push({ type, id, x, y });
  return v;
};
if (mode === 'village') {
  put('station', 'station', 26, 25);
  put('station', 'town', 22, 25);
  put('station', 'farm', 18, 25);
  put('station', 'warehouse', 32, 29);
  for (const [x, y] of [
    [22, 21],
    [25, 20],
    [28, 21],
    [24, 23],
    [29, 23],
    [21, 23],
  ])
    put('decor', 'townhouse', x, y);
  put('building', 'windmill', 18, 22);
  put('decor', 'water_tower', 28, 27);
  put('decor', 'fuel_stop', 30, 24);
  put('building', 'kiln', 25, 30);
} else if (mode === 'industry') {
  put('station', 'lumber', 20, 25);
  put('station', 'warehouse', 27, 25);
  put('station', 'quarry', 20, 27);
  put('station', 'station', 33, 25);
  for (const [id, x, y] of [
    ['kiln', 23, 22],
    ['grinder', 23, 29],
    ['refinery', 27, 30],
    ['power_plant', 28, 21],
    ['substation', 31, 22],
  ])
    put('building', id, x, y);
  put('decor', 'water_tower', 29, 27);
  put('decor', 'fuel_stop', 25, 27);
} else {
  put('station', 'farm', 23, 25);
  put('station', 'station', 29, 25);
  put('station', 'lumber', 18, 25);
  put('building', 'windmill', 23, 22);
  put('decor', 'townhouse', 28, 22);
  put('decor', 'townhouse', 26, 20);
  put('decor', 'water_tower', 30, 27);
}
const t = new Train(
  [{ uid: 85001, def: content.locomotives.find((d) => d.id === 'rocket'), level: 0 }],
  'Rocket',
  85001,
);
if (!t.spawnAt(g.track, 26, 26, 3)) throw new Error('Rocket spawn failed');
g.fleet.trains = [t];
t.coal = t.coalCap;
t.water = t.waterCap;
g.people.persons = [
  {
    id: 99001,
    x: mode === 'village' ? 26.8 : 27.25,
    y: mode === 'village' ? 25.1 : 24.3,
    home: 'still',
    outfit: 0,
    state: 'idle',
    timer: 99999,
    path: [],
    step: 0,
    transient: false,
    stationId: null,
  },
];
// Low-level fixture track placement does not invoke the builder's tree clearing.
// Reserve the pictured yards, railway, and standing person's clearance.
for (const [k, list] of g.map.props) {
  const x = k % 64,
    y = Math.floor(k / 64);
  const keep = list.filter(
    (p) =>
      !g.track.has(x, y) &&
      !placed.some(
        (l) => Math.abs(x + p.ox - l.x) < 1.65 && Math.abs(y + p.oy - l.y - 0.2) < 1.3,
      ) &&
      !g.people.persons.some(
        (h) => Math.abs(x + p.ox - h.x) < 0.8 && Math.abs(y + p.oy - h.y) < 0.8,
      ),
  );
  if (keep.length !== list.length) {
    if (keep.length) g.map.props.set(k, keep);
    else g.map.props.delete(k);
    g.world.rebuildProps(x, y);
  }
}
const ground = await installGround(g, mode, placed);
const scales = [];
for (const p of placed) {
  const key = 'structures/' + (p.type === 'station' ? p.id + '_1' : p.id);
  const scale = visualScale(key);
  // Existing door-based preview profile. This is explicitly a still-art study,
  // not a change to simulation footprints or a certified metres/tile contract.
  const position = tileToWorld(p.x, p.y);
  for (const s of g.world.objects.children) {
    if (Math.abs(s.x - position.x) < 1 && Math.abs(s.y - position.y) < 1) {
      s.scale.set(scale);
    }
  }
  scales.push({ id: p.id, key, scale });
}
function render(x = 25, y = 25, zoom = 2.65) {
  const p = tileToWorld(x, y);
  g.camera.centerOn(p.x, p.y - 35);
  g.camera.zoom = zoom;
  g.render(1, 0);
  g.world.overlay.visible = false;
  g.app.renderer.render(g.app.stage);
}
render();
const trackOnWater = [...g.track.pieces.keys()].filter((k) => g.map.terrain[k] === 3);
if (trackOnWater.length) throw new Error('Unbridged track on water: ' + trackOnWater.join(','));
const human = g.peopleRenderer.sprites.get(99001);
if (
  !human ||
  human.texture !== g.atlas.get('people/walker_0_f0').texture ||
  human.texture.orig.height !== 11
)
  throw new Error('Illustrated human not applied at the shared 11-pixel height');
const trainSprite = g.trainRenderer.cars.get(t.id)[0].parts[0];
if (Math.abs(trainSprite.scale.x) !== 1 || trainSprite.scale.y !== 1)
  throw new Error('Train body was stretched');
window.stills = {
  g,
  mode,
  placed,
  render,
  report: () => ({
    mode,
    placed,
    projection: '2:1, 64x32 logical pixels',
    rocketFacings: 25,
    ground,
    scales,
    checks: {
      trackOnWater: trackOnWater.length,
      humanLogicalHeight: human.texture.orig.height,
      illustratedHumanLoaded: true,
      trainSpriteScale: [
        g.trainRenderer.cars.get(t.id)[0].parts[0].scale.x,
        g.trainRenderer.cars.get(t.id)[0].parts[0].scale.y,
      ],
    },
    source: 'real Game and WorldRenderer with isolated continuous terrain and art scale preview',
    productionAssetsModified: false,
  }),
};
