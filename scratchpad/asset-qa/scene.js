import { Game } from '/src/game.ts';
import { emptyMap } from '/src/world/mapgen.ts';
import { levelFromMap } from '/src/world/level.ts';
import { Train } from '/src/sim/trains.ts';
import { content } from '/src/data/content.ts';
import { tileToWorld } from '/src/engine/iso.ts';
import { facingOf, mirrorFacing, DRAWN_FACINGS, COUPLER_GAP } from '/src/sim/body.ts';
import { locoFrame } from '/src/art/frames.ts';

const check = (condition, message) => {
  if (!condition) throw new Error(message);
};
const level = levelFromMap(emptyMap(7412, 64, 64), 'Asset QA');
const g = new Game({ kind: 'level', seed: 7412, level });
window.game = g;
await g.init();
g.loop.stop();
g.app.ticker.stop();
g.closeMenus();
g.settings.autosave = false;
g.settings.weather = false;
g.settings.dayNight = false;
g.settings.smoke = false;
g.clock.setSpeed(0);
g.builder.free = true;
for (let i = 0; i < g.regions.unlocked.length; i++) g.regions.own(i);
g.world.rebuildFog();
const baseline = new Map();
const prefix = 'rolling/loco_steam_early_small_yellow_body_f';
for (const k of g.atlas.keys(prefix)) baseline.set(k, g.atlas.get(k));
await g.atlas.load([
  {
    name: '../../scratchpad/asset-qa/candidate/rolling',
    generate: () => ({ image: document.createElement('canvas'), frames: {} }),
  },
]);
const candidate = new Map(g.atlas.keys(prefix).map((k) => [k, g.atlas.get(k)]));
check(candidate.size === 25, 'Candidate needs exactly 25 drawn facings');
check(
  candidate.get(prefix + '0').texture !== baseline.get(prefix + '0').texture,
  'Candidate atlas did not replace Rocket texture',
);

const route = [];
const add = (x, y, kind, rot) => {
  for (const q of g.track.place(x, y, kind, rot, 'regular')) g.onTrackChanged(q.x, q.y);
};
for (let x = 21; x < 30; x++) {
  add(x, 20, x === 26 ? 'switch' : 'straight', 1);
  add(x, 30, 'straight', 1);
}
for (let y = 21; y < 30; y++) {
  add(20, y, 'straight', 0);
  add(30, y, 'straight', 0);
}
add(20, 20, 'curve', 1);
add(30, 20, 'switch', 2);
add(30, 30, 'curve', 3);
add(20, 30, 'curve', 0);
for (let y = 17; y < 20; y++) add(30, y, 'straight', 0);
for (let y = 21; y < 24; y++) add(26, y, 'straight', 0);
const seg = (x, y, inn, out) => ({ x, y, in: inn, out });
for (let x = 24; x < 30; x++) route.push(seg(x, 20, 3, 1));
route.push(seg(30, 20, 3, 2));
for (let y = 21; y < 30; y++) route.push(seg(30, y, 0, 2));
route.push(seg(30, 30, 0, 3));
for (let x = 29; x > 20; x--) route.push(seg(x, 30, 1, 3));
route.push(seg(20, 30, 1, 0));
for (let y = 29; y > 20; y--) route.push(seg(20, y, 2, 0));
route.push(seg(20, 20, 2, 1));
for (let x = 21; x <= 24; x++) route.push(seg(x, 20, 3, 1));
g.track.resolveRoutes(route);
for (const s of route)
  check(g.track.segGeom(s.x, s.y, s.in, s.out, s.route).pts.length > 1, 'Invalid route geometry');
const placements = [];
for (const [x, y, id, kind] of [
  [25, 19, 'station', 'station'],
  [23, 17, 'townhouse', 'decor'],
  [28, 18, 'water_tower', 'decor'],
]) {
  const placed =
    kind === 'station' ? g.builder.placeStation(x, y, id, 0) : g.builder.placeDecor(x, y, id, 0);
  placements.push({ id, placed: !!placed });
}
g.people.persons = [
  {
    id: 99001,
    x: 25,
    y: 19,
    home: 'qa',
    outfit: 0,
    state: 'idle',
    timer: 99999,
    path: [],
    step: 0,
    transient: false,
    stationId: null,
  },
  {
    id: 99002,
    x: 27,
    y: 19,
    home: 'qa',
    outfit: 2,
    state: 'idle',
    timer: 99999,
    path: [],
    step: 0,
    transient: false,
    stationId: null,
  },
];
let t,
  now = 100,
  usingCandidate = true,
  playing = false,
  last = 0,
  scenario = 'initial',
  reversalError = 0;
