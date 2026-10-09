import { describe, it, expect, beforeEach } from 'vitest';
import { emptyMap } from '../world/mapgen';
import { Terrain, type GameMap } from '../world/tiles';
import { RegionState } from '../world/regions';
import { TrackGraph } from '../world/track';
import { Dir } from '../engine/iso';
import { Builder } from './build';
import { Stockpile } from './stockpile';
import { Economy } from './economy';
import { Station, resetStationIds, type StationJSON } from './stations';
import { Train, defaultStop, resetTrainIds, type TrainState } from './trains';
import { Fleet } from './fleet';
import { rules, DEFAULT_RULES } from './rules';
import { setSupplyMode, DEFAULT_SUPPLY } from './supply';
import { migrate, SAVE_VERSION, type SaveGame } from './save';
import { Inventory } from '../gacha/inventory';
import { locoDef, wagonDef } from '../gacha/items';
import { forAll, shrinkInt } from '../testing/property';

// Trains carry on after a load (issue #81). A train saved while moving or loading, taken through
// toJSON, JSON and fromJSON into a fresh fleet on the same track, runs on as the uninterrupted
// control does; only its path is planned again. A v13 save's trains stand without a route, as
// every load left them before.

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
