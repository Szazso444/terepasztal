import { Game } from '/src/game.ts';
import { emptyMap } from '/src/world/mapgen.ts';
import { levelFromMap } from '/src/world/level.ts';
import { tileToWorld } from '/src/engine/iso.ts';
import { hash2 } from '/src/engine/rng.ts';
import { createMaterials } from './materials.js';

// Deliberately controlled comparison fixture; normal generation is checked separately.
const map = emptyMap(7412, 48, 48);
map.props.clear();
for (let y = 0; y < 48; y++)
  for (let x = 0; x < 48; x++) {
    const k = y * 48 + x;
    const type = x < 24 ? 0 : y < 24 ? 1 : x < 30 ? 5 : 3;
    map.terrain[k] = type;
    map.biome[k] = type === 1 ? 1 : type === 3 ? 5 : 0;
    map.variant[k] = Math.floor(hash2(x, y, 29) * 3);
    if (type !== 3 && type !== 5) {
      const h = hash2(x, y, 52);
      const kind =
        h < 0.035
          ? 'oak'
          : h < 0.07
            ? 'tree'
            : h < 0.105
              ? 'spruce'
              : h < 0.2
                ? 'bush'
                : h < 0.35
                  ? 'flowers'
                  : null;
      if (kind)
        map.props.set(k, [
          {
            kind,
            variant: (x + y) % 2,
            ox: (hash2(x, y, 5) - 0.5) * 0.6,
            oy: (hash2(x, y, 7) - 0.5) * 0.6,
          },
        ]);
    }
  }
const props = new Map(map.props);
const g = new Game({ kind: 'level', seed: 7412, level: levelFromMap(map, 'Terrain comparison') });
window.game = g;
await g.init();
g.loop.stop();
g.app.ticker.stop();
g.closeMenus();
Object.assign(g.settings, { autosave: false, weather: false, dayNight: false, smoke: false });
g.clock.setSpeed(0);
for (let i = 0; i < g.regions.unlocked.length; i++) g.regions.own(i);
g.world.rebuildFog();
const keys = new Set([...g.map.props.keys(), ...props.keys()]);
g.map.props = props;
for (const k of keys) g.world.rebuildProps(k % 48, Math.floor(k / 48));
g.builder.free = true;
g.builder.placeDecor(21, 21, 'townhouse', 0);
g.people.persons = [];
const materials = await createMaterials(g);
const views = [
  {
    id: '01-restored-tiles',
    title: 'Restored illustrated tiles',
    detail: 0,
    edge: 'native',
    x: 23,
    y: 20,
    zoom: 3,
  },
  {
    id: '02-light-detail',
    title: 'Light texture',
    detail: 0.48,
    edge: 'patches',
    x: 23,
    y: 20,
    zoom: 3,
  },
  {
    id: '03-balanced-detail',
    title: 'Balanced illustrated texture — recommended',
    detail: 0.78,
    edge: 'patches',
    x: 23,
    y: 20,
    zoom: 3,
  },
  {
    id: '04-rich-detail',
    title: 'Rich meadow texture',
    detail: 1,
    edge: 'patches',
    x: 23,
    y: 20,
    zoom: 3,
  },
  {
    id: '05-forest-interlock',
    title: 'Grass → forest: interlocking material patches',
    detail: 0.78,
    edge: 'patches',
    x: 23.5,
    y: 17,
    zoom: 4,
  },
  {
    id: '06-forest-fringe',
    title: 'Grass → forest: narrow winding fringe',
    detail: 0.78,
    edge: 'fringe',
    x: 23.5,
    y: 17,
    zoom: 4,
  },
  {
    id: '07-grass-sand',
    title: 'Grass → sand: scattered grass tongues',
    detail: 0.78,
    edge: 'patches',
    x: 23.5,
    y: 29,
    zoom: 4,
  },
  {
    id: '08-sand-water',
    title: 'Sand → water: irregular narrow shoreline',
    detail: 0.78,
    edge: 'patches',
    x: 29.5,
    y: 29,
    zoom: 4,
  },
];
function render(v) {
  const p = tileToWorld(v.x, v.y);
  g.camera.viewW = g.app.screen.width;
  g.camera.viewH = g.app.screen.height;
  g.camera.x = p.x;
  g.camera.y = p.y - 20;
  g.camera.zoom = v.zoom;
  g.render(1, 0);
  materials.draw(v.detail, v.edge);
  g.cursor.visible = false;
  g.app.renderer.render(g.app.stage);
  if (g.camera.zoom !== v.zoom) throw Error('Camera drift');
  return { ground: g.world.ground.visible, view: v };
}
window.terrainReview = {
  views,
  render,
  report: {
    fixture: 'Controlled 48 × 48 material comparison in Game/Pixi renderer',
    seed: 7412,
    production: 'Illustrated tiles restored; material alternatives are preview-only',
    samePropsAcrossDetailLevels: true,
    treeScale: 1.5,
  },
};
render(views[2]);
