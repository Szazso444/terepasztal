// Rail showcase: every track piece in every rotation and form, the S-shaped switch snapping, a
// passing loop of two S-switches, a narrow-gauge line and trains on all of it, in the real game.
// Works on builds without narrow gauge or switch forms too (the "before" shots).
//   qa.catalogue(), qa.shoot(i), qa.area(name, zoom), qa.snap(state), qa.step(ticks), qa.follow(k)
import { Game } from '/src/game.ts';
import { emptyMap } from '/src/world/mapgen.ts';
import { levelFromMap } from '/src/world/level.ts';
import { Train } from '/src/sim/trains.ts';
import { content } from '/src/data/content.ts';
import { tileToWorld, DIR_DX, DIR_DY } from '/src/engine/iso.ts';
import * as T from '/src/world/track.ts';
import { unitDef } from '/src/world/trackGeom.ts';
import { findPath } from '/src/world/pathfinding.ts';

const check = (c, m) => {
  if (!c) throw new Error(m);
};
const label = document.getElementById('qa-label');
const W = 140,
  H = 140;
const HAS_FORMS = typeof T.TrackGraph.prototype.refreshSwitchForms === 'function';
const HAS_NARROW = T.TRACK_CLASSES.includes('narrow');

// ------------------------------------------------------------------ catalogue layout
const items = [];
for (const it of T.TRACK_ITEMS) {
  for (let r = 0; r < T.rotationCount(it.kind); r++) {
    items.push({ it, rot: r, form: 'turn', key: `${T.itemKey(it)} r${r}` });
    if (HAS_FORMS && it.kind === 'switch' && T.CLASS_N[it.cls] > 1)
      items.push({ it, rot: r, form: 'parallel', key: `${T.itemKey(it)} r${r} S` });
  }
}
const CX0 = 6,
  CY0 = 6,
  CELL = 5,
  COLS = 12;
const cells = items.map((c, i) => ({
  ...c,
  x: CX0 + (i % COLS) * CELL + 1,
  y: CY0 + Math.floor(i / COLS) * CELL + 1,
}));
const catRows = Math.ceil(cells.length / COLS);
const BELOW = CY0 + catRows * CELL + 4;

const map = emptyMap(7412, W, H);
const level = levelFromMap(map, 'Rail showcase');
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
for (const k of [...g.builder.decor.keys()])
  g.builder.removeDecor(k % g.map.w, Math.floor(k / g.map.w));
// clear scattered trees and rocks off the whole test ground
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) g.world.removeProps?.(x, y);

/** Lay track the way a player does: through the builder, so switches snap. */
const lay = (x, y, kind, rot, cls = 'regular', cls2) => {
  const ok = g.builder.placeTrack(x, y, { kind, cls, cls2 }, rot);
  check(ok, `could not lay ${kind} ${cls} r${rot} at ${x},${y}`);
};
/** Lay a piece exactly as given (the catalogue shows each form on its own). */
const put = (x, y, kind, rot, cls, cls2, form) => {
  const tiles = HAS_FORMS
    ? g.track.place(x, y, kind, rot, cls, cls2, form)
    : g.track.place(x, y, kind, rot, cls, cls2);
  for (const q of tiles) g.onTrackChanged(q.x, q.y);
};
for (const c of cells) put(c.x, c.y, c.it.kind, c.rot, c.it.cls, c.it.cls2, c.form);

const n2 = T.CLASS_N.regular;
const areas = {};

