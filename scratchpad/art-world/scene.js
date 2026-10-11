import { Application, Container, Sprite, Graphics, Texture } from 'pixi.js';
import { loadLandscape, landscape } from './landscape.js';
import { profiles, visualScale, metresToPixels } from './lots.js';
import { AtlasRegistry } from '/src/engine/atlas.ts';
import { ATLAS_GROUPS } from '/src/art/index.ts';
import { generateTrackAtlas } from '/src/art/track.ts';
const atlas = new AtlasRegistry();
await atlas.load(ATLAS_GROUPS.filter((g) => ['terrain', 'props', 'structures'].includes(g.name)));
atlas.register(generateTrackAtlas());
await loadLandscape();
const grounds = new Map();
const report = await (await fetch('/assets/illustrated-report.json')).json();
const app = new Application();
await app.init({
  width: 1400,
  height: 850,
  background: 0x243b32,
  antialias: true,
  preserveDrawingBuffer: true,
});
document.querySelector('#scene').append(app.canvas);
const pos = (x, y) => [(x - y) * 32, (x + y) * 16];
function draw() {
  app.stage.removeChildren().forEach((c) => c.destroy({ children: true }));
  const root = new Container();
  root.position.set(700, 105);
  root.scale.set(2);
  app.stage.addChild(root);
  const mode = document.querySelector('#mode').value,
    grid = document.querySelector('#grid').checked;
  const add = (key, x, y, object = false) => {
    const f = atlas.get(key),
      s = new Sprite(f.texture);
    s.anchor.set(f.anchorX, f.anchorY);
    s.position.set(...pos(x, y));
    if (object) s.scale.set(visualScale(key));
    if (object && !document.querySelector('#width').checked) s.scale.x /= 1.2;
    root.addChild(s);
  };
  const palette = [
    'grass',
    'forest',
    'plains',
    'sand',
    'rock',
    'hillcut',
    'taiga',
    'swamp',
    'desert',
    'water',
  ];
  for (let sum = 0; sum <= 20; sum++)
    for (let x = 0; x <= 10; x++) {
      const y = sum - x;
      if (y < 0 || y > 10) continue;
      let kind =
        mode === 'terrain'
          ? palette[Math.min(9, Math.floor(x / 2) + Math.floor(y / 6) * 5)]
          : x >= 9
            ? 'water'
            : x === 8
              ? 'sand'
              : x < 2
                ? 'forest'
                : mode === 'industry' && y > 6
                  ? 'rock'
                  : 'grass';
      if (mode === 'terrain')
        add(
          kind === 'water' ? `terrain/water_${(x + y) % 3}_f0` : `terrain/${kind}_${(x + y) % 4}`,
          x,
          y,
        );
      if (grid) {
        const [px, py] = pos(x, y);
        root.addChild(
          new Graphics()
            .poly([px, py - 16, px + 32, py, px, py + 16, px - 32, py])
            .stroke({ width: 0.35, color: 0xebddb1, alpha: 0.5 }),
        );
      }
    }
  if (mode !== 'terrain') for (let x = 0; x <= 8; x++) add('track/straight_regular_1', x, 6);
  const objects =
    mode === 'terrain'
      ? []
      : mode === 'village'
        ? [
            ['structures/station_1', 5, 5],
            ['structures/townhouse', 3, 2],
            ['structures/townhouse_2', 5, 2],
            ['structures/town_1', 6, 3],
            ['structures/warehouse_1', 7, 7],
            ['structures/farm_1', 3, 8],
            ['structures/windmill', 1, 8],
            ['structures/water_tower', 3, 5],
            ['structures/fuel_stop', 7, 5],
            ['props/tree_0', 1, 2],
            ['props/oak_0', 2, 4],
            ['props/pine_0', 0, 4],
            ['props/tree_1', 1, 0],
            ['props/bush_0', 6, 8],
            ['props/flowers_0', 4, 3],
            ['props/reeds_0', 8, 9],
            ['props/rock_0', 8, 1],
          ]
        : [
            ['structures/lumber_1', 2, 2],
            ['structures/quarry_1', 2, 8],
            ['structures/refinery', 5, 8],
            ['structures/power_plant', 6, 2],
            ['structures/substation', 7, 3],
            ['structures/grinder', 4, 3],
            ['structures/kiln', 4, 8],
            ['structures/pump_1', 7, 8],
            ['structures/ironworks', 6, 10],
            ['structures/colliery', 2, 10],
            ['props/pine_0', 0, 1],
            ['props/pine_1', 1, 1],
            ['props/coal_0', 1, 7],
            ['props/boulder_0', 0, 8],
            ['props/oil_0', 7, 10],
          ];
  // Give forecourts room: compare a few readable lots rather than crowding single tiles.
  const excluded =
    mode === 'village'
      ? ['structures/townhouse_2', 'structures/windmill', 'structures/fuel_stop']
      : [
          'structures/substation',
          'structures/grinder',
          'structures/ironworks',
          'structures/colliery',
        ];
  for (let i = objects.length - 1; i >= 0; i--)
    if (excluded.includes(objects[i][0])) objects.splice(i, 1);
  const lots = objects
    .filter(([key]) => profiles[key])
    .map(([key, x, y]) => ({ key, x, y: y + 0.3, ...profiles[key] }));
  if (mode !== 'terrain') {
    const yards = document.querySelector('#yards').checked,
      cacheKey = mode + yards;
    if (!grounds.has(cacheKey)) grounds.set(cacheKey, Texture.from(landscape(lots, yards)));
    const ground = new Sprite(grounds.get(cacheKey));
    ground.scale.set(0.5);
    ground.position.set(-352, -16);
    root.addChildAt(ground, 0);
    if (grid)
      for (const lot of lots) {
        const points = [
          [lot.x - lot.w / 2, lot.y - lot.h / 2],
          [lot.x + lot.w / 2, lot.y - lot.h / 2],
          [lot.x + lot.w / 2, lot.y + lot.h / 2],
          [lot.x - lot.w / 2, lot.y + lot.h / 2],
        ].flatMap((p) => pos(...p));
        root.addChild(new Graphics().poly(points).stroke({ width: 0.65, color: 0xf6cf7d }));
      }
  }
  objects.sort((a, b) => a[1] + a[2] - b[1] - b[2]);
  for (const [k, x, y] of objects) add(k, x, y, true);
  if (mode !== 'terrain' && document.querySelector('#people').checked)
    for (const lot of lots) {
      const [x, y] = pos(lot.x, lot.y + lot.h / 2 - 0.15),
        h = 1.75 * metresToPixels;
      const person = new Graphics().circle(x, y - h + 1.2, 1.2).fill(0xe0c7a2);
      person
        .moveTo(x, y - h + 3)
        .lineTo(x, y - 3)
        .stroke({ width: 2.2, color: 0xc6a76b });
      person
        .moveTo(x, y - 3)
        .lineTo(x - 1.3, y)
        .moveTo(x, y - 3)
        .lineTo(x + 1.3, y)
        .stroke({ width: 0.8, color: 0x3b382e });
      root.addChild(person);
    }
  document.querySelector('#status').textContent =
    `${objects.length} objects · ${lots.length} material-specific lots · provisional shared door scale · original rail art`;
  window.artWorldLots = lots.map((l) => ({
    key: l.key,
    material: l.material,
    footprint: [l.w, l.h],
    scale: visualScale(l.key),
  }));
  window.artWorldReady = true;
}
for (const el of document.querySelectorAll('select,input')) el.addEventListener('change', draw);
document.querySelector('#save').onclick = () => {
  app.renderer.render(app.stage);
  const a = document.createElement('a');
  a.download = 'illustrated-world.png';
  a.href = app.canvas.toDataURL();
  a.click();
};
for (const entry of report.converted.filter((e) => !e.id.startsWith('cargo.'))) {
  const article = document.createElement('article'),
    title = document.createElement('h3'),
    pair = document.createElement('div'),
    img = new Image(),
    canvas = document.createElement('canvas'),
    caption = document.createElement('small');
  title.textContent = entry.id;
  pair.className = 'pair';
  img.src = `/assets/source/base-v1/${entry.source}`;
  img.alt = entry.id + ' source';
  const f = atlas.get(entry.frames[0]),
    r = f.texture.frame;
  canvas.width = r.width;
  canvas.height = r.height;
  canvas.getContext('2d').drawImage(f.image, r.x, r.y, r.width, r.height, 0, 0, r.width, r.height);
  caption.textContent = `${entry.frames.length} atlas frames · ${f.w.toFixed(1)} × ${f.h.toFixed(1)} world pixels`;
  pair.append(img, canvas);
  article.append(title, pair, caption);
  document.querySelector('#catalog').append(article);
}
draw();
