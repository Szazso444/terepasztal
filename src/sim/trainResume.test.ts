import { describe, it, expect, beforeEach } from 'vitest';
import { emptyMap } from '../world/mapgen';
import { Terrain, type GameMap } from '../world/tiles';
import { RegionState } from '../world/regions';
import { TrackGraph } from '../world/track';
import { Dir } from '../engine/iso';
import type { Rng } from '../engine/rng';
import { Builder } from './build';
import { Stockpile } from './stockpile';
import { Economy } from './economy';
import { Station, resetStationIds, type StationJSON } from './stations';
import { Train, defaultStop, resetTrainIds, type RouteMode, type TrainState } from './trains';
import { Fleet } from './fleet';
import { rules, DEFAULT_RULES } from './rules';
import { setSupplyMode, DEFAULT_SUPPLY } from './supply';
import { migrate, SAVE_VERSION, type SaveGame } from './save';
import { Inventory } from '../gacha/inventory';
import { locoDef, wagonDef } from '../gacha/items';
import { SEEDS, forAll, shrinkArray, shrinkInt } from '../testing/property';
import {
  buildTrafficScenario,
  sharedTiles,
  SCENARIO_GDT,
  SCENARIO_MAX_TICKS,
  SCENARIO_ROW,
  SCENARIO_TICK_RATE,
} from '../testing/trafficScenario';

// Trains carry on after a load (issue #81). A train saved while moving or loading, taken through
// toJSON, JSON and fromJSON into a fresh fleet on the same track, runs on as the uninterrupted
// control does; only its path is planned again. A v13 save's trains stand without a route, as
// every load left them before. Further down: the same held at any tick of generated lines, a load
// that moves no car, a save made between a load and the first tick, and the traffic scenarios
// with a round trip mid-run.

beforeEach(() => {
  Object.assign(rules, DEFAULT_RULES);
  setSupplyMode(DEFAULT_SUPPLY);
  resetTrainIds(1);
  resetStationIds(1);
});

const SIZE = 96;
const ROW = 30;
const GDT = 0.05;
/** Game seconds both runs go on after the save. */
const AFTER = 30;
/** How far apart any car of the loaded train and of the control may stand then, in tiles. */
const TOLERANCE = 0.01;
/** Game seconds of the control run the save moments are drawn from: its first rounds. */
const SPAN = 150;

type TrainJSON = ReturnType<Train['toJSON']>;
/** What `Train.toJSON` writes since v14, which a v13 build did not. */
const V14_FIELDS = [
  'state',
  'stateTime',
  'speed',
  'station',
  'holding',
  'blockedTime',
  'yieldCount',
] as const;

interface World {
  map: GameMap;
  track: TrackGraph;
  regions: RegionState;
  stock: Stockpile;
  economy: Economy;
  builder: Builder;
  fleet: Fleet;
  /** stations the fleet reported a train arriving at, in order */
  arrivals: number[];
}

/** A fleet over `builder`, reporting arrivals into the world's list. */
function fleetOf(w: Omit<World, 'fleet'>): Fleet {
  const fleet = new Fleet(w.track, w.builder, w.map, new Inventory(), w.economy, w.stock);
  fleet.onArrive = (_t, s) => void w.arrivals.push(s.id);
  return fleet;
}

/**
 * The line of `world()` in expansion.test.ts (row 30, x 2 to 89 on a grass map) with a quarry at
 * x 20, its stone waiting, and a warehouse at x 70 on it, and a diesel with a hopper starting at
 * x 45 on a schedule between them.
 */
function scene(): World {
  const map = emptyMap(4242, SIZE, SIZE, Terrain.Grass);
  const track = new TrackGraph(SIZE, SIZE);
  for (let x = 2; x < 90; x++) track.place(x, ROW, 'straight', 1);
  const regions = new RegionState(map);
  const stock = new Stockpile();
  const economy = new Economy();
  const builder = new Builder(map, regions, track, economy, stock);
  builder.free = true;
  const quarry = new Station('quarry', 20, ROW - 1);
  quarry.storage.set('stone', 40);
  const warehouse = new Station('warehouse', 70, ROW - 1);
  builder.stations.push(quarry, warehouse);
  const w = { map, track, regions, stock, economy, builder, arrivals: [] as number[] };
  const fleet = fleetOf(w);
  const t = new Train([{ uid: 1, level: 1, def: locoDef('f7') }]);
  t.wagons = [
    { uid: 2, def: wagonDef('wood_hopper'), level: 1, cargo: null, amount: 0, origin: null },
  ];
  expect(t.spawnAt(track, 45, ROW, Dir.E)).toBe(true);
  t.oil = t.oilCap;
  t.schedule = [defaultStop(quarry.id), defaultStop(warehouse.id)];
  fleet.trains.push(t);
  return { ...w, fleet };
}

