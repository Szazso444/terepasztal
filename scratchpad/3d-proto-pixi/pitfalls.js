// Pitfall panel: one engine per case, labelled, at zoom 3.   page.html?scene=pitfalls[&heading=0.3]
import { Text } from 'pixi.js';
import { makeApp, makeWorld, loadAtlas, params, num, depthKey } from './scene.js';
import {
  loadTrainModel,
  makeGeometry,
  makeModelTexture,
  makeTrainMesh,
  tileToWorld,
  NEAR_XY,
  SCREEN_DEPTH_SCALE,
} from './train3d.js';
import { SeparateImpostors, impostorCell } from './impostor.js';

const app = await makeApp();
const layers = makeWorld(app, { size: 40 });
const { objects, camera, world } = layers;
if (params.get('noground') === '1') layers.ground.visible = false;
const meta = await (await fetch('./black_five.meta.json')).json();
const model = await loadTrainModel('./black_five.glb', meta, { textureUrl: './black_five_texture.png' });
const geometry = makeGeometry(model);
const texture = makeModelTexture(model.image);
const SCALE = [0.75, 0.93, 1];
const zoom = num('zoom', 3);
const heading = num('heading', 0);
const props = await loadAtlas('props');
const impostors = new SeparateImpostors(app.renderer, {
  cell: impostorCell(model, SCALE),
  pixelScale: zoom * app.renderer.resolution,
});

// a grid of cases in SCREEN axes: column step 104 px, row step 84 px (world pixels)
const C0 = [num('c0', 20), num('c0', 20)]; // c0=490: the far corner of a 512-tile map (depth and float precision)
const at = (col, row) => {
  const sx = (col - 1.5) * 104;
  const sy = (row - 1) * 84;
  // world px -> tile: x = (tx - ty) * 32, y = (tx + ty) * 16
  return [C0[0] + sx / 64 + sy / 32, C0[1] - sx / 64 + sy / 32];
};
const labels = [];
const label = (col, row, text) => labels.push({ p: at(col, row), text });
const mesh = (col, row, text, tweak = () => {}, opts = {}) => {
  const [tx, ty] = at(col, row);
  const m = makeTrainMesh(geometry, texture, { scale: SCALE, ...opts });
  m.setPose(tx, ty, heading);
  m.zIndex = depthKey(tx, ty, 15);
  tweak(m);
  objects.addChild(m);
  label(col, row, text);
  return m;
};

// row 0: render state
mesh(0, 0, '1 depth test + cull back\n(the working state)');
mesh(1, 0, '2 depthTest = false\n(triangle order shows)', (m) => (m.state.depthTest = false));
mesh(2, 0, '3 cullMode none\n(same picture, more fill)', (m) => (m.state.cullMode = 'none'));
mesh(3, 0, '4 cullMode front\n(inside-out)', (m) => (m.state.cullMode = 'front'));

// row 1: mirroring flips the winding
mesh(0, 1, '5 scale.x = -1, cull back\n(inside-out)', (m) => (m.scale.x = -1));
mesh(1, 1, '6 scale.x = -1, cull front\n(correct mirror)', (m) => {
  m.scale.x = -1;
  m.state.cullMode = 'front';
});
mesh(2, 1, '7 uScale width < 0, cull back\n(inside-out)', () => {}, { scale: [0.75, -0.93, 1] });
mesh(3, 1, '8 uScale width < 0,\nclockwiseFrontFace', (m) => (m.state.clockwiseFrontFace = true), {
  scale: [0.75, -0.93, 1],
});

// row 2: alpha and tint
mesh(0, 2, '9 direct, alpha 0.6\n(hidden faces blend through)', (m) => (m.alpha = 0.6));
{
  const [tx, ty] = at(1, 2);
  const it = impostors.add(geometry, texture, { scale: SCALE });
  it.setPose(tx, ty, heading);
  it.sprite.zIndex = depthKey(tx, ty, 15);
  it.sprite.alpha = 0.6;
  objects.addChild(it.sprite);
  label(1, 2, '10 impostor sprite, alpha 0.6\n(flat fade)');
}
mesh(2, 2, '11 direct, tint 0x9be8ff', (m) => (m.tint = 0x9be8ff));
{
  const [tx, ty] = at(3, 2);
  const it = impostors.add(geometry, texture, { scale: SCALE });
  it.setPose(tx, ty, heading);
  it.sprite.zIndex = depthKey(tx, ty, 15);
  it.sprite.tint = 0x9be8ff;
  objects.addChild(it.sprite);
  label(3, 2, '12 impostor sprite, tint 0x9be8ff');
}