// ------------------------------------------------------------------ a regular loop
// 2x2 corners, a transition onto a high-speed stretch with a regular line crossing it
const L = { X0: 8, X1: 52, Y0: BELOW + 2, Y1: BELOW + 26 };
{
  const { X0, X1, Y0, Y1 } = L;
  const TRA = X0 + 12,
    TRB = X0 + 28,
    XC = TRA + 8;
  for (let x = X0 + n2; x <= X1 - n2; x++) {
    lay(x, Y0, 'straight', 1);
    if (x === TRA || x === TRB) lay(x, Y1, 'transition', 1);
    else if (x === XC) lay(x, Y1, 'crossing', 0, 'regular', 'high_speed');
    else if (x > TRA && x < TRB) lay(x, Y1, 'straight', 1, 'high_speed');
    else lay(x, Y1, 'straight', 1);
  }
  for (let y = Y0 + n2; y <= Y1 - n2; y++) {
    lay(X0, y, 'straight', 0);
    lay(X1, y, 'straight', 0);
  }
  lay(X0, Y0, 'curve', 1);
  lay(X1 - n2 + 1, Y0, 'curve', 2);
  lay(X1 - n2 + 1, Y1 - n2 + 1, 'curve', 3);
  lay(X0, Y1 - n2 + 1, 'curve', 0);
  for (let y = Y1 - 6; y <= Y1 + 6; y++) if (y !== Y1) lay(XC, y, 'straight', 0);
  Object.assign(L, { TRA, TRB, XC });
  areas.loop = { x: (X0 + X1) / 2, y: (Y0 + Y1) / 2 };
  areas.hs = { x: (TRA + TRB) / 2, y: Y1 };
}

// ------------------------------------------------------------------ S-switch passing loop
// The loop's top line gets a passing loop: two switches whose branches bend into a parallel track
// one row below, joined by straights. Laid through the builder, so the switches snap on their own.
const P = { y: L.Y0 };
if (HAS_FORMS) {
  /** a rotation whose main line runs along x with its points facing `from` and its S lane one row down */
  const pick = (pointsFrom) => {
    for (let rot = 0; rot < 8; rot++) {
      const def = unitDef('switch', n2, rot, 'parallel');
      const main = def.routes[0].members;
      const first = def.members[main[0]];
      const inn = first.links.find((l) => l.route === 0).in;
      if (inn !== pointsFrom) continue;
      const s = def.routes[1].members;
      const last = def.members[s[s.length - 1]];
      const out = last.links.find((l) => l.route === 1).out;
      if (out !== (pointsFrom === 3 ? 1 : 3)) continue;
      if (last.dy !== first.dy + 1) continue;
      return { rot, mainDy: first.dy };
    }
    throw new Error('no switch rotation for ' + pointsFrom);
  };
  const A = pick(3); // points facing west
  const B = pick(1); // points facing east
  const ax = L.X0 + 8,
    bx = L.X0 + 20;
  // take the top-line straights out where the blocks go, then lay the switches
  for (const x of [ax, ax + 1, bx, bx + 1]) g.builder.removeTrack(x, L.Y0);
  lay(ax, L.Y0 - A.mainDy, 'switch', A.rot);
  lay(bx, L.Y0 - B.mainDy, 'switch', B.rot);
  const exitA = g.track.switchExit(ax, L.Y0 - A.mainDy, A.rot, 'regular', 'parallel');
  const exitB = g.track.switchExit(bx, L.Y0 - B.mainDy, B.rot, 'regular', 'parallel');
  for (let x = exitA.x; x <= exitB.x; x++) lay(x, exitA.y, 'straight', 1);
  Object.assign(P, { ax, bx, A, B, exitA, exitB, row: exitA.y });
  areas.passing = { x: (ax + bx + 1) / 2, y: L.Y0 + 0.5 };
}