const status = document.getElementById('qa-status');
const samples = [];
const coverage = { ticks: 0, facings: new Set(), trackKinds: new Set(), reversedTicks: 0 };
function tick() {
  g.fleet.tick(1 / 60, (now += 1 / 60));
  coverage.ticks++;
  if (t.reversed) coverage.reversedTicks++;
  const s = t.vehiclePoses[0].segments[0];
  const f = facingOf(s.angle + (t.reversed ? Math.PI : 0));
  const firstVisit = !coverage.facings.has(f);
  coverage.facings.add(f);
  const d = DRAWN_FACINGS.has(f) ? f : mirrorFacing(f);
  check(candidate.has(prefix + d), 'Missing candidate facing ' + d);
  const h = t.headTile;
  if (h) coverage.trackKinds.add(g.track.get(h.x, h.y)?.kind);
  for (const v of t.vehiclePoses)
    for (const p of v.segments)
      check([p.x, p.y, p.angle].every(Number.isFinite), 'Nonfinite simulated pose');
  if (firstVisit) {
    render();
    snapshot();
  }
}
function setRoute(path) {
  t.setPath(path, g.map, g.track);
  t.trackVersion = g.track.version;
  t.nextFuelCheck = Infinity;
  t.setState('moving');
}
function reset() {
  if (t) g.trainRenderer.remove(t.id);
  t = new Train(
    [{ uid: 80001, def: content.locomotives.find((d) => d.id === 'rocket'), level: 0 }],
    'QA Rocket',
    80001,
  );
  t.wagons = [
    {
      uid: 80002,
      def: content.wagons.find((d) => d.id === 'wooden_coach'),
      level: 0,
      cargo: null,
      amount: 0,
    },
  ];
  check(t.spawnAt(g.track, 24, 20, 3), 'Train spawn failed');
  t.coal = t.coalCap;
  t.water = t.waterCap;
  t.oil = t.oilCap;
  t.battery = t.batteryCap;
  g.fleet.trains = [t];
  setRoute(route.map((s) => ({ ...s })));
  scenario = 'initial';
  samples.length = 0;
  render();
}
function render() {
  const p = t?.vehiclePoses[0];
  if (p) {
    const w = tileToWorld(p.x, p.y);
    g.camera.centerOn(w.x, w.y - 15);
  }
  g.camera.zoom = Number(document.getElementById('zoom').value);
  g.render(1, 0);
  g.app.renderer.render(g.app.stage);
  status.textContent =
    (usingCandidate ? 'Candidate' : 'Procedural baseline') +
    ' · ' +
    scenario +
    ' · ' +
    (t?.state ?? 'loading');
  document.getElementById('qa-details').textContent =
    'Frame ' +
    (p ? facingOf(p.segments[0].angle + (t.reversed ? Math.PI : 0)) : '—') +
    ' / 48 · ' +
    (t?.pathProgress ?? 0).toFixed(2) +
    ' tiles along route · wheel-fit review pending';
}
function snapshot() {
  const p = t.vehiclePoses[0],
    s = p.segments[0],
    f = facingOf(s.angle + (t.reversed ? Math.PI : 0)),
    drawn = DRAWN_FACINGS.has(f) ? f : mirrorFacing(f),
    key = locoFrame(g.atlas, t.locoDef, drawn, 'body');
  const sprites = g.trainRenderer.cars.get(t.id),
    sp = sprites?.[0]?.parts[0];
  check(sp, 'Runtime did not create train sprite');
  check(sp.texture === g.atlas.get(key).texture, 'Renderer selected wrong texture');
  check(
    sp.texture === (usingCandidate ? candidate : baseline).get(key).texture,
    'Wrong candidate/baseline texture',
  );
  check(Math.abs(sp.scale.x) === 1 && sp.scale.y === 1, 'Vehicle sprite stretched');
  if (usingCandidate) {
    check(sp.texture.orig.width === 96 && sp.texture.orig.height === 96, 'Wrong atlas resolution');
    check(
      Math.abs(sp.anchor.x - 0.5) < 1e-6 && Math.abs(sp.anchor.y - 0.72) < 1e-6,
      'Wrong ground anchor',
    );
  }
  for (const v of t.vehiclePoses)
    for (const part of v.segments)
      check([part.x, part.y, part.angle].every(Number.isFinite), 'Nonfinite train pose');
  return {
    scenario,
    progress: t.pathProgress,
    state: t.state,
    x: p.x,
    y: p.y,
    angle: s.angle,
    facing: f,
    drawn,
    key,
    reversed: t.reversed,
    spriteScale: [sp.scale.x, sp.scale.y],
    textureSize: [sp.texture.orig.width, sp.texture.orig.height],
    anchor: [sp.anchor.x, sp.anchor.y],
    rotation: sp.rotation,
    vehicleCount: t.vehiclePoses.length,
    rigidLengths: t.vehicleSpecs.map((v) => v.L),
    couplerGap: COUPLER_GAP,
  };
}
function step(count = 1) {
  for (let i = 0; i < count; i++) {
    tick();
    if (t.state !== 'moving') break;
  }
  render();
  return snapshot();
}
function advanceTo(arc, label) {
  scenario = label;
  let count = 0;
  while (t.pathProgress < arc && t.state === 'moving' && count < 30000) {
    tick();
    count++;
  }
  render();
  check(
    t.pathProgress >= arc - 0.01,
    JSON.stringify({
      wanted: arc,
      actual: t.pathProgress,
      state: t.state,
      speed: t.speed,
      blocked: t.blocked,
      claimLimit: t.claimLimit,
    }),
  );
  const r = { ...snapshot(), ticks: count };
  samples.push(r);
  return r;
}
function reverse() {
  const before = t.vehiclePoses.map((p) => ({ x: p.x, y: p.y }));
  t.reverseConsist();
  const after = t.vehiclePoses;
  reversalError = Math.max(...before.map((p, i) => Math.hypot(p.x - after[i].x, p.y - after[i].y)));
  const head = t.trail.at(-1).seg;
  const all = route
    .slice(0, -1)
    .reverse()
    .map((s) => ({ ...s, in: s.out, out: s.in }));
  let at = all.findIndex((s) => s.x === head.x && s.y === head.y);
  check(at >= 0, 'Reversal head not on loop');
  const rotated = [...all.slice(at), ...all.slice(0, at), { ...all[at] }];
  setRoute(rotated);
  scenario = 'reversed';
  render();
  return { ...snapshot(), reversalError };
}
function toggle() {
  usingCandidate = !usingCandidate;
  for (const [k, v] of usingCandidate ? candidate : baseline) g.atlas.frames.set(k, v);
  document.getElementById('asset').textContent = usingCandidate
    ? 'Show procedural baseline'
    : 'Show candidate';
  render();
  return snapshot();
}
document.getElementById('asset').onclick = toggle;
document.getElementById('reset').onclick = reset;
document.getElementById('reverse').onclick = reverse;
document.getElementById('zoom').onchange = render;
document.getElementById('run').onclick = () => {
  playing = !playing;
  document.getElementById('run').textContent = playing ? 'Pause' : 'Run';
};
function animate(ms) {
  if (playing && ms - last > 1000 / 30) {
    step(2);
    last = ms;
  }
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
reset();
window.qa = {
  g,
  reset,
  step,
  advanceTo,
  reverse,
  toggle,
  snapshot,
  render,
  get train() {
    return t;
  },
  get samples() {
    return samples;
  },
  get coverage() {
    return {
      ...coverage,
      facings: [...coverage.facings].sort((a, b) => a - b),
      trackKinds: [...coverage.trackKinds],
    };
  },
  placements,
  baselineKeys: baseline.size,
  candidateKeys: candidate.size,
};
