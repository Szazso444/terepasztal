// Scratch: a train over a hill on both tile axes and in both directions, to judge how it pitches.
//   qa.start(line, dir, consist)   line 'x' | 'y'; dir 1 (towards +axis) or -1; consist index
//   qa.frame(progress, zoom, follow)  head at `progress` tiles along its run; follow = camera on the engine
import { Game } from '/src/game.ts';
import { emptyMap } from '/src/world/mapgen.ts';
import { levelFromMap } from '/src/world/level.ts';
import { levelAt } from '/src/world/elevation.ts';
import { Train } from '/src/sim/trains.ts';
import { content } from '/src/data/content.ts';
import { tileToWorld } from '/src/engine/iso.ts';
import { findPath } from '/src/world/pathfinding.ts';

const label = document.getElementById('qa-label');
export const CONSISTS = [
  ['mk48', ['boxcar', 'boxcar']],
  ['flying_scotsman', ['steel_coach', 'pullman']],
  ['m62', ['steel_hopper', 'steel_hopper', 'steel_hopper']],
];
// each line crosses a hill: 0 0 … 1 2 2 … 2 1 0 … along it
const LINES = {
  x: { a: [36, 40], b: [70, 40], hill: [48, 36, 58, 44] },
  y: { a: [80, 36], b: [80, 70], hill: [76, 48, 84, 58] },
};

const map = emptyMap(7412, 112, 112);
for (const { hill } of Object.values(LINES))
  for (let y = hill[1]; y <= hill[3]; y++) for (let x = hill[0]; x <= hill[2]; x++) map.terrain[y * map.w + x] = 2;
const level = levelFromMap(map, 'Slope pitch');
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
// no trees round the lines: they would stand in front of the trains
for (let y = 28; y < 78; y++)
  for (let x = 28; x < 92; x++) {
    const i = y * g.map.w + x;
    if (g.map.props.has(i)) {
      g.map.props.delete(i);
      g.world.removeProps(x, y);
    }
  }
for (const [axis, L] of Object.entries(LINES)) {
  const want = axis === 'x' ? [1, 3] : [0, 2];
  L.levels = [];
  for (let x = L.a[0], y = L.a[1]; x <= L.b[0] && y <= L.b[1]; axis === 'x' ? x++ : y++) {
    let ok = false;
    for (const r of [0, 1]) {
      if (!g.builder.placeTrackKind(x, y, 'straight', r)) continue;
      const link = g.track.get(x, y).links[0];
      if (want.every((d) => link.includes(d))) {
        ok = true;
        break;
      }
      g.builder.removeTrack(x, y);
    }
    if (!ok) throw new Error(`no track at ${x},${y}`);
    L.levels.push(levelAt(g.map, x, y));
  }
}

let t = null,
  now = 100,
  uid = 87000,
  run = null;
function start(line, dir, consist) {
  if (t) g.trainRenderer.remove(t.id);
  const L = LINES[line];
  const [locoId, wagonIds] = CONSISTS[consist];
  const def = content.locomotives.find((d) => d.id === locoId);
  t = new Train([{ uid: ++uid, def, level: 0 }], 'Climber', uid);
  for (const l of t.locos) l.inCab = true;
  t.wagons = wagonIds.map((id) => ({ uid: ++uid, def: content.wagons.find((d) => d.id === id), level: 0, cargo: null, amount: 0 }));
  const from = dir > 0 ? L.a : L.b,
    to = dir > 0 ? L.b : L.a,
    // the side the head enters its tiles from
    entry = line === 'x' ? (dir > 0 ? 3 : 1) : dir > 0 ? 0 : 2,
    step = line === 'x' ? [dir, 0] : [0, dir],
    sx = from[0] + step[0] * 7,
    sy = from[1] + step[1] * 7;
  if (!t.spawnAt(g.track, sx, sy, entry)) throw new Error('spawn failed');
  const route = findPath(g.track, { x: sx, y: sy, in: entry }, (x2, y2) => x2 === to[0] && y2 === to[1], 1e6, undefined, () => true);
  if (!route) throw new Error('no route');
  g.track.resolveRoutes(route);
  t.coal = t.coalCap;
  t.water = t.waterCap;
  t.oil = t.oilCap;
  t.battery = t.batteryCap;
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
  run = { line, dir, name: def.name, centre: [(L.hill[0] + L.hill[2]) / 2, (L.hill[1] + L.hill[3]) / 2] };
  return { levels: L.levels, length: route.length, name: def.name };
}
function frame(progress, zoom = 2, follow = false) {
  let k = 0;
  while (t.pathProgress < progress && t.state === 'moving' && k++ < 40000) g.fleet.tick(1 / 60, (now += 1 / 60));
  const p = t.vehiclePoses[0];
  let cx = run.centre[0],
    cy = run.centre[1];
  if (follow && p) {
    // keep the middle of the train in view
    const q = t.vehiclePoses[Math.min(1, t.vehiclePoses.length - 1)];
    cx = (p.x + q.x) / 2;
    cy = (p.y + q.y) / 2;
    if (follow === 'engine') {
      cx = p.x;
      cy = p.y;
    }
  }
  const at = tileToWorld(cx, cy);
  const dz = follow ? g.world.railAt(cx, cy).dz : -8;
  g.camera.centerOn(at.x, at.y + dz - 10);
  g.camera.zoom = zoom;
  g.render(1, 0);
  g.app.renderer.render(g.app.stage);
  label.textContent = '';
  return { progress: t.pathProgress, state: t.state, x: p?.x, y: p?.y };
}
function settled() {
  g.render(1, 0);
  return g.world.landscape.ready;
}
window.qa = { g, start, frame, settled, lines: LINES, consists: CONSISTS };