/** What a save keeps of a world: its trains, stations, stockpile and economy, as JSON. */
function saved(w: World): string {
  return JSON.stringify({
    trains: w.fleet.trains.map((t) => t.toJSON()),
    stations: w.builder.stations.map((s) => s.toJSON()),
    stock: w.stock.toJSON(),
    economy: w.economy.toJSON(),
  });
}

/**
 * The world a load builds from `text`: the same map and track, the stations, stockpile and
 * economy read back, and the trains through `Train.fromJSON` into a fresh fleet.
 */
function loaded(w: World, text: string, edit?: (j: { stations: StationJSON[] }) => void): World {
  const j = JSON.parse(text) as {
    trains: TrainJSON[];
    stations: StationJSON[];
    stock: ReturnType<Stockpile['toJSON']>;
    economy: ReturnType<Economy['toJSON']>;
  };
  edit?.(j);
  const stock = new Stockpile();
  stock.load(j.stock);
  const economy = new Economy();
  economy.load(j.economy);
  const builder = new Builder(w.map, w.regions, w.track, economy, stock);
  builder.free = true;
  for (const s of j.stations) builder.stations.push(Station.fromJSON(s));
  const { map, track, regions } = w;
  const back = { map, track, regions, stock, economy, builder, arrivals: [] as number[] };
  const fleet = fleetOf(back);
  for (const t of j.trains) fleet.trains.push(Train.fromJSON(t, track));
  return { ...back, fleet };
}

/** One step of the world at game time `now`, as the game steps the fleet. */
const step = (w: World, now: number) => w.fleet.tick(GDT, now);
/** Game time after tick `i` (0-based) of a run. */
const timeOf = (i: number) => (i + 1) * GDT;

/** The farthest any car in `a` stands from the same car in `b`, in tiles. */
function apart(a: readonly { x: number; y: number }[], b: readonly { x: number; y: number }[]) {
  expect(b.length).toBe(a.length);
  return Math.max(...a.map((p, i) => Math.hypot(p.x - b[i].x, p.y - b[i].y)));
}

/** The uninterrupted run, after each of its ticks. */
interface Control {
  /** the world it ran in: a load keeps its map and track */
  world: World;
  /** the save, for the ticks before SPAN */
  texts: string[];
  states: TrainState[];
  poses: { x: number; y: number }[][];
  /** how many arrivals `world.arrivals` held */
  arrived: number[];
}
let cached: Control | null = null;
/** The control, run once for SPAN + AFTER game seconds and kept for every test. */
function control(): Control {
  if (cached) return cached;
  resetTrainIds(1);
  resetStationIds(1);
  const world = scene();
  const c: Control = { world, texts: [], states: [], poses: [], arrived: [] };
  for (let i = 0; i < (SPAN + AFTER) / GDT; i++) {
    step(world, timeOf(i));
    const t = world.fleet.trains[0];
    c.texts.push(i < SPAN / GDT ? saved(world) : '');
    c.states.push(t.state);
    c.poses.push(t.poses.map((p) => ({ x: p.x, y: p.y })));
    c.arrived.push(world.arrivals.length);
  }
  return (cached = c);
}
const controlWorld = () => control().world;

/** Ticks of the control after which the train is in `state`, early enough to run AFTER on. */
function savesIn(state: TrainState): number[] {
  const c = control();
  const out: number[] = [];
  for (let i = 0; i < SPAN / GDT; i++) if (c.states[i] === state) out.push(i);
  return out;
}

/**
 * Save after tick `i` of the control, load into a fresh fleet on the same track and run AFTER
 * game seconds: every car within TOLERANCE of the control's, in the control's state, having
 * arrived where the control arrived, and nowhere else (a train standing at a platform when loaded
 * has not arrived there again).
 */
function carriesOn(i: number) {
  const c = control();
  const w = loaded(controlWorld(), c.texts[i]);
  const end = i + AFTER / GDT;
  for (let k = i + 1; k <= end; k++) step(w, timeOf(k));
  const t = w.fleet.trains[0];
  expect(apart(c.poses[end], t.poses), `tiles from the control ${AFTER} s on`).toBeLessThan(
    TOLERANCE,
  );
  expect(t.state, 'state').toBe(c.states[end]);
  expect(w.arrivals, 'arrivals').toEqual(c.world.arrivals.slice(c.arrived[i], c.arrived[end]));
}

