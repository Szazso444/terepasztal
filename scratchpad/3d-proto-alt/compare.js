// Scratch: does a mesh drawn by Pixi at runtime reproduce the pipeline's Blender sprite?
// For every drawn facing of a part: the pipeline sprite, the runtime render into the same canvas with the
// same anchor, and numbers (alpha IoU, centroid offset, colour difference).
//   ?part=engine|tender  ?glb=<suffix e.g. _r025>  ?pref=webgl|webgpu  ?ss=2 (supersample)  ?tex=512
import { Application, Sprite, Container, RenderTexture, RenderTarget, Texture, Assets, Text } from 'pixi.js';
import { loadPart, PartMesh, defaultTune } from './loco3d.js';

const q = new URLSearchParams(location.search);
const PART = q.get('part') ?? 'engine';
const SUFFIX = q.get('glb') ?? '';
const SS = Number(q.get('ss') ?? 2);
const TEX = Number(q.get('tex') ?? 0);
const app = new Application();
await app.init({
  canvas: document.getElementById('c'),
  width: 1700,
  height: 900,
  background: '#6f8f5a',
  antialias: false,
  resolution: 1,
  preference: q.get('pref') ?? 'webgl',
  depth: q.get('depth') !== '0',
});
window.app = app;
const meta = await (await fetch('./ref/black_five.meta.json')).json();
const rd = meta.renders.find((r) => r.part === PART);
const RES = meta.resolution; // texels per logical px in the reference
const [CW, CH] = rd.canvas_px,
  [AX, AY] = rd.anchor_px;
const part = await loadPart(`./export/black_five_${PART}${SUFFIX}.glb`, { textureSize: TEX, mipmaps: q.get('mip') !== '0' });
const mesh = new PartMesh(part);
const holder = new Container();
holder.addChild(mesh);

// the runtime render of one facing into the reference's own canvas: CW x CH physical px, anchor at AX, AY
function renderFacing(heading, pitch = 0, tune = defaultTune()) {
  const rt = RenderTexture.create({ width: CW / RES, height: CH / RES, resolution: RES * SS, scaleMode: 'linear' });
  const target = new RenderTarget({ colorTextures: [rt.source], depth: true });
  mesh.setPose(heading, pitch, tune);
  mesh.position.set(AX / RES, AY / RES);
  app.renderer.render({ container: holder, target, clear: true, clearColor: [0, 0, 0, 0] });
  return rt;
}
// physical-resolution RGBA of a texture, box-filtered down from the supersampled render
function pixelsAt(tex, w, h) {
  const src = app.renderer.extract.canvas({ target: tex, resolution: 1 });
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, src.width, src.height, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h).data;
}
function stats(a, b, w, h) {
  let inter = 0,
    uni = 0,
    dsum = 0,
    n = 0;
  const ca = [0, 0, 0],
    cb = [0, 0, 0];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const A = a[i + 3] > 127,
        Bb = b[i + 3] > 127;
      if (A) (ca[0] += x), (ca[1] += y), ca[2]++;
      if (Bb) (cb[0] += x), (cb[1] += y), cb[2]++;
      if (A && Bb) {
        inter++;
        dsum += (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3;
        n++;
      }
      if (A || Bb) uni++;
    }
  return {
    iou: +(inter / uni).toFixed(4),
    dx: +(cb[0] / cb[2] - ca[0] / ca[2]).toFixed(2),
    dy: +(cb[1] / cb[2] - ca[1] / ca[2]).toFixed(2),
    meanAbs: +(dsum / n).toFixed(2),
  };
}

const rows = [];
const sheet = new Container();
app.stage.addChild(sheet);
const SCALE = Number(q.get('show') ?? 1.5);
const show = (q.get('dirs') ?? '0,3,6,9,12,15,18,21,24').split(',').map(Number);
let col = 0;
for (const d of rd.dirs) {
  const heading = (d.facing * 7.5 * Math.PI) / 180;
  const refTex = await Assets.load(`./ref/black_five_${PART}_d${d.index}.png`);
  refTex.source.scaleMode = 'linear';
  const rt = renderFacing(heading);
  const refPx = pixelsAt(refTex, CW, CH);
  const ourPx = pixelsAt(rt, CW, CH);
  rows.push({ dir: d.index, facing: d.facing, ...stats(refPx, ourPx, CW, CH) });
  if (show.includes(d.index)) {
    const x = 10 + col * (CW / RES + 6) * SCALE;
    const a = new Sprite(refTex);
    a.scale.set(SCALE / RES);
    a.position.set(x, 24);
    const b = new Sprite(rt);
    b.scale.set(SCALE);
    b.position.set(x, 24 + (CH / RES + 8) * SCALE);
    // 4x zoom rows, nearest for the eye
    sheet.addChild(a, b);
    col++;
  }
}
const label = new Text({
  text: `top: pipeline sprite (Blender, ${RES} texel/px)   bottom: runtime mesh (${part.tris} tris, tex ${part.texDim}, ss ${SS}, ${app.renderer.name})`,
  style: { fill: '#fff', fontSize: 14 },
});
label.position.set(10, 2);
sheet.addChild(label);
// direct (mode A) row: the same mesh drawn straight into the canvas, at zoom 1, 2 and 4
const direct = new Container();
app.stage.addChild(direct);
let dx = 60;
for (const z of [1, 2, 4]) {
  const m = new PartMesh(part);
  m.setPose((3 * 7.5 * Math.PI) / 180, 0);
  m.scale.set(z);
  m.position.set(dx + (CW / RES) * z * 0.5, 620 + (z === 4 ? 150 : 60));
  direct.addChild(m);
  const e = renderFacing((3 * 7.5 * Math.PI) / 180);
  const s = new Sprite(e);
  s.anchor.set(AX / CW, AY / CH);
  s.scale.set(z);
  s.position.set(dx + (CW / RES) * z * 1.6, 620 + (z === 4 ? 150 : 60));
  direct.addChild(s);
  dx += (CW / RES) * z * 2.4 + 20;
}
app.renderer.render(app.stage);
const mean = (k) => +(rows.reduce((a, r) => a + r[k], 0) / rows.length).toFixed(3);
window.result = {
  part: PART,
  renderer: app.renderer.name,
  tris: part.tris,
  verts: part.verts,
  texDim: part.texDim,
  rows,
  mean: { iou: mean('iou'), dx: mean('dx'), dy: mean('dy'), meanAbs: mean('meanAbs') },
  worst: { iou: Math.min(...rows.map((r) => r.iou)), meanAbs: Math.max(...rows.map((r) => r.meanAbs)) },
};
document.getElementById('out').textContent = JSON.stringify(window.result.mean) + ' worst ' + JSON.stringify(window.result.worst);
