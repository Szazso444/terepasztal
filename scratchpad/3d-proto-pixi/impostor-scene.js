// (2) IMPOSTOR scene: same layout as direct.js, every engine is a Sprite showing an atlas cell.
import { Sprite } from 'pixi.js';
import { makeApp, makeWorld, params, num, depthKey } from './scene.js';
import { loadTrainModel, makeGeometry, makeModelTexture } from './train3d.js';
import { ImpostorAtlas, SeparateImpostors, impostorCell } from './impostor.js';
import { populate } from './layout.js';

const app = await makeApp();
const layers = makeWorld(app);
const { objects, camera } = layers;
const meta = await (await fetch('./black_five.meta.json')).json();
const variant = params.get('model') ?? 'full';
const url = variant === 'full' ? './black_five.glb' : `./black_five.${variant}.glb`;
const model = await loadTrainModel(url, meta, { textureUrl: './black_five_texture.png' });
const geometry = makeGeometry(model);
const texture = makeModelTexture(model.image, { filter: params.get('filter') ?? 'linear', mipmaps: params.get('mips') !== '0' });
const SCALE = (params.get('scale') ?? '0.75,0.93,1').split(',').map(Number);
let zoom = num('zoom', 1);
const SS = num('ss', 1); // supersample: 2 renders at twice the screen density and shows it at half size
const mode = params.get('mode') ?? 'atlas';
const cell = impostorCell(model, SCALE);
const msaa = params.get('msaa') === '1';
const pixelScale = zoom * app.renderer.resolution * SS;
const filter = SS > 1 ? 'linear' : 'nearest';
const store =
  mode === 'separate'
    ? new SeparateImpostors(app.renderer, { cell, pixelScale, filter, depth: params.get('nodepth') !== '1', msaa })
    : new ImpostorAtlas(app.renderer, { cell, pixelScale, count: 24, filter, msaa });
const items = [];
await populate(layers, (tx, ty, heading, pitch = 0, h = 0, extra = {}) => {
  const it = store.add(geometry, texture, { scale: SCALE });
  it.setPose(tx, ty, heading, pitch, h);
  it.sprite.zIndex = depthKey(tx, ty, 15);
  if (extra.tint !== undefined) it.sprite.tint = extra.tint;
  if (extra.alpha !== undefined) it.sprite.alpha = extra.alpha;
  objects.addChild(it.sprite);
  items.push(it);
});

camera.look(num('cx', 11), num('cy', 13.5), zoom);
let drawn = mode === 'each' ? store.refreshEach(false, params.get('noscissor') !== '1') : store.refresh();
if (params.has('rezoom')) {
  // a zoom change after the first frame: draw once at the old scale, then re-lay the atlas out
  app.render();
  zoom = num('rezoom', 3);
  camera.look(num('cx', 11), num('cy', 13.5), zoom);
  store.layout(zoom * app.renderer.resolution * SS);
  drawn = store.refresh();
}
if (params.get('partial') === '1') {
  // only two engines turn after the first frame: only their cells may be cleared and redrawn
  app.render();
  for (const i of [12, 13]) items[i].setPose(i === 12 ? 8 : 10.05, 17.5, 0.6);
  drawn = store.refresh();
}
if (params.get('partialref') === '1') for (const i of [12, 13]) items[i].setPose(i === 12 ? 8 : 10.05, 17.5, 0.6), (drawn = store.refresh(true));
if (params.get('atlasview') === '1') {
  // show the atlas itself in the corner
  const v = new Sprite({ texture: store.texture });
  v.scale.set(Math.min(1, 620 / store.size));
  v.position.set(8, 60);
  app.stage.addChild(v);
}
app.render();
document.getElementById('label').textContent =
  `IMPOSTOR ${mode}${msaa ? ' msaa' : ''}  ${variant} ${model.triangles} tris x ${items.length}  zoom ${zoom} res ${app.renderer.resolution} ss ${SS}  ` +
  `cell ${cell.w}x${cell.h} logical -> ${store.cw ?? Math.ceil(cell.w * pixelScale)}x${store.ch ?? Math.ceil(cell.h * pixelScale)} px, atlas ${store.size ?? '-'}\n${app.glInfo.renderer}`;
window.report = { cell, drawn, atlas: store.size, cw: store.cw, ch: store.ch };
window.proto = { app, items, model, camera, objects, store };
window.ready = true;
