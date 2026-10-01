// Spike: trains of one to six tiles through the curves of a loop, in the real game.
//   ?cls=regular      2x2 curves and switch (radius 1.5)
//   ?cls=high_speed   3x3 curves and switch (radius 2.5)
// qa.show(consistIndex, 'loco' | 'train') poses a consist so its locomotive, or the middle of the
// whole train, stands in the middle of the first curve, and centres the camera on that curve.
import { Game } from '/src/game.ts';
import { emptyMap } from '/src/world/mapgen.ts';
import { levelFromMap } from '/src/world/level.ts';
import { Train } from '/src/sim/trains.ts';
import { content } from '/src/data/content.ts';
import { tileToWorld } from '/src/engine/iso.ts';
import { CLASS_N } from '/src/world/track.ts';
import { vehicleSpec, COUPLER_GAP } from '/src/sim/body.ts';
import { findPath } from '/src/world/pathfinding.ts';

const check = (c, m) => {
  if (!c) throw new Error(m);
};
const params = new URLSearchParams(location.search);
const cls = params.get('cls') ?? 'regular';
const n = CLASS_N[cls];
const label = document.getElementById('qa-label');

const NARROW = new Set(['rocket', 'bm50', 'muki', 'c50', 'mav490', 'mk45', 'mk48', 'rezet']);
export const CONSISTS = content.locomotives
  .filter((d) => d.gear && NARROW.has(d.id) === (cls !== 'regular'))
  .map((d) => [d.id, ['boxcar', 'boxcar']]);

const level = levelFromMap(emptyMap(7412, 112, 112), 'Curve sizes');
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

// the loop: a top line with a switch and a spur, four n x n corners
const add = (x, y, kind, rot) => {
  for (const q of g.track.place(x, y, kind, rot, cls)) g.onTrackChanged(q.x, q.y);
};
const X0 = 30,
  X1 = 82,
  Y0 = 40,
  Y1 = 68,
  SW = 44;
for (let x = X0 + n; x <= X1 - n; x++) {
  if (x < SW || x >= SW + n) add(x, Y0, 'straight', 1);
  add(x, Y1, 'straight', 1);
}
add(SW, Y0, 'switch', 1);
for (let y = Y0 + n; y < Y0 + n + 4; y++) add(SW, y, 'straight', 0);
for (let y = Y0 + n; y <= Y1 - n; y++) {
  add(X0, y, 'straight', 0);
  add(X1, y, 'straight', 0);
}
add(X0, Y0, 'curve', 1);
add(X1 - n + 1, Y0, 'curve', 2);
add(X1 - n + 1, Y1 - n + 1, 'curve', 3);
add(X0, Y1 - n + 1, 'curve', 0);
// bare ground: the scattered trees would stand in front of the trains
for (const k of [...g.builder.decor.keys()]) {
  const x = k % g.map.w;
  const y = Math.floor(k / g.map.w);
  if (g.builder.removeDecor(x, y)) g.onTrackChanged?.(x, y);
}
const spawn = { x: X0 + 30, y: Y0 };
const ID = () => CONSISTS.map((c) => c[0]);
// the first curve the trains meet: the top-right corner
const corner = { x: X1 - n + 1 + (n - 1) / 2, y: Y0 + (n - 1) / 2 };

let t = null,
  now = 100,
  scenario = '';
let route = null,
  curve = null;
