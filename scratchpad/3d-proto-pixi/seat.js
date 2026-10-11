// Proportions and the wheel-seat correction as DATA (uniforms): nothing is re-rendered or re-baked.
//   page.html?scene=seat[&model=d10]
import { Text } from 'pixi.js';
import { makeApp, makeWorld, drawTrack, straight, params, num, depthKey } from './scene.js';
import { loadTrainModel, makeGeometry, makeModelTexture, makeTrainMesh, setSeat, tileToWorld } from './train3d.js';

const app = await makeApp();
const layers = makeWorld(app, { size: 40 });
const { objects, camera, world, rails } = layers;
const meta = await (await fetch('./black_five.meta.json')).json();
const variant = params.get('model') ?? 'full';
const model = await loadTrainModel(variant === 'full' ? './black_five.glb' : `./black_five.${variant}.glb`, meta, { textureUrl: './black_five_texture.png' });
const geometry = makeGeometry(model);
const texture = makeModelTexture(model.image);
const zoom = num('zoom', 3);
const cases = [
  ['as loaded\nscale 0.75, 0.93, 1', {}, [0.75, 0.93, 1]],
  ['seat pitch +2.6 deg\n(nose floats)', { pitchDeg: 2.6 }, [0.75, 0.93, 1]],
  ['seat roll 4 deg +\nsideways 0.06 tile', { rollDeg: 4, offset: [0, 0.06, 0] }, [0.75, 0.93, 1]],
  ['seat height +0.05 tile\n(floats)', { offset: [0, 0, 0.05] }, [0.75, 0.93, 1]],
  ['scale 1.0, 0.93, 1\n(uncompressed length)', {}, [1, 0.93, 1]],
  ['scale 0.75, 0.6, 0.8\n(narrow, low)', {}, [0.75, 0.6, 0.8]],
];
const labels = [];
// a grid in SCREEN axes (world pixels): column step 140, row step 92
const at = (col, row) => {
  const sx = (col - 1) * 140;
  const sy = (row - 0.5) * 92;
  return [20 + sx / 64 + sy / 32, 20 - sx / 64 + sy / 32];
};
cases.forEach(([text, seat, scale], i) => {
  const [tx, ty] = at(i % 3, Math.floor(i / 3));
  drawTrack(rails, straight(tx - 1.25, ty, tx + 1.25, ty));
  const m = makeTrainMesh(geometry, texture, { scale });
  m.setPose(tx, ty, 0);
  setSeat(m.uniforms, seat);
  m.zIndex = depthKey(tx, ty, 15);
  objects.addChild(m);
  labels.push({ p: [tx, ty], text });
});
camera.look(20, 20, zoom);
for (const l of labels) {
  const w = tileToWorld(l.p[0], l.p[1]);
  const t = new Text({ text: l.text, style: { fontFamily: 'system-ui', fontSize: 12, fill: 0xffffff, stroke: { color: 0x000000, width: 3 }, lineHeight: 14 } });
  t.anchor.set(0.5, 0);
  t.position.set(world.x + w.x * zoom - 20 * zoom, world.y + w.y * zoom + 14 * zoom);
  app.stage.addChild(t);
}
app.render();
document.getElementById('label').textContent = `SEAT + SCALE as uniforms  ${variant} ${model.triangles} tris  zoom ${zoom} res ${app.renderer.resolution}\n${app.glInfo.renderer}`;
window.proto = { app };
window.ready = true;
