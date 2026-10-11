// Scratch: cost per frame of N locomotive parts drawn three ways.
//   ?mode=sprite|A|B  ?n=60  ?glb=_r025 (decimation suffix)  ?zoom=1  ?dpr=1  ?turn=0.5 (share of parts on a curve)
//   ?rate=1.5 (degrees of heading per frame for those)  ?frames=90  ?tex=1024  ?yaw=256 (B: heading steps)  ?ss=2
import { Application, Sprite, Container, Texture, Rectangle, Assets } from 'pixi.js';
import { loadPart, PartMesh, ImpostorCache, defaultTune } from './loco3d.js';

const q = new URLSearchParams(location.search);
const num = (k, d) => (q.has(k) ? Number(q.get(k)) : d);
const MODE = q.get('mode') ?? 'B',
  N = num('n', 60),
  ZOOM = num('zoom', 1),
  DPR = num('dpr', 1),
  TURN = num('turn', 0.5),
  RATE = (num('rate', 1.5) * Math.PI) / 180,
  FRAMES = num('frames', 90),
  SS = num('ss', 2);
const app = new Application();
await app.init({
  canvas: document.getElementById('c'),
  width: 1280,
  height: 800,
  background: '#6f8f5a',
  antialias: q.get('aa') === '1',
  resolution: DPR,
  preference: q.get('pref') ?? 'webgl',
  depth: true,
});
window.app = app;
const gl = app.renderer.gl;
let draws = 0,
  tris = 0;
if (gl)
  for (const fn of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
    const orig = gl[fn].bind(gl);
    gl[fn] = (...a) => {
      draws++;
      tris += (fn.startsWith('drawElements') ? a[1] : a[2]) / 3;
      return orig(...a);
    };
  }
const world = new Container();
world.scale.set(ZOOM);
app.stage.addChild(world);

const suffix = q.get('glb') ?? '';
const parts =
  MODE === 'sprite'
    ? []
    : [
        await loadPart(`./export/black_five_engine${suffix}.glb`, { textureSize: num('tex', 1024) }),
        await loadPart(`./export/black_five_tender${suffix}.glb`, { textureSize: num('tex', 1024) }),
      ];
// positions on a grid, a heading each, some of them turning
const cols = Math.ceil(Math.sqrt(N * 1.6)),
  items = [];
for (let i = 0; i < N; i++) {
  const x = ((i % cols) + 0.5) * (1280 / ZOOM / cols),
    y = (Math.floor(i / cols) + 0.7) * (800 / ZOOM / Math.ceil(N / cols));
  items.push({ x, y, heading: (i * 0.731) % (Math.PI * 2), turning: i / N < TURN, part: i % 2 });
}
const tune = defaultTune();
let update;
let cache = null;
if (MODE === 'sprite') {
  // today's path: frames from the packed atlas, picked by facing, mirrored, residual rotation
  const { facingOf, DRAWN_FACINGS, mirrorFacing, residualRotation, ROTATION_SHARE } = await import('/src/sim/body.ts');
  const json = await (await fetch('/assets/rolling-B.json')).json();
  const base = await Assets.load('/assets/rolling-B.png');
  const frames = new Map();
  for (const [k, f] of Object.entries(json.frames))
    if (k.includes('black_five'))
      frames.set(k, {
        texture: new Texture({ source: base.source, frame: new Rectangle(f.x, f.y, f.w, f.h), orig: new Rectangle(0, 0, f.w / 2, f.h / 2) }),
        ax: f.ax / f.w,
        ay: f.ay / f.h,
      });
  for (const it of items) {
    it.s = new Sprite();
    world.addChild(it.s);
  }
  update = () => {
    for (const it of items) {
      const f = facingOf(it.heading),
        drawn = DRAWN_FACINGS.has(f);
      const fr = frames.get(`rolling/loco_black_five_${it.part ? 'tender' : 'engine'}_f${drawn ? f : mirrorFacing(f)}`);
      it.s.texture = fr.texture;
      it.s.anchor.set(fr.ax, fr.ay);
      it.s.scale.set(drawn ? 1 : -1, 1);
      it.s.rotation = residualRotation(it.heading, f) * ROTATION_SHARE;
      it.s.position.set(it.x, it.y);
    }
  };
} else if (MODE === 'A') {
  for (const it of items) {
    it.m = new PartMesh(parts[it.part]);
    it.m.position.set(it.x, it.y);
    world.addChild(it.m);
  }
  // one depth range for the whole scene: world depth of the anchor (screen y is depth on the ground plane)
  update = () => {
    for (const it of items) it.m.setPose(it.heading, 0, tune, 1 / 4096, -it.y / 4096);
  };
} else {
  cache = new ImpostorCache(app.renderer, { yawSteps: num('yaw', 256), maxEntries: num('max', 512) });
  const scale = Math.min(4, Math.ceil(ZOOM * DPR)) * SS;
  for (const it of items) {
    // ?distinct=1: every item is its own model (own cache entries), as 37 different locomotives would be
    if (q.get('distinct') === '1') it.own = Object.assign(Object.create(parts[it.part]), { url: parts[it.part].url + '#' + items.indexOf(it) });
    it.s = new Sprite();
    it.s.position.set(it.x, it.y);
    world.addChild(it.s);
  }
  update = () => {
    for (const it of items) {
      const e = cache.get(it.own ?? parts[it.part], it.heading, 0, tune, 0, scale);
      it.s.texture = e.texture;
      it.s.anchor.set(e.ax, e.ay);
    }
  };
}
const px = new Uint8Array(4);
const device = app.renderer.gpu?.device;
const sync = () => {
  if (gl) gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
};
const syncAsync = async () => {
  if (device) await device.queue.onSubmittedWorkDone();
};
// warm up (shader compile, uploads), then measure
for (let i = 0; i < 5; i++) {
  update();
  app.renderer.render(app.stage);
  sync();
}
let cpu = 0,
  total = 0,
  worst = 0;
draws = 0;
tris = 0;
const r0 = cache?.renders ?? 0;
for (let f = 0; f < FRAMES; f++) {
  for (const it of items) if (it.turning) it.heading += RATE;
  const t0 = performance.now();
  update();
  app.renderer.render(app.stage);
  const t1 = performance.now();
  sync();
  if (device) await syncAsync();
  const t2 = performance.now();
  cpu += t1 - t0;
  total += t2 - t0;
  worst = Math.max(worst, t2 - t0);
}
const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
window.result = {
  mode: MODE,
  n: N,
  zoom: ZOOM,
  dpr: DPR,
  turn: TURN,
  renderer: app.renderer.name,
  gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : device ? 'webgpu ' + (app.renderer.gpu.adapter?.info?.description || app.renderer.gpu.adapter?.info?.vendor || '') : '?',
  trisPerPart: parts.map((p) => p.tris),
  cpuMs: +(cpu / FRAMES).toFixed(3),
  totalMs: +(total / FRAMES).toFixed(3),
  worstMs: +worst.toFixed(2),
  drawsPerFrame: +(draws / FRAMES).toFixed(1),
  trisPerFrame: Math.round(tris / FRAMES),
  impostorRendersPerFrame: cache ? +((cache.renders - r0) / FRAMES).toFixed(2) : 0,
  cacheEntries: cache?.map.size ?? 0,
  cacheMB: cache ? +((cache.texels * 4) / 1048576).toFixed(1) : 0,
};
document.getElementById('out').textContent = JSON.stringify(window.result);
