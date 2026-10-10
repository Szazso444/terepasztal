import { describe, it, expect, beforeEach } from 'vitest';
import { emptyMap } from '../world/mapgen';
import { Terrain, type GameMap } from '../world/tiles';
import { RegionState } from '../world/regions';
import { TrackGraph, type TrackKind } from '../world/track';
import type { PathSegment } from '../world/pathfinding';
import { Dir } from '../engine/iso';
import type { Rng } from '../engine/rng';
import { Builder } from './build';
import { Stockpile } from './stockpile';
import { Economy } from './economy';
import { Station, resetStationIds, type StationJSON } from './stations';
import {
  Train,
  defaultStop,
  resetTrainIds,
  type RouteMode,
  type StopPlan,
  type TrainState,
} from './trains';
import { Fleet } from './fleet';
import { rules, DEFAULT_RULES } from './rules';
import { setSupplyMode, DEFAULT_SUPPLY, dieselFuelId } from './supply';
import { setSeasonOffset } from './weather';
import { migrate, SAVE_VERSION, type SaveGame } from './save';
import { expandSave, CHUNK_TILES } from './expand';
import { Inventory } from '../gacha/inventory';
import { locoDef, wagonDef } from '../gacha/items';
import { STR } from '../strings';
import { SEEDS, forAll, shrinkArray, shrinkInt } from '../testing/property';
import { simWorld, line, station, type SimWorld } from '../testing/simWorld';
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
// control does, along the way the save holds (since v17; before, its path was planned again). A
// v13 save's trains stand without a route, as every load left them before. Further down: the same held at any tick of generated lines, some with a
// fuel and water stop the train runs low by, a train heading for a service it can no longer reach
// dropping it for its stop, a load that moves no car or changes where it is bound or how fast, a
// save made between a load and the first tick, and the traffic scenarios with a round trip
// mid-run: no shared tile or deadlock, a train backing off kept on its escape and only on one it
// can still run, a yielding train kept waiting as long as it would have, no train asked to back
// off again before its last back-off has run out, and a world grown around the save carrying on
// as the save. At the end: the scenes of src/sim/idleTraffic.test.ts, in which a train with
// nothing worth hauling idles and makes way for another (issue #151), saved at any tick.

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
  'retreat',
  'blockedTime',
  'yieldCount',
  'yieldUntil',
  'badTargets',
  'serviceStop',
  'nextFuelCheck',
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
 * The world a load builds from `text`: the same map, track and decor, the stations, stockpile and
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
  for (const [key, d] of w.builder.decor) builder.decor.set(key, { ...d });
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
      if (state === 'moving') expect(t.pathAhead().length, 'a way to run on').toBeGreaterThan(0);
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
  // with its escape saved it runs on along it: see the traffic scenarios below
  it('stops and plans again when the save holds no escape for it', () => {
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

describe("a train's note, when saved", () => {
  it('is the note it shows after a load, but that it is jammed', () => {
    // The fleet's jam bookkeeping is not saved (docs/traffic-current.md §8): a train saved saying
    // it is jammed says nothing until the jam resolution says so again, and never keeps saying it
    // once the jam is over.
    const c = control();
    const i = savesIn('moving')[60];
    for (const note of ['', STR.traffic.madeWay, 'rerouted around traffic', STR.traffic.jammed]) {
      const j = JSON.parse(c.texts[i]) as { trains: TrainJSON[] };
      j.trains[0].note = note;
      const t = loaded(controlWorld(), JSON.stringify(j)).fleet.trains[0];
      expect(t.lastMessage, note).toBe(note === STR.traffic.jammed ? '' : note);
    }
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
        retreat: null,
        blockedTime: 0,
        yieldCount: 0,
        yieldUntil: 0,
        badTargets: [],
        serviceStop: null,
        nextFuelCheck: 0,
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
  /**
   * the column of a coaling stage, with a water tower east of it, two rows south of the line, and
   * coal, fuel and water in the stockpile for them to hand out; none when absent
   */
  service?: number;
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
  if (c.service !== undefined) {
    // two rows off the line they serve its tiles two columns either side; an even column stands
    // clear of every siding, and the tower east of it too
    for (const [id, x] of [
      ['fuel_stop', c.service],
      ['water_tower', c.service + 1],
    ] as const)
      builder.decor.set((ROW + 2) * map.w + x, { id, x, y: ROW + 2, rot: 0 });
    for (const id of ['coal', dieselFuelId(), 'water']) stock.add(id, 1000);
  }
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
 * it arrived. The way the save holds measures its arcs from another start, which in floating
 * point may move an arrival by a tick, so what the train does may match the control's a tick
 * either side.
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
 * stay in its list. At 242 and 561 an arrival landed a tick late while the save rounded trail
 * points to a thousandth of a tile, and the departure after it followed a tick late; at 631 the
 * train stood on a switch when saved and the path planned again took the other route through it
 * (see 'a load moves no car').
 */
const SCHEDULE_FOUND = [242, 561, 631];

/**
 * Tanks a train starts with on a line with a service: low enough that it heads for the service at
 * once, or a hair above the share (0.4) under which it looks for one, so it does within seconds.
 */
const SERVICE_FUEL = [0.2, 0.3, 0.401, 0.405, 0.41];
/** Game seconds of a run with a service the save moments are drawn from: its first fuel stop. */
const SERVICE_SPAN = 60;
/** A generated line with a service by it, the train's tanks running low, saved early on. */
function serviceLayout(rng: Rng): Layout {
  const c = layout(rng, ['schedule', ...ROAMING]);
  return {
    ...c,
    fuel: rng.pick(SERVICE_FUEL),
    service: rng.pick(SLOTS),
    tick: rng.int(0, SERVICE_SPAN / GDT - 1),
  };
}

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

  it(
    'carries on as if never saved with its tanks running low by a fuel and water stop',
    { timeout: 300_000 },
    () => {
      // A train under way looks for a service every five seconds and heads there before its stop
      // once a tank is under 0.4 full; saved between two looks or on its way there, it carries on
      // as the uninterrupted run does.
      roamingRules();
      forAll(serviceLayout, (c) => carriesOnFrom(c, true), {
        shrink: shrinkLayout,
        shrinkBudget: LAYOUT_SHRINK,
        seeds: LAYOUT_SEEDS,
      });
    },
  );

  it('keeps heading for the service it set off for, and the time of its next look for one', () => {
    // The smallest case the property above found: saved on the tick it set off for the coaling
    // stage, a load that planned the path to its stop stood it still for a tick while it turned
    // for the service again, and one that forgot when it next looks for a service looked a tick
    // late.
    const c: Layout = {
      loco: 'john_bull',
      mode: 'schedule',
      sites: [
        { kind: 'quarry', x: 14, stocked: true },
        { kind: 'warehouse', x: 44, stocked: false },
      ],
      siding: null,
      trainX: 25,
      east: true,
      fuel: 0.405,
      tick: 200,
      service: 86,
    };
    const w = layoutScene(c);
    for (let i = 0; i <= c.tick; i++) step(w, timeOf(i));
    const text = saved(w);
    const j = (JSON.parse(text) as { trains: TrainJSON[] }).trains[0];
    expect(j.serviceStop, 'the service it heads to').toMatchObject({ x: 84, y: ROW });
    expect(j.nextFuelCheck, 'its next look for one').toBeGreaterThan(timeOf(c.tick));
    // a tick on, the loaded train runs on to the same tile at the same speed as the control
    const ahead = (t: Train) => {
      const end = t.pathAhead().at(-1);
      return { speed: t.speed, end: end && { x: end.x, y: end.y } };
    };
    step(w, timeOf(c.tick + 1));
    const was = ahead(w.fleet.trains[0]);
    expect(was.speed).toBeGreaterThan(0);
    expect(was.end).toEqual({ x: 84, y: ROW });
    const back = loaded(w, text);
    step(back, timeOf(c.tick + 1));
    const now = ahead(back.fleet.trains[0]);
    expect(now.end).toEqual(was.end);
    expect(now.speed).toBeCloseTo(was.speed, 9);
    // and saved again, it still holds both
    const again = back.fleet.trains[0].toJSON();
    expect(again.serviceStop).toEqual(j.serviceStop);
    expect(again.nextFuelCheck).toBe(j.nextFuelCheck);
  });
});

/** A generated line with a service, and which of the saves made on the way there to take. */
interface ServiceSave {
  layout: Layout;
  /** share of the way through the run's saves heading for the service, 0 to under 1 */
  at: number;
}
const serviceSave = (rng: Rng): ServiceSave => ({ layout: serviceLayout(rng), at: rng.next() });
/** Fewer stations, no siding, the diesel, then an earlier save; the tanks stay as low. */
function* shrinkServiceSave(s: ServiceSave): Iterable<ServiceSave> {
  for (const layout of shrinkLayout(s.layout))
    if (layout.tick === s.layout.tick && layout.fuel === s.layout.fuel) yield { ...s, layout };
  for (const at of [0, s.at / 2]) if (at < s.at) yield { ...s, at };
}
/**
 * The run of the layout over SERVICE_SPAN, and the save after `at` of the way through its ticks
 * after which the train heads for a fuel or water service; none when it never does.
 */
function serviceSaveOf(s: ServiceSave): { world: World; tick: number; text: string } | null {
  const world = layoutScene(s.layout);
  const saves: { tick: number; text: string }[] = [];
  for (let i = 0; i < SERVICE_SPAN / GDT; i++) {
    step(world, timeOf(i));
    if (world.fleet.trains[0].toJSON().serviceStop) saves.push({ tick: i, text: saved(world) });
  }
  if (!saves.length) return null;
  return { world, ...saves[Math.floor(s.at * saves.length)] };
}
/**
 * Seeds the service-save properties run, and how many of them must head for a service within
 * SERVICE_SPAN, so the properties are not met by cases that never do (37 of the 40 do).
 */
const SERVICE_SEEDS = SEEDS.slice(0, 40);
const SERVICE_HEADING = 30;

describe('a train heading for a fuel or water service when saved', () => {
  it(
    'drops a service it can no longer reach and carries on as a load with no service does',
    { timeout: 300_000 },
    () => {
      // A load runs on along the way the save holds only while it leads where the train is bound;
      // else it plans the path again to the service the train heads for, and where there is no
      // way to it any more, the train drops it for its stop as dispatch drops it. Loaded with the
      // service on a tile without track, it does tick for tick what it does loaded with none: it
      // keeps its speed for the stop, and looks for a service again when its next look is due.
      roamingRules();
      let heading = 0;
      forAll(
        serviceSave,
        (s) => {
          const found = serviceSaveOf(s);
          if (!found) return;
          heading++;
          const { world, tick, text } = found;
          const withService = (serviceStop: TrainJSON['serviceStop']) => {
            const j = JSON.parse(text) as { trains: TrainJSON[] };
            j.trains[0].serviceStop = serviceStop;
            return loaded(world, JSON.stringify(j));
          };
          const was = (JSON.parse(text) as { trains: TrainJSON[] }).trains[0].serviceStop!;
          const off = { ...was, y: ROW - 6 };
          expect(world.track.has(off.x, off.y), 'track on the moved service tile').toBe(false);
          const gone = withService(off);
          const none = withService(null);
          const end = tick + AFTER / GDT;
          for (let k = tick + 1; k <= end; k++) {
            step(gone, timeOf(k));
            step(none, timeOf(k));
            if (k !== tick + 1 && k !== end) continue;
            const why = `${k - tick} ticks after the load`;
            const a = gone.fleet.trains[0];
            const b = none.fleet.trains[0];
            expect({ state: a.state, speed: a.speed }, why).toEqual({
              state: b.state,
              speed: b.speed,
            });
            expect(JSON.parse(JSON.stringify(a.toJSON())), why).toEqual(
              JSON.parse(JSON.stringify(b.toJSON())),
            );
          }
        },
        {
          shrink: shrinkServiceSave,
          shrinkBudget: 20,
          seeds: SERVICE_SEEDS,
          format: (s) => `${JSON.stringify(s)}, the save heading for the service`,
        },
      );
      expect(heading, 'cases saved heading for a service').toBeGreaterThanOrEqual(SERVICE_HEADING);
    },
  );

  it('saved again before the first tick, is the save that was loaded', { timeout: 300_000 }, () => {
    // The service it heads for, what that hands out, and when it next looks for one survive a
    // load and a save with no tick between them.
    roamingRules();
    let heading = 0;
    forAll(
      serviceSave,
      (s) => {
        const found = serviceSaveOf(s);
        if (!found) return;
        heading++;
        const was = (JSON.parse(found.text) as { trains: TrainJSON[] }).trains[0];
        const back = Train.fromJSON(
          JSON.parse(JSON.stringify(was)) as TrainJSON,
          found.world.track,
        );
        expect(JSON.parse(JSON.stringify(back.toJSON()))).toEqual(was);
      },
      { shrink: shrinkServiceSave, shrinkBudget: 20, seeds: SERVICE_SEEDS },
    );
    expect(heading, 'cases saved heading for a service').toBeGreaterThanOrEqual(SERVICE_HEADING);
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
      // The save keeps each car's place as it was; a load that plans the path again along
      // another line than the one the train stands on (the other route through a switch) shows
      // here as a jump. Each case loads 240 times, so it runs on fewer seeds.
      roamingRules();
      forAll(
        (rng) => ({ ...layout(rng, ['schedule', ...ROAMING]), tick: 0 }),
        (c) =>
          eachLoad(c, (ctl, back, after) => {
            const gap = apart(ctl.poses, back.poses);
            const why = `tiles from the control a tick after loading the save after tick ${after}`;
            expect(gap, why).toBeLessThan(TOLERANCE);
          }),
        { shrink: shrinkLayout, shrinkBudget: 20, seeds: SEEDS.slice(0, 30) },
      );
    },
  );

  it(
    'one tick after a load on the way to a service, the train runs on to the same tile at the same speed',
    { timeout: 300_000 },
    () => {
      // The run of a line with a service while the tanks run low, loaded every quarter second:
      // a load that planned the path to the stop instead of the service, or to both, or stood
      // the train for a tick, shows here as another end to its way or another speed.
      roamingRules();
      let heading = 0;
      forAll(
        (rng) => ({ ...serviceLayout(rng), tick: 0 }),
        (c) =>
          eachLoad(c, (ctl, back, after) => {
            const why = `a tick after loading the save after tick ${after}`;
            expect(apart(ctl.poses, back.poses), `tiles from the control ${why}`).toBeLessThan(
              TOLERANCE,
            );
            expect(wayOf(back), why).toEqual(wayOf(ctl));
            expect(back.speed, `speed ${why}`).toBeCloseTo(ctl.speed, 6);
            if (ctl.toJSON().serviceStop) heading++;
          }),
        { shrink: shrinkLayout, shrinkBudget: 20, seeds: SEEDS.slice(0, 30) },
      );
      // 3 216 of the 7 200 loads find the control heading for a service a tick on
      expect(heading, 'loads heading for a service').toBeGreaterThan(2000);
    },
  );
});

/**
 * Run the layout SWEEP_SPAN seconds, loading a save every SWEEP_EVERY ticks into a fresh fleet on
 * the same track, and hand `check` the control's train and the loaded one a tick after each load.
 */
function eachLoad(c: Layout, check: (ctl: Train, back: Train, after: number) => void) {
  const w = layoutScene(c);
  let pending: { back: World; after: number } | null = null;
  for (let i = 0; i < SWEEP_SPAN / GDT; i++) {
    step(w, timeOf(i));
    if (pending) {
      check(w.fleet.trains[0], pending.back.fleet.trains[0], pending.after);
      pending = null;
    }
    if (i % SWEEP_EVERY) continue;
    const back = loaded(w, saved(w));
    for (const [id, at] of lastServed(w.fleet)) lastServed(back.fleet).set(id, at);
    step(back, timeOf(i + 1));
    pending = { back, after: i };
  }
}
/** What a train is doing and the tile its way ends on. */
const wayOf = (t: Train) => {
  const end = t.pathAhead().at(-1);
  return { state: t.state, end: end ? { x: end.x, y: end.y } : null };
};

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
// heads for a stop as a game's train does, and a yielding one finds its own way on (the
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

/** The escapes the traffic control holds for trains backing off: by train, group and tile keys. */
type Escapes = Map<number, { group: number[]; tiles: Set<number> }>;
const escapesOf = (fleet: Fleet): Escapes =>
  new Map(
    [...fleet.traffic.recoveries.active].map(([id, plan]) => [
      id,
      { group: [...plan.group], tiles: new Set(plan.tiles) },
    ]),
  );

/** The uninterrupted run of a case, with a save after every tick. */
interface TrafficControl {
  map: GameMap;
  track: TrackGraph;
  run: TrafficRun;
  /** trains and stations as JSON after each tick */
  texts: string[];
  /** what each train was doing after each tick */
  doing: string[];
  /** the escapes reserved after each tick */
  escapes: Escapes[];
  /** ticks after which some train was held up, yielding or backing off for another */
  busy: number[];
  /** ticks after which some train was backing off on a reserved escape */
  backing: number[];
}
const trafficControls = new Map<TrafficCase, TrafficControl>();
function trafficControl(c: TrafficCase): TrafficControl {
  const known = trafficControls.get(c);
  if (known) return known;
  const sc = trafficWithStops(c);
  const texts: string[] = [];
  const doing: string[] = [];
  const escapes: Escapes[] = [];
  const busy: number[] = [];
  const backing: number[] = [];
  const run = runTraffic(sc.fleet, sc.track.w, 0, () => {
    const trains = sc.fleet.trains;
    texts.push(
      JSON.stringify({
        trains: trains.map((t) => t.toJSON()),
        stations: sc.builder.stations.map((s) => s.toJSON()),
      }),
    );
    doing.push(trains.map((t) => `#${t.id} ${t.state}${t.holding ? ' holding' : ''}`).join(', '));
    escapes.push(escapesOf(sc.fleet));
    if (trains.some((t) => t.holding || t.state === 'yielding' || t.blockedTime > 0))
      busy.push(texts.length - 1);
    if (trains.some((t) => t.holding)) backing.push(texts.length - 1);
  });
  const control = { map: sc.map, track: sc.track, run, texts, doing, escapes, busy, backing };
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

  it('keeps a train backing off on its escape, reserved again for it', { timeout: 120_000 }, () => {
    // Every save of the uninterrupted runs after which a train was backing off on a reserved
    // escape, loaded and run a tick on: every train of the fleet stands where the control has it,
    // doing the same, and the traffic control holds escapes for the trains and groups the
    // control's does. Each covers every tile its train still runs on, and no tile the control's
    // does not: the control's may still hold the tile its train is leaving, which the rest of the
    // escape the save holds no longer has.
    let saves = 0;
    for (const c of TRAFFIC) {
      const ctl = trafficControl(c);
      for (const tick of ctl.backing) {
        if (tick + 1 >= ctl.texts.length) continue;
        saves++;
        const fleet = trafficLoaded(ctl, tick);
        fleet.tick(SCENARIO_GDT, (tick + 1) / SCENARIO_TICK_RATE);
        const why = `${caseName(c)}, the save after tick ${tick}`;
        // trains the control took out of the run on this tick are not compared
        for (const j of (JSON.parse(ctl.texts[tick + 1]) as { trains: TrainJSON[] }).trains) {
          const t = fleet.trains.find((x) => x.id === j.id)!;
          expect({ state: t.state, holding: t.holding }, `${why}: #${j.id}`).toEqual({
            state: j.state,
            holding: j.holding,
          });
          const want = Train.fromJSON(j, ctl.track).poses;
          expect(apart(want, t.poses), `${why}: #${j.id}'s tiles from the control`).toBeLessThan(
            TOLERANCE,
          );
        }
        const want = ctl.escapes[tick + 1];
        const got = escapesOf(fleet);
        expect([...got.keys()].sort(), `${why}: trains with an escape`).toEqual(
          [...want.keys()].sort(),
        );
        for (const [id, { group, tiles }] of got) {
          const control = want.get(id)!;
          expect(group, `${why}: #${id}'s group`).toEqual(control.group);
          const t = fleet.trains.find((x) => x.id === id)!;
          const ahead = t.pathAhead().map((p) => p.y * ctl.track.w + p.x);
          expect(
            ahead.filter((key) => !tiles.has(key)),
            `${why}: tiles ahead of #${id} its escape does not hold`,
          ).toEqual([]);
          expect(
            [...tiles].filter((key) => !control.tiles.has(key)),
            `${why}: tiles #${id}'s escape holds and the control's does not`,
          ).toEqual([]);
        }
      }
    }
    // the runs back off often enough for this to say something
    expect(saves).toBeGreaterThan(1000);
  });

  it(
    'keeps a yielding train waiting as long as it would have, and asks no train to back off sooner',
    { timeout: 120_000 },
    () => {
      // A yielding train looks for a clear way every two seconds and sets off past the other
      // trains once a minute has gone by after its last back-off ran out, and the traffic control
      // asks no train to back off again before that back-off has run out (`Train.yieldUntil`, a
      // game time). Every save of the uninterrupted runs after which a train was held up, yielding
      // or backing off, loaded and run a tick on: every train is doing what the control's is, and
      // one saved yielding stands where the control's does.
      let yielding = 0;
      for (const c of TRAFFIC) {
        const ctl = trafficControl(c);
        for (const tick of ctl.busy) {
          if (tick + 1 >= ctl.texts.length) continue;
          const fleet = trafficLoaded(ctl, tick);
          fleet.tick(SCENARIO_GDT, (tick + 1) / SCENARIO_TICK_RATE);
          const why = `${caseName(c)}, the save after tick ${tick} (${ctl.doing[tick]})`;
          const was = (JSON.parse(ctl.texts[tick]) as { trains: TrainJSON[] }).trains;
          // trains the control took out of the run on this tick are not compared
          for (const j of (JSON.parse(ctl.texts[tick + 1]) as { trains: TrainJSON[] }).trains) {
            const t = fleet.trains.find((x) => x.id === j.id)!;
            expect({ state: t.state, holding: t.holding }, `${why}: #${j.id}`).toEqual({
              state: j.state,
              holding: j.holding,
            });
            if (was.find((x) => x.id === j.id)?.state !== 'yielding') continue;
            yielding++;
            const want = Train.fromJSON(j, ctl.track).poses;
            expect(apart(want, t.poses), `${why}: #${j.id}'s tiles from the control`).toBeLessThan(
              TOLERANCE,
            );
          }
        }
      }
      // the runs yield often enough for this to say something
      expect(yielding).toBeGreaterThan(1000);
    },
  );

  it(
    'asks a train loaded before its last back-off has run out to back off only once it has',
    { timeout: 120_000 },
    () => {
      // Every save of the uninterrupted runs after which the control asks a train to back off on
      // the next tick, loaded and run that tick: as saved, the same train is asked; with that
      // train's back-off made to run out just after the tick, 4 s or 30 s after it (`yieldUntil`,
      // what a cancelled escape and a new one leave), it is not, whatever it was doing.
      let picks = 0;
      const doing = new Set<TrainState>();
      for (const c of TRAFFIC) {
        const ctl = trafficControl(c);
        for (let tick = 0; tick + 1 < ctl.texts.length; tick++) {
          const was = (JSON.parse(ctl.texts[tick]) as { trains: TrainJSON[] }).trains;
          const now = (tick + 1) / SCENARIO_TICK_RATE;
          for (const j of (JSON.parse(ctl.texts[tick + 1]) as { trains: TrainJSON[] }).trains) {
            const saved = was.find((x) => x.id === j.id)!;
            if (j.yieldCount <= saved.yieldCount) continue;
            picks++;
            doing.add(saved.state);
            const why = `${caseName(c)}, #${j.id} (${saved.state}) in the save after tick ${tick}`;
            for (const ahead of [null, 1e-3, 4, 30]) {
              const text = JSON.parse(ctl.texts[tick]) as { trains: TrainJSON[] };
              if (ahead !== null) text.trains.find((x) => x.id === j.id)!.yieldUntil = now + ahead;
              const fleet = trafficLoaded({ ...ctl, texts: [JSON.stringify(text)] }, 0);
              fleet.tick(SCENARIO_GDT, now);
              const t = fleet.trains.find((x) => x.id === j.id)!;
              expect(
                { yieldCount: t.yieldCount, holding: t.holding },
                ahead === null ? why : `${why}, its back-off running out ${ahead} s after the tick`,
              ).toEqual(
                ahead === null
                  ? { yieldCount: j.yieldCount, holding: true }
                  : { yieldCount: saved.yieldCount, holding: false },
              );
            }
          }
        }
      }
      // every run asks some train to back off, and not only trains already yielding: a load that
      // kept the time for a yielding train alone would let the fleet ask one under way again
      expect(picks).toBeGreaterThanOrEqual(TRAFFIC.length);
      expect([...doing].filter((s) => s !== 'yielding')).not.toEqual([]);
    },
  );

  it(
    'a save made after a load, before the first tick, is the save loaded',
    { timeout: 120_000 },
    () => {
      // As for the single trains above, here for every train of every save of the uninterrupted
      // runs, those backing off on an escape among them.
      let escapes = 0;
      for (const c of TRAFFIC) {
        const ctl = trafficControl(c);
        ctl.texts.forEach((text, tick) => {
          for (const j of (JSON.parse(text) as { trains: TrainJSON[] }).trains) {
            if (j.retreat) escapes++;
            const was = JSON.stringify(j);
            const again = Train.fromJSON(JSON.parse(was) as TrainJSON, ctl.track).toJSON();
            if (JSON.stringify(again) !== was)
              expect(
                JSON.parse(JSON.stringify(again)),
                `${caseName(c)}, #${j.id} in the save after tick ${tick}`,
              ).toEqual(j);
          }
        });
      }
      expect(escapes).toBeGreaterThan(1000);
    },
  );

  it(
    'stops a train whose saved escape can no longer be reserved, and holds none for it',
    { timeout: 120_000 },
    () => {
      // A saved escape is run again only from where its train stands, over track still there,
      // with no other train on it. A save edited so it is not loads with the train stopped a
      // tick on, looking for its way again, and no escape held for it.
      forAll(
        (rng): EscapeEdit => {
          const at = rng.int(0, TRAFFIC.length - 1);
          const ctl = trafficControl(TRAFFIC[at]);
          const tick = rng.pick(ctl.backing);
          const saved = JSON.parse(ctl.texts[tick]) as { trains: TrainJSON[] };
          const id = rng.pick(saved.trains.filter((j) => j.holding)).id;
          return { at, tick, id, edit: rng.pick(ESCAPE_EDITS) };
        },
        ({ at, tick, id, edit }) => {
          const ctl = trafficControl(TRAFFIC[at]);
          const j = JSON.parse(ctl.texts[tick]) as { trains: TrainJSON[]; stations: unknown[] };
          const train = j.trains.find((t) => t.id === id)!;
          const others = j.trains.filter((t) => t.id !== id);
          const path = editEscape(edit, train, others, ctl.track);
          if (!path) return;
          train.retreat!.path = path;
          const fleet = trafficLoaded({ ...ctl, texts: [JSON.stringify(j)] }, 0);
          fleet.tick(SCENARIO_GDT, (tick + 1) / SCENARIO_TICK_RATE);
          const t = fleet.trains.find((x) => x.id === id)!;
          expect({
            state: t.state,
            holding: t.holding,
            speed: t.speed,
            escape: fleet.traffic.recoveries.active.has(id),
          }).toEqual({ state: 'yielding', holding: false, speed: 0, escape: false });
        },
        {
          shrink: function* (e) {
            // an earlier save of the case in which the same train backs off
            const ctl = trafficControl(TRAFFIC[e.at]);
            for (const tick of ctl.backing)
              if (tick < e.tick && ctl.texts[tick].includes(`"id":${e.id},`)) {
                const j = JSON.parse(ctl.texts[tick]) as { trains: TrainJSON[] };
                if (j.trains.find((t) => t.id === e.id)?.holding) yield { ...e, tick };
              }
          },
          format: (e) =>
            `${caseName(TRAFFIC[e.at])}, #${e.id}'s escape ${e.edit} in the save after tick ${e.tick}`,
          shrinkBudget: 20,
        },
      );
    },
  );

  it(
    'carries on in a world grown around the save as in the world it grew from, moved with it',
    { timeout: 300_000 },
    () => {
      // A generated world grows by a ring of chunks around a save (expandSave), and every tile
      // coordinate the save holds moves by the ring, a train's escape among them. Loaded onto the
      // track moved with it, a tick and two seconds on, every train stands where it stands loaded
      // into the world it grew from, moved by the ring, doing the same.
      forAll(
        trafficSave,
        ({ at, tick }) => {
          const ctl = trafficControl(TRAFFIC[at]);
          const plain = trafficLoaded(ctl, tick);
          const grown = grownLoaded(ctl, tick);
          for (let k = tick + 1; k <= tick + 40; k++) {
            plain.tick(SCENARIO_GDT, k / SCENARIO_TICK_RATE);
            grown.tick(SCENARIO_GDT, k / SCENARIO_TICK_RATE);
            if (k !== tick + 1 && k !== tick + 40) continue;
            for (const t of grown.trains) {
              const why = `#${t.id}, ${k - tick} ticks after the load`;
              const p = plain.trains.find((x) => x.id === t.id)!;
              expect({ state: t.state, holding: t.holding }, why).toEqual({
                state: p.state,
                holding: p.holding,
              });
              const moved = p.poses.map((q) => ({ x: q.x + CHUNK_TILES, y: q.y + CHUNK_TILES }));
              expect(apart(moved, t.poses), `${why}: tiles apart`).toBeLessThan(TOLERANCE);
            }
          }
        },
        {
          shrink: shrinkTrafficSave,
          format: formatTrafficSave,
          seeds: SEEDS.slice(0, 40),
          shrinkBudget: 20,
        },
      );
    },
  );
});

/** A way a saved escape can no longer be run (see `editEscape`). */
const ESCAPE_EDITS = [
  'starting past its head',
  'running under another train',
  'running off the track',
] as const;
interface EscapeEdit {
  /** the case, by its index in TRAFFIC */
  at: number;
  /** the save after this tick of its uninterrupted run */
  tick: number;
  /** the train backing off in it */
  id: number;
  edit: (typeof ESCAPE_EDITS)[number];
}
/**
 * The rest of an escape as `train`'s save holds it, edited: its tiles up to the one the head
 * stands on dropped, so it starts past the head; or a tile under another train's head car added;
 * or a tile without track added. Null when the escape is too short or there is no other train.
 */
function editEscape(
  edit: EscapeEdit['edit'],
  train: TrainJSON,
  others: TrainJSON[],
  track: TrackGraph,
): PathSegment[] | null {
  const path = train.retreat!.path;
  const last = path[path.length - 1];
  switch (edit) {
    case 'starting past its head': {
      const [, , hx, hy] = train.trail[train.trail.length - 1];
      const at = path.findIndex((s) => s.x === hx && s.y === hy);
      return at >= 0 && path.length > at + 1 ? path.slice(at + 1) : null;
    }
    case 'running under another train': {
      const other = others[0];
      if (!other) return null;
      const [, , x, y, entry, exit] = other.trail[other.trail.length - 1];
      return [...path, { x, y, in: entry as Dir, out: exit as Dir }];
    }
    case 'running off the track': {
      const off = { ...last, y: last.y - 5 };
      expect(track.has(off.x, off.y)).toBe(false);
      return [...path, off];
    }
  }
}

/**
 * The control's save after `tick` in a world grown by one ring of chunks around it, as the game
 * grows one: through expandSave, its track laid and stations and trains loaded as a load does.
 */
function grownLoaded(c: TrafficControl, tick: number): Fleet {
  const j = JSON.parse(c.texts[tick]) as { trains: TrainJSON[]; stations: StationJSON[] };
  const save = expandSave(
    {
      version: SAVE_VERSION,
      world: { kind: 'generated', seed: 4242, params: { w: c.track.w, h: c.track.h } },
      track: [...c.track.anchors()].map(({ x, y, piece: p }) => [
        x,
        y,
        p.kind,
        p.rot,
        p.cls,
        p.cls2,
      ]),
      stations: j.stations,
      trains: j.trains,
      camera: { x: 0, y: 0, zoomIndex: 2 },
    } as unknown as SaveGame,
    1,
  );
  const w = c.track.w + 2 * CHUNK_TILES;
  const h = c.track.h + 2 * CHUNK_TILES;
  const map = emptyMap(4242, w, h, Terrain.Grass);
  const track = new TrackGraph(w, h);
  for (const [x, y, kind, rot, cls, cls2] of save.track)
    track.place(x, y, kind, rot, cls ?? 'regular', cls2);
  track.refreshSwitchForms();
  const stock = new Stockpile();
  const economy = new Economy();
  const builder = new Builder(map, new RegionState(map), track, economy, stock);
  builder.free = true;
  for (const s of save.stations) builder.stations.push(Station.fromJSON(s));
  const fleet = new Fleet(track, builder, map, new Inventory(), economy, stock);
  for (const t of save.trains as TrainJSON[]) fleet.trains.push(Train.fromJSON(t, track));
  return fleet;
}

// ------------------------------------------------------------------ idle trains (issue #151)
// The scenes of src/sim/idleTraffic.test.ts: a roaming train finds nothing worth hauling at its
// station and idles there, holding no platform, and a train on a schedule comes by. Where that
// train needs the track under it, the idle train makes way: it runs an escape aside, reserved as a
// train backing off has its escape, and idles where it ends. On a single line it has nowhere to go
// and says so, and where the other train comes in by another road it stays where it stands. In two
// more, stone turns up at the quarry the train idles at, before and after it made way, and it takes
// up work again. Saved after any tick from the moment the second train sets off (the train idles
// alone in one), and loaded into the scene laid afresh at the saved game time, every train carries
// on as the uninterrupted run does.

/** Game seconds of an idle scene's run the save moments are drawn from, and run on after one. */
const IDLE_SPAN = 100;
const IDLE_AFTER = 60;
/** The notes an idle train may show: none, or one about making way (as idleTraffic.test.ts). */
const IDLE_NOTES: string[] = [
  '',
  STR.traffic.madeWay,
  STR.traffic.waitAside,
  STR.traffic.noWayAside,
  STR.traffic.replan,
];

/** An idle scene's world and its stations, in the order they were placed. */
interface IdleLaid {
  w: SimWorld;
  st: Station[];
}

/** Lays a piece through the builder, free of cost and region, as the game would. */
function layPiece(w: SimWorld, x: number, y: number, kind: TrackKind, rot: number) {
  w.builder.free = true;
  const ok = w.builder.placeTrack(x, y, { kind, cls: 'regular' }, rot);
  w.builder.free = false;
  if (!ok) throw new Error(`no ${kind} at ${x},${y}`);
}
/**
 * A terminus: the main line along ROW from x 4 to 40, a warehouse at its west end (platform x 5)
 * and a quarry at its dead east end (platform x 40). A switch at x 20, its throat facing east,
 * leads into a six-tile siding south of the line.
 */
function terminusLine(): IdleLaid {
  const w = simWorld({ terrain: 'grass', size: 64 });
  layPiece(w, 20, ROW, 'switch', 1);
  for (let y = ROW + 2; y < ROW + 8; y++) layPiece(w, 20, y, 'straight', 0);
  line(w, 4, ROW, 19);
  line(w, 22, ROW, 40);
  return { w, st: [station(w, 'warehouse', 5, ROW - 1), station(w, 'quarry', 40, ROW - 1)] };
}
/**
 * A through station: the main line along ROW from x 4 to 56, a quarry beside it at x 30 and a
 * warehouse at x 50. Past the quarry a switch at x 36, its throat facing west, leads into a
 * six-tile siding south of the line.
 */
function throughLine(): IdleLaid {
  const w = simWorld({ terrain: 'grass', size: 64 });
  layPiece(w, 36, ROW, 'switch', 7);
  for (let y = ROW + 2; y < ROW + 8; y++) layPiece(w, 37, y, 'straight', 0);
  line(w, 4, ROW, 35);
  line(w, 38, ROW, 56);
  return { w, st: [station(w, 'quarry', 30, ROW - 1), station(w, 'warehouse', 50, ROW - 1)] };
}
/**
 * One platform two roads end at: the main line along ROW from x 4 ends at the quarry's platform
 * (x 30), and a road from the north down x 31 at the tile east of it, with a warehouse beside it.
 * The quarry has one platform for both.
 */
function twoRoads(): IdleLaid {
  const w = simWorld({ terrain: 'grass', size: 64 });
  line(w, 4, ROW, 30);
  for (let y = ROW - 8; y <= ROW - 1; y++) layPiece(w, 31, y, 'straight', 0);
  const quarry = station(w, 'quarry', 30, ROW - 1);
  expect(quarry.platforms).toBe(1);
  return { w, st: [quarry, station(w, 'warehouse', 32, ROW - 7)] };
}
/** A single line from x 4 to 40 between a warehouse and a quarry at its ends: nowhere to pass. */
function singleLine(): IdleLaid {
  const w = simWorld({ terrain: 'grass', size: 64 });
  line(w, 4, ROW, 40);
  return { w, st: [station(w, 'warehouse', 5, ROW - 1), station(w, 'quarry', 40, ROW - 1)] };
}

/**
 * An F7 and a hopper with full tanks, its head at (x, y) entering from `from`, sent off for its
 * first stop as the fleet sends a train off.
 */
function sendOff(w: SimWorld, x: number, y: number, from: Dir, mode: RouteMode, stops: StopPlan[]) {
  const t = new Train([{ uid: 1, level: 1, def: locoDef('f7') }]);
  t.wagons = [
    { uid: 2, def: wagonDef('wood_hopper'), level: 1, cargo: null, amount: 0, origin: null },
  ];
  expect(t.spawnAt(w.track, x, y, from)).toBe(true);
  t.oil = t.oilCap;
  t.mode = mode;
  t.schedule = stops;
  w.fleet.trains.push(t);
  expect(t.dispatch(w.track, w.builder, w.map)).toBe(true);
  t.onPathReady({ builder: w.builder });
  return t;
}
/** A roaming train heading east on the main line, its head at x, bound for `s`. */
const roamTo = (w: SimWorld, x: number, s: Station) =>
  void sendOff(w, x, ROW, Dir.W, 'production', [defaultStop(s.id)]);
/** A train on a schedule heading east on the main line, its head at x. */
const runFrom = (w: SimWorld, x: number, stops: StopPlan[]) =>
  void sendOff(w, x, ROW, Dir.W, 'schedule', stops);
/** A stop where the train calls and moves on without waiting for full wagons. */
const callAt = (s: Station, load: 'auto' | 'none' = 'auto'): StopPlan => ({
  ...defaultStop(s.id),
  waitFull: false,
  load,
});
/** Stone turns up at the station with this id. */
const stoneAt = (id: number) => (w: SimWorld) => void w.builder.stationById(id)!.store('stone', 40);

/**
 * A scene of idleTraffic.test.ts: its track, its roaming trains sent off to the station where they
 * find nothing to haul, the trains set off once those idle, and what it does to its world on the
 * way.
 */
interface IdleScene {
  name: string;
  lay: () => IdleLaid;
  idle: (l: IdleLaid) => void;
  others: (l: IdleLaid) => void;
  /**
   * Done to the world before a tick of the uninterrupted run, once, the first time `when` holds
   * (`arrived` lists the stations a train has arrived at); a load does it before the same tick.
   */
  actions?: {
    when: (arrived: (id: number) => number[], tick: number) => boolean;
    act: (w: SimWorld) => void;
  }[];
}
// In each world the idle train is #1 and the other #2; the stations take ids in `st` order.
const IDLE_SCENES: readonly IdleScene[] = [
  ...[8, 30].map((x): IdleScene => ({
    name: `a terminus, the caller setting off at x ${x}`,
    lay: terminusLine,
    idle: ({ w, st }) => roamTo(w, 34, st[1]),
    others: ({ w, st }) => runFrom(w, x, [callAt(st[1]), callAt(st[0])]),
  })),
  ...(
    [
      [12, 'east'],
      [25, 'east'],
      [12, 'mid'],
    ] as const
  ).map(([x, first]): IdleScene => ({
    name: `a through station, the train behind setting off at x ${x} for ${first} first`,
    lay: throughLine,
    idle: ({ w, st }) => roamTo(w, 24, st[0]),
    others: ({ w, st: [mid, east] }) =>
      runFrom(w, x, first === 'east' ? [callAt(east), callAt(mid)] : [callAt(mid), callAt(east)]),
  })),
  {
    name: 'one platform two roads end at, the second train on the other road',
    lay: twoRoads,
    idle: ({ w, st }) => roamTo(w, 24, st[0]),
    others: ({ w, st }) =>
      void sendOff(w, 31, ROW - 6, Dir.N, 'schedule', [callAt(st[0]), callAt(st[1])]),
  },
  {
    name: 'a single line, nowhere to move aside to',
    lay: singleLine,
    idle: ({ w, st }) => roamTo(w, 34, st[1]),
    others: ({ w, st }) => runFrom(w, 8, [callAt(st[1]), callAt(st[0])]),
  },
  {
    name: 'a terminus, stone turning up where the train idles',
    lay: terminusLine,
    idle: ({ w, st }) => roamTo(w, 34, st[1]),
    others: () => {},
    actions: [{ when: (_, tick) => tick === 30 / GDT, act: stoneAt(2) }],
  },
  {
    name: 'a terminus, stone turning up once the train made way and the caller left',
    lay: terminusLine,
    idle: ({ w, st }) => roamTo(w, 34, st[1]),
    others: ({ w, st }) => runFrom(w, 8, [callAt(st[1], 'none'), callAt(st[0], 'none')]),
    actions: [
      {
        // the caller has called at the quarry (2) and back at the warehouse (1)
        when: (arrived) => arrived(2).join() === '2,1',
        act: (w) => {
          w.fleet.recall(w.fleet.byId(2)!);
          stoneAt(2)(w);
        },
      },
    ],
  },
];

/**
 * What every train of an idle scene is doing, what an idle train or one making way says, and what
 * the stations hold.
 */
function idleStatus(w: SimWorld) {
  return {
    trains: w.fleet.trains.map((t) => ({
      id: t.id,
      state: t.state,
      makingWay: t.makingWay,
      holding: t.holding,
      station: t.atStation?.id ?? null,
      cargo: t.totalCargo(),
      note: t.state === 'idle' || t.makingWay ? t.lastMessage : null,
    })),
    platforms: w.builder.stations.map((s) => [...s.occupants].sort((a, b) => a - b)),
    stone: w.builder.stations.map((s) => s.stored('stone')),
  };
}
type IdleStatus = ReturnType<typeof idleStatus>;

/**
 * The first thing wrong in an idle scene after a tick, as idleTraffic.test.ts's `run` watches:
 * two trains on one tile, a station with more trains on its platforms than it has or an idle one
 * among them, an idle train saying anything but about making way, or a train making way that does
 * not say so.
 */
function idleBroken(w: SimWorld): string | null {
  const shared = sharedTiles(w.fleet.trains, w.track.w);
  if (shared.length) return `trains share tiles ${JSON.stringify(shared)}`;
  for (const s of w.builder.stations) {
    if (s.occupants.size > s.platforms) return `${s.name} has too many trains`;
    for (const id of s.occupants)
      if (w.fleet.byId(id)?.state === 'idle') return `idle #${id} holds ${s.name}`;
  }
  for (const t of w.fleet.trains) {
    if (t.state === 'idle' && !IDLE_NOTES.includes(t.lastMessage))
      return `idle #${t.id} says "${t.lastMessage}"`;
    if (t.makingWay && t.lastMessage !== STR.traffic.makingWay)
      return `#${t.id} makes way saying "${t.lastMessage}"`;
  }
  return null;
}

/**
 * Whether a train waiting to go on from where it pulled aside (`yielding`) wants a way through a
 * train standing idle. Before v17 a save did not keep the way it wants: a load forgot it until the
 * train's next try, and the idle train moved aside up to 2 s later.
 */
function wantsThroughIdle(w: SimWorld): boolean {
  const wk = w.track.w;
  return w.fleet.trains.some((y) => {
    if (y.state !== 'yielding') return false;
    const wants = y.pathTileKeys(wk);
    return w.fleet.trains.some(
      (t) => t.state === 'idle' && t.occupancyKeys(wk).some((k) => wants.has(k)),
    );
  });
}

/** What a save keeps of an idle scene: its trains and stations, as JSON. */
const idleSaved = (w: SimWorld) =>
  JSON.stringify({
    trains: w.fleet.trains.map((t) => t.toJSON()),
    stations: w.builder.stations.map((s) => s.toJSON()),
  });
/**
 * The scene laid afresh with the stations read back and the trains through `Train.fromJSON`, as a
 * load builds the world before it reads the trains.
 */
function idleLoaded(sc: IdleScene, text: string): SimWorld {
  const { w } = sc.lay();
  const j = JSON.parse(text) as { trains: TrainJSON[]; stations: StationJSON[] };
  const stations = j.stations.map((s) => Station.fromJSON(s));
  w.builder.stations.splice(0, w.builder.stations.length, ...stations);
  w.fleet.trains = j.trains.map((t) => Train.fromJSON(t, w.track));
  return w;
}
/** Logs every arrival of `w`'s fleet, train and station, into `into`. */
function logArrivals(w: SimWorld, into: [number, number][]) {
  const next = w.fleet.onArrive;
  w.fleet.onArrive = (t, s) => {
    into.push([t.id, s.id]);
    next?.(t, s);
  };
}

/** The uninterrupted run of an idle scene, after each tick from the second train setting off. */
interface IdleControl {
  /** the save, for the ticks before IDLE_SPAN */
  texts: string[];
  /** the game time */
  nows: number[];
  status: IdleStatus[];
  /** where every car of every train stands */
  poses: { x: number; y: number }[][][];
  /** every arrival of the run, train and station, and how many there were after each tick */
  arrivals: [number, number][];
  arrived: number[];
  /** what each train was doing, for a failure message */
  doing: string[];
  /** ticks before IDLE_SPAN after which a train was making way */
  aside: number[];
  /** ticks before IDLE_SPAN after which a yielding train wanted a way through an idle one */
  wanting: number[];
  /** the actions of the scene, by index, done before each tick */
  fired: Map<number, number[]>;
  /** the stuck episodes and deadlocks counted in the whole run */
  counted: { stuck: number; deadlocks: number };
}
const idleControls = new Map<number, IdleControl>();
/** The control of IDLE_SCENES[scene], run once for IDLE_SPAN + IDLE_AFTER game seconds. */
function idleControl(scene: number): IdleControl {
  const known = idleControls.get(scene);
  if (known) return known;
  const sc = IDLE_SCENES[scene];
  const laid = sc.lay();
  const { w } = laid;
  const c: IdleControl = {
    texts: [],
    nows: [],
    status: [],
    poses: [],
    arrivals: [],
    arrived: [],
    doing: [],
    aside: [],
    wanting: [],
    fired: new Map(),
    counted: { stuck: 0, deadlocks: 0 },
  };
  logArrivals(w, c.arrivals);
  const arrived = (id: number) => c.arrivals.filter(([t]) => t === id).map(([, s]) => s);
  let now = 0;
  sc.idle(laid);
  const idle = [...w.fleet.trains];
  for (let i = 0; i < 60 / GDT && idle.some((t) => t.state !== 'idle'); i++)
    w.fleet.tick(GDT, (now += GDT));
  expect(
    idle.map((t) => t.state),
    `${sc.name}: the roaming trains idle`,
  ).toEqual(idle.map(() => 'idle'));
  sc.others(laid);
  const done = new Set<number>();
  for (let i = 0; i < (IDLE_SPAN + IDLE_AFTER) / GDT; i++) {
    sc.actions?.forEach((a, n) => {
      if (done.has(n) || !a.when(arrived, i)) return;
      done.add(n);
      a.act(w);
      c.fired.set(i, [...(c.fired.get(i) ?? []), n]);
    });
    w.fleet.tick(GDT, (now += GDT));
    const span = i < IDLE_SPAN / GDT;
    c.texts.push(span ? idleSaved(w) : '');
    c.nows.push(now);
    c.status.push(idleStatus(w));
    c.poses.push(w.fleet.trains.map((t) => t.poses.map((p) => ({ x: p.x, y: p.y }))));
    c.arrived.push(c.arrivals.length);
    c.doing.push(
      w.fleet.trains
        .map((t) => `#${t.id} ${t.state}${t.makingWay ? ' making way' : ''}`)
        .join(', '),
    );
    if (span && w.fleet.trains.some((t) => t.makingWay)) c.aside.push(i);
    if (span && wantsThroughIdle(w)) c.wanting.push(i);
  }
  expect(done.size, `${sc.name}: the actions taken`).toBe(sc.actions?.length ?? 0);
  const { stuck, deadlocks } = w.fleet.traffic.counters;
  c.counted = { stuck, deadlocks };
  idleControls.set(scene, c);
  return c;
}

/**
 * The control's save after `tick`, loaded and run IDLE_AFTER seconds on from the saved game time,
 * the scene doing what it did after the save; `check` sees the world after every tick.
 */
function idleRoundTrip(scene: number, tick: number, check: (w: SimWorld, k: number) => void) {
  const sc = IDLE_SCENES[scene];
  const c = idleControl(scene);
  const w = idleLoaded(sc, c.texts[tick]);
  const arrivals: [number, number][] = [];
  logArrivals(w, arrivals);
  let now = c.nows[tick];
  for (let k = tick + 1; k <= tick + IDLE_AFTER / GDT; k++) {
    for (const n of c.fired.get(k) ?? []) sc.actions![n].act(w);
    w.fleet.tick(GDT, (now += GDT));
    check(w, k);
  }
  return { w, arrivals };
}

/** A scene, by its index in IDLE_SCENES, and the tick of its uninterrupted run the save follows. */
interface IdleSave {
  scene: number;
  tick: number;
}
/** Any tick of IDLE_SPAN, half the time one after which a train is making way. */
function idleSave(rng: Rng): IdleSave {
  const scene = rng.int(0, IDLE_SCENES.length - 1);
  const c = idleControl(scene);
  const aside = rng.chance(0.5) && c.aside.length > 0;
  return { scene, tick: aside ? rng.pick(c.aside) : rng.int(0, IDLE_SPAN / GDT - 1) };
}
/** An earlier save of the same scene. */
function* shrinkIdleSave(s: IdleSave): Iterable<IdleSave> {
  for (const tick of shrinkInt(s.tick)) yield { ...s, tick };
}
const formatIdleSave = ({ scene, tick }: IdleSave) =>
  `${IDLE_SCENES[scene].name}, saved after tick ${tick} (${idleControl(scene).doing[tick]})`;

/**
 * The control's save after `tick` of an idle scene, loaded and run IDLE_AFTER seconds on: after
 * every tick, every train stands within TOLERANCE of the control's, in its state, making way or
 * not, at the same station, with the same cargo, idle or making way saying the same; each
 * station's platforms are held by the same trains and hold the same stone; and what
 * idleTraffic.test.ts watches holds (`idleBroken`). By the end, every train has arrived where the
 * control's arrived. The traffic control's counters are not saved, so a load may count a jam the
 * run counted before the save again, but never one the uninterrupted run did not.
 */
function carriesOnIdle(scene: number, tick: number) {
  const c = idleControl(scene);
  const { w, arrivals } = idleRoundTrip(scene, tick, (back, k) => {
    const after = `${k - tick} ticks after the load`;
    const broken = idleBroken(back);
    if (broken) expect(broken, after).toBeNull();
    const status = idleStatus(back);
    if (JSON.stringify(status) !== JSON.stringify(c.status[k]))
      expect(status, after).toEqual(c.status[k]);
    back.fleet.trains.forEach((t, i) => {
      const gap = apart(c.poses[k][i], t.poses);
      if (gap >= TOLERANCE)
        expect(gap, `${after}: #${t.id}'s tiles from the control`).toBeLessThan(TOLERANCE);
    });
  });
  const end = tick + IDLE_AFTER / GDT;
  const why = `${IDLE_AFTER} s after the load`;
  expect(arrivals, `${why}: arrivals`).toEqual(c.arrivals.slice(c.arrived[tick], c.arrived[end]));
  const { overlaps, stuck, deadlocks } = w.fleet.traffic.counters;
  expect(overlaps, `${why}: overlaps`).toBe(0);
  expect(stuck, `${why}: stuck episodes`).toBeLessThanOrEqual(c.counted.stuck);
  expect(deadlocks, `${why}: deadlocks`).toBeLessThanOrEqual(c.counted.deadlocks);
}

describe('a train idle or making way, saved at any tick of the idle scenes', () => {
  beforeEach(() => setSeasonOffset(0));

  it('carries on as if never saved', { timeout: 300_000 }, () => {
    let makingWay = 0;
    let idleAtStation = 0;
    forAll(
      idleSave,
      ({ scene, tick }) => {
        const saved = idleControl(scene).status[tick].trains;
        if (saved.some((t) => t.makingWay)) makingWay++;
        if (saved.some((t) => t.state === 'idle' && t.station !== null)) idleAtStation++;
        carriesOnIdle(scene, tick);
      },
      { shrink: shrinkIdleSave, format: formatIdleSave, shrinkBudget: 30 },
    );
    // the draws say something about both halves of the claim
    expect(makingWay, 'saves while a train makes way').toBeGreaterThanOrEqual(30);
    expect(idleAtStation, 'saves while a train idles at its station').toBeGreaterThanOrEqual(25);
  });

  it(
    'carries on as if never saved when saved as a yielding train wants the track an idle one stands on',
    { timeout: 120_000 },
    () => {
      // The save keeps the way a train waiting to go on from where it pulled aside wants, and the
      // train it last found in it, so the idle train standing in that way moves aside on the tick
      // it would have (before v17 a load forgot them until the next try, up to 2 s later). Every
      // such save of the scenes carries on as the property above has it.
      let saves = 0;
      IDLE_SCENES.forEach((_, scene) => {
        for (const tick of idleControl(scene).wanting) {
          saves++;
          carriesOnIdle(scene, tick);
        }
      });
      // the scenes have such saves (the terminus with the caller from x 30), or this says nothing
      expect(saves, 'saves as a yielding train wants a way through an idle one').toBeGreaterThan(0);
    },
  );
});
