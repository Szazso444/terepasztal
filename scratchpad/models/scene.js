// Scratch: engines standing side by side on straight track (fronts level), and one engine at a time
// through a curve. Narrow engines stand on narrow track.
//   ?rows=a,b,,c   one engine per track, back to front; an empty entry leaves a blank track
//   ?gap=1 ?zoom=2 ?night=1
//   qa.shot(zoom) frames the lineup; qa.bare() takes the engines away; qa.curve(id, zoom) runs one
//   engine with two wagons into the curve of its own gauge
import { Game } from '/src/game.ts';
import { emptyMap } from '/src/world/mapgen.ts';
import { levelFromMap } from '/src/world/level.ts';
import { Train } from '/src/sim/trains.ts';
import { content } from '/src/data/content.ts';
import { tileToWorld } from '/src/engine/iso.ts';
import { vehicleSpec } from '/src/sim/body.ts';
import { findPath } from '/src/world/pathfinding.ts';
import { Text } from 'pixi.js';
import gearJson from '/src/data/gear.json';
import fitJson from '/src/data/locoFit.json';

// not in the game's data yet: the Koutetsujou stands in the lineup on the Big Boy's numbers
if (!content.locomotives.some((d) => d.id === 'koutetsujou') && fitJson.koutetsujou)
  content.locomotives.push({
    ...content.locomotives.find((d) => d.id === 'big_boy'),
    id: 'koutetsujou',
    name: 'Koutetsujou',
    gear: gearJson.koutetsujou,
    lengthTiles: fitJson.koutetsujou.tiles,
    spriteGear: true,
    smoke: fitJson.koutetsujou.smoke,
  });

const params = new URLSearchParams(location.search);
const ROWS = (params.get('rows') ?? '').split(',');
const GAP = Number(params.get('gap') ?? 1);
const label = document.getElementById('qa-label');

const level = levelFromMap(emptyMap(7412, 112, 112), 'Models');
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
for (let y = 10; y < 100; y++)
  for (let x = 10; x < 100; x++) {
    const i = y * g.map.w + x;
    if (g.map.props.has(i)) {
      g.map.props.delete(i);
      g.world.removeProps(x, y);
    }
  }
const defOf = (id) => content.locomotives.find((d) => d.id === id);
const clsOf = (id) => (defOf(id)?.gauge === 'narrow' ? 'narrow' : 'regular');
const add = (x, y, kind, rot, cls) => {
  for (const q of g.track.place(x, y, kind, rot, cls)) g.onTrackChanged(q.x, q.y);
};

// ---- the lineup: parallel straights
const XS = 40, XE = 62, Y0 = 36, RUN = 8;
const rowY = (i) => Y0 + i * GAP;
ROWS.forEach((id, i) => {
  for (let x = XS; x <= XE; x++) add(x, rowY(i), 'straight', 1, id ? clsOf(id) : 'regular');
});
// ---- a curve per gauge, away from the lineup
const CURVES = {};
for (const [cls, y0] of [['regular', 80], ['narrow', 92]]) {
  const n = cls === 'narrow' ? 1 : 2;
  for (let x = 20; x < 40; x++) add(x, y0, 'straight', 1, cls);
  add(40, y0, 'curve', 2, cls);
  for (let y = y0 + n; y < y0 + n + 8; y++) add(40 + n - 1, y, 'straight', 0, cls);
  CURVES[cls] = { x: 20, y: y0, n, corner: { x: 40 + (n - 1) / 2, y: y0 + (n - 1) / 2 }, end: { x: 40 + n - 1, y: y0 + n + 7 } };
}

