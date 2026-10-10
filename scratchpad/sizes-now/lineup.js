// Scratch: locomotives standing side by side on parallel straight tracks, fronts level.
//   ?rows=a,b,,c   one loco per track, front to back; an empty entry leaves a blank track
//   ?hs=a,b        these run on high-speed track (main keeps its large engines off regular track)
//   ?gap=1         tiles between tracks; ?zoom=1
import { Game } from '/src/game.ts';
import { emptyMap } from '/src/world/mapgen.ts';
import { levelFromMap } from '/src/world/level.ts';
import { Train } from '/src/sim/trains.ts';
import { content } from '/src/data/content.ts';
import { tileToWorld } from '/src/engine/iso.ts';
import { vehicleSpec } from '/src/sim/body.ts';
import { findPath } from '/src/world/pathfinding.ts';

const params = new URLSearchParams(location.search);
const ROWS = (params.get('rows') ?? '').split(',');
const HS = new Set((params.get('hs') ?? '').split(',').filter(Boolean));
const GAP = Number(params.get('gap') ?? 1);
const label = document.getElementById('qa-label');

const level = levelFromMap(emptyMap(7412, 112, 112), 'Lineup');
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
// scratch: with ?sprites=<set>, an engine the pipeline rendered carries its own running gear
const SPRITE_SET = new URLSearchParams(location.search).get('sprites');
const PIPE = SPRITE_SET ? (await (await fetch('/assets/rolling-' + SPRITE_SET + '.json')).json()).frames : {};
if (SPRITE_SET)
  for (const d of content.locomotives)
    if (d.gear && d.gear.parts.every((p) => `rolling/loco_${d.id}_${p.part}_f0` in PIPE)) d.spriteGear = true;
export const SPRITED = content.locomotives.filter((d) => d.spriteGear).map((d) => d.id);

// no trees round the lineup: they would stand in front of the engines
for (let y = 20; y < 80; y++)
  for (let x = 20; x < 90; x++) {
    const i = y * g.map.w + x;
    if (g.map.props.has(i)) {
      g.map.props.delete(i);
      g.world.removeProps(x, y);
    }
  }

const XS = 40, XE = 62, Y0 = 36, RUN = 8;
const rowY = (i) => Y0 + i * GAP;
ROWS.forEach((id, i) => {
  const cls = HS.has(id) ? 'high_speed' : 'regular';
  for (let x = XS; x <= XE; x++)
    for (const q of g.track.place(x, rowY(i), 'straight', 1, cls)) g.onTrackChanged(q.x, q.y);
});
for (const k of [...g.builder.decor.keys()]) {
  const x = k % g.map.w;
  const y = Math.floor(k / g.map.w);
  if (g.builder.removeDecor(x, y)) g.onTrackChanged?.(x, y);
}

let now = 100;
const trains = [];
const placed = [];
ROWS.forEach((id, i) => {
  if (!id) return;
  const def = content.locomotives.find((d) => d.id === id);
  if (!def) {
    placed.push({ id, row: i, missing: true });
    return;
  }
  const t = new Train([{ uid: 81001 + i, def, level: 0 }], 'Lineup', 81001 + i);
  for (const l of t.locos) l.inCab = true;
  t.wagons = [];
  const y = rowY(i);
  if (!t.spawnAt(g.track, XS + 2, y, 3)) throw new Error('spawn failed ' + id);
  const route = findPath(g.track, { x: XS + 2, y, in: 3 }, (x2, y2) => x2 === XE && y2 === y, 1e6, undefined, () => true);
  if (!route) throw new Error('no route ' + id);
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
  let k = 0;
  while (t.pathProgress < RUN && t.state === 'moving' && k++ < 40000) g.fleet.tick(1 / 60, (now += 1 / 60));
  trains.push(t);
  placed.push({ id, row: i, L: vehicleSpec(def).L, progress: t.pathProgress });
});
g.fleet.trains = trains;
// the fronts stand RUN tiles past the spawn tile; centre on the middle of the longest bodies
function shot(zoom = Number(params.get('zoom') ?? 1)) {
  const mid = tileToWorld(XS + 2 + RUN - 1.5, rowY((ROWS.length - 1) / 2));
  g.camera.centerOn(mid.x, mid.y - 10);
  g.camera.zoom = zoom;
  g.render(1, 0);
  g.app.renderer.render(g.app.stage);
  label.textContent = params.get('title') ?? '';
  return placed;
}
// the same view with the trains taken away, to crop the shot to them
function bare() {
  for (const t of trains) g.trainRenderer.remove(t.id);
  g.fleet.trains = [];
  g.render(1, 0);
  g.app.renderer.render(g.app.stage);
}
window.qa = { g, sprited: SPRITED, shot, bare, placed };
