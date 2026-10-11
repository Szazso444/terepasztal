// An old (v12) game on main: a regular loop with one-tile curves and a one-tile switch, a depot,
// two stations and a train running. qa.saveJson() gives the save; qa.view() renders it.
import { Game } from '/src/game.ts';
import { emptyMap } from '/src/world/mapgen.ts';
import { levelFromMap } from '/src/world/level.ts';
import { tileToWorld } from '/src/engine/iso.ts';

const label = document.getElementById('qa-label');
const level = levelFromMap(emptyMap(9031, 64, 64), 'Old save');
const g = new Game({ kind: 'level', seed: 9031, level });
window.game = g;
await g.init();
g.loop.stop();
g.app.ticker.stop();
g.closeMenus();
g.settings.weather = false;
g.settings.dayNight = false;
g.clock.setSpeed(0);
g.builder.free = true;
for (let i = 0; i < g.regions.unlocked.length; i++) g.regions.own(i);
g.world.rebuildFog();
for (const k of [...g.builder.decor.keys()]) g.builder.removeDecor(k % g.map.w, Math.floor(k / g.map.w));
const lay = (x, y, kind, rot) => {
  if (!g.builder.placeTrack(x, y, { kind, cls: 'regular', cls2: 'regular' }, rot))
    throw new Error(`could not lay ${kind} at ${x},${y}`);
};
const X0 = 20, X1 = 40, Y0 = 20, Y1 = 32;
for (let x = X0 + 1; x < X1; x++) {
  lay(x, Y0, 'straight', 1);
  lay(x, Y1, 'straight', 1);
}
for (let y = Y0 + 1; y < Y1; y++) {
  lay(X0, y, 'straight', 0);
  lay(X1, y, 'straight', 0);
}
lay(X0, Y0, 'curve', 1);
lay(X1, Y0, 'curve', 2);
lay(X1, Y1, 'curve', 3);
lay(X0, Y1, 'curve', 0);
lay(X0 + 10, Y0, 'switch', 1);
for (let y = Y0 + 1; y < Y0 + 4; y++) lay(X0 + 10, y, 'straight', 0);
for (const x of [X0 + 4, X0 + 5]) g.builder.removeTrack(x, Y1);
const depot = g.builder.placeStation(X0 + 4, Y1 - 1, 'depot', 0);
if (!depot) throw new Error('no depot');
g.onStationChanged(depot, false);
for (const x of [X0 + 4, X0 + 5]) lay(x, Y1, 'straight', 1);
const farm = g.builder.placeStation(X0 + 14, Y0 - 1, 'farm', 0);
const wh = g.builder.placeStation(X1 - 4, Y1 + 1, 'warehouse', 0);
for (const st of [farm, wh]) g.onStationChanged(st, false);
for (const [id, n] of [['coal', 9000], ['water', 9000], ['oil', 9000]]) g.stock.add(id, n);
const inv = g.inventory;
const get = (id) => (inv.items.find((i) => i.defId === id && i.assigned === null) ?? inv.add(id, 0)).uid;
const t = g.fleet.create([get('f7')], [get('boxcar'), get('boxcar')], [farm.id, wh.id], 'Old line');
if (typeof t === 'string') throw new Error(t);
t.oil = t.oilCap;
let now = 100;
window.qa = {
  g,
  step(ticks) {
    for (let i = 0; i < ticks; i++) g.fleet.tick(1 / 60, (now += 1 / 60));
  },
  saveJson: () => JSON.stringify(g.snapshot()),
  view(x = (X0 + X1) / 2, y = (Y0 + Y1) / 2, zoom = 1.3) {
    const at = tileToWorld(x, y);
    g.camera.centerOn(at.x, at.y);
    g.camera.zoom = zoom;
    g.render(1, 0);
    g.app.renderer.render(g.app.stage);
    label.textContent = '';
  },
  states: () => g.fleet.trains.map((t) => `${t.name}:${t.state}`),
};
