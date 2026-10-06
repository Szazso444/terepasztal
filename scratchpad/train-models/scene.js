// In-game review of rendered rolling stock: the real Game, AtlasRegistry, TrackGraph, Fleet and
// TrainRenderer on an isolated test world. `qa.useNew(false)` drops the frames that
// public/assets/rolling.json and wagons.json supply, so the same pose shows the current procedural
// look; nothing else changes between the two.
//   ?locos=flying_scotsman&wagons=steel_coach,steel_coach
//   &cls=high_speed lays a high-speed loop (2x2 curves and switch) for large stock
import { Game } from '/src/game.ts';
import { emptyMap } from '/src/world/mapgen.ts';
import { levelFromMap } from '/src/world/level.ts';
import { Train } from '/src/sim/trains.ts';
import { content } from '/src/data/content.ts';
import { tileToWorld } from '/src/engine/iso.ts';
import {
  Polyline,
  poseVehicle,
  vehicleSpec,
  facingOf,
  FACINGS,
  DRAWN_FACINGS,
  mirrorFacing,
  residualRotation,
  ROTATION_SHARE,
} from '/src/sim/body.ts';
import { bogieFrame } from '/src/art/frames.ts';
import { findPath } from '/src/world/pathfinding.ts';
import { depthKey } from '/src/engine/iso.ts';
import { Graphics, Sprite } from 'pixi.js';

const check = (condition, message) => {
  if (!condition) throw new Error(message);
};
const params = new URLSearchParams(location.search);
const locoIds = (params.get('locos') ?? 'rocket').split(',').filter(Boolean);
const wagonIds = (params.get('wagons') ?? 'wooden_coach').split(',').filter(Boolean);
const cls = params.get('cls') ?? 'regular';
const label = document.getElementById('qa-label');

const level = levelFromMap(emptyMap(7412, 64, 64), 'Train model review');
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

// preview-only locos that are not in src/data yet (?extra=c50,mk48): their pipeline sprites and a
// stand-in definition from renders/preview/<id>.json (make_preview.py); nothing reaches the game's data
for (const id of (params.get('extra') ?? '').split(',').filter(Boolean)) {
  const res = await fetch(`./renders/preview/${id}.json`, { cache: 'no-cache' });
  check(res.ok && res.headers.get('content-type')?.includes('json'), 'no preview atlas for ' + id);
  const pv = await res.json();
  const image = new Image();
  await new Promise((ok, fail) => {
    image.onload = ok;
    image.onerror = () => fail(new Error('preview png missing: ' + id));
    image.src = `./renders/preview/${id}.png?${Date.now()}`;
  });
  g.atlas.register({ image, frames: pv.frames, resolution: pv.resolution });
  content.locomotives.push(pv.def);
}

// frames the rendered atlases supply, so they can be taken out for the current look
const supplied = new Map();
for (const group of ['rolling', 'wagons']) {
  const res = await fetch(`/assets/${group}.json`);
  // the dev server answers a missing file with the app's index page
  if (!res.ok || !res.headers.get('content-type')?.includes('json')) continue;
  for (const key of Object.keys((await res.json()).frames))
    supplied.set(key, g.atlas.frames.get(key));
}
let usingNew = true;
function useNew(on) {
  usingNew = on;
  for (const [k, v] of supplied) {
    if (on) g.atlas.frames.set(k, v);
    else g.atlas.frames.delete(k);
  }
  render();
}