describe('a train saved and loaded mid-run', () => {
  for (const state of ['moving', 'loading'] as const)
    it(`carries on as if never saved when it was ${state}`, { timeout: 120_000 }, () => {
      const saves = savesIn(state);
      // the run has enough of each to choose from
      expect(saves.length).toBeGreaterThan(200);
      forAll(
        (rng) => rng.int(0, saves.length - 1),
        (k) => carriesOn(saves[k]),
        { shrink: (k) => shrinkInt(k), format: (k) => `the save after tick ${saves[k]}` },
      );
    });

  it('keeps its speed under way and its place on the platform', () => {
    const c = control();
    for (const state of ['moving', 'loading'] as const) {
      const i = savesIn(state)[40];
      const was = JSON.parse(c.texts[i]) as { trains: TrainJSON[] };
      const w = loaded(controlWorld(), c.texts[i]);
      const t = w.fleet.trains[0];
      expect(t.state, state).toBe(state);
      expect(t.speed, state).toBe(was.trains[0].speed);
      expect(t.stateTime, state).toBe(was.trains[0].stateTime);
      // before its first tick the train cannot look its station up; then it stands there
      expect(t.atStation, state).toBeNull();
      step(w, timeOf(i + 1));
      const st = state === 'loading' ? w.builder.stationById(was.trains[0].station!)! : null;
      expect(t.atStation, state).toBe(st);
      if (st) expect([...st.occupants], state).toEqual([t.id]);
      if (state === 'moving')
        expect(t.pathAhead().length, 'a path planned again').toBeGreaterThan(0);
    }
  });
});

describe('two trains at a one-platform station, loaded', () => {
  /** A train of the scene's make standing at `x`, facing west, in `state` at the quarry. */
  function at(w: World, id: number, x: number, state: 'loading' | 'waiting') {
    const quarry = w.builder.stations[0];
    const t = new Train([{ uid: 10 * id + 1, level: 1, def: locoDef('f7') }], undefined, id);
    t.wagons = [
      {
        uid: 10 * id + 2,
        def: wagonDef('wood_hopper'),
        level: 1,
        cargo: null,
        amount: 0,
        origin: null,
      },
    ];
    expect(t.spawnAt(w.track, x, ROW, Dir.E)).toBe(true);
    t.oil = t.oilCap;
    t.schedule = [defaultStop(quarry.id), defaultStop(w.builder.stations[1].id)];
    t.state = state;
    t.atStation = quarry;
    if (state === 'loading') quarry.occupants.add(t.id);
    return t;
  }

  it('leaves the one waiting for the platform waiting, whichever of them ticks first', () => {
    for (const waitingFirst of [true, false]) {
      resetTrainIds(1);
      resetStationIds(1);
      const w = scene();
      const quarry = w.builder.stations[0];
      expect(quarry.platforms).toBe(1);
      const plat = w.builder.platformTiles(quarry)[0];
      const loading = at(w, 1, plat.x, 'loading');
      const waiting = at(w, 2, plat.x + 6, 'waiting');
      w.fleet.trains = waitingFirst ? [waiting, loading] : [loading, waiting];
      const back = loaded(w, saved(w));
      step(back, GDT);
      const [a, b] = waitingFirst ? back.fleet.trains.slice().reverse() : back.fleet.trains;
      const st = back.builder.stations[0];
      expect(a.state).toBe('loading');
      expect(b.state, `waiting ticks ${waitingFirst ? 'first' : 'second'}`).toBe('waiting');
      expect(a.atStation).toBe(st);
      expect(b.atStation).toBe(st);
      expect([...st.occupants]).toEqual([a.id]);
      // standing there already: neither arrives
      expect(back.arrivals).toEqual([]);
    }
  });

  it('stands a train whose station the save no longer has without a route', () => {
    const w = scene();
    const quarry = w.builder.stations[0];
    const t = at(w, 1, w.builder.platformTiles(quarry)[0].x, 'loading');
    w.fleet.trains = [t];
    const back = loaded(w, saved(w), (j) => (j.stations = j.stations.slice(1)));
    step(back, GDT);
    const b = back.fleet.trains[0];
    expect(b.state).toBe('noRoute');
    expect(b.atStation).toBeNull();
  });
});

describe('a train backing off for another when saved', () => {
  it('stops and plans again: its escape was reserved, and reservations are not saved', () => {
    const c = control();
    const i = savesIn('moving')[60];
    const j = JSON.parse(c.texts[i]) as { trains: TrainJSON[] };
    j.trains[0].holding = true;
    const w = loaded(controlWorld(), JSON.stringify(j));
    step(w, timeOf(i + 1));
    const t = w.fleet.trains[0];
    expect(t.holding).toBe(false);
    expect(t.state).toBe('yielding');
    expect(t.speed).toBe(0);
  });
});

