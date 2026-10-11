// Scratch: UI thumbnails without a sprite atlas. The DOM screens want an <img> data URL of a locomotive at a
// facing (src/ui/spritePreview.ts); here each part's mesh is rendered into one texture and read back.
import { Application, Container, RenderTexture, RenderTarget } from 'pixi.js';
import { loadPart, PartMesh, defaultTune, K } from './loco3d.js';
const q = new URLSearchParams(location.search);
const app = new Application();
await app.init({ canvas: document.getElementById('c'), width: 64, height: 64, antialias: false, resolution: 1, preference: q.get('pref') ?? 'webgl', depth: true });
const t0 = performance.now();
const parts = [await loadPart('./export/black_five_engine_r025.glb', { textureSize: 1024 }), await loadPart('./export/black_five_tender_r025.glb', { textureSize: 1024 })];
const loadMs = performance.now() - t0;
const meshes = parts.map((p) => new PartMesh(p));
const holder = new Container();
holder.addChild(...meshes);
const W = 240, H = 150, SCALE = 3;
const rt = RenderTexture.create({ width: W, height: H, resolution: SCALE, antialias: false });
const target = new RenderTarget({ colorTextures: [rt.source], depth: true });
const proj = (x, y, z) => [(x + y) * Math.SQRT1_2 * K, -((y - x) * 0.35355339 + z * 0.8660254) * K];
async function thumb(headingDeg) {
  const h = (headingDeg * Math.PI) / 180, d = [Math.cos(-h), Math.sin(-h)];
  const len = parts.map((p) => p.hi[0] - p.lo[0]);
  const along = [len[0] / 2 - 1.5, -len[1] / 2 - 1.75];
  meshes.forEach((m, i) => {
    const w = [d[0] * along[i], d[1] * along[i], 0], p = proj(...w);
    m.setPose(h, 0, defaultTune(), 1 / 64, -((w[0] - w[1]) * 0.61237244) / 64);
    m.position.set(W / 2 + p[0], H * 0.62 + p[1]);
  });
  app.renderer.render({ container: holder, target, clear: true, clearColor: [0, 0, 0, 0] });
  return app.renderer.extract.base64(rt);
}
await thumb(0);
const times = [];
let url;
for (let f = 0; f < 48; f++) {
  const t = performance.now();
  url = await thumb(f * 7.5);
  times.push(performance.now() - t);
}
times.sort((a, b) => a - b);
const img = document.getElementById('img');
img.src = await thumb(22.5);
window.result = { renderer: app.renderer.name, loadMs: +loadMs.toFixed(0), thumbPx: [W * SCALE, H * SCALE], medianMs: +times[24].toFixed(2), worstMs: +times[47].toFixed(2), dataUrlBytes: url.length };
