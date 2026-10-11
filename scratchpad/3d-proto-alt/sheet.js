// Scratch: any exported parts, eight headings each, through the impostor path (and one direct mesh per row).
//   ?parts=mk48_body_r025,big_boy_engine_r025,...  ?zoom=2  ?pref=webgl|webgpu
import { Application, Sprite, Text } from 'pixi.js';
import { loadPart, PartMesh, ImpostorCache, defaultTune } from './loco3d.js';
const q = new URLSearchParams(location.search);
const names = (q.get('parts') ?? 'mk48_body_r025').split(',');
const Z = Number(q.get('zoom') ?? 2);
const app = new Application();
await app.init({ canvas: document.getElementById('c'), width: 1500, height: 180 * names.length + 20, background: '#6f8f5a', antialias: false, resolution: 1, preference: q.get('pref') ?? 'webgl', depth: true });
const cache = new ImpostorCache(app.renderer, { yawSteps: 720 });
const info = [];
let row = 0;
for (const n of names) {
  const t0 = performance.now();
  const part = await loadPart(`./export/${n}.glb`, { textureSize: 1024 });
  info.push({ part: n, tris: part.tris, verts: part.verts, loadMs: Math.round(performance.now() - t0), texDim: part.texDim, glbMB: +(part.glbBytes / 1048576).toFixed(2) });
  for (let i = 0; i < 8; i++) {
    const e = cache.get(part, (i * Math.PI) / 4 + 0.35, 0, defaultTune(), 0, Z * 2);
    const s = new Sprite(e.texture);
    s.anchor.set(e.ax, e.ay);
    s.scale.set(Z);
    s.position.set(100 + i * 160, 110 + row * 180);
    app.stage.addChild(s);
  }
  const m = new PartMesh(part);
  m.setPose(0.35, 0, defaultTune(), 1 / 64, 0);
  m.scale.set(Z);
  m.position.set(100 + 8 * 160, 110 + row * 180);
  app.stage.addChild(m);
  const label = new Text({ text: `${n}  ${part.tris} tris   (last column: direct mesh)`, style: { fill: '#fff', fontSize: 13 } });
  label.position.set(8, 4 + row * 180);
  app.stage.addChild(label);
  row++;
}
app.renderer.render(app.stage);
window.result = info;
