// Scratch: a live tuner. The owner drags sliders (length / width / height factor, yaw, pitch, roll, height
// over the rail, sideways, heading, track grade, gauge) and the locomotive is redrawn from its mesh at once:
// no Blender, no re-pack. "Stand on wheels" solves the model's own error from its wheel contacts.
//   ?mode=B|A (impostor sprite | direct mesh)  ?zoom=4  ?glb=_r025  ?pref=webgl|webgpu
import { Application, Container, Graphics, Sprite } from 'pixi.js';
import { loadPart, PartMesh, ImpostorCache, defaultTune, correction, K, TILE_M } from './loco3d.js';
import { axlesOf, solve } from './contact.js';

const q = new URLSearchParams(location.search);
const ZOOM = Number(q.get('zoom') ?? 4);
const SUFFIX = q.get('glb') ?? '';
const app = new Application();
await app.init({
  canvas: document.getElementById('c'),
  width: 1280,
  height: 720,
  background: '#6f8f5a',
  antialias: false,
  resolution: 1,
  preference: q.get('pref') ?? 'webgl',
  depth: true,
});
const gl = app.renderer.gl;
const px = new Uint8Array(4);
const sync = () => gl && gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);

const gear = (await (await fetch('/src/data/gear.json')).json()).black_five;
const info = (await (await fetch('./export/black_five.parts.json')).json()).parts;
const names = ['engine', 'tender'];
const parts = {};
for (const n of names) {
  parts[n] = await loadPart(`./export/black_five_${n}${SUFFIX}.glb`, { textureSize: 1024 });
  // the contact solver reads the full-resolution mesh: decimation moves the wheel bottoms
  parts[n].full = SUFFIX ? (await loadPart(`./export/black_five_${n}.glb`, { textureSize: 64 })).positions : parts[n].positions;
  const pi = info.find((p) => p.part === n);
  parts[n].axles = axlesOf(gear.parts.find((p) => p.part === n), pi.lo[0], pi.hi[0]);
}
const tunes = { engine: defaultTune(), tender: defaultTune() };
const state = { mode: q.get('mode') ?? 'B', heading: 20, grade: 0, gauge: 1435, part: 'engine', version: 0 };
const GAUGE_M = (mm) => (mm / 1435) * 0.32 * TILE_M; // the game's 0.32-tile gauge at standard gauge

const world = new Container();
world.scale.set(ZOOM);
world.position.set(640, 400);
app.stage.addChild(world);
const track = new Graphics();
world.addChild(track);
const layer = new Container();
layer.sortableChildren = true;
world.addChild(layer);
const meshes = Object.fromEntries(names.map((n) => [n, new PartMesh(parts[n])]));
const sprites = Object.fromEntries(names.map((n) => [n, new Sprite()]));
const cache = new ImpostorCache(app.renderer, { yawSteps: 720, pitchStep: Math.PI / 720, maxEntries: 16 });

