// Engine showcase as a save the owner can load in the demo build: every engine parked on its own
// siding in sheet-ID order, a regular loop and a narrow loop over a hill each with trains running
// between two stops, day and night and smoke on, every engine also in the inventory.
//   qa.build() lays it out and returns what was made; qa.saveJson() is the save; qa.view(x, y, zoom)
import { Game } from '/src/game.ts';
import { emptyMap, decorateProps } from '/src/world/mapgen.ts';
import { levelFromMap } from '/src/world/level.ts';
import { Train } from '/src/sim/trains.ts';
import { content } from '/src/data/content.ts';
import { tileToWorld } from '/src/engine/iso.ts';
import * as T from '/src/world/track.ts';
import { findPath } from '/src/world/pathfinding.ts';
import { vehicleSpec } from '/src/sim/body.ts';
import { daySeconds } from '/src/sim/rules.ts';

const check = (c, m) => {
  if (!c) throw new Error(m);
};
// sheet ID -> game id (9 and 10 are retired; 39, the Koutetsujou, is not in the game's data yet)
const SHEET = ['rocket', 'bm50', 'muki', 'c50', 'mav490', 'mk45', 'mk48', 'rezet', null, null, 'mav375', 'j94', 'class08',
  'general', 'jupiter', 'kando_v40', 'sw1', 'black_five', 'crocodile', 'deltic', 'drg01', 'f7', 'flying_scotsman', 'ice1',
  'k4s', 'm62', 'mallard', 're460', 'taurus', 'tgv', 'v63', 'daylight', 'dda40x', 'gg1', 'mav424', 'nine_f', 'sd40',
  'big_boy'];
const W = 140, H = 140;
const n2 = T.CLASS_N.regular;
// the loops, and a hill across the top line of each
const L = { X0: 10, X1: 76, Y0: 19, Y1: 45 };
const N = { X0: 90, X1: 114, Y0: 19, Y1: 33 };
const HILLS = [[34, 14, 52, 24], [98, 15, 106, 23]];
// the parade: dead-end sidings, two columns
const PAR = { ax: 12, bx: 44, y0: 60, len: 10, gap: 2, perCol: 19 };

// Scenery grows back from the seed when a save is loaded: pick a seed that puts no tree on or in
// front of the parked engines.
const N_PARKED = SHEET.filter(Boolean).length;
const TREES = new Set(['oak', 'tree', 'birch', 'pine', 'spruce', 'deadtree', 'palm']);
function treesAtParade(seed) {
  const m = emptyMap(seed, W, H);
  decorateProps(m, seed);
  let n = 0;
  for (let k = 0; k < N_PARKED; k++) {
    const col = k < PAR.perCol ? 0 : 1;
    const x0 = col ? PAR.bx : PAR.ax;
    const y = PAR.y0 + (col ? k - PAR.perCol : k) * PAR.gap;
    // its own row (a tree there is pushed to the tile's edge, not removed) and the row in front
    for (let yy = y; yy <= y + 1; yy++)
      for (let xx = x0 + PAR.len - 5; xx <= x0 + PAR.len + 1; xx++) if (m.props.get(yy * W + xx)?.some((q) => TREES.has(q.kind))) n++;
  }
  return n;
}
let SEED = 7412;
for (let sd = 7412; sd < 37412; sd++)
  if (treesAtParade(sd) === 0) {
    SEED = sd;
    break;
  }
const map = emptyMap(SEED, W, H);
for (const [x0, y0, x1, y1] of HILLS) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) map.terrain[y * W + x] = 2;
const level = levelFromMap(map, 'Engine showcase');
const g = new Game({ kind: 'level', seed: SEED, level });
window.game = g;
await g.init();
g.loop.stop();
g.app.ticker.stop();
g.closeMenus();
g.settings.autosave = false;
g.settings.weather = false;
g.settings.dayNight = true;
g.settings.smoke = true;
g.clock.setSpeed(0);
g.builder.free = true;
for (let i = 0; i < g.regions.unlocked.length; i++) g.regions.own(i);
g.world.rebuildFog();
for (const k of [...g.builder.decor.keys()]) g.builder.removeDecor(k % g.map.w, Math.floor(k / g.map.w));

const lay = (x, y, kind, rot, cls = 'regular') => check(g.builder.placeTrack(x, y, { kind, cls }, rot), `could not lay ${kind} ${cls} r${rot} at ${x},${y}`);
let now = 100;
const step = (ticks = 1) => {
  for (let i = 0; i < ticks; i++) g.fleet.tick(1 / 60, (now += 1 / 60));
};
const defOf = (id) => content.locomotives.find((d) => d.id === id);