function build(locoId, wagonIds) {
  if (t) g.trainRenderer.remove(t.id);
  const def = content.locomotives.find((d) => d.id === locoId);
  check(def, 'unknown loco ' + locoId);
  t = new Train([{ uid: 80001, def, level: 0 }], 'Spike', 80001);
  for (const l of t.locos) l.inCab = true;
  t.wagons = wagonIds.map((id, i) => {
    const w = content.wagons.find((d) => d.id === id);
    check(w, 'unknown wagon ' + id);
    return { uid: 80101 + i, def: w, level: 0, cargo: null, amount: 0 };
  });
  check(t.spawnAt(g.track, spawn.x, spawn.y, 3), 'spawn failed');
  if (!route) {
    route = findPath(
      g.track,
      { x: spawn.x, y: spawn.y, in: 3 },
      (x, y) => x === spawn.x - 1 && y === spawn.y,
      1e6,
      undefined,
      t.canUse,
    );
    check(route, 'no route round the loop');
    route.push({ x: spawn.x, y: spawn.y, in: 3, out: 1 });
    g.track.resolveRoutes(route);
    // arc where the first curve starts and ends
    let arc = 0;
    for (const s of route) {
      const p = g.track.get(s.x, s.y);
      const len = g.track.segGeom(s.x, s.y, s.in, s.out, s.route).len;
      if (p.kind === 'curve' && !curve) curve = { start: arc, end: arc + len, unit: p.unit };
      else if (curve && !curve.done && p.kind === 'curve' && p.unit.ax === curve.unit.ax && p.unit.ay === curve.unit.ay)
        curve.end = arc + len;
      else if (curve && p.kind !== 'curve') curve.done = true;
      arc += len;
    }
  }
  t.coal = t.coalCap;
  t.water = t.waterCap;
  t.oil = t.oilCap;
  t.battery = t.batteryCap;
  // the test loop has no wire: electric engines run as if it had
  t.fuelProblem = () => null;
  t.wireCeiling = () => null;
  t.refreshModes = () => {
    for (const l of t.locos) l.engaged = true;
  };
  g.fleet.trains = [t];
  t.setPath(route.map((s) => ({ ...s })), g.map, g.track);
  t.trackVersion = g.track.version;
  t.nextFuelCheck = Infinity;
  t.setState('moving');
}
function tick() {
  g.fleet.tick(1 / 60, (now += 1 / 60));
}
function render(zoom) {
  const at = tileToWorld(corner.x, corner.y);
  g.camera.centerOn(at.x, at.y - 12);
  g.camera.zoom = zoom;
  g.render(1, 0);
  g.app.renderer.render(g.app.stage);
  label.textContent = scenario;
}
function lengths() {
  const specs = [...t.locos.map((l) => vehicleSpec(l.def)), ...t.wagons.map((w) => vehicleSpec(w.def))];
  const loco = specs[0].L;
  const train = specs.reduce((a, s) => a + s.L, 0) + COUPLER_GAP * (specs.length - 1);
  return { loco, train, specs: specs.map((s) => s.L) };
}
function show(i, what, zoom = 1.6) {
  const [locoId, wagonIds] = CONSISTS[i];
  build(locoId, wagonIds);
  const L = lengths();
  const mid = (curve.start + curve.end) / 2;
  // the path starts at the head: progress is how far the head has run
  const target =
    what === 'straight' ? curve.start - 2.5 : mid + (what === 'loco' ? L.loco / 2 : L.train / 2);
  let k = 0;
  while (t.pathProgress < target && t.state === 'moving' && k++ < 40000) tick();
  const def = content.locomotives.find((d) => d.id === locoId);
  scenario = `${cls === 'regular' ? '2×2 curve' : '1×1 curve'} · ${def.name} · ${L.loco} tiles`;
  if (what === 'straight') {
    const p = t.vehiclePoses[0];
    const at = tileToWorld(p.x, p.y);
    g.camera.centerOn(at.x, at.y - 12);
    g.camera.zoom = zoom;
    g.render(1, 0);
    g.app.renderer.render(g.app.stage);
    label.textContent = scenario;
  } else render(zoom);
  return { progress: t.pathProgress, target, state: t.state, lengths: L, curve };
}
function overview(zoom = 0.75) {
  if (t) g.trainRenderer.remove(t.id);
  g.fleet.trains = [];
  const at = tileToWorld((X0 + X1) / 2, (Y0 + Y1) / 2);
  g.camera.centerOn(at.x, at.y);
  g.camera.zoom = zoom;
  g.render(1, 0);
  g.app.renderer.render(g.app.stage);
  scenario = `${cls === 'regular' ? 'Regular: 2×2 curves and switch' : 'High speed: 3×3 curves and switch'}`;
  label.textContent = scenario;
}
// animation: prepare a consist, then step its head along the path frame by frame
function prepare(i) {
  const [locoId, wagonIds] = CONSISTS[i];
  build(locoId, wagonIds);
  const def = content.locomotives.find((d) => d.id === locoId);
  return { lengths: lengths(), curve, name: def.name, wagons: wagonIds.length };
}
function runTo(arc, zoom, text) {
  let k = 0;
  while (t.pathProgress < arc && t.state === 'moving' && k++ < 40000) tick();
  scenario = text;
  render(zoom);
  return t.pathProgress;
}
window.qa = { g, show, overview, prepare, runTo, consists: CONSISTS, ids: ID(), cls, n };