// the loop: straights both ways, four curves, a switch on the top line and a spur
const add = (x, y, kind, rot) => {
  for (const q of g.track.place(x, y, kind, rot, cls)) g.onTrackChanged(q.x, q.y);
};
const seg = (x, y, inn, out) => ({ x, y, in: inn, out });
let route = [];
let spawn = { x: 24, y: 20 };
let marks = null;
if (cls === 'regular') {
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
} else {
  // 2x2 corners anchored at their top-left tile (curve 1 top-left, 2 top-right, 3 bottom-right,
  // 0 bottom-left) and a 2x2 switch on the top line whose branch runs south as a spur
  const X0 = 16,
    X1 = 44,
    Y0 = 18,
    Y1 = 38,
    SW = 30;
  for (let x = X0 + 2; x <= X1 - 2; x++) {
    if (x !== SW && x !== SW + 1) add(x, Y0, 'straight', 1);
    add(x, Y1, 'straight', 1);
  }
  add(SW, Y0, 'switch', 1);
  for (let y = Y0 + 2; y < Y0 + 6; y++) add(SW, y, 'straight', 0);
  for (let y = Y0 + 2; y <= Y1 - 2; y++) {
    add(X0, y, 'straight', 0);
    add(X1, y, 'straight', 0);
  }
  add(X0, Y0, 'curve', 1);
  add(X1 - 1, Y0, 'curve', 2);
  add(X1 - 1, Y1 - 1, 'curve', 3);
  add(X0, Y1 - 1, 'curve', 0);
  spawn = { x: X0 + 8, y: Y0 };
}
g.builder.placeStation(spawn.x + 1, spawn.y - 1, 'station', 0);
g.builder.placeDecor(spawn.x - 1, spawn.y - 3, 'townhouse', 0);
g.people.persons = [spawn.x + 1, spawn.x + 3].map((x, i) => ({
  id: 99001 + i,
  x,
  y: spawn.y - 1,
  home: 'qa',
  outfit: i * 2,
  state: 'idle',
  timer: 99999,
  path: [],
  step: 0,
  transient: false,
  stationId: null,
}));

let t,
  now = 100,
  scenario = 'start';
const facings = new Set();
function tick() {
  g.fleet.tick(1 / 60, (now += 1 / 60));
  const s = t.vehiclePoses[0].segments[0];
  facings.add(facingOf(s.angle + (t.reversed ? Math.PI : 0)));
  for (const v of t.vehiclePoses)
    for (const p of v.segments) check([p.x, p.y, p.angle].every(Number.isFinite), 'nonfinite pose');
}
function setRoute(path) {
  t.setPath(path, g.map, g.track);
  t.trackVersion = g.track.version;
  t.nextFuelCheck = Infinity;
  t.setState('moving');
}
function reset() {
  if (t) g.trainRenderer.remove(t.id);
  const locos = locoIds.map((id, i) => ({
    uid: 80001 + i,
    def: content.locomotives.find((d) => d.id === id),
    level: 0,
  }));
  check(
    locos.every((l) => l.def),
    'unknown loco in ' + locoIds,
  );
  t = new Train(locos, 'Review', 80001);
  // high-speed track needs in-cab signalling: fitted, as a player would for this line
  if (cls === 'high_speed') for (const l of t.locos) l.inCab = true;
  t.wagons = wagonIds.map((id, i) => ({
    uid: 80101 + i,
    def: content.wagons.find((d) => d.id === id),
    level: 0,
    cargo: null,
    amount: 0,
  }));
  check(
    t.wagons.every((w) => w.def),
    'unknown wagon in ' + wagonIds,
  );
  check(t.access.classes.has(cls), `${locoIds} may not run on ${cls} track`);
  check(t.spawnAt(g.track, spawn.x, spawn.y, 3), 'spawn failed');
  if (cls !== 'regular' && !route.length) {
    // once round the loop, found by the game's own pathfinder
    route = findPath(
      g.track,
      { x: spawn.x, y: spawn.y, in: 3 },
      (x, y) => x === spawn.x - 1 && y === spawn.y,
      1e6,
      undefined,
      t.canUse,
    );
    check(route, 'no route round the high-speed loop');
    route.push(seg(spawn.x, spawn.y, 3, 1));
    g.track.resolveRoutes(route);
    // scenario marks along it: the switch, then the first three curves
    marks = { curves: [] };
    let arc = 0;
    let lastUnit = null;
    for (const s of route) {
      const piece = g.track.get(s.x, s.y);
      const len = g.track.segGeom(s.x, s.y, s.in, s.out, s.route).len ?? 1;
      const unit = piece.unit ? `${piece.unit.ax},${piece.unit.ay}` : null;
      if (piece.kind === 'switch' && marks.switch == null) marks.switch = arc;
      if (piece.kind === 'curve' && unit !== lastUnit && marks.curves.length < 3)
        marks.curves.push(arc + len);
      lastUnit = unit;
      arc += len;
    }
  }
  t.coal = t.coalCap;
  t.water = t.waterCap;
  t.oil = t.oilCap;
  t.battery = t.batteryCap;
  g.fleet.trains = [t];
  setRoute(route.map((s) => ({ ...s })));
  scenario = 'start';
  render();
}