describe('a v13 save', () => {
  /** A save as a v13 build wrote it around the control's train after tick `i`. */
  function v13(i: number): SaveGame {
    const j = JSON.parse(control().texts[i]) as { trains: Record<string, unknown>[] };
    for (const t of j.trains) for (const key of V14_FIELDS) delete t[key];
    return {
      version: 13,
      savedAt: 0,
      seed: 4242,
      clock: { time: timeOf(i), speedIndex: 1 },
      economy: { money: 0, tickets: 0, tier: 0, granted: [] },
      track: [],
      stations: [],
      trains: j.trains,
      contracts: { contracts: [] },
      inventory: { items: [] },
      gacha: {},
      camera: { x: 0, y: 0, zoomIndex: 2 },
      lastDay: 0,
    };
  }

  it("gives its trains the step's values, so they load standing without a route", () => {
    for (const state of ['moving', 'loading'] as const) {
      const i = savesIn(state)[40];
      const j = migrate(v13(i));
      expect(j.version).toBe(SAVE_VERSION);
      const stored = j.trains[0] as TrainJSON;
      expect(
        Object.fromEntries(V14_FIELDS.map((k) => [k, stored[k]])),
        `a train saved ${state}`,
      ).toEqual({
        state: 'noRoute',
        stateTime: 10,
        speed: 0,
        station: null,
        holding: false,
        blockedTime: 0,
        yieldCount: 0,
      });
      const t = Train.fromJSON(
        JSON.parse(JSON.stringify(stored)) as TrainJSON,
        controlWorld().track,
      );
      expect(t.state, state).toBe('noRoute');
      expect(t.speed, state).toBe(0);
      expect(t.stateTime, state).toBe(10);
      // and on its first tick it looks for its route, as every loaded train did before v14: one
      // under way sets off again from a standstill, one on the platform arrives there again
      const text = JSON.parse(control().texts[i]) as { trains: unknown[] };
      text.trains = j.trains;
      const w = loaded(controlWorld(), JSON.stringify(text));
      step(w, timeOf(i + 1));
      const back = w.fleet.trains[0];
      expect(back.state, state).toBe(state);
      expect(back.speed, state).toBe(0);
      if (state === 'loading') expect(w.arrivals, state).toEqual([back.atStation!.id]);
    }
  });
});

// ------------------------------------------------------------------ generated single-train lines
// The round trip at any tick, not only while moving or loading, on lines generated from a seed:
// two to four stations on the line, sometimes a siding with one more, a diesel or a steam engine
// with full or low tanks, on a schedule or roaming.

/** Game seconds of a generated run the save moments are drawn from. */
const LAYOUT_SPAN = 200;
/** Columns a station on the line may take: six apart, clear of both columns of every switch. */
const SLOTS = Array.from({ length: 14 }, (_, i) => 8 + 6 * i);
/** Columns a switch to a siding may stand at. */
const SIDINGS = [11, 23, 35, 47, 59, 71, 83];
type Kind = 'quarry' | 'warehouse' | 'farm' | 'depot';
const KINDS: readonly Kind[] = ['quarry', 'warehouse', 'farm', 'depot'];
const ROAMING: readonly RouteMode[] = ['production', 'collection'];

/** One train on the scene's line, the stations it may serve, and the tick it is saved after. */
interface Layout {
  loco: 'f7' | 'john_bull';
  mode: RouteMode;
  /** on the line by column, a quarry and a warehouse first; a stocked one holds goods */
  sites: { kind: Kind; x: number; stocked: boolean }[];
  /**
   * the column of a 2×2 switch whose diverging leg turns south off the line into an eight-tile
   * siding, with a stocked warehouse beside the siding's fifth tile
   */
  siding: number | null;
  trainX: number;
  east: boolean;
  /** share of full tanks it starts with */
  fuel: number;
  /** the save follows this tick (0-based) of the run */
  tick: number;
}

function layout(rng: Rng, modes: readonly RouteMode[]): Layout {
  const slots = rng.shuffle([...SLOTS]);
  const n = rng.int(2, 4);
  return {
    loco: rng.pick(['f7', 'john_bull'] as const),
    mode: rng.pick(modes),
    sites: slots.slice(0, n).map((x, i) => ({
      kind: i === 0 ? 'quarry' : i === 1 ? 'warehouse' : rng.pick(KINDS),
      x,
      stocked: i === 0 || rng.chance(0.6),
    })),
    siding: rng.chance(0.5) ? rng.pick(SIDINGS) : null,
    trainX: rng.int(12, 80),
    east: rng.chance(0.5),
    fuel: rng.pick([1, 0.5, 0.2]),
    tick: rng.int(0, LAYOUT_SPAN / GDT - 1),
  };
}
/** Fewer stations, no siding, full tanks, the diesel, then an earlier save. */
function* shrinkLayout(c: Layout): Iterable<Layout> {
  for (const rest of shrinkArray(c.sites.slice(2)))
    yield { ...c, sites: [...c.sites.slice(0, 2), ...rest] };
  if (c.siding !== null) yield { ...c, siding: null };
  if (c.fuel !== 1) yield { ...c, fuel: 1 };
  if (c.loco !== 'f7') yield { ...c, loco: 'f7' };
  for (const tick of shrinkInt(c.tick)) yield { ...c, tick };
}