// world metres -> logical px, the shader's own projection
const proj = (x, y, z) => [(x + y) * Math.SQRT1_2 * K, -((y - x) * 0.35355339 + z * 0.8660254) * K];
function frame() {
  const h = (state.heading * Math.PI) / 180,
    pitch = Math.atan(state.grade / 100);
  // track direction and its left normal in the mesh's world frame (tile +y is world -Y)
  const d = [Math.cos(-h), Math.sin(-h)],
    n = [-d[1], d[0]],
    rise = state.grade / 100;
  const at = (s, l) => proj(d[0] * s + n[0] * l, d[1] * s + n[1] * l, s * rise);
  const g = GAUGE_M(state.gauge);
  track.clear();
  for (let s = -11; s <= 11; s += 0.7) {
    const a = at(s, -g * 0.85),
      b = at(s, g * 0.85);
    track.moveTo(a[0], a[1]).lineTo(b[0], b[1]);
  }
  track.stroke({ width: 1.4, color: 0x5b4632 });
  for (const side of [-1, 1]) {
    const a = at(-11, (side * g) / 2),
      b = at(11, (side * g) / 2);
    track.moveTo(a[0], a[1]).lineTo(b[0], b[1]);
  }
  track.stroke({ width: 0.6, color: 0xd8d8d8 });
  // engine ahead, tender behind, a coupler gap between; lengths follow the length factor
  const len = (nm) => (parts[nm].hi[0] - parts[nm].lo[0]) * tunes[nm].sx;
  const pos = { engine: len('engine') / 2 - 1.5, tender: -len('tender') / 2 - 1.5 - 0.25 };
  layer.removeChildren();
  for (const nm of names) {
    const s = pos[nm],
      w = [d[0] * s, d[1] * s, s * rise],
      p = proj(...w),
      depth = (w[0] - w[1]) * 0.61237244 + w[2] * 0.5;
    if (state.mode === 'A') {
      const m = meshes[nm];
      m.setPose(h, pitch, tunes[nm], 1 / 64, -depth / 64);
      m.position.set(p[0], p[1]);
      m.zIndex = depth;
      layer.addChild(m);
    } else {
      const e = cache.get(parts[nm], h, pitch, tunes[nm], state.version, ZOOM * 2);
      const sp = sprites[nm];
      sp.texture = e.texture;
      sp.anchor.set(e.ax, e.ay);
      sp.position.set(p[0], p[1]);
      sp.zIndex = depth;
      layer.addChild(sp);
    }
  }
  app.renderer.render(app.stage);
}
function redraw() {
  const t0 = performance.now();
  state.version++;
  frame();
  sync();
  const ms = performance.now() - t0;
  window.lastMs = ms;
  document.getElementById('ms').textContent = `redraw ${ms.toFixed(2)} ms (${state.mode === 'A' ? 'direct mesh' : 'impostor'}, ${app.renderer.name}, ${parts.engine.tris + parts.tender.tris} triangles)`;
  return ms;
}

/** Solve one part's error from its wheel contacts and write it into its tune. Returns before / after. */
function stand(nm) {
  const P = parts[nm].full,
    t = tunes[nm];
  const opt = { yMin: 0.3, yMax: 1.1, win: 0.3 };
  const before = solve(P, parts[nm].axles, opt);
  const d2r = Math.PI / 180;
  t.yaw = before.yaw_deg * d2r;
  t.pitch0 = before.pitch_deg * d2r;
  t.roll0 = before.roll_deg * d2r;
  const C = correction(t);
  const rot = (c) => [0, 1, 2].map((r) => C[r][0] * c.x + C[r][1] * c.y + C[r][2] * c.z);
  const cs = before.detail.map(rot);
  t.lift = -cs.reduce((a, c) => a + c[2], 0) / cs.length;
  t.lateral = -cs.reduce((a, c) => a + c[1], 0) / cs.length;
  // check: the corrected mesh, solved again
  const Q = new Float32Array(P.length);
  for (let i = 0; i < P.length; i += 3) {
    const v = rot({ x: P[i], y: P[i + 1], z: P[i + 2] });
    Q[i] = v[0] + t.fore;
    Q[i + 1] = v[1] + t.lateral;
    Q[i + 2] = v[2] + t.lift;
  }
  const after = solve(Q, parts[nm].axles, opt);
  const brief = (r) => ({ pitch_deg: +r.pitch_deg.toFixed(2), roll_deg: +r.roll_deg.toFixed(2), yaw_deg: +r.yaw_deg.toFixed(2), height_mm: Math.round(r.height_m * 1000), lateral_mm: Math.round(r.lateral_m * 1000), gauge_m: +r.gauge_m.toFixed(2), ms: +r.ms.toFixed(1) });
  return { before: brief(before), after: brief(after), gauge_m: after.gauge_m };
}