let now = 100, uid = 81000;
function run(t, x, y, toX, toY, until) {
  if (!t.spawnAt(g.track, x, y, 3)) throw new Error('spawn failed ' + t.locos[0].def.id);
  const route = findPath(g.track, { x, y, in: 3 }, (x2, y2) => x2 === toX && y2 === toY, 1e6, undefined, () => true);
  if (!route) throw new Error('no route ' + t.locos[0].def.id);
  g.track.resolveRoutes(route);
  t.coal = t.coalCap; t.water = t.waterCap; t.oil = t.oilCap; t.battery = t.batteryCap;
  t.fuelProblem = () => null;
  t.wireCeiling = () => null;
  t.refreshModes = () => { for (const l of t.locos) l.engaged = true; };
  g.fleet.trains = [t];
  t.setPath(route.map((s) => ({ ...s })), g.map, g.track);
  t.trackVersion = g.track.version;
  t.nextFuelCheck = Infinity;
  t.setState('moving');
  let k = 0;
  while (!until(t) && t.state === 'moving' && k++ < 60000) g.fleet.tick(1 / 60, (now += 1 / 60));
}
function make(id, wagons = []) {
  const def = defOf(id);
  if (!def) return null;
  const t = new Train([{ uid: ++uid, def, level: 0 }], 'Model', uid);
  for (const l of t.locos) l.inCab = true;
  t.wagons = wagons.map((w) => ({ uid: ++uid, def: content.wagons.find((d) => d.id === w), level: 0, cargo: null, amount: 0 }));
  return t;
}
const trains = [], placed = [];
// ?ids=1,2,,4 labels each track with its sheet ID, ahead of the engine's nose
const IDS = (params.get('ids') ?? '').split(',');
const labels = [];
ROWS.forEach((id, i) => {
  if (!id) return;
  const t = make(id);
  if (!t) return placed.push({ id, row: i, missing: true });
  run(t, XS + 2, rowY(i), XE, rowY(i), (tt) => tt.pathProgress >= RUN);
  trains.push(t);
  placed.push({ id, row: i, L: vehicleSpec(t.locos[0].def).L, sprite: !!t.locos[0].def.spriteGear });
  if (IDS[i]) {
    const tx = new Text({ text: IDS[i], style: { fontFamily: 'Arial', fontSize: 11, fontWeight: '700', fill: 0xffffff, stroke: { color: 0x10201a, width: 3 } } });
    const at = tileToWorld(XS + 2 + RUN + 0.45, rowY(i));
    tx.anchor.set(0.5);
    tx.position.set(at.x, at.y - 4);
    g.world.overlay.addChild(tx);
    labels.push(tx);
  }
});
g.fleet.trains = trains;
function draw(cx, cy, zoom, night) {
  const at = tileToWorld(cx, cy);
  g.camera.centerOn(at.x, at.y - 10);
  g.camera.zoom = zoom;
  // night: the game's own day and night at 23:00
  g.settings.dayNight = !!night;
  if (night) {
    g.clock.time = 1;
    g.clock.time = (23 / 24) / g.clock.dayFraction;
  }
  g.render(1, 0);
  g.app.renderer.render(g.app.stage);
  label.textContent = '';
}
const NIGHT = Number(params.get('night') ?? 0);
function shot(zoom = Number(params.get('zoom') ?? 2)) {
  draw(XS + 2 + RUN - 1.5, rowY((ROWS.length - 1) / 2), zoom, NIGHT);
  return placed;
}
function bare() {
  for (const l of labels) l.visible = false;
  for (const t of g.fleet.trains) g.trainRenderer.remove(t.id);
  g.fleet.trains = [];
  g.render(1, 0);
  g.app.renderer.render(g.app.stage);
}
function curve(id, zoom = 3, wagons) {
  bare();
  const cls = clsOf(id), c = CURVES[cls];
  const t = make(id, wagons ?? (cls === 'narrow' ? ['mine_tub', 'mine_tub'] : ['boxcar', 'boxcar']));
  const L = vehicleSpec(t.locos[0].def).L;
  // head half an engine length past the middle of the curve
  const mid = 20 + ((Math.PI / 2) * (c.n - 0.5)) / 2 - 2 + L / 2;
  run(t, c.x + 2, c.y, c.end.x, c.end.y, (tt) => tt.pathProgress >= mid);
  draw(c.corner.x, c.corner.y, zoom, NIGHT);
  return { id, L, progress: t.pathProgress, state: t.state };
}
window.qa = { g, shot, bare, curve, placed, defOf };