/**
 * The scene's line with the layout's stations and siding, and its train with a hopper, set off
 * on a schedule between the first two stations or switched to its roaming mode as a player does.
 */
function layoutScene(c: Layout): World {
  resetTrainIds(1);
  resetStationIds(1);
  const map = emptyMap(4242, SIZE, SIZE, Terrain.Grass);
  const track = new TrackGraph(SIZE, SIZE);
  for (let x = 2; x < 90; x++) track.place(x, ROW, 'straight', 1);
  if (c.siding !== null) {
    // the diverging leg runs through the unit's own tile below the anchor and leaves it by its
    // south edge; the siding starts under that, so no plain straight replaces a member of the
    // unit and breaks the curve
    track.place(c.siding, ROW, 'switch', 1);
    for (let y = ROW + 2; y <= ROW + 9; y++) track.place(c.siding, y, 'straight', 0);
  }
  const regions = new RegionState(map);
  const stock = new Stockpile();
  const economy = new Economy();
  const builder = new Builder(map, regions, track, economy, stock);
  builder.free = true;
  const put = (kind: Kind, x: number, y: number, stocked: boolean) => {
    const s = new Station(kind, x, y);
    if (stocked && kind === 'farm') s.storage.set('wheat', 30);
    else if (stocked && kind !== 'depot') s.storage.set('stone', 40);
    builder.stations.push(s);
    return s;
  };
  const sites = c.sites.map((s) => put(s.kind, s.x, ROW - 1, s.stocked));
  if (c.siding !== null) sites.splice(1, 0, put('warehouse', c.siding + 1, ROW + 6, true));
  const w = { map, track, regions, stock, economy, builder, arrivals: [] as number[] };
  const fleet = fleetOf(w);
  const t = new Train([{ uid: 1, level: 1, def: locoDef(c.loco) }]);
  t.wagons = [
    { uid: 2, def: wagonDef('wood_hopper'), level: 1, cargo: null, amount: 0, origin: null },
  ];
  expect(t.spawnAt(track, c.trainX, ROW, c.east ? Dir.W : Dir.E)).toBe(true);
  t.coal = t.coalCap * c.fuel;
  t.oil = t.oilCap * c.fuel;
  t.water = t.waterCap * c.fuel;
  t.schedule = sites.slice(0, 2).map((s) => defaultStop(s.id));
  fleet.trains.push(t);
  if (c.mode !== 'schedule') expect(fleet.setMode(t, c.mode)).toEqual({ ok: true });
  return { ...w, fleet };
}

/** A warehouse is worth collecting from with what a level 1 store holds (as in fleet.test.ts). */
const roamingRules = () => void (rules.collectMin = 30);

/**
 * The fleet's own memory of when a train last loaded at each station, which a roaming train's
 * pick weighs. A save does not hold it and src/sim/fleet.ts is outside issue #81, so the roaming
 * property carries it across the round trip itself, to hold the train to what the train saves.
 */
const lastServed = (f: Fleet) => (f as unknown as { lastServed: Map<number, number> }).lastServed;

/** What a train is doing and carries, and where it has arrived since the save. */
interface Doing {
  state: TrainState;
  arrivals: number[];
  cargo: (string | null)[];
  /** cargo aboard each wagon, then coal, oil and water in the tanks */
  amounts: number[];
}
const doingOf = (t: Train, arrivals: number[]): Doing => ({
  state: t.state,
  arrivals,
  cargo: t.wagons.map((x) => x.cargo),
  amounts: [...t.wagons.map((x) => x.amount), t.coal, t.oil, t.water],
});
const sameDoing = (a: Doing, b: Doing) =>
  a.state === b.state &&
  JSON.stringify(a.arrivals) === JSON.stringify(b.arrivals) &&
  JSON.stringify(a.cargo) === JSON.stringify(b.cargo) &&
  a.amounts.every((v, i) => Math.abs(v - b.amounts[i]) < 1e-3);

/**
 * Run the layout to its save, AFTER seconds on, and again from the save through toJSON, JSON and
 * fromJSON into a fresh fleet on the same track: every car of the loaded train within TOLERANCE
 * of the control's, doing what the control does, with its cargo and fuel, having arrived where
 * it arrived. A save rounds trail points to a thousandth of a tile, which may move an arrival by
 * a tick, so what the train does may match the control's a tick either side.
 */
