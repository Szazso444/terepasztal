// Spike showcase: every track piece in every rotation, and trains running through curves,
// switches, crossings and transitions, in the real game.
//   qa.cells: catalogue cells {key, x, y}; qa.shoot(cell): camera on one piece
//   qa.catalogue(): camera on the whole catalogue; qa.loop(): camera on the train loop
//   qa.step(ticks): advance every train
import { Game } from '/src/game.ts';
import { emptyMap } from '/src/world/mapgen.ts';
import { levelFromMap } from '/src/world/level.ts';
import { Train } from '/src/sim/trains.ts';
import { content } from '/src/data/content.ts';
import { tileToWorld } from '/src/engine/iso.ts';
import { TRACK_ITEMS, rotationCount, itemKey, footprintOf } from '/src/world/track.ts';
import { unitDef } from '/src/world/trackGeom.ts';
import { CLASS_N } from '/src/world/track.ts';
import { findPath } from '/src/world/pathfinding.ts';

const check = (c, m) => {
  if (!c) throw new Error(m);
};
const label = document.getElementById('qa-label');
const W = 110,
  H = 110;

// catalogue layout: 10 cells of 5 x 5 tiles per row, pieces at each cell's (1,1)
const items = [];
for (const it of TRACK_ITEMS)
  for (let r = 0; r < rotationCount(it.kind); r++) items.push({ it, rot: r, key: `${itemKey(it)} r${r}` });
const CX0 = 6,
  CY0 = 6,
  CELL = 5,
  COLS = 10;
const cells = items.map((c, i) => ({
  ...c,
  x: CX0 + (i % COLS) * CELL + 1,
  y: CY0 + Math.floor(i / COLS) * CELL + 1,
}));
const catRows = Math.ceil(cells.length / COLS);

const map = emptyMap(7412, W, H);
for (const c of cells)
  if (c.it.kind === 'bridge') for (const d of [-1, 0, 1]) map.terrain[(c.y + d) * W + c.x + d * 0] = 3;
const level = levelFromMap(map, 'Track showcase');
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
for (const k of [...g.builder.decor.keys()]) g.builder.removeDecor(k % g.map.w, Math.floor(k / g.map.w));

const add = (x, y, kind, rot, cls = 'regular', cls2) => {
  for (const q of g.track.place(x, y, kind, rot, cls, cls2)) g.onTrackChanged(q.x, q.y);
};
for (const c of cells) add(c.x, c.y, c.it.kind, c.rot, c.it.cls, c.it.cls2);

// the train loop below the catalogue
const n = CLASS_N.regular;
const X0 = 14,
  X1 = 50,
  Y0 = CY0 + catRows * CELL + 8,
  Y1 = Y0 + 24;
const SWA = X0 + 8,
  SWB = X0 + 20,
  TRA = X0 + 10,
  TRB = X0 + 24,
  XC = TRA + 6,
  YC = Y0 + 10;
for (let x = X0 + n; x <= X1 - n; x++) {
  if (!(x >= SWA && x < SWA + n) && !(x >= SWB && x < SWB + n)) add(x, Y0, 'straight', 1);
  if (x === TRA || x === TRB) add(x, Y1, 'transition', 1);
  else if (x === XC) add(x, Y1, 'crossing', 0, 'regular', 'high_speed');
  else if (x > TRA && x < TRB) add(x, Y1, 'straight', 1, 'high_speed');
  else add(x, Y1, 'straight', 1);
}
for (let y = Y0 + n; y <= Y1 - n; y++) {
  if (y === YC) add(X0, y, 'crossing', 0);
  else add(X0, y, 'straight', 0);
  add(X1, y, 'straight', 0);
}
add(X0, Y0, 'curve', 1);
add(X1 - n + 1, Y0, 'curve', 2);
add(X1 - n + 1, Y1 - n + 1, 'curve', 3);
add(X0, Y1 - n + 1, 'curve', 0);
// two switches on the top line, one of each hand, each with a spur off its diverging route
const spurs = [];
for (const [x, rot] of [
  [SWA, 1],
  [SWB, 7],
]) {
  add(x, Y0, 'switch', rot);
  // where the diverging route leaves the block
  const def = unitDef('switch', n, rot);
  const last = def.routes[1].members.at(-1);
  const m = def.members[last];
  const out = m.links.find((l) => l.route === 1).out;
  const dx = [0, 1, 0, -1][out],
    dy = [-1, 0, 1, 0][out];
  let sx = x + m.dx + dx,
    sy = Y0 + m.dy + dy;
  const end = [];
  for (let k = 0; k < 5; k++) {
    add(sx, sy, 'straight', dx === 0 ? 0 : 1);
    end.push({ x: sx, y: sy });
    sx += dx;
    sy += dy;
  }
  spurs.push(end.at(-1));
}
// a regular line crossing the loop's left side, and one crossing the high-speed stretch
for (let x = X0 - 6; x <= X0 + 6; x++) if (x !== X0) add(x, YC, 'straight', 1);
for (let y = Y1 - 6; y <= Y1 + 6; y++) if (y !== Y1) add(XC, y, 'straight', 0);