function build() {
  const out = { trains: [], parked: [], skipped: [] };
  // ---- regular loop
  {
    const { X0, X1, Y0, Y1 } = L;
    for (let x = X0 + n2; x <= X1 - n2; x++) {
      lay(x, Y0, 'straight', 1);
      lay(x, Y1, 'straight', 1);
    }
    for (let y = Y0 + n2; y <= Y1 - n2; y++) {
      lay(X0, y, 'straight', 0);
      lay(X1, y, 'straight', 0);
    }
    lay(X0, Y0, 'curve', 1);
    lay(X1 - n2 + 1, Y0, 'curve', 2);
    lay(X1 - n2 + 1, Y1 - n2 + 1, 'curve', 3);
    lay(X0, Y1 - n2 + 1, 'curve', 0);
    const dx = X0 + 4;
    g.builder.removeTrack(dx, Y1);
    g.builder.removeTrack(dx + 1, Y1);
    const depot = g.builder.placeStation(dx, Y1 - 1, 'depot', 0);
    check(depot, 'could not place the regular depot');
    depot.name = 'Depot';
    g.onStationChanged(depot, false);
    lay(dx, Y1, 'straight', 1);
    lay(dx + 1, Y1, 'straight', 1);
    const farm = g.builder.placeStation(X0 + 14, Y0 - 1, 'farm', 0);
    const wh = g.builder.placeStation(X1 - 8, Y1 + 1, 'warehouse', 0);
    check(farm && wh, 'could not place the regular stops');
    for (const st of [farm, wh]) g.onStationChanged(st, false);
    farm.storage.set('wheat', Math.min(farm.capacity, 600));
    Object.assign(L, { depot, farm, wh });
  }
  // ---- narrow loop
  {
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
    const dx = X0 + 5;
    g.builder.removeTrack(dx, Y1);
    g.builder.removeTrack(dx + 1, Y1);
    const depot = g.builder.placeStation(dx, Y1, 'narrow_depot', 0);
    check(depot, 'could not place the narrow depot');
    depot.name = 'Narrow Depot';
    g.onStationChanged(depot, false);
    lay(dx, Y1, 'straight', 1, 'narrow');
    lay(dx + 1, Y1, 'straight', 1, 'narrow');
    const q = g.builder.placeStation(X1 - 4, Y0 - 1, 'quarry', 0);
    const wh = g.builder.placeStation(X0 + 1, Y0 + 3, 'warehouse', 0);
    check(q && wh, 'could not place the narrow stops');
    for (const st of [q, wh]) g.onStationChanged(st, false);
    q.storage.set('stone', Math.min(q.capacity, 600));
    Object.assign(N, { depot, quarry: q, wh });
  }
  for (const id of ['coal', 'water', 'oil', 'diesel', 'wood', 'stone', 'iron', 'food']) g.stock.add(id, 20000);
  g.economy.money = Math.max(g.economy.money, 500000);
  const inv = g.inventory;
  const get = (id) => (inv.items.find((i) => i.defId === id && i.assigned === null) ?? inv.add(id, 0)).uid;

  // ---- the parade: every engine parked on its own siding, noses level, in sheet-ID order
  const ids = SHEET.map((id, i) => ({ id, n: i + 1 })).filter((e) => e.id);
  ids.forEach((e, k) => {
    const def = defOf(e.id);
    if (!def) return out.skipped.push(e.id);
    const col = k < PAR.perCol ? 0 : 1;
    const x0 = col ? PAR.bx : PAR.ax;
    const y = PAR.y0 + (col ? k - PAR.perCol : k) * PAR.gap;
    const cls = def.gauge === 'narrow' ? 'narrow' : 'regular';
    for (let x = x0; x <= x0 + PAR.len; x++) lay(x, y, 'straight', 1, cls);
    const item = inv.add(e.id, 0);
    const t = new Train([{ uid: item.uid, def, level: item.level }], `${e.n} ${def.name}`);
    for (const l of t.locos) l.inCab = true;
    check(t.spawnAt(g.track, x0 + 1, y, 3), 'spawn failed for ' + e.id);
    const end = x0 + PAR.len;
    const path = findPath(g.track, { x: x0 + 1, y, in: 3 }, (x2, y2) => x2 === end && y2 === y, 1e6, undefined, () => true);
    check(path, 'no path for ' + e.id);
    g.track.resolveRoutes(path);
    t.coal = t.coalCap;
    t.water = t.waterCap;
    t.oil = t.oilCap;
    t.battery = t.batteryCap;
    const keep = { fuelProblem: t.fuelProblem, wireCeiling: t.wireCeiling, refreshModes: t.refreshModes };
    t.fuelProblem = () => null;
    t.wireCeiling = () => null;
    t.refreshModes = () => {
      for (const l of t.locos) l.engaged = true;
    };
    item.assigned = t.id;
    g.fleet.trains.push(t);
    t.setPath(path.map((s) => ({ ...s })), g.map, g.track);
    t.trackVersion = g.track.version;
    t.setState('moving');
    out.parked.push({ n: e.n, id: e.id, y, x0, keep, t });
  });
  // every parked engine runs to the end of its siding and stops there
  let k = 0;
  while (out.parked.some((p) => p.t.state === 'moving') && k++ < 6000) step(1);
  for (const p of out.parked) {
    delete p.t.fuelProblem;
    delete p.t.wireCeiling;
    delete p.t.refreshModes;
    p.state = p.t.state;
    p.L = vehicleSpec(p.t.locos[0].def).L;
    p.head = p.t.vehiclePoses[0] ? +p.t.vehiclePoses[0].x.toFixed(2) : null;
    delete p.t;
    delete p.keep;
  }

  // ---- running trains, rolled out of the depots the way a player does
  const roll = (locoId, wagons, stops, name) => {
    // the gate may still be taken by the train before: give it time
    let r = g.fleet.create([get(locoId)], wagons.map(get), stops, name);
    for (let tries = 0; typeof r === 'string' && tries < 12; tries++) {
      step(300);
      r = g.fleet.create([get(locoId)], wagons.map(get), stops, name);
    }
    if (typeof r === 'string') return out.trains.push(`${name}: ${r}`);
    r.coal = r.coalCap;
    r.water = r.waterCap;
    r.oil = r.oilCap;
    for (const stop of r.schedule) stop.waitFull = false;
    out.trains.push(r.name);
  };
  roll('flying_scotsman', ['steel_coach', 'pullman'], [L.farm.id, L.wh.id], 'Scotsman');
  roll('mk48', ['mine_tub', 'mine_tub', 'narrow_box'], [N.quarry.id, N.wh.id], 'Narrow 1');
  step(900);
  roll('big_boy', ['steel_hopper', 'steel_hopper', 'steel_hopper'], [L.farm.id, L.wh.id], 'Big Boy');
  roll('rocket', ['mine_tub', 'mine_tub'], [N.quarry.id, N.wh.id], 'Narrow 2');
  step(900);
  roll('dda40x', ['boxcar', 'boxcar', 'boxcar'], [L.farm.id, L.wh.id], 'Centennial');
  roll('mav490', ['narrow_coach', 'narrow_box'], [N.quarry.id, N.wh.id], 'Narrow 3');
  step(600);

  // ---- a spare of every engine and some wagons in the inventory, to build more trains at the depots
  for (const e of ids) if (defOf(e.id)) inv.add(e.id, 0);
  for (const w of ['boxcar', 'steel_hopper', 'steel_coach', 'pullman', 'mine_tub', 'narrow_box', 'narrow_coach']) for (let i = 0; i < 4; i++) inv.add(w, 0);
  // early afternoon: dusk and night follow within a couple of minutes of play
  g.clock.time = 0.58 * daySeconds();
  out.states = g.fleet.trains.map((t) => `${t.name}:${t.state}`);
  return out;
}
function saveJson() {
  const j = g.snapshot();
  j.clock.speedIndex = 1;
  // open on the parade
  const at = tileToWorld(PAR.ax + 20, PAR.y0 + 10);
  j.camera = { ...j.camera, x: at.x, y: at.y };
  return JSON.stringify(j);
}
function view(cx, cy, zoom = 1, hour = null) {
  const at = tileToWorld(cx, cy);
  g.camera.centerOn(at.x, at.y);
  g.camera.zoom = zoom;
  if (hour !== null) g.clock.time = (hour / 24) * daySeconds();
  g.render(1, 0);
  g.render(1, 0);
  g.app.renderer.render(g.app.stage);
  document.getElementById('qa-label').textContent = '';
}
async function settle(ms = 30000) {
  const t0 = performance.now();
  while (performance.now() - t0 < ms) {
    g.render(1, 0);
    if (g.world.landscape.failed || g.world.landscape.sharpReady) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  g.render(1, 0);
  g.app.renderer.render(g.app.stage);
}
window.qa = { g, build, saveJson, view, settle, step, L, N, PAR, SEED, treesAtParade };