function carriesOnFrom(c: Layout, carryFleetMemory = false) {
  const w = layoutScene(c);
  const end = c.tick + AFTER / GDT;
  let text = '';
  let memory = new Map<number, number>();
  let from = 0;
  let poses: { x: number; y: number }[] = [];
  const around: Doing[] = [];
  for (let i = 0; i <= end + 1; i++) {
    step(w, timeOf(i));
    const t = w.fleet.trains[0];
    if (i >= end - 1) around.push(doingOf(t, w.arrivals.slice(from)));
    if (i === end) poses = t.poses.map((p) => ({ x: p.x, y: p.y }));
    if (i !== c.tick) continue;
    text = saved(w);
    memory = new Map(lastServed(w.fleet));
    from = w.arrivals.length;
  }
  const back = loaded(w, text);
  if (carryFleetMemory) for (const [id, at] of memory) lastServed(back.fleet).set(id, at);
  for (let k = c.tick + 1; k <= end; k++) step(back, timeOf(k));
  const b = back.fleet.trains[0];
  const why = `${AFTER} s after the save`;
  expect(apart(poses, b.poses), `tiles from the control ${why}`).toBeLessThan(TOLERANCE);
  const now = doingOf(b, back.arrivals);
  if (!around.some((d) => sameDoing(d, now))) expect(now, `doing ${why}`).toEqual(around[1]);
}

/**
 * Seeds the generated single-train properties run: half of SEEDS keeps the file's run time near
 * the suite's other long files, with a shrink budget to match.
 */
const LAYOUT_SEEDS = SEEDS.slice(0, 50);
const LAYOUT_SHRINK = 40;
/**
 * Seeds past SEEDS at which a sweep of seeds 101 to 700 found the schedule property failing; they
 * stay in its list. At 242 and 561 an arrival lands a tick late because the save rounds trail
 * points to a thousandth of a tile, and the departure after it follows a tick late; at 631 the
 * train stands on a switch when saved (see 'a load moves no car').
 */
const SCHEDULE_FOUND = [242, 561, 631];

describe('a single train saved at any tick of a generated line', () => {
  it('carries on as if never saved on a schedule', { timeout: 300_000 }, () => {
    forAll(
      (rng) => layout(rng, ['schedule']),
      (c) => carriesOnFrom(c),
      {
        shrink: shrinkLayout,
        shrinkBudget: LAYOUT_SHRINK,
        seeds: [...LAYOUT_SEEDS, ...SCHEDULE_FOUND],
      },
    );
  });

  it('carries on as if never saved when roaming', { timeout: 300_000 }, () => {
    roamingRules();
    forAll(
      (rng) => layout(rng, ROAMING),
      (c) => carriesOnFrom(c, true),
      { shrink: shrinkLayout, shrinkBudget: LAYOUT_SHRINK, seeds: LAYOUT_SEEDS },
    );
  });
});

/**
 * Game seconds of a generated run swept for loads, and the ticks between two of them: a quarter
 * of a second, under half a tile at full speed, so no tile of a 2×2 switch is passed unsaved.
 */
const SWEEP_SPAN = 60;
const SWEEP_EVERY = 5;

describe('a load moves no car', () => {
  it(
    'one tick after a load, every car stands where the uninterrupted run has it',
    { timeout: 300_000 },
    () => {
      // The save keeps each car's place to a thousandth of a tile; a load that plans the path
      // again along another line than the one the train stands on shows here as a jump. Each
      // case loads 240 times, so it runs on fewer seeds.
      roamingRules();
      forAll(
        (rng) => ({ ...layout(rng, ['schedule', ...ROAMING]), tick: 0 }),
        (c) => {
          const w = layoutScene(c);
          let pending: { back: World; after: number } | null = null;
          for (let i = 0; i < SWEEP_SPAN / GDT; i++) {
            step(w, timeOf(i));
            if (pending) {
              const gap = apart(w.fleet.trains[0].poses, pending.back.fleet.trains[0].poses);
              const why = `tiles from the control a tick after loading the save after tick ${pending.after}`;
              expect(gap, why).toBeLessThan(TOLERANCE);
              pending = null;
            }
            if (i % SWEEP_EVERY) continue;
            const back = loaded(w, saved(w));
            for (const [id, at] of lastServed(w.fleet)) lastServed(back.fleet).set(id, at);
            step(back, timeOf(i + 1));
            pending = { back, after: i };
          }
        },
        { shrink: shrinkLayout, shrinkBudget: 20, seeds: SEEDS.slice(0, 30) },
      );
    },
  );
});