const trains = [];
let id = 70000;
function makeTrain(locoId, wagons, head, entry, target, viaSpur) {
  const def = content.locomotives.find((d) => d.id === locoId);
  check(def, 'unknown loco ' + locoId);
  const t = new Train([{ uid: ++id, def, level: 0 }], def.name, ++id);
  for (const l of t.locos) l.inCab = true;
  t.wagons = wagons.map((w) => ({
    uid: ++id,
    def: content.wagons.find((d) => d.id === w),
    level: 0,
    cargo: null,
    amount: 0,
  }));
  check(t.spawnAt(g.track, head.x, head.y, entry), 'spawn failed for ' + locoId);
  const path = findPath(
    g.track,
    { x: head.x, y: head.y, in: entry },
    (x, y) => x === target.x && y === target.y,
    1e6,
    undefined,
    t.canUse,
  );
  check(path, 'no path for ' + locoId);
  g.track.resolveRoutes(path);
  t.coal = t.coalCap;
  t.water = t.waterCap;
  t.oil = t.oilCap;
  t.battery = t.batteryCap;
  t.fuelProblem = () => null;
  t.wireCeiling = () => null;
  t.refreshModes = () => {
    for (const l of t.locos) l.engaged = true;
  };
  t.setPath(path, g.map, g.track);
  t.trackVersion = g.track.version;
  t.nextFuelCheck = Infinity;
  t.setState('moving');
  trains.push(t);
  return t;
}
// round the loop clockwise from the top line: curves, switches straight through, both crossings,
// the transitions and the high-speed stretch
makeTrain('black_five', ['steel_hopper', 'steel_hopper', 'steel_hopper'], { x: X0 + 30, y: Y0 }, 3, { x: X0 + 29, y: Y0 });
// into the first switch's spur
makeTrain('f7', ['steel_coach', 'steel_coach'], { x: SWA + 6, y: Y0 }, 1, spurs[0]);
// across the left crossing
makeTrain('john_bull', ['boxcar', 'boxcar'], { x: X0 - 3, y: YC }, 3, { x: X0 + 6, y: YC });
// across the high-speed stretch on the regular line
makeTrain('class08', ['boxcar'], { x: XC, y: Y1 - 4 }, 0, { x: XC, y: Y1 + 6 });
g.fleet.trains = trains;

let now = 100;
function step(ticks = 1) {
  for (let i = 0; i < ticks; i++) g.fleet.tick(1 / 60, (now += 1 / 60));
}
function view(cx, cy, zoom, text) {
  const at = tileToWorld(cx, cy);
  g.camera.centerOn(at.x, at.y);
  g.camera.zoom = zoom;
  g.render(1, 0);
  g.app.renderer.render(g.app.stage);
  label.textContent = text;
}
function shoot(i, zoom = 2.6) {
  const c = cells[i];
  const fp = footprintOf(c.x, c.y, c.it.kind, c.rot, c.it.cls);
  const cx = fp.reduce((a, t) => a + t.x, 0) / fp.length;
  const cy = fp.reduce((a, t) => a + t.y, 0) / fp.length;
  view(cx, cy, zoom, c.key);
  return c.key;
}
window.qa = {
  g,
  cells: cells.map((c) => ({ key: c.key, kind: c.it.kind, cls: c.it.cls, cls2: c.it.cls2, rot: c.rot })),
  shoot,
  catalogue: (zoom = 0.62) => view(CX0 + (COLS * CELL) / 2, CY0 + (catRows * CELL) / 2, zoom, 'All track pieces'),
  loop: (zoom = 0.85) => view((X0 + X1) / 2 - 2, (Y0 + Y1) / 2, zoom, ''),
  close: (zoom, x, y) => view(x, y, zoom, ''),
  follow: (k, zoom) => {
    const p = trains[k].vehiclePoses[0];
    view(p.x, p.y, zoom, '');
  },
  step,
  states: () => trains.map((t) => `${t.locos[0].def.id}:${t.state}:${t.pathProgress.toFixed(1)}`),
  marks: { X0, X1, Y0, Y1, SWA, SWB, TRA, TRB, XC, YC },
};
