// Cost: N engines, every one turning every frame (the worst case), timed with a GPU sync per frame.
//   ?approach=direct|atlas|each|separate|static  &n=1|20|100  &model=full|d25|d10|d03  &zoom=1  &frames=30
import { makeApp, makeWorld, params, num, depthKey } from './scene.js';
import { loadTrainModel, makeGeometry, makeModelTexture, makeTrainMesh } from './train3d.js';
import { ImpostorAtlas, SeparateImpostors, impostorCell } from './impostor.js';

const app = await makeApp();
app.ticker.stop();
const layers = makeWorld(app, { size: 26 });
const { objects, camera } = layers;
const meta = await (await fetch('./black_five.meta.json')).json();
const variant = params.get('model') ?? 'full';
const tLoad = performance.now();
const model = await loadTrainModel(variant === 'full' ? './black_five.glb' : `./black_five.${variant}.glb`, meta, {
  textureUrl: './black_five_texture.png',
});
const loadMs = performance.now() - tLoad;
const geometry = makeGeometry(model);
const texture = makeModelTexture(model.image);
const SCALE = [0.75, 0.93, 1];
const approach = params.get('approach') ?? 'direct';
const N = num('n', 20);
const zoom = num('zoom', 1);
const SS = num('ss', 1);
const frames = num('frames', 30);
const cols = Math.ceil(Math.sqrt(N));
const pixelScale = zoom * app.renderer.resolution * SS;
const cell = impostorCell(model, SCALE);
let store = null;
const msaa = params.get('msaa') === '1';
if (approach === 'separate') store = new SeparateImpostors(app.renderer, { cell, pixelScale, msaa });
else if (approach !== 'direct') store = new ImpostorAtlas(app.renderer, { cell, pixelScale, count: N, filter: SS > 1 ? 'linear' : 'nearest', maxSize: 8192, msaa });
const things = [];
for (let i = 0; i < N; i++) {
  const tx = 4 + (i % cols) * 1.9;
  const ty = 4 + Math.floor(i / cols) * 1.9;
  let it;
  if (approach === 'direct') {
    it = makeTrainMesh(geometry, texture, { scale: SCALE });
    it.zIndex = depthKey(tx, ty, 15);
    objects.addChild(it);
  } else {
    it = store.add(geometry, texture, { scale: SCALE });
    it.sprite.zIndex = depthKey(tx, ty, 15);
    objects.addChild(it.sprite);
  }
  it.tx = tx;
  it.ty = ty;
  things.push(it);
}
const mid = 4 + ((cols - 1) * 1.9) / 2;
camera.look(mid, mid, zoom);

const gl = app.renderer.gl;
const px = new Uint8Array(4);
const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); // waits for the GPU
const pose = (f) => things.forEach((it, i) => it.setPose(it.tx, it.ty, f * 0.05 + i * 0.37));
const refresh = () => (approach === 'each' ? store.refreshEach() : store.refresh());

const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const round = (x) => Math.round(x * 100) / 100;
async function run() {
  const total = [], refreshMs = [], cpu = [];
  // first frame: uploads the geometry and the texture, compiles the program
  let t0 = performance.now();
  pose(0);
  if (store) refresh();
  app.renderer.render(app.stage);
  sync();
  const firstMs = performance.now() - t0;
  for (let f = 1; f <= frames + 5; f++) {
    t0 = performance.now();
    let tr = 0;
    if (approach !== 'static') pose(f);
    if (store) {
      refresh();
      tr = performance.now() - t0;
    }
    app.renderer.render(app.stage);
    const tc = performance.now() - t0;
    sync();
    const t1 = performance.now() - t0;
    if (f > 5) {
      total.push(t1);
      refreshMs.push(tr);
      cpu.push(tc);
    }
    if (f % 10 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  return {
    approach, msaa, n: N, model: variant, triangles: model.triangles, zoom, ss: SS,
    resolution: app.renderer.resolution, screen: [app.screen.width, app.screen.height],
    frameMs: round(med(total)), jsMs: round(med(cpu)), refreshJsMs: round(med(refreshMs)),
    minMs: round(Math.min(...total)), maxMs: round(Math.max(...total)), firstFrameMs: round(firstMs),
    loadMs: round(loadMs), fetchMs: round(model.timing.fetchMs), parseMs: round(model.timing.parseMs), alignMs: round(model.alignMs),
    atlas: store?.size, cellPx: store ? [store.cw ?? Math.ceil(cell.w * pixelScale), store.ch ?? Math.ceil(cell.h * pixelScale)] : null,
    gl: app.glInfo.renderer,
  };
}
window.report = await run();
document.getElementById('label').textContent = JSON.stringify(window.report).replace(/,"/g, ', "').slice(0, 400);
window.proto = { app };
window.ready = true;