describe('a save made after a load, before the first tick', () => {
  it('is the save that was loaded', { timeout: 120_000 }, () => {
    // The game saves on a wall-clock timer and when the page closes, also while the clock stands:
    // a game loaded paused can be saved again before any train has ticked.
    roamingRules();
    forAll(
      (rng) => layout(rng, ['schedule', ...ROAMING]),
      (c) => {
        const w = layoutScene(c);
        for (let i = 0; i <= c.tick; i++) step(w, timeOf(i));
        const was = JSON.parse(JSON.stringify(w.fleet.trains[0].toJSON())) as TrainJSON;
        const back = Train.fromJSON(JSON.parse(JSON.stringify(was)) as TrainJSON, w.track);
        expect(JSON.parse(JSON.stringify(back.toJSON()))).toEqual(was);
      },
      { shrink: shrinkLayout, shrinkBudget: 100 },
    );
  });
});

// ------------------------------------------------------------------ the traffic scenarios
// The refuge scenarios of src/testing/trafficScenario.ts drive their trains by path alone, with
// no stop: a loaded train with no stop has nothing to plan a path to, so it stands without a
// route, which that fixture counts as an arrival. Here each destination column gets a station
// whose platform is that column, and each train that station as its one stop, so a loaded train
// plans its path again as a game's train does, and a yielding one finds its own way on (the
// fixture's resume of yielded trains is not used). A train leaves the run once it stops at its
// own platform. Each uninterrupted run is checked first: it is what a round trip is held to.

interface TrafficCase {
  count: number;
  pinned: boolean;
}
const TRAFFIC: readonly TrafficCase[] = [
  { count: 3, pinned: false },
  { count: 4, pinned: true },
  { count: 12, pinned: false },
];
const caseName = (c: TrafficCase) => `${c.count} trains${c.pinned ? ', pinned' : ''}`;

/** The scenario, with a stop at each destination column and each train bound for its own. */
function trafficWithStops(c: TrafficCase) {
  resetTrainIds();
  resetStationIds();
  const sc = buildTrafficScenario(c.count, c.pinned);
  const stop = new Map<number, number>();
  for (const x of new Set(sc.destinations.values())) {
    const st = new Station('farm', x, SCENARIO_ROW - 1);
    sc.builder.stations.push(st);
    stop.set(x, st.id);
  }
  for (const t of sc.trains) t.schedule = [defaultStop(stop.get(sc.destinations.get(t.id)!)!)];
  return sc;
}

/** How a run from some tick on went, to its end or SCENARIO_MAX_TICKS. */
interface TrafficRun {
  /** the first tick after which two trains stood on one tile, and the tiles, or null */
  shared: string | null;
  overlaps: number;
  deadlocks: number;
  /** trains that had not stopped at their own platform when the run gave up */
  left: string[];
  /** the last tick run */
  end: number;
}

/**
 * Steps `fleet` from tick `from` at the scenario's rate until every train has stopped at its own
 * platform and left the run, or SCENARIO_MAX_TICKS, looking for a shared tile after every tick.
 */
function runTraffic(fleet: Fleet, w: number, from: number, after?: () => void): TrafficRun {
  let shared: string | null = null;
  let tick = from;
  for (; tick < SCENARIO_MAX_TICKS && fleet.trains.length; tick++) {
    fleet.tick(SCENARIO_GDT, tick / SCENARIO_TICK_RATE);
    for (const t of [...fleet.trains])
      if (
        (t.state === 'loading' || t.state === 'waiting') &&
        t.atStation?.id === t.schedule[0]?.stationId
      ) {
        t.recall();
        fleet.trains.splice(fleet.trains.indexOf(t), 1);
      }
    after?.();
    const found = sharedTiles(fleet.trains, w);
    if (found.length && shared === null) shared = `after tick ${tick}: ${JSON.stringify(found)}`;
  }
  const { overlaps, deadlocks } = fleet.traffic.counters;
  const left = fleet.trains.map((t) => `#${t.id} ${t.state} at ${t.headTile?.x},${t.headTile?.y}`);
  return { shared, overlaps, deadlocks, left, end: tick - 1 };
}

/** The uninterrupted run of a case, with a save after every tick. */
interface TrafficControl {
  map: GameMap;
  track: TrackGraph;
  run: TrafficRun;
  /** trains and stations as JSON after each tick */
  texts: string[];
  /** what each train was doing after each tick */
  doing: string[];
  /** ticks after which some train was held up, yielding or backing off for another */
  busy: number[];
}
const trafficControls = new Map<TrafficCase, TrafficControl>();
function trafficControl(c: TrafficCase): TrafficControl {
  const known = trafficControls.get(c);
  if (known) return known;
  const sc = trafficWithStops(c);
  const texts: string[] = [];
  const doing: string[] = [];
  const busy: number[] = [];
  const run = runTraffic(sc.fleet, sc.track.w, 0, () => {
    const trains = sc.fleet.trains;
    texts.push(
      JSON.stringify({
        trains: trains.map((t) => t.toJSON()),
        stations: sc.builder.stations.map((s) => s.toJSON()),
      }),
    );
    doing.push(trains.map((t) => `#${t.id} ${t.state}${t.holding ? ' holding' : ''}`).join(', '));
    if (trains.some((t) => t.holding || t.state === 'yielding' || t.blockedTime > 0))
      busy.push(texts.length - 1);
  });
  const control = { map: sc.map, track: sc.track, run, texts, doing, busy };
  trafficControls.set(c, control);
  return control;
}

