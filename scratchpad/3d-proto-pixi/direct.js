// (1) DIRECT: the 3D mesh is an ordinary Mesh in the display list, among Sprites, sorted by zIndex.
import { Culler } from 'pixi.js';
import { makeApp, makeWorld, params, num, depthKey } from './scene.js';
import { loadTrainModel, makeGeometry, makeModelTexture, makeTrainMesh } from './train3d.js';
import { populate } from './layout.js';

const app = await makeApp(params.get('aa') === '1' ? { antialias: true } : {});
const layers = makeWorld(app);
const { objects, camera } = layers;
const meta = await (await fetch('./black_five.meta.json')).json();
const variant = params.get('model') ?? 'full';
const url = variant === 'full' ? './black_five.glb' : `./black_five.${variant}.glb`;
const model = await loadTrainModel(url, meta, { textureUrl: './black_five_texture.png' });
const geometry = makeGeometry(model);
const texture = makeModelTexture(model.image, {
  filter: params.get('filter') ?? 'linear',
  mipmaps: params.get('mips') !== '0',
});
const SCALE = (params.get('scale') ?? '0.75,0.93,1').split(',').map(Number);
const meshes = [];
await populate(layers, (tx, ty, heading, pitch = 0, h = 0, extra = {}) => {
  const m = makeTrainMesh(geometry, texture, { scale: SCALE });
  m.setPose(tx, ty, heading, pitch, h);
  m.zIndex = depthKey(tx, ty, 15);
  if (params.get('cull')) m.state.cullMode = params.get('cull');
  if (params.get('depth') === '0') m.state.depthTest = false;
  if (params.get('round') === '0') m.roundPixels = false;
  if (params.get('mirror') === '1') m.scale.x = -1;
  if (params.get('cullable') === '1') m.cullable = true; // what the game's CullerPlugin looks at
  if (params.get('nocullarea') === '1') m.cullArea = null;
  if (extra.tint !== undefined) m.tint = extra.tint;
  if (extra.alpha !== undefined) m.alpha = extra.alpha;
  objects.addChild(m);
  meshes.push(m);
});

camera.look(num('cx', 11), num('cy', 13.5), num('zoom', 1));
if (params.get('cullable') === '1') {
  objects.cullableChildren = true;
  Culler.shared.cull(app.stage, app.renderer.screen, false); // what CullerPlugin does before every render
  window.report = { culled: meshes.filter((m) => m.culled).length, of: meshes.length };
}
app.render();
document.getElementById('label').textContent =
  `DIRECT  ${variant} ${model.triangles} tris x ${meshes.length}  zoom ${camera.zoom}  res ${app.renderer.resolution}\n${app.glInfo.renderer}`;
window.proto = { app, meshes, model, camera, objects };
window.ready = true;