// row 3: stale depth. A, then a tree sprite over A, then B which is drawn LAST but sits 0.5 tile behind A.
const stale = (col, fix) => {
  const [tx, ty] = at(col, 3);
  const a = makeTrainMesh(geometry, texture, { scale: SCALE });
  a.setPose(tx, ty, heading);
  a.zIndex = depthKey(tx, ty, 15);
  const tree = props.sprite('props/tree_1', tx + 0.25, ty + 0.25, 16);
  const b = makeTrainMesh(geometry, texture, { scale: SCALE });
  b.setPose(tx - 0.5, ty - 0.5, heading + 0.6);
  b.zIndex = depthKey(tx, ty, 90); // forced on top by the 2D sort (a bridge, a lift, an effect layer...)
  b.tint = 0xffd0a0;
  if (fix) {
    // depth origin from the SAME key the 2D sort uses: zIndex = (tx + ty) * 100 + layer
    for (const m of [a, b]) m.uniforms.uDepth[0] = 1 - (m.zIndex / 100) * NEAR_XY * SCREEN_DEPTH_SCALE;
  }
  objects.addChild(a, tree, b);
  label(col, 3, fix ? '14 depth origin from zIndex\n(last drawn wins, like sprites)' : '13 depth from position, drawn last\n(A and the tree cut into B)');
};
stale(0, false);
stale(1, true);
// what the 2D pipeline would show for the same three objects: impostor sprites
{
  const [tx, ty] = at(2, 3);
  const a = impostors.add(geometry, texture, { scale: SCALE });
  a.setPose(tx, ty, heading);
  a.sprite.zIndex = depthKey(tx, ty, 15);
  const tree = props.sprite('props/tree_1', tx + 0.25, ty + 0.25, 16);
  const b = impostors.add(geometry, texture, { scale: SCALE });
  b.setPose(tx - 0.5, ty - 0.5, heading + 0.6);
  b.sprite.zIndex = depthKey(tx, ty, 90);
  b.sprite.tint = 0xffd0a0;
  objects.addChild(a.sprite, tree, b.sprite);
  label(2, 3, '15 the same as impostor sprites\n(pure painter order)');
}
// engine and tender as two meshes of ONE model, cut with uClipX, sharing the depth buffer
{
  const [tx, ty] = at(3, 3);
  const cut = 0.25; // model x of the engine/tender gap, tile lengths (illustrative)
  const eng = makeTrainMesh(geometry, texture, { scale: SCALE, clipX: [cut, 1e6] });
  const ten = makeTrainMesh(geometry, texture, { scale: SCALE, clipX: [-1e6, cut] });
  eng.setPose(tx, ty, heading);
  ten.setPose(tx, ty, heading);
  ten.position.y -= 6; // lifted 6 px so the cut is visible
  eng.zIndex = ten.zIndex = depthKey(tx, ty, 15);
  objects.addChild(ten, eng);
  label(3, 3, '16 one model, two parts via uClipX\n(rear part lifted 6 px)');
}

const [cx, cy] = at(1.5, 1.5);
camera.look(cx, cy, zoom);
impostors.refresh();
for (const l of labels) {
  const w = tileToWorld(l.p[0], l.p[1]);
  const t = new Text({ text: l.text, style: { fontFamily: 'system-ui', fontSize: 12, fill: 0xffffff, stroke: { color: 0x000000, width: 3 }, lineHeight: 14 } });
  t.anchor.set(0.5, 0);
  t.position.set(world.x + w.x * zoom, world.y + w.y * zoom + 22 * zoom);
  app.stage.addChild(t);
}
app.render();
document.getElementById('label').textContent = `PITFALLS  ${model.triangles} tris  zoom ${zoom} res ${app.renderer.resolution}  heading ${heading}\n${app.glInfo.renderer}`;
window.proto = { app };
window.ready = true;
