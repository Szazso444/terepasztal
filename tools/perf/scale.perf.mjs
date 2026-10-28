// Headless scaling benchmark: how Signals.ahead, findPath and one simulation tick (SimStep.run)
// grow with path length, map size and the number of trains. It is a measurement, not a test: it
// asserts nothing and prints tables. Its name keeps it out of the regular `npm test` run (whose
// include is `src/**/*.test.ts` and `tools/**/*.test.mjs`); it runs only through its own config:
//
//   npx vitest run --config tools/perf/vitest.perf.config.ts
//
// It is .mjs rather than .ts because tsconfig.node.json type-checks `tools/**/*.ts` without the
// DOM library, and the simulation modules it imports reach src/engine/audio.ts, which needs it.
//
// Environment (all optional):
//   PERF_CASES   comma-separated SimStep case ids (see CASES), or `all`; default: DEFAULT_CASES
//   PERF_TICKS   timed ticks per case (default 600, after as many warm-up ticks)
//   PERF_ONLY    `sim` to skip the Signals.ahead and findPath tables
//   PERF_OUT     write every table as JSON to this path
//   PERF_PROF    write a V8 CPU profile of the timed ticks (of the last case) to this path

import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { Session } from 'node:inspector/promises';
import { TrackGraph } from '../../src/world/track';
import { Signals } from '../../src/sim/signals';
import { Dir } from '../../src/engine/iso';
import { findPath } from '../../src/world/pathfinding';
import { simWorld, line, station } from '../../src/testing/simWorld';
import { SimStep } from '../../src/sim/step';
import { SIM_STEP } from '../../src/sim/time';

const out = {};
const env = process.env;
const TICKS = Number(env.PERF_TICKS ?? 600);

/** Mean ms per call of `fn`, called for at least `minMs`. */
function time(fn, minMs = 300) {
  let n = 0;
  const t0 = performance.now();
  while (performance.now() - t0 < minMs) {
    fn();
    n++;
  }
  return (performance.now() - t0) / n;
}

/** A forced collection between cases, when the worker runs with --expose-gc (the config's). */
function collect() {
  globalThis.gc?.();
}

it.skipIf(env.PERF_ONLY === 'sim')(
  'Signals.ahead: cost against path length and signals on the path',
  () => {
    const W = 6000;
    const rows = [];
    for (const [P, spacing] of [
      [100, 10],
      [200, 10],
      [400, 10],
      [800, 10],
      [1600, 10],
      [400, 40],
      [400, 20],
      [400, 5],
    ]) {
      const track = new TrackGraph(W, 4);
      for (let x = 1; x < W - 1; x++) track.place(x, 1, 'straight', 1);
      const sig = new Signals(track);
      const decor = [];
      for (let x = 10; x < W - 10; x += spacing) decor.push({ id: 'signal', x, y: 1, rot: Dir.E });
      sig.rebuild(decor);
      const path = Array.from({ length: P }, (_, i) => ({
        x: 5 + i,
        y: 1,
        in: Dir.W,
        out: Dir.E,
        arc: i,
      }));
      const free = () => false;
      const ms = time(() => sig.ahead(path, free));
      rows.push({
        pathTiles: P,
        spacing,
        signalsOnPath: Math.floor(P / spacing),
        msPerCall: +ms.toFixed(4),
      });
    }
    out.signalsAhead = rows;
    console.table(rows);
  },
);

it.skipIf(env.PERF_ONLY === 'sim')('findPath along one straight line: cost against length', () => {
  const rows = [];
  for (const size of [160, 320, 480, 960]) {
    const track = new TrackGraph(size, 8);
    for (let x = 1; x < size - 1; x++) track.place(x, 2, 'straight', 1);
    const tx = size - 3;
    const ms = time(() =>
      findPath(track, { x: 2, y: 2, in: Dir.W }, (x, y) => x === tx && y === 2),
    );
    rows.push({ lineTiles: size - 2, msPerCall: +ms.toFixed(4) });
  }
  out.findPathLine = rows;
  console.table(rows);
});

/**
 * The SimStep cases. Each is `trains` straight single-track lines of `route` tiles on a flat grass
 * map of side `map`, one train per line shuttling quarry -> warehouse with a depot at the line's
 * west end, and with `signals` a signal every 10 tiles (absolute block). Lines are 4 rows apart.
 */
const CASES = [
  // the default set: train count and route length varied on one map size
  { id: 'r130-t8', map: 480, route: 130, trains: 8, signals: false },
  { id: 'r130-t64', map: 480, route: 130, trains: 64, signals: false },
  { id: 'r130-t100', map: 480, route: 130, trains: 100, signals: false },
  { id: 'r450-t8', map: 480, route: 450, trains: 8, signals: false },
  { id: 'r450-t64', map: 480, route: 450, trains: 64, signals: false },
  { id: 'r450-t100', map: 480, route: 450, trains: 100, signals: false },
  // the 2026-10-27 report's other rows: the small map, 32 trains, dense signals
  { id: 'm160-r130-t8', map: 160, route: 130, trains: 8, signals: false },
  { id: 'r450-t32', map: 480, route: 450, trains: 32, signals: false },
  { id: 'r450-t64-sig', map: 480, route: 450, trains: 64, signals: true },
  { id: 'r450-t100-sig', map: 480, route: 450, trains: 100, signals: true },
];
const DEFAULT_CASES = ['r130-t8', 'r130-t64', 'r130-t100', 'r450-t8', 'r450-t64', 'r450-t100'];