// ---- controls
const SL = [
  ['sx', 'length ×', 0.5, 1.5, 0.01, (t) => t.sx, (t, v) => (t.sx = v)],
  ['sy', 'width ×', 0.5, 2, 0.01, (t) => t.sy, (t, v) => (t.sy = v)],
  ['sz', 'height ×', 0.5, 1.5, 0.01, (t) => t.sz, (t, v) => (t.sz = v)],
  ['yaw', 'yaw °', -10, 10, 0.1, (t) => (t.yaw * 180) / Math.PI, (t, v) => (t.yaw = (v * Math.PI) / 180)],
  ['pitch0', 'pitch °', -6, 6, 0.05, (t) => (t.pitch0 * 180) / Math.PI, (t, v) => (t.pitch0 = (v * Math.PI) / 180)],
  ['roll0', 'roll °', -6, 6, 0.05, (t) => (t.roll0 * 180) / Math.PI, (t, v) => (t.roll0 = (v * Math.PI) / 180)],
  ['lift', 'above rail m', -0.5, 0.5, 0.005, (t) => t.lift, (t, v) => (t.lift = v)],
  ['lateral', 'sideways m', -0.5, 0.5, 0.005, (t) => t.lateral, (t, v) => (t.lateral = v)],
];
const panel = document.getElementById('panel');
const inputs = {};
function row(id, label, min, max, step, value, on) {
  const wrap = document.createElement('label');
  const inp = Object.assign(document.createElement('input'), { type: 'range', min, max, step, value, id });
  const out = document.createElement('output');
  out.textContent = (+value).toFixed(2);
  inp.addEventListener('input', () => {
    on(+inp.value);
    out.textContent = (+inp.value).toFixed(2);
    redraw();
  });
  wrap.append(label, inp, out);
  panel.append(wrap);
  inputs[id] = { inp, out };
}
row('heading', 'heading °', 0, 360, 0.5, state.heading, (v) => (state.heading = v));
row('grade', 'track grade %', -23, 23, 0.5, state.grade, (v) => (state.grade = v));
for (const [id, label, min, max, step, get, set] of SL) row(id, label, min, max, step, get(tunes[state.part]), (v) => set(tunes[state.part], v));
function refresh() {
  for (const [id, , , , , get] of SL) {
    inputs[id].inp.value = get(tunes[state.part]);
    inputs[id].out.textContent = (+get(tunes[state.part])).toFixed(2);
  }
}
const sel = (id, opts, on) => {
  const s = document.getElementById(id);
  for (const [v, l] of opts) s.append(new Option(l, v));
  s.addEventListener('change', () => {
    on(s.value);
    refresh();
    redraw();
  });
  return s;
};
sel('part', [['engine', 'engine'], ['tender', 'tender']], (v) => (state.part = v));
sel('gauge', [['1435', 'standard 1435 mm'], ['760', 'narrow 760 mm'], ['600', 'narrow 600 mm']], (v) => (state.gauge = +v));
sel('mode', [['B', 'impostor sprite (B)'], ['A', 'direct mesh (A)']], (v) => (state.mode = v)).value = state.mode;
window.tuner = {
  state,
  tunes,
  redraw,
  /** set a slider as the owner would: value, then its input event */
  drag(id, v) {
    inputs[id].inp.value = v;
    inputs[id].inp.dispatchEvent(new Event('input'));
    return window.lastMs;
  },
  standOnWheels() {
    const out = {};
    for (const nm of names) out[nm] = stand(nm);
    refresh();
    redraw();
    return out;
  },
  /** width factor that puts the measured wheel gauge on the chosen rails */
  fitGauge() {
    const out = {};
    for (const nm of names) {
      const r = solve(parts[nm].full, parts[nm].axles, { yMin: 0.3, yMax: 1.1, win: 0.3 });
      tunes[nm].sy = GAUGE_M(state.gauge) / r.gauge_m;
      out[nm] = { measured_gauge_m: +r.gauge_m.toFixed(2), rails_m: +GAUGE_M(state.gauge).toFixed(2), width_factor: +tunes[nm].sy.toFixed(2) };
    }
    refresh();
    redraw();
    return out;
  },
  json: () => JSON.stringify(tunes, (k, v) => (typeof v === 'number' ? +v.toFixed(4) : v)),
};
document.getElementById('stand').onclick = () => (document.getElementById('log').textContent = JSON.stringify(window.tuner.standOnWheels(), null, 1));
document.getElementById('fit').onclick = () => (document.getElementById('log').textContent = JSON.stringify(window.tuner.fitGauge(), null, 1));
document.getElementById('dump').onclick = () => (document.getElementById('log').textContent = window.tuner.json());
redraw();
window.ready = true;