let focus = null,
  fakes = null;
function render(zoom = g.camera.zoom) {
  const p = t?.vehiclePoses[Math.min(1, t.vehiclePoses.length - 1)];
  const at = focus ?? (p ? tileToWorld(p.x, p.y) : null);
  if (at) g.camera.centerOn(at.x, at.y - 12);
  g.camera.zoom = zoom;
  g.render(1, 0);
  // the heading sheet's stand-ins carry only poses and specs, so they bypass the fleet
  if (fakes) g.trainRenderer.update(fakes, 1);
  g.app.renderer.render(g.app.stage);
  label.textContent = `${usingNew ? 'NEW' : 'CURRENT'} · ${[...locoIds, ...wagonIds].join(' + ')} · ${scenario}`;
}
function advanceTo(arc, name) {
  scenario = name;
  let n = 0;
  while (t.pathProgress < arc && t.state === 'moving' && n < 30000) {
    tick();
    n++;
  }
  check(t.pathProgress >= arc - 0.01, `stuck at ${t.pathProgress} before ${arc} (${t.state})`);
  render();
  return pose();
}
function pose() {
  return {
    scenario,
    progress: t.pathProgress,
    reversed: t.reversed,
    vehicles: t.vehiclePoses.map((v) =>
      v.segments.map((s) => ({ x: s.x, y: s.y, angle: s.angle })),
    ),
  };
}
function reverse() {
  const before = t.vehiclePoses.map((p) => ({ x: p.x, y: p.y }));
  t.reverseConsist();
  const err = Math.max(
    ...before.map((p, i) => Math.hypot(p.x - t.vehiclePoses[i].x, p.y - t.vehiclePoses[i].y)),
  );
  const head = t.trail.at(-1).seg;
  const all = route
    .slice(0, -1)
    .reverse()
    .map((s) => ({ ...s, in: s.out, out: s.in }));
  const at = all.findIndex((s) => s.x === head.x && s.y === head.y);
  check(at >= 0, 'reversal head not on the loop');
  setRoute([...all.slice(at), ...all.slice(0, at), { ...all[at] }]);
  scenario = 'reversed';
  render();
  return { ...pose(), reversalError: err };
}