function selected() {
  const ask = env.PERF_CASES;
  if (ask === 'all') return CASES;
  const ids = ask ? ask.split(',').map((s) => s.trim()) : DEFAULT_CASES;
  const unknown = ids.filter((id) => !CASES.some((c) => c.id === id));
  if (unknown.length)
    throw new Error(`unknown PERF_CASES ${unknown.join(', ')}; known: ${CASES.map((c) => c.id)}`);
  return CASES.filter((c) => ids.includes(c.id));
}

/** Build a case's world; returns one tick of it and what the table reports. */
function setUp(c) {
  if (c.map < c.route + 20 || c.map < 10 + 4 * c.trains)
    throw new Error(`case ${c.id}: ${c.trains} lines of ${c.route} tiles do not fit ${c.map}²`);
  const w = simWorld({ size: c.map, terrain: 'grass', seed: 4242 });
  w.builder.free = true;
  for (let i = 0; i < w.regions.unlocked.length; i++) w.regions.own(i);
  w.stock.add('coal', 1e7, 1e9);
  w.stock.add('water', 1e7, 1e9);
  w.stock.add('wood', 1e7, 1e9);
  w.economy.money = 1e9;
  const L = c.route;
  // the fixture recomputes the whole map's rail beds on every placed tile: lay first, then once
  const onTrack = w.builder.onTrackChanged;
  w.builder.onTrackChanged = null;
  for (let k = 0; k < c.trains; k++) line(w, 4, 6 + 4 * k, 4 + L);
  w.builder.onTrackChanged = onTrack;
  onTrack?.(4, 6);
  for (let k = 0; k < c.trains; k++) {
    const y = 6 + 4 * k;
    const depot = station(w, 'depot', 2, y);
    const q = station(w, 'quarry', 12, y - 1);
    const wh = station(w, 'warehouse', 4 + L - 10, y - 1);
    q.store('stone', 1000);
    if (c.signals) for (let x = 20; x < L; x += 10) w.builder.placeDecor(x, y, 'signal', Dir.E);
    const loco = w.inventory.add('mav375', 0);
    const hop = w.inventory.add('wood_hopper', 0);
    const tr = w.fleet.create(
      [loco.uid],
      [hop.uid],
      [q.id, wh.id],
      undefined,
      'schedule',
      depot.id,
    );
    if (typeof tr === 'string') throw new Error(`case ${c.id}: line ${k}: ${tr}`);
    tr.coal = tr.coalCap;
    tr.water = 1000;
  }
  if (c.signals) w.fleet.signals.level = 'absolute_block';
  const step = new SimStep(w);
  const ctx = { mode: 'play', weather: false, stockCap: () => 1e9 };
  return {
    tick() {
      w.clock.time += SIM_STEP;
      step.run(SIM_STEP, ctx);
    },
    trains: () => w.fleet.trains.length,
    signals: () => w.fleet.signals.count,
    states() {
      const s = {};
      for (const t of w.fleet.trains) s[t.state] = (s[t.state] ?? 0) + 1;
      return s;
    },
  };
}

it('SimStep.run: ms per tick against trains and route length', async () => {
  const rows = [];
  for (const c of selected()) {
    collect();
    const s = setUp(c);
    for (let i = 0; i < TICKS; i++) s.tick();
    collect();
    const samples = [];
    const prof = env.PERF_PROF ? new Session() : null;
    if (prof) {
      prof.connect();
      await prof.post('Profiler.enable');
      await prof.post('Profiler.setSamplingInterval', { interval: 200 });
      await prof.post('Profiler.start');
    }
    for (let i = 0; i < TICKS; i++) {
      const t0 = performance.now();
      s.tick();
      samples.push(performance.now() - t0);
    }
    if (prof) {
      const { profile } = await prof.post('Profiler.stop');
      writeFileSync(env.PERF_PROF, JSON.stringify(profile));
      prof.disconnect();
    }
    samples.sort((a, b) => a - b);
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const trains = s.trains();
    const row = {
      case: c.id,
      map: c.map,
      route: c.route,
      trains,
      signals: s.signals(),
      meanMs: +mean.toFixed(3),
      p95Ms: +samples[Math.floor(samples.length * 0.95)].toFixed(3),
      maxMs: +samples[samples.length - 1].toFixed(2),
      perTrainUs: +((mean / Math.max(1, trains)) * 1000).toFixed(1),
      states: JSON.stringify(s.states()),
    };
    rows.push(row);
    // a line per case as it finishes, so a long run shows progress
    console.log(
      `${row.case}: ${row.meanMs} ms/tick (p95 ${row.p95Ms}, max ${row.maxMs}), ` +
        `${row.perTrainUs} µs/train`,
    );
  }
  out.simStep = rows;
  console.table(rows);
  if (env.PERF_OUT) writeFileSync(env.PERF_OUT, JSON.stringify(out, null, 1));
}, 0);