// ------------------------------------------------------------------ the snap on its own
// one switch, with the parallel straight laid and taken away again by qa.snap()
const S = { x: 62, y: BELOW + 4, rot: 1 };
let snapExit = null;
if (HAS_FORMS) {
  lay(S.x, S.y, 'switch', S.rot);
  // straights before the points and after the main line's far end
  const def = unitDef('switch', n2, S.rot, 'turn');
  const main = def.routes[0].members;
  const first = def.members[main[0]];
  const last = def.members[main[main.length - 1]];
  const inn = first.links.find((l) => l.route === 0).in;
  const out = last.links.find((l) => l.route === 0).out;
  const axis = (d) => (d === 0 || d === 2 ? 0 : 1);
  for (let k = 1; k <= 4; k++) {
    lay(S.x + first.dx + DIR_DX[inn] * k, S.y + first.dy + DIR_DY[inn] * k, 'straight', axis(inn));
    lay(S.x + last.dx + DIR_DX[out] * k, S.y + last.dy + DIR_DY[out] * k, 'straight', axis(out));
  }
  snapExit = g.track.switchExit(S.x, S.y, S.rot, 'regular', 'parallel');
  areas.snap = { x: S.x + 1.5, y: S.y + 0.5 };
}
function snap(state) {
  if (!snapExit) return 'no forms in this build';
  const e = snapExit;
  const rot = e.out === 0 || e.out === 2 ? 0 : 1;
  const run = [];
  for (let k = 0; k < 4; k++) run.push({ x: e.x + DIR_DX[e.out] * k, y: e.y + DIR_DY[e.out] * k });
  if (state === 'on')
    for (const t of run) if (!g.track.has(t.x, t.y)) lay(t.x, t.y, 'straight', rot);
  if (state === 'off')
    for (const t of run) if (g.track.has(t.x, t.y)) g.builder.removeTrack(t.x, t.y);
  return g.track.get(S.x, S.y).form ?? 'turn';
}

// ------------------------------------------------------------------ a narrow line
const N = { X0: 64, X1: 84, Y0: BELOW + 12, Y1: BELOW + 26 };
if (HAS_NARROW) {
  const { X0, X1, Y0, Y1 } = N;
  for (let x = X0 + 1; x < X1; x++) {
    lay(x, Y0, 'straight', 1, 'narrow');
    lay(x, Y1, 'straight', 1, 'narrow');
  }
  for (let y = Y0 + 1; y < Y1; y++) {
    lay(X0, y, 'straight', 0, 'narrow');
    lay(X1, y, 'straight', 0, 'narrow');
  }
  lay(X0, Y0, 'curve', 1, 'narrow');
  lay(X1, Y0, 'curve', 2, 'narrow');
  lay(X1, Y1, 'curve', 3, 'narrow');
  lay(X0, Y1, 'curve', 0, 'narrow');
  // a siding off the top line through a narrow switch, with a tight S of one-tile curves
  const sw = X0 + 6;
  g.builder.removeTrack(sw, Y0);
  lay(sw, Y0, 'switch', 1, 'narrow');
  // the switch's branch: a short siding inside the loop
  {
    const links = T.pieceLinks('switch', 1);
    const branch = links[1][1];
    for (let k = 1; k <= 4; k++)
      lay(
        sw + DIR_DX[branch] * k,
        Y0 + DIR_DY[branch] * k,
        'straight',
        branch === 0 || branch === 2 ? 0 : 1,
        'narrow',
      );
  }
  // a regular line crossing both narrow sides on narrow x regular crossings (axes swapped: R)
  const xc = X0 + 13;
  for (let y = Y0 - 4; y <= Y1 + 4; y++)
    if (y === Y0 || y === Y1) lay(xc, y, 'crossing', 1, 'narrow', 'regular');
    else lay(xc, y, 'straight', 0, 'regular');
  Object.assign(N, { sw, xc });
  areas.crossing = { x: xc, y: Y0 };
  // a narrow depot on the bottom line, the narrow track running through its shed
  const dx = X0 + 5;
  g.builder.removeTrack(dx, Y1);
  g.builder.removeTrack(dx + 1, Y1);
  const depot = g.builder.placeStation(dx, Y1, 'narrow_depot', 0);
  check(depot, 'could not place the narrow depot');
  depot.name = 'Narrow Depot';
  g.onStationChanged(depot, false);
  lay(dx, Y1, 'straight', 1, 'narrow');
  lay(dx + 1, Y1, 'straight', 1, 'narrow');
  // a quarry and a warehouse on the line for narrow trains to work between
  const q = g.builder.placeStation(X1 - 4, Y0 - 1, 'quarry', 0);
  const wh = g.builder.placeStation(X0 + 1, Y0 + 3, 'warehouse', 0);
  check(q && wh, 'could not place the narrow stops');
  for (const st of [q, wh]) g.onStationChanged(st, false);
  Object.assign(N, { depot, quarry: q, warehouse: wh });
  areas.depot = { x: dx + 0.5, y: Y1 };
  // a turned narrow depot on its own, to show both orientations
  const t = g.builder.placeStation(X1 + 4, Y0 + 4, 'narrow_depot', 1);
  check(t, 'could not place the turned narrow depot');
  g.onStationChanged(t, false);
  for (const y of [Y0 + 3, Y0 + 6]) lay(X1 + 4, y, 'straight', 0, 'narrow');
  areas.depotTurned = { x: X1 + 4, y: Y0 + 4.5 };
  areas.narrow = { x: (X0 + X1) / 2, y: (Y0 + Y1) / 2 };
}

