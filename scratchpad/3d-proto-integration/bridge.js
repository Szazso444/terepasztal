// Scratch: a train crossing a bridge over a valley, to see how the near railing (a structure in
// the object layer at depth layer 35) orders against the vehicle parts (layer 15) as they pass.
//   qa.frame(progress, zoom)   qa.order()   the z order of railings and train parts
import { Game } from '/src/game.ts';
import { emptyMap } from '/src/world/mapgen.ts';
import { levelFromMap } from '/src/world/level.ts';
import { levelAt } from '/src/world/elevation.ts';
import { Train } from '/src/sim/trains.ts';
import { content } from '/src/data/content.ts';
import { tileToWorld } from '/src/engine/iso.ts';
import { findPath } from '/src/world/pathfinding.ts';

const params = new URLSearchParams(location.search);
const LOCO = params.get('loco') ?? 'black_five';
const AXIS = params.get('axis') ?? 'x';
const map = emptyMap(7412, 112, 112);
const X0 = 36, Y = 40;
// hills either side of a one-tile valley at i = 8
for (let i = 2; i <= 14; i++) if (i !== 8) for (let d = -2; d <= 2; d++) map.terrain[AXIS === 'x' ? (Y + d) * map.w + X0 + i : (X0 + i) * map.w + Y + d] = 2;
const level = levelFromMap(map, '3D bridge');
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
const SPRITE_SET = params.get('sprites');
const PIPE = SPRITE_SET ? (await (await fetch('/assets/rolling-' + SPRITE_SET + '.json')).json()).frames : {};
if (SPRITE_SET)
  for (const d of content.locomotives)
    if (d.gear && d.gear.parts.every((p) => `rolling/loco_${d.id}_${p.part}_f0` in PIPE)) d.spriteGear = true;
for (let y = 28; y < 60; y++)
  for (let x = 28; x < 60; x++) {
    const i = y * g.map.w + x;
    if (g.map.props.has(i)) {
      g.map.props.delete(i);
      g.world.removeProps(x, y);
    }
  }
const at = (i) => (AXIS === 'x' ? [X0 + i, Y] : [Y, X0 + i]);
const levels = Array.from({ length: 17 }, (_, i) => levelAt(g.map, ...at(i)));
const bridged = [];
for (const i of [7, 8, 9]) {
  const b = g.builder.placeBuilding(...at(i), params.get('bridge') ?? 'bridge_stone');
  if (!b) throw new Error('bridge ' + i);
  bridged.push(at(i));
}
const want = AXIS === 'x' ? [1, 3] : [0, 2];
for (let i = 0; i < 17; i++) {
  let ok = false;
  for (const r of [0, 1]) {
    if (!g.builder.placeTrackKind(...at(i), 'straight', r)) continue;
    if (want.every((d) => g.track.get(...at(i)).links[0].includes(d))) {
      ok = true;
      break;
    }
    g.builder.removeTrack(...at(i));
  }
  if (!ok) throw new Error('no track at ' + i);
}
let now = 100;
const def = content.locomotives.find((d) => d.id === LOCO);
const t = new Train([{ uid: 87001, def, level: 0 }], 'Probe', 87001);
for (const l of t.locos) l.inCab = true;
t.wagons = ['pullman'].map((id, i) => ({ uid: 87101 + i, def: content.wagons.find((d) => d.id === id), level: 0, cargo: null, amount: 0 }));
const entry = AXIS === 'x' ? 3 : 0;
if (!t.spawnAt(g.track, ...at(4), entry)) throw new Error('spawn failed');
const end = at(16);
const route = findPath(g.track, { x: at(4)[0], y: at(4)[1], in: entry }, (x, y) => x === end[0] && y === end[1], 1e6, undefined, () => true);
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
function frame(progress, zoom = 3) {
  let k = 0;
  while (t.pathProgress < progress && t.state === 'moving' && k++ < 40000) g.fleet.tick(1 / 60, (now += 1 / 60));
  const c = at(8);
  const w = tileToWorld(c[0], c[1]);
  g.camera.centerOn(w.x, w.y + g.world.railAt(c[0], c[1]).dz - 10);
  g.camera.zoom = zoom;
  g.render(1, 0);
  g.app.renderer.render(g.app.stage);
  return { progress: t.pathProgress, state: t.state };
}
function order() {
  const layer = g.world.objects;
  layer.sortChildren();
  const mine = new Map();
  g.trainRenderer.cars.get(t.id).forEach((c, i) => c.parts.forEach((s, k) => mine.set(s, `car${i}.${t.vehiclePoses[i].segments[k].part} @${t.vehiclePoses[i].segments[k].x.toFixed(2)},${t.vehiclePoses[i].segments[k].y.toFixed(2)}`)));
  for (const [x, y] of bridged) for (const id of [`bridge:${x},${y}`, `bridge-detail:${x},${y}`]) if (g.world.getStructure(id)) mine.set(g.world.getStructure(id), id);
  return layer.children.filter((c) => mine.has(c)).map((c) => `${c.zIndex.toFixed(1).padStart(8)}  ${mine.get(c)}`);
}
function settled() {
  g.render(1, 0);
  return g.world.landscape.ready;
}
window.qa = { g, t, frame, order, settled, levels, bridgeKit: g.world.bridgeKit };