// every heading: one vehicle per heading on a straight polyline, drawn by the real TrainRenderer,
// with the game's rail centres (+-0.16 tile) drawn under it as a gauge guide
const guides = new Graphics();
g.world.track.addChild(guides);
// sheets stand on bare ground: the world's own trees and buildings are hidden meanwhile
let hidden = [];
function hideWorld() {
  if (hidden.length) return;
  hidden = g.world.objects.children.filter((c) => c.visible && c instanceof Sprite);
  for (const c of hidden) c.visible = false;
}
function showWorld() {
  for (const c of hidden) if (!c.destroyed) c.visible = true;
  hidden = [];
}
function headings(id, kind = 'loco', cols = 8) {
  hideWorld();
  const def = (kind === 'loco' ? content.locomotives : content.wagons).find((d) => d.id === id);
  check(def, 'unknown ' + kind + ' ' + id);
  const spec = vehicleSpec(def);
  const colW = 60 + spec.L * 70,
    rowH = 44 + spec.L * 34;
  const rows = Math.ceil(FACINGS / cols);
  fakes = [];
  guides.clear();
  for (let f = 0; f < FACINGS; f++) {
    const sx = (f % cols) * colW - ((cols - 1) * colW) / 2,
      sy = Math.floor(f / cols) * rowH - ((rows - 1) * rowH) / 2 + 1024;
    const cx = (sx / 32 + sy / 16) / 2,
      cy = (sy / 16 - sx / 32) / 2;
    const a = (f * 2 * Math.PI) / FACINGS,
      dx = Math.cos(a),
      dy = Math.sin(a);
    const R = spec.L;
    const pl = new Polyline([
      { x: cx - dx * R * 1.5, y: cy - dy * R * 1.5 },
      { x: cx + dx * R * 1.5, y: cy + dy * R * 1.5 },
    ]);
    const vp = poseVehicle(pl, R * 1.5 + spec.L / 2, spec);
    fakes.push({
      id: 90000 + f,
      vehicleSpecs: [spec],
      locos: kind === 'loco' ? [{ def }] : [],
      wagons: kind === 'loco' ? [] : [{ def, cargo: null, amount: 0 }],
      vehiclePoses: [vp],
      prevVehiclePoses: [vp],
      reversed: false,
    });
    for (const side of [-0.16, 0.16]) {
      const a0 = tileToWorld(cx - dx * R * 0.8 - dy * side, cy - dy * R * 0.8 + dx * side),
        a1 = tileToWorld(cx + dx * R * 0.8 - dy * side, cy + dy * R * 0.8 + dx * side);
      guides.moveTo(a0.x, a0.y).lineTo(a1.x, a1.y);
    }
  }
  guides.stroke({ width: 0.5, color: 0xd8cfb4, alpha: 0.9 });
  g.fleet.trains = [];
  focus = tileToWorld(32, 32); // the middle of the 64 x 64 review map
  scenario = `all ${FACINGS} headings`;
  // as close as the sheet allows in a 2400 x 1500 view
  const zoom = Math.min(2, 2300 / (cols * colW), 1420 / (rows * rowH));
  render(zoom);
  return { cols, rows, colW, rowH, L: spec.L, zoom };
}
// every heading of one bogie style, placed as TrainRenderer.pose places it (drawn facing or its
// mirror, the residual turn), with the rail centres under each
let bogieSprites = [];
function bogies(style, kind = 'bogie', cols = 8) {
  for (const b of bogieSprites) b.destroy();
  bogieSprites = [];
  g.fleet.trains = [];
  guides.clear();
  hideWorld();
  const colW = 90,
    rowH = 60,
    rows = Math.ceil(FACINGS / cols);
  for (let f = 0; f < FACINGS; f++) {
    const sx = (f % cols) * colW - ((cols - 1) * colW) / 2,
      sy = Math.floor(f / cols) * rowH - ((rows - 1) * rowH) / 2 + 1024;
    const cx = (sx / 32 + sy / 16) / 2,
      cy = (sy / 16 - sx / 32) / 2;
    const angle = (f * 2 * Math.PI) / FACINGS;
    const drawn = DRAWN_FACINGS.has(f);
    const fr = g.atlas.get(bogieFrame(g.atlas, style, kind, drawn ? f : mirrorFacing(f)));
    const s = new Sprite(fr.texture);
    s.anchor.set(fr.anchorX, fr.anchorY);
    s.scale.set(drawn ? 1 : -1, 1);
    s.rotation = residualRotation(angle, f) * ROTATION_SHARE;
    const w = tileToWorld(cx, cy);
    s.position.set(Math.round(w.x), Math.round(w.y));
    s.zIndex = depthKey(cx, cy, 14);
    g.world.objects.addChild(s);
    bogieSprites.push(s);
    const dx = Math.cos(angle),
      dy = Math.sin(angle);
    for (const side of [-0.16, 0.16]) {
      const a0 = tileToWorld(cx - dx * 0.6 - dy * side, cy - dy * 0.6 + dx * side),
        a1 = tileToWorld(cx + dx * 0.6 - dy * side, cy + dy * 0.6 + dx * side);
      guides.moveTo(a0.x, a0.y).lineTo(a1.x, a1.y);
    }
  }
  guides.stroke({ width: 0.5, color: 0xd8cfb4, alpha: 0.9 });
  focus = tileToWorld(32, 32); // the middle of the 64 x 64 review map
  scenario = `bogie ${style}: all ${FACINGS} headings`;
  render();
  return { style, kind, cols, rows };
}

function clearHeadings() {
  showWorld();
  for (const b of bogieSprites) b.destroy();
  bogieSprites = [];
  guides.clear();
  focus = null;
  fakes = null;
  g.fleet.trains = [t];
  render();
}

reset();
window.qa = {
  g,
  reset,
  advanceTo,
  reverse,
  useNew,
  render,
  headings,
  bogies,
  clearHeadings,
  pose,
  get supplied() {
    return [...supplied.keys()];
  },
  get facings() {
    return [...facings].sort((a, b) => a - b);
  },
  get marks() {
    return marks;
  },
};