/** The control's save after `tick`, loaded into a fresh fleet on the same track. */
function trafficLoaded(c: TrafficControl, tick: number): Fleet {
  const j = JSON.parse(c.texts[tick]) as { trains: TrainJSON[]; stations: StationJSON[] };
  const stock = new Stockpile();
  const economy = new Economy();
  const builder = new Builder(c.map, new RegionState(c.map), c.track, economy, stock);
  builder.free = true;
  for (const s of j.stations) builder.stations.push(Station.fromJSON(s));
  const fleet = new Fleet(c.track, builder, c.map, new Inventory(), economy, stock);
  for (const t of j.trains) fleet.trains.push(Train.fromJSON(t, c.track));
  return fleet;
}

/** A case, by its index in TRAFFIC, and the tick of its uninterrupted run the save follows. */
interface TrafficSave {
  at: number;
  tick: number;
}
const roundTrips = new Map<string, TrafficRun>();
/** The run on from the round trip after the save; each is run once, for both properties. */
function trafficRoundTrip({ at, tick }: TrafficSave): TrafficRun {
  const key = `${at}:${tick}`;
  const known = roundTrips.get(key);
  if (known) return known;
  const c = trafficControl(TRAFFIC[at]);
  const run = runTraffic(trafficLoaded(c, tick), c.track.w, tick + 1);
  roundTrips.set(key, run);
  return run;
}
/**
 * Any tick before the last train of the case left: half the time drawn from all of them, half
 * from those in which trains stand in each other's way, where a round trip has the most to lose.
 */
function trafficSave(rng: Rng): TrafficSave {
  const at = rng.int(0, TRAFFIC.length - 1);
  const c = trafficControl(TRAFFIC[at]);
  const busy = rng.chance(0.5) && c.busy.length > 0;
  return { at, tick: busy ? rng.pick(c.busy) : rng.int(0, c.run.end - 1) };
}
/** Seeds the traffic properties run, and their shrink budget: a 12-train run takes a while. */
const TRAFFIC_SEEDS = SEEDS.slice(0, 60);
const TRAFFIC_SHRINK = 30;
/** Fewer trains, then an earlier save. */
function* shrinkTrafficSave(s: TrafficSave): Iterable<TrafficSave> {
  for (const at of shrinkInt(s.at))
    yield { at, tick: Math.min(s.tick, trafficControl(TRAFFIC[at]).run.end - 1) };
  for (const tick of shrinkInt(s.tick)) yield { ...s, tick };
}
const formatTrafficSave = ({ at, tick }: TrafficSave) =>
  `${caseName(TRAFFIC[at])}, saved after tick ${tick} (${trafficControl(TRAFFIC[at]).doing[tick]})`;

describe('the traffic scenarios with a round trip mid-run', () => {
  for (const c of TRAFFIC)
    it(`${caseName(c)}: run clean without one`, { timeout: 60_000 }, () => {
      const { run, doing } = trafficControl(c);
      expect(run).toEqual({ shared: null, overlaps: 0, deadlocks: 0, left: [], end: run.end });
      // a run in which no train ever pulled aside on a reserved escape proves little
      expect(doing.some((d) => d.includes('holding'))).toBe(true);
    });

  it('never put two trains on one tile, whenever the save is made', { timeout: 300_000 }, () => {
    forAll(
      trafficSave,
      (s) => {
        const run = trafficRoundTrip(s);
        expect({ shared: run.shared, overlaps: run.overlaps }).toEqual({
          shared: null,
          overlaps: 0,
        });
      },
      {
        shrink: shrinkTrafficSave,
        format: formatTrafficSave,
        seeds: TRAFFIC_SEEDS,
        shrinkBudget: TRAFFIC_SHRINK,
      },
    );
  });

  it(
    'never deadlock: every train still stops at its platform, whenever the save is made',
    { timeout: 300_000 },
    () => {
      forAll(
        trafficSave,
        (s) => {
          const run = trafficRoundTrip(s);
          expect({ deadlocks: run.deadlocks, left: run.left }).toEqual({ deadlocks: 0, left: [] });
        },
        {
          shrink: shrinkTrafficSave,
          format: formatTrafficSave,
          seeds: TRAFFIC_SEEDS,
          shrinkBudget: TRAFFIC_SHRINK,
        },
      );
    },
  );
});