// ------------------------------------------------------------------ trains
const trains = [];
let id = 70000;
function makeTrain(locoId, wagons, head, entry, target, viaPath) {
  const def = content.locomotives.find((d) => d.id === locoId);
  check(def, 'unknown loco ' + locoId);
  const t = new Train([{ uid: ++id, def, level: 0 }], def.name, ++id);
  for (const l of t.locos) l.inCab = true;
  t.wagons = wagons.map((w) => {
    const wd = content.wagons.find((d) => d.id === w);
    check(wd, 'unknown wagon ' + w);
    return { uid: ++id, def: wd, level: 0, cargo: null, amount: 0 };
  });
  check(t.spawnAt(g.track, head.x, head.y, entry), 'spawn failed for ' + locoId);
  const path =
    viaPath ??
    findPath(
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
/** Roll a narrow train out of the narrow depot the way a player does (depot picked by gauge). */
function deployNarrow() {
  const inv = g.inventory;
  const take = (id) =>
    (inv.items.find((i) => i.defId === id && i.assigned === null) ?? inv.add(id, 0)).uid;
  const loco = take('mk48');
  const wagons = [take('mine_tub'), inv.add('mine_tub', 0).uid, take('narrow_box')];
  const r = g.fleet.create([loco], wagons, [N.quarry.id, N.warehouse.id], 'Narrow 1');
  if (typeof r === 'string') return r;
  r.oil = r.oilCap;
  r.fuelProblem = () => null;
  return r.name;
}
/**
 * Turn the showcase into a playable game: a regular depot on the loop's bottom line, a farm and a
 * warehouse on the regular loop, and trains rolled out of both depots on real schedules, with
 * fuel in the stockpile. Returns the trains' names (or the reasons a rollout failed).
 */
function buildDemo() {
  const out = [];
  const { X0, X1, Y0, Y1 } = L;
  const dx = X0 + 4;
  g.builder.removeTrack(dx, Y1);
  g.builder.removeTrack(dx + 1, Y1);
  const depot = g.builder.placeStation(dx, Y1 - 1, 'depot', 0);
  check(depot, 'could not place the regular depot');
  depot.name = 'Depot';
  g.onStationChanged(depot, false);
  lay(dx, Y1, 'straight', 1);
  lay(dx + 1, Y1, 'straight', 1);
  const farm = g.builder.placeStation(X0 + 26, Y0 - 1, 'farm', 0);
  const wh = g.builder.placeStation(X1 - 6, Y1 + 1, 'warehouse', 0);
  check(farm && wh, 'could not place the regular stops');
  for (const st of [farm, wh]) g.onStationChanged(st, false);
  // stock on the platforms, so the trains load and leave instead of waiting for the harvest
  farm.storage.set('wheat', Math.min(farm.capacity, 600));
  N.quarry.storage.set('stone', Math.min(N.quarry.capacity, 600));
  for (const [id, n] of [
    ['coal', 20000],
    ['water', 20000],
    ['oil', 20000],
    ['diesel', 20000],
    ['wood', 20000],
    ['stone', 20000],
    ['iron', 20000],
    ['food', 20000],
  ])
    g.stock.add(id, n);
  g.economy.money = Math.max(g.economy.money, 500000);
  const inv = g.inventory;
  const get = (id) =>
    (inv.items.find((i) => i.defId === id && i.assigned === null) ?? inv.add(id, 0)).uid;
  const roll = (locoId, wagons, stops, name) => {
    const r = g.fleet.create([get(locoId)], wagons.map(get), stops, name);
    if (typeof r === 'string') return out.push(`${name}: ${r}`);
    r.coal = r.coalCap;
    r.water = r.waterCap;
    r.oil = r.oilCap;
    // leave with what is on the platform: a demo train that waits to fill up looks stuck
    for (const stop of r.schedule) stop.waitFull = false;
    out.push(r.name);
  };
  roll('f7', ['boxcar', 'boxcar', 'boxcar'], [farm.id, wh.id], 'Grain 1');
  roll('mk48', ['mine_tub', 'mine_tub', 'narrow_box'], [N.quarry.id, N.warehouse.id], 'Narrow 1');
  // the first trains clear the gates before the next ones roll out
  step(720);
  roll('black_five', ['boxcar', 'boxcar'], [farm.id, wh.id], 'Grain 2');
  roll('rocket', ['mine_tub', 'mine_tub'], [N.quarry.id, N.warehouse.id], 'Narrow 2');
  areas.demoDepot = { x: dx + 0.5, y: Y1 - 0.5 };
  return out;
}
/** The running game as a save file. */
function saveJson() {
  const j = g.snapshot();
  // the save opens with the clock running at normal speed, so the trains are seen moving
  j.clock.speedIndex = 1;
  return JSON.stringify(j);
}
/** The showcase's trains; returns their names in film order. */
function spawnTrains() {
  const names = [];
  const add = (name, ...args) => {
    makeTrain(...args);
    names.push(name);
  };
  // round the regular loop through both S-switches' main lines, the transitions and the crossing
  add(
    'black_five',
    'black_five',
    ['steel_hopper', 'steel_hopper', 'steel_hopper'],
    { x: L.X0 + 32, y: L.Y0 },
    3,
    { x: L.X0 + 31, y: L.Y0 },
  );
  if (HAS_FORMS) {
    // into the passing loop on the S lane, stopping in the middle of it
    add('f7', 'f7', ['steel_coach', 'steel_coach'], { x: P.ax - 2, y: L.Y0 }, 3, {
      x: Math.round((P.exitA.x + P.exitB.x) / 2),
      y: P.row,
    });
  }
  if (HAS_NARROW) {
    add('mk48', 'mk48', ['mine_tub', 'mine_tub', 'narrow_box'], { x: N.X0 + 3, y: N.Y1 }, 1, {
      x: N.X0 + 4,
      y: N.Y1,
    });
    add('rocket', 'rocket', ['narrow_coach'], { x: N.X1 - 2, y: N.Y0 }, 3, {
      x: N.X1 - 3,
      y: N.Y0,
    });
    add('class08', 'class08', ['boxcar'], { x: N.xc, y: N.Y0 - 3 }, 0, { x: N.xc, y: N.Y1 + 3 });
  }
  return names;
}
window.qaTrains = { makeTrain, trains, L, P, N };
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
  const fp = T.footprintOf(c.x, c.y, c.it.kind, c.rot, c.it.cls);
  view(
    fp.reduce((a, t) => a + t.x, 0) / fp.length,
    fp.reduce((a, t) => a + t.y, 0) / fp.length,
    zoom,
    c.key,
  );
  return c.key;
}
window.qa = {
  g,
  cells: cells.map((c) => ({
    key: c.key,
    kind: c.it.kind,
    cls: c.it.cls,
    cls2: c.it.cls2,
    rot: c.rot,
    form: c.form,
  })),
  shoot,
  catalogue: (zoom = 0.5) => view(CX0 + (COLS * CELL) / 2, CY0 + (catRows * CELL) / 2, zoom, ''),
  area: (name, zoom = 1.6) => view(areas[name].x, areas[name].y, zoom, ''),
  areas: () => Object.keys(areas),
  snap,
  step,
  follow: (k, zoom = 2.2) => {
    const p = trains[k].vehiclePoses[0];
    view(p.x, p.y, zoom, '');
  },
  states: () => trains.map((t) => `${t.locos[0].def.id}:${t.state}:${t.pathProgress.toFixed(1)}`),
  info: { HAS_FORMS, HAS_NARROW, L, P, N, S },
  spawnTrains,
  deployNarrow,
  buildDemo,
  saveJson,
};
