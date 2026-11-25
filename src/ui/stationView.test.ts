import { afterEach, describe, expect, it } from 'vitest';
import { LAST_AGE } from '../sim/ages';
import { MAX_LEVEL } from '../sim/levels';
import { rules } from '../sim/rules';
import { LEVELS, Station, stationDef, weeklyOutput } from '../sim/stations';
import { FAMINE_PRODUCTION_MUL } from '../sim/step';
import type { Flow } from '../sim/stores';
import { fmtCost } from '../sim/stores';
import { setSupplyMode } from '../sim/supply';
import { TRAIN_COLOURS } from '../sim/trainColours';
import { STR } from '../strings';
import { trainFacts } from '../testing/trainFacts';
import { fmtDuration } from './numberFormat';
import { worksChip } from './outlinerRows';
import {
  boardShape,
  callState,
  callsShape,
  fillTone,
  reachSources,
  stationCargo,
  stationExpansion,
  stationOverview,
  stationPerWeek,
  stationTimetable,
  stationTrains,
  upgradeShape,
  type CallFacts,
  type ContractFacts,
  type MakerFacts,
  type ReachSource,
  type StationFacts,
  type StationWorld,
  type WorksFacts,
} from './stationView';
import { upgradeHours, type UpgradeView } from './upgradeView';

const P = STR.stationPanel;

/** A store of literals: what moved through it in the week. */
function dock(key: string, flows: Record<string, Partial<Flow>> = {}) {
  return {
    key,
    weeklyFlow: (id: string): Flow => ({ produced: 0, consumed: 0, ...flows[id] }),
  };
}

/** A station of a real kind, as literals: a test sets what it is about. */
function station(defId: string, more: Partial<StationFacts> = {}): StationFacts {
  const held: Record<string, number> = {};
  const def = stationDef(defId);
  return {
    id: 1,
    level: 1,
    closed: false,
    capacity: 60,
    loadRate: 4,
    platforms: 1,
    crew: 2,
    loadBoost: 1,
    firstAge: def.tier ?? 0,
    terrainFactor: 1,
    productionMul: 1,
    productionPerWeek: 0,
    passengerPopulation: 0,
    occupants: new Set(),
    def,
    dock: null,
    outlet: null,
    distTo: () => 0,
    availableCargo: () => def.produces.map((p) => p.cargo),
    producedCargo: () => def.produces.map((p) => p.cargo),
    stored: (c) => held[c] ?? 0,
    shownStored: () => 0,
    fill: () => 0,
    ...more,
  };
}

/** The same with goods on hand: a store's fullest good, else all its goods together. */
function holding(defId: string, goods: Record<string, number>, more: Partial<StationFacts> = {}) {
  const amounts = Object.values(goods);
  const dockd = !!more.dock;
  const shown = dockd ? Math.max(0, ...amounts) : amounts.reduce((a, b) => a + b, 0);
  const made = stationDef(defId).produces.map((p) => p.cargo);
  return station(defId, {
    stored: (c) => goods[c] ?? 0,
    availableCargo: () => [...new Set([...made, ...Object.keys(goods)])],
    shownStored: () => shown,
    fill: () => Math.min(1, shown / (more.capacity ?? 60)),
    ...more,
  });
}

function world(more: Partial<StationWorld> = {}): StationWorld {
  return {
    age: 0,
    free: false,
    town: null,
    hasTrack: true,
    famine: false,
    outletName: null,
    storeName: null,
    storeShared: false,
    reach: [],
    now: 0,
    contracts: [],
    remaining: () => 1,
    trains: [],
    stationName: (id) => `Stop ${id}`,
    stuck: () => null,
    ...more,
  };
}

/** A train with a program of stops, as literals. */
function train(id: number, stops: number[], more: Partial<CallFacts> = {}): CallFacts {
  const schedule = stops.map((stationId) => ({ stationId, pass: false }));
  return {
    ...trainFacts({ route: stops, job: null, jobs: [] }),
    id,
    name: `Train ${id}`,
    colour: 0,
    schedule,
    program: schedule,
    atStation: null,
    job: null,
    jobs: [],
    ...more,
  };
}

const contract = (more: Partial<ContractFacts>): ContractFacts => ({
  id: 1,
  originId: 1,
  destId: 2,
  cargo: 'coal',
  amount: 40,
  delivered: 12.6,
  expires: 500,
  ...more,
});

/** A works that runs, as literals: a test sets what it is about. */
const works = (more: Partial<WorksFacts> = {}): WorksFacts => ({
  name: 'Windmill',
  x: 10,
  y: 10,
  store: 'town:1',
  out: { food: 5 },
  rate: 4,
  status: { kind: 'running' },
  ...more,
});

/** A harvester carrying to a store with room, as literals. */
const maker = (more: Partial<MakerFacts> = {}): MakerFacts => ({
  id: 2,
  name: 'Farm Halt',
  x: 20,
  y: 10,
  closed: false,
  productionMul: 1.5,
  productionPerWeek: 20,
  outlet: { key: 'town:1', get: () => 0, cap: () => 100 },
  producedCargo: () => ['wheat'],
  fill: () => 0,
  ...more,
});

const running = { id: 1, distTo: (x: number) => Math.abs(x - 4) };
const noFamine = () => false;

describe('what a station makes now', () => {
  it("is the tick's figure: its week, season and biome, half in a famine", () => {
    const s = { productionPerWeek: 20, productionMul: 1.5 };
    expect(stationPerWeek(s, false)).toBe(30);
    expect(stationPerWeek(s, true)).toBe(30 * FAMINE_PRODUCTION_MUL);
  });
  it('agrees with a real station: closed it makes nothing', () => {
    const s = new Station('farm', 3, 3);
    s.terrainFactor = 0.5;
    s.productionMul = 2;
    expect(stationPerWeek(s, false)).toBe(weeklyOutput(1, 0.5) * 2);
    s.work = { to: 2, left: 10, total: 20 };
    expect(stationPerWeek(s, false)).toBe(0);
  });
});

describe('what makes goods for a store', () => {
  it('reads a works by what it really makes, not by its most', () => {
    const [r] = reachSources(running, [], [works({ rate: 2.5 })], noFamine);
    expect(r).toEqual({
      name: 'Windmill',
      tiles: 6,
      store: 'town:1',
      makes: { food: 12.5 },
      chip: null,
    });
  });
  it('says what holds a works back, and what it still makes', () => {
    const starved = works({ rate: 0.5, status: { kind: 'starved', missing: 'wheat' } });
    const full = works({ rate: 0, status: { kind: 'full' } });
    const closed = works({ rate: 0, status: { kind: 'closed' } });
    const rows = reachSources(running, [], [starved, full, closed], noFamine);
    expect(rows.map((r) => [r.makes.food, r.chip?.text])).toEqual([
      [2.5, STR.outliner.noInput],
      [0, STR.outliner.full],
      [0, STR.outliner.closed],
    ]);
  });
  it('leaves power out: it goes to the grid, and no store receives it', () => {
    const plant = works({ name: 'Power Plant', out: { power: 60 } });
    const both = works({ name: 'Kiln', out: { power: 5, coal: 3 } });
    const rows = reachSources(running, [], [plant, both], noFamine);
    expect(rows.map((r) => [r.name, r.makes])).toEqual([['Kiln', { coal: 12 }]]);
  });
  it('leaves out a works that makes nothing', () => {
    expect(reachSources(running, [], [works({ out: {} })], noFamine)).toEqual([]);
  });
  it('reads a harvester as a tick does, shared between its goods, half in a famine', () => {
    const two = maker({ producedCargo: () => ['wheat', 'food'] });
    const [r] = reachSources(running, [two], [], noFamine);
    expect(r.makes).toEqual({ wheat: 15, food: 15 });
    expect(r.store).toBe('town:1');
    expect(r.tiles).toBe(16);
    expect(reachSources(running, [two], [], () => true)[0].makes.wheat).toBe(7.5);
  });
  it('says a harvester is closed, or its goods have no room in the store', () => {
    const shut = maker({ closed: true, productionPerWeek: 0 });
    const brim = maker({ outlet: { key: 'town:1', get: () => 100, cap: () => 100 } });
    const rows = reachSources(running, [shut, brim], [], noFamine);
    expect(rows.map((r) => [r.makes.wheat, r.chip?.text])).toEqual([
      [0, STR.outliner.closed],
      [0, STR.outliner.full],
    ]);
  });
  it('leaves out the station itself, one that carries nowhere, and one that makes nothing', () => {
    const self = maker({ id: 1 });
    const own = maker({ outlet: null });
    const idle = maker({ producedCargo: () => [] });
    expect(reachSources(running, [self, own, idle], [], noFamine)).toEqual([]);
  });
});

describe('the Overview', () => {
  it('says what a plain station is at: platforms, loading, storage, crew, its people', () => {
    const s = holding('station', { passengers: 15 }, { occupants: new Set([7]), platforms: 2 });
    s.passengerPopulation = 38;
    s.productionPerWeek = 15.2;
    const v = stationOverview(s, world());
    expect(v.notes).toEqual([]);
    expect(v.facts.map((f) => f.label)).toEqual([
      STR.station.platforms,
      STR.station.loadRate,
      STR.station.storage,
      P.crew,
    ]);
    expect(v.facts.map((f) => f.value)).toEqual(['1 / 2', '4 / s', '15 / 60', '2']);
    expect(v.facts[2].meter).toBe(25);
    expect(v.residents).toBe(38);
    expect(v.production).toEqual([
      { res: 'passengers', name: 'Passengers', tiles: null, perWeek: 15.2, chip: null },
    ]);
    expect(v.waiting).toEqual([{ res: 'passengers', amount: 15 }]);
  });
  it('counts no week for a station with storage of its own', () => {
    const v = stationOverview(holding('farm', { wheat: 3 }), world());
    expect(v.weekOf).toBeNull();
    expect(v.week).toEqual([]);
    expect(v.residents).toBeNull();
  });
  it('gives a harvest station its rate on this ground, none while it is closed', () => {
    const s = holding('farm', { wheat: 3 }, { productionPerWeek: 27.51, productionMul: 1.5 });
    expect(stationOverview(s, world()).production[0].perWeek).toBe(41.3);
    const shut = holding('farm', { wheat: 3 }, { closed: true });
    const v = stationOverview(shut, world());
    expect(v.production[0]).toMatchObject({ perWeek: 0, chip: worksChip({ kind: 'closed' }) });
    expect(v.notes).toEqual([{ cls: 'amber', text: STR.upgrade.closed }]);
  });
  it('halves what it makes while the crews at its store starve', () => {
    const s = station('farm', { productionPerWeek: 30 });
    expect(stationOverview(s, world({ famine: true })).production[0].perWeek).toBe(15);
  });
  it('makes nothing while its storage is full, and says so', () => {
    const s = station('farm', { productionPerWeek: 30, fill: () => 1 });
    const [r] = stationOverview(s, world()).production;
    expect(r).toMatchObject({ perWeek: 0, chip: worksChip({ kind: 'full' }) });
  });
  it('looks to the store for a harvester that carries there, not to its own fill', () => {
    const room = { key: 'town:1', get: () => 50, cap: () => 100 };
    const s = station('farm', { productionPerWeek: 30, fill: () => 1, outlet: room });
    expect(stationOverview(s, world()).production[0]).toMatchObject({ perWeek: 30, chip: null });
    const brim = { ...room, get: () => 100 };
    const full = station('farm', { productionPerWeek: 30, outlet: brim });
    expect(stationOverview(full, world()).production[0].chip).toEqual(worksChip({ kind: 'full' }));
  });
  it('tells what has to be seen: no track, a water tower', () => {
    const s = station('farm', { loadBoost: 1.5 });
    expect(stationOverview(s, world({ hasTrack: false })).notes).toEqual([
      { cls: 'red', text: STR.station.noPlatform },
      { cls: 'cyan', text: STR.station.boost(50) },
    ]);
  });
  it('shares what it makes between its goods, as a tick does', () => {
    const def = stationDef('farm');
    const two = { ...def, produces: [...def.produces, { cargo: 'food', level: 1 }] };
    const s = station('farm', {
      def: two,
      producedCargo: () => ['wheat', 'food'],
      productionPerWeek: 30,
    });
    const v = stationOverview(s, world());
    expect(v.production.map((p) => [p.res, p.perWeek])).toEqual([
      ['wheat', 15],
      ['food', 15],
    ]);
  });
  it('names the town a station stands in, across the grid', () => {
    const v = stationOverview(station('station'), world({ town: 'Szeged' }));
    expect(v.facts.at(-1)).toEqual({ label: STR.station.town, value: 'Szeged', wide: true });
  });
  it('lists only goods a person can count as waiting', () => {
    const s = holding('warehouse', { coal: 0.4, wood: 2.9 });
    expect(stationOverview(s, world()).waiting).toEqual([{ res: 'wood', amount: 2 }]);
  });
  it('reads a store: the fullest good of its cap, its week, what works from it', () => {
    const src = (name: string, tiles: number, store: string | null, makes: object) =>
      ({ name, tiles, store, makes, chip: null }) as ReachSource;
    const near = src('Mill', 2, 'st:1', { food: 20.04 });
    const far = src('Quarry', 9, 'st:1', { stone: 30 });
    const other = src('Kiln', 1, 'st:9', { coal: 5 });
    const none = src('Dam', 1, null, { coal: 5 });
    const held = worksChip({ kind: 'full' });
    const stopped = { ...src('Press', 3, 'st:1', { wire: 0 }), chip: held };
    const s = holding(
      'warehouse',
      { coal: 150, wood: 40 },
      {
        capacity: 200,
        level: 2,
        dock: dock('st:1', {
          coal: { produced: 90.4, consumed: 10 },
          wood: { produced: 20 },
          stone: { consumed: 60.6 },
          iron: { produced: 3 },
          sand: { produced: 0.2, consumed: 0.3 },
        }),
      },
    );
    const v = stationOverview(s, world({ reach: [far, other, near, none, stopped] }));
    expect(v.facts[2].value).toBe('150 / 200 a good');
    expect(v.facts[2].meter).toBe(75);
    expect(v.week).toEqual([
      { res: 'coal', amount: 100 },
      { res: 'stone', amount: 61 },
      { res: 'wood', amount: 20 },
    ]);
    expect(v.production).toEqual([
      { res: 'food', name: 'Mill', tiles: 2, perWeek: 20, chip: null },
      { res: 'wire', name: 'Press', tiles: 3, perWeek: 0, chip: held },
      { res: 'stone', name: 'Quarry', tiles: 9, perWeek: 30, chip: null },
    ]);
  });
  it('shows an empty week of a store as a week, not as none', () => {
    const v = stationOverview(station('depot', { dock: dock('st:1') }), world());
    expect(v.weekOf).toBe(P.storeWeek(P.ownStore));
    expect(v.week).toEqual([]);
  });
  it('gives no reach to a station without a store', () => {
    const r = { name: 'Mill', tiles: 2, store: 'town:1', makes: { food: 20 }, chip: null };
    expect(stationOverview(station('farm'), world({ reach: [r] })).production).toHaveLength(1);
  });
});

describe('whose week the figures are', () => {
  const flows = { coal: { produced: 12 } };

  it('calls a store of the station alone this store', () => {
    const s = station('depot', { id: 7, dock: dock('st:7', flows) });
    const w = world({ storeName: 'Depot' });
    expect(stationOverview(s, w).weekOf).toBe(P.storeWeek(P.ownStore));
    expect(stationCargo(s, w).title).toBe(P.ownStore);
  });
  it('names the town for a Townhouse and for every warehouse in the town', () => {
    const w = world({ storeName: 'Szeged' });
    for (const id of ['town', 'warehouse']) {
      const s = station(id, { dock: dock('town:1', flows) });
      expect(stationOverview(s, w).weekOf).toBe('Szeged town store, this week');
      expect(stationCargo(s, w).title).toBe('Szeged town store');
    }
  });
  it("calls a store shared on a rail network the network's, town or not", () => {
    const w = world({ storeName: 'Szeged', storeShared: true });
    for (const key of ['town:1', 'st:1']) {
      const s = station('warehouse', { dock: dock(key, flows) });
      expect(stationOverview(s, w).weekOf).toBe(P.storeWeek(P.networkStore));
      expect(stationCargo(s, w).title).toBe(P.networkStore);
    }
  });
  it("keeps the station's own heading where there is no store", () => {
    const v = stationCargo(station('station'), world());
    expect(v.title).toBe(P.cargoHere);
    expect(v.counted).toBe(false);
  });
});

describe('the storage bar', () => {
  it('warns when nearly full and is bad when full', () => {
    expect([fillTone(74), fillTone(75), fillTone(99), fillTone(100)]).toEqual([
      '',
      'warn',
      'warn',
      'bad',
    ]);
  });
});

describe('the Cargo tab', () => {
  afterEach(() => setSupplyMode('simple'));

  it('sets what a station holds against its capacity, with no week to tell', () => {
    const v = stationCargo(holding('farm', { wheat: 45.8 }), world());
    expect(v.counted).toBe(false);
    expect(v.rows).toEqual([{ res: 'wheat', waiting: 45, share: 75, in: null, out: null }]);
    expect(v.storage.value).toBe('45 / 60');
    expect(v.accepts).toEqual([]);
  });
  it('shows a depot its goods, then what only passed through', () => {
    const s = holding(
      'depot',
      { coal: 30 },
      {
        capacity: 300,
        dock: dock('st:1', {
          coal: { produced: 10, consumed: 2.4 },
          food: { consumed: 28 },
          wood: { produced: 0.1 },
        }),
      },
    );
    const v = stationCargo(s, world());
    expect(v.counted).toBe(true);
    expect(v.rows).toEqual([
      { res: 'coal', waiting: 30, share: 10, in: 10, out: 2 },
      { res: 'food', waiting: 0, share: 0, in: 0, out: 28 },
    ]);
  });
  it('lists what a warehouse takes, of this game’s production chain only', () => {
    const accepts = stationDef('warehouse').accepts;
    setSupplyMode('simple');
    const simple = stationCargo(station('warehouse'), world()).accepts;
    setSupplyMode('full');
    const full = stationCargo(station('warehouse'), world()).accepts;
    expect(simple.length).toBeGreaterThan(0);
    expect(simple.length).toBeLessThan(accepts.length);
    expect(full).toContain('copper_ore');
    expect(simple).not.toContain('copper_ore');
  });
  it('says where a harvester in a town carries its goods', () => {
    const v = stationCargo(station('farm'), world({ outletName: 'Szeged' }));
    expect(v.carried).toBe(P.carriedTo('Szeged'));
    expect(stationCargo(station('farm'), world()).carried).toBeNull();
  });
  it('lists the contracts with an end here, the nearest deadline first', () => {
    const v = stationCargo(
      station('station'),
      world({
        now: 100,
        contracts: [
          contract({ id: 1, expires: 900 }),
          contract({ id: 2, originId: 5, destId: 1, expires: 300, cargo: 'wheat' }),
          contract({ id: 3, originId: 5, destId: 6 }),
        ],
        remaining: (c) => (c.id === 2 ? 0.2 : 0.9),
      }),
    );
    expect(v.contracts).toEqual([
      {
        id: 2,
        title: '← Stop 5: 40 Wheat',
        progress: '12/40',
        left: fmtDuration(200),
        late: true,
      },
      {
        id: 1,
        title: '→ Stop 2: 40 Coal',
        progress: '12/40',
        left: fmtDuration(800),
        late: false,
      },
    ]);
  });
  it('names a contract’s far end even when that station is gone, and never a negative time', () => {
    const v = stationCargo(
      station('station'),
      world({ now: 900, contracts: [contract({ expires: 500 })], stationName: () => null }),
    );
    expect(v.contracts[0].title).toBe('→ ?: 40 Coal');
    expect(v.contracts[0].left).toBe(fmtDuration(0));
  });
});

describe('the trains that call here', () => {
  const here = station('station', { id: 1 });

  it('counts its platform, its queue, its stops, its contracts and a service stop', () => {
    const at = train(1, [1, 2], { state: 'loading' });
    const s = station('station', { id: 1, occupants: new Set([1]) });
    expect(callState(at, s)).toBe('platform');
    const queued = train(2, [1, 2], { state: 'waiting', atStation: { id: 1 } });
    expect(callState(queued, here)).toBe('queued');
    expect(callState(train(3, [1, 2]), here)).toBe('inbound');
    expect(callState(train(4, [2, 1]), here)).toBe('later');
    const job = { name: 'Coal', originId: 1, destId: 2 };
    expect(callState(train(5, [8, 9], { job }), here)).toBe('later');
    expect(callState(train(6, [8, 9], { jobs: [job] }), here)).toBe('later');
    expect(callState(train(7, [8, 9], { detour: 1 }), here)).toBe('inbound');
  });
  it('leaves out a train that does not come, or only runs through', () => {
    expect(callState(train(1, [2, 3]), here)).toBeNull();
    const schedule = [
      { stationId: 1, pass: true },
      { stationId: 2, pass: false },
    ];
    const through = train(2, [1, 2], { schedule, program: schedule });
    expect(callState(through, here)).toBeNull();
  });
  it('goes by its own stops while a contract has set them aside', () => {
    const program = [{ stationId: 1, pass: false }];
    const t = train(1, [8, 9], { program });
    expect(callState(t, here)).toBe('later');
  });
  it('waiting at another station is not this one’s queue', () => {
    const t = train(1, [2, 1], { state: 'waiting', atStation: { id: 2 } });
    expect(callState(t, here)).toBe('later');
  });

  it('draws a row of a train with its status, cargo and load', () => {
    const wagon = { cargo: 'coal', amount: 15, level: 1, def: { capacity: 30 } };
    const t = train(3, [1, 2], {
      colour: 2,
      wagons: [wagon],
      pathTotal: 12,
      pathProgress: 2,
      freeSpeed: 2,
    });
    const [r] = stationTrains(here, world({ trains: [t] }));
    expect(r).toMatchObject({
      id: 3,
      name: 'Train 3',
      hex: TRAIN_COLOURS[2],
      cargo: [{ res: 'coal', amount: 15 }],
      load: 50,
      state: 'inbound',
      eta: 5,
      where: P.arrives(fmtDuration(5)),
    });
    expect(r.chip.text).toBe(STR.outliner.status.moving);
  });
  it('orders them: at the platforms, waiting, then by when they come', () => {
    const s = station('station', { id: 1, occupants: new Set([4]) });
    const trains = [
      train(1, [2, 1]),
      train(2, [1, 2], { pathTotal: 30, freeSpeed: 1 }),
      train(3, [1, 2], { pathTotal: 10, freeSpeed: 1 }),
      train(4, [1, 2], { state: 'loading', atStation: { id: 1 } }),
      train(5, [1, 2], { state: 'waiting', atStation: { id: 1 } }),
      train(6, [1, 2], { holding: true, pathTotal: 5, freeSpeed: 1 }),
    ];
    const rows = stationTrains(s, world({ trains }));
    expect(rows.map((r) => r.id)).toEqual([4, 5, 3, 2, 6, 1]);
    expect(rows.map((r) => r.where)).toEqual([
      P.atPlatform,
      P.queued,
      P.arrives(fmtDuration(10)),
      P.arrives(fmtDuration(30)),
      P.onItsWay,
      P.boundFor('Stop 2'),
    ]);
  });
  it('has a word for a train whose next stop has gone', () => {
    const t = train(1, [2, 1]);
    const rows = stationTrains(here, world({ trains: [t], stationName: () => null }));
    expect(rows[0].where).toBe(P.onItsRoute);
  });
  it('says stuck when the train has stood for good', () => {
    const t = train(1, [1, 2], { state: 'moving' });
    const [r] = stationTrains(here, world({ trains: [t], stuck: () => 900 }));
    expect(r.chip.text).toBe(STR.outliner.stuck);
  });
  it('holds a harvest station, a depot and a warehouse to the same rule', () => {
    const trains = [train(1, [1, 2])];
    for (const id of ['farm', 'depot', 'warehouse'])
      expect(stationTrains(station(id, { id: 1 }), world({ trains })).map((r) => r.id)).toEqual([
        1,
      ]);
  });
});

describe('the Expansion tab', () => {
  it('reads each level of a plain station from the tables, up to the top', () => {
    const v = stationExpansion(station('station'), world());
    expect(v.levels.map((l) => l.level)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(v.levels).toHaveLength(MAX_LEVEL);
    v.levels.forEach((l, i) => {
      expect(l.storage).toBe(Math.round(LEVELS.capacity[i] * rules.capacityMul));
      expect(l.loadRate).toBe(LEVELS.loadRate[i]);
      expect(l.platforms).toBe(LEVELS.platforms[i]);
      expect(l.crew).toBe(LEVELS.crew[i]);
      expect(l.picture).toBe(LEVELS.spriteByLevel[i]);
    });
  });
  it('charges what the station itself will charge, for every level', () => {
    for (const id of ['station', 'farm', 'warehouse', 'town', 'depot']) {
      const s = new Station(id, 3, 3);
      for (let level = 1; level < MAX_LEVEL; level++) {
        s.level = level;
        const row = stationExpansion(s, world()).next!;
        expect(row.level).toBe(level + 1);
        expect(fmtCost(row.cost), `${id} to ${level + 1}`).toBe(fmtCost(s.upgradeCost()));
      }
    }
  });
  it('pays nothing for a level it has', () => {
    const v = stationExpansion(station('station', { level: 3 }), world());
    expect(v.levels.slice(0, 3).map((l) => l.cost)).toEqual([{}, {}, {}]);
    expect(v.levels.slice(0, 3).map((l) => l.hours)).toEqual([0, 0, 0]);
    expect(Object.keys(v.levels[3].cost).length).toBeGreaterThan(0);
    expect(v.levels[3].hours).toBe(upgradeHours(4, false));
  });
  it('marks the levels: past, now, next, later', () => {
    const v = stationExpansion(station('station', { level: 2 }), world({ age: 5 }));
    expect(v.levels.map((l) => l.state)).toEqual([
      'done',
      'now',
      'next',
      'later',
      'later',
      'later',
    ]);
  });
  it('caps them by age: a level per age from the age the kind appears in', () => {
    const v = stationExpansion(station('station'), world({ age: 2 }));
    expect(v.levels.map((l) => l.locked)).toEqual([false, false, false, true, true, true]);
    expect(v.levels[2].opens).toBeNull();
    expect(v.levels[3].opens).toBe(STR.build.levelOpens(4, STR.ages.name.nuclear));
  });
  it('holds everything but level 1 in the first age', () => {
    const v = stationExpansion(station('farm'), world());
    expect(v.next?.locked).toBe(true);
    expect(v.next?.opens).toBe(STR.build.levelOpens(2, STR.ages.name.diesel));
  });
  it('stops a later kind at what the last age opens', () => {
    const s = station('copper_mine');
    const v = stationExpansion(s, world({ age: LAST_AGE }));
    expect(s.firstAge).toBe(2);
    expect(v.levels.map((l) => l.level)).toEqual([1, 2, 3, 4]);
    expect(v.levels.some((l) => l.locked)).toBe(false);
  });
  it('keeps a level past that top, set in the editor', () => {
    const s = station('copper_mine', { level: 6 });
    const v = stationExpansion(s, world());
    expect(v.levels).toHaveLength(6);
    expect(v.levels.some((l) => l.locked || l.opens)).toBe(false);
    expect(v.next).toBeNull();
    expect(v.compare).toEqual([]);
  });
  it('compares the next level with this one, naming only what changes', () => {
    const v = stationExpansion(station('station', { level: 2 }), world({ age: 5 }));
    expect(v.next?.level).toBe(3);
    expect(v.compare.slice(0, 4)).toEqual([
      { label: STR.station.storage, now: '120', next: '200' },
      { label: P.loadPerSec, now: '6', next: '9' },
      { label: STR.station.platforms, now: '1', next: '2' },
      { label: P.crew, now: '3', next: '5' },
    ]);
    const same = stationExpansion(station('station', { level: 3 }), world({ age: 5 }));
    expect(same.compare[2]).toEqual({ label: STR.station.platforms, now: '2', next: null });
  });
  it('gives a harvester its output on this ground in this season', () => {
    const s = station('farm', { terrainFactor: 0.5, productionMul: 2, level: 1 });
    const v = stationExpansion(s, world({ age: 5 }));
    expect(v.levels[1].output).toBe(weeklyOutput(2, 0.5) * 2);
    expect(v.compare[4].label).toBe(P.makesAWeek);
  });
  it('gives a store no output, so no line for it', () => {
    const v = stationExpansion(station('warehouse'), world({ age: 5 }));
    expect(v.levels.every((l) => l.output === null)).toBe(true);
    expect(v.compare).toHaveLength(4);
  });
  it('names what a level adds', () => {
    const def = stationDef('farm');
    const more = { ...def, produces: [...def.produces, { cargo: 'food', level: 3 }] };
    const v = stationExpansion(station('farm', { def: more }), world({ age: 5 }));
    expect(v.levels[0].unlocks).toEqual(['wheat']);
    expect(v.levels[1].unlocks).toEqual([]);
    expect(v.levels[2].unlocks).toEqual(['food']);
  });
  it('raises a warehouse’s store one cap a level, its own or its town’s', () => {
    const own = station('warehouse', { level: 2, capacity: rules.warehouseCap * 2 });
    const levels = stationExpansion(own, world({ age: 5 })).levels;
    expect(levels.map((l) => l.storage)).toEqual(
      [1, 2, 3, 4, 5, 6].map((n) => n * rules.warehouseCap),
    );
    const town = station('warehouse', { level: 1, capacity: 500, dock: dock('town:1') });
    const inTown = stationExpansion(town, world({ age: 5 })).levels;
    expect(inTown[1].storage).toBe(500 + rules.warehouseCap);
  });
  it('keeps a depot’s store and tracks at every level, free and instant', () => {
    const s = station('depot', { capacity: rules.depotCap, platforms: 2 });
    const v = stationExpansion(s, world({ age: 5 }));
    expect(v.levels.every((l) => l.storage === rules.depotCap && l.platforms === 2)).toBe(true);
    expect(v.levels[1].loadRate).toBe(LEVELS.loadRate[1]);
    expect(v.levels.flatMap((l) => Object.keys(l.cost))).toEqual([]);
    expect(v.levels.map((l) => l.hours)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(v.compare[0].next).toBeNull();
    expect(v.compare[2].next).toBeNull();
  });
  it('keeps a Townhouse’s store at every level', () => {
    const s = station('town', { capacity: 800, dock: dock('town:1') });
    const v = stationExpansion(s, world({ age: 5 }));
    expect(new Set(v.levels.map((l) => l.storage))).toEqual(new Set([800]));
  });
  it('asks nothing of the level editor: no age, no price, no time', () => {
    const v = stationExpansion(station('copper_mine'), world({ free: true }));
    expect(v.levels).toHaveLength(MAX_LEVEL);
    expect(v.levels.some((l) => l.locked)).toBe(false);
    expect(v.levels.flatMap((l) => Object.keys(l.cost))).toEqual([]);
    expect(v.levels.map((l) => l.hours)).toEqual([0, 0, 0, 0, 0, 0]);
  });
});

describe('the Timetable tab', () => {
  it('says what the simulation can: who is here, who waits, who comes and when', () => {
    const s = station('station', { id: 1, platforms: 2, occupants: new Set([4]) });
    const trains = [
      train(1, [2, 1]),
      train(3, [1, 2, 7], { pathTotal: 10, freeSpeed: 1, routeIndex: 0 }),
      train(4, [2, 1], { state: 'loading', routeIndex: 1, atStation: { id: 1 } }),
      train(5, [1, 2], { state: 'waiting', atStation: { id: 1 } }),
      train(6, [1], { holding: true }),
    ];
    const v = stationTimetable(s, world({ trains }));
    expect(v.board.map((r) => [r.id, r.when, r.to])).toEqual([
      [4, P.now, 'Stop 2'],
      [5, P.inQueue, 'Stop 2'],
      [3, P.inAbout(fmtDuration(10)), 'Stop 2'],
      [6, '-', null],
    ]);
    expect(v.used).toBe(1);
    expect(v.platforms).toBe(2);
    expect(v.share).toBe(50);
    expect(v.queued).toBe(1);
  });
  it('sends a train on a service stop on to its scheduled stop', () => {
    const s = station('farm', { id: 1 });
    const t = train(1, [8, 9], { detour: 1 });
    expect(stationTimetable(s, world({ trains: [t] })).board[0].to).toBe('Stop 8');
  });
  it('is an empty board when nothing is on its way', () => {
    const s = station('warehouse', { id: 1, platforms: 2 });
    const v = stationTimetable(s, world({ trains: [train(1, [2, 3])] }));
    expect(v.board).toEqual([]);
    expect(v.share).toBe(0);
  });
  it('fills to the platforms of a harvest station, past them never', () => {
    const s = station('farm', { id: 1, platforms: 1, occupants: new Set([1, 2]) });
    expect(stationTimetable(s, world()).share).toBe(100);
  });
});

describe("a train's onward stop", () => {
  const at = (stops: { stationId: number; pass: boolean }[], more: Partial<CallFacts> = {}) =>
    train(
      1,
      stops.map((p) => p.stationId),
      { schedule: stops, program: stops, state: 'loading', ...more },
    );
  const stop = (stationId: number, pass = false) => ({ stationId, pass });
  const here = station('station', { id: 1, occupants: new Set([1]) });
  const onward = (t: CallFacts) => stationTimetable(here, world({ trains: [t] })).board[0].to;

  it('is the next stop of its round', () => {
    expect(onward(at([stop(1), stop(2), stop(3)]))).toBe('Stop 2');
  });
  it('is not a stop it runs through', () => {
    expect(onward(at([stop(1), stop(2, true), stop(3)]))).toBe('Stop 3');
    expect(onward(at([stop(1), stop(2, true), stop(3, true), stop(4)]))).toBe('Stop 4');
  });
  it('comes round the end of the list', () => {
    const t = at([stop(9), stop(5, true), stop(1), stop(6, true)], { routeIndex: 2 });
    expect(onward(t)).toBe('Stop 9');
  });
  it('is unknown when all it does is come back here, or on a one-stop program', () => {
    expect(onward(at([stop(1), stop(2, true)]))).toBeNull();
    expect(onward(at([stop(1)]))).toBeNull();
  });
  it('after a service stop is its next scheduled stop, past those it runs through', () => {
    const t = at([stop(8, true), stop(9)], { detour: 1 });
    expect(onward(t)).toBe('Stop 9');
  });
});

describe('what a depot has of the board', () => {
  it('says the same as any station: who is due, and its tracks in use', () => {
    const s = station('depot', { id: 1, platforms: 2, occupants: new Set([3]) });
    const trains = [train(3, [1, 2], { state: 'loading', atStation: { id: 1 } })];
    const v = stationTimetable(s, world({ trains }));
    expect(v.board.map((r) => [r.id, r.when, r.to])).toEqual([[3, P.now, 'Stop 2']]);
    expect([v.used, v.platforms, v.share]).toEqual([1, 2, 50]);
  });
});

describe('what a level says a passenger station makes', () => {
  it('is a most, where the Overview has what the people around it allow', () => {
    const s = station('station', { productionPerWeek: 12, passengerPopulation: 30 });
    const w = world({ age: 5 });
    const v = stationExpansion(s, w);
    expect(stationOverview(s, w).production[0].perWeek).toBe(12);
    expect(v.compare[4]).toEqual({ label: P.atMostAWeek, now: '30', next: '50' });
    expect(v.outputHead).toBe(P.atMostShort);
  });
  it('is what it makes for a harvester, whose ground and season the figure holds', () => {
    const s = station('farm', { productionPerWeek: 15, terrainFactor: 0.5, productionMul: 1 });
    const w = world({ age: 5 });
    const v = stationExpansion(s, w);
    expect(stationOverview(s, w).production[0].perWeek).toBe(v.levels[0].output);
    expect(v.compare[4].label).toBe(P.makesAWeek);
    expect(v.outputHead).toBe(P.makesShort);
  });
});

describe('what a tab is drawn again for', () => {
  const inbound = (progress: number) =>
    train(3, [1, 2], { pathTotal: 100, pathProgress: progress, freeSpeed: 1 });
  const here = station('station', { id: 1, platforms: 2 });
  const rows = (progress: number) => stationTrains(here, world({ trains: [inbound(progress)] }));

  it('is not a train coming closer', () => {
    expect(rows(10)[0].where).not.toBe(rows(50)[0].where);
    expect(callsShape(rows(10))).toEqual(callsShape(rows(50)));
    const board = (p: number) => stationTimetable(here, world({ trains: [inbound(p)] }));
    expect(board(10).board[0].when).not.toBe(board(50).board[0].when);
    expect(boardShape(board(10))).toEqual(boardShape(board(50)));
  });
  it('is a train that comes, goes, or changes what it is doing', () => {
    const none = stationTrains(here, world());
    expect(callsShape(none)).not.toEqual(callsShape(rows(10)));
    const stopped = train(3, [1, 2], { state: 'waiting', atStation: { id: 1 } });
    const queued = stationTrains(here, world({ trains: [stopped] }));
    expect(callsShape(queued)).not.toEqual(callsShape(rows(10)));
  });
  it("is the board's platforms when one fills", () => {
    const empty = stationTimetable(here, world());
    const used = stationTimetable({ ...here, occupants: new Set([9]) }, world());
    expect(boardShape(empty)).not.toEqual(boardShape(used));
  });
  it('is not a work going on, or the stock behind a button that is off', () => {
    const work = (progress: number, label: string): UpgradeView => ({
      kind: 'work',
      label,
      progress,
    });
    expect(upgradeShape(work(0.1, '6 h left'))).toEqual(upgradeShape(work(0.7, '2 h left')));
    const off = (title: string): UpgradeView => ({
      kind: 'button',
      label: 'Upgrade',
      enabled: false,
      title,
    });
    expect(upgradeShape(off('12 wood short'))).toEqual(upgradeShape(off('3 wood short')));
  });
  it('is the button coming on, the work starting and the top reached', () => {
    const off: UpgradeView = { kind: 'button', label: 'Upgrade', enabled: false, title: 'x' };
    const on: UpgradeView = { kind: 'button', label: 'Upgrade', enabled: true, title: '' };
    const work: UpgradeView = { kind: 'work', label: 'x', progress: 0 };
    const top: UpgradeView = { kind: 'top', label: 'Max level' };
    const shapes = [off, on, work, top].map((v) => JSON.stringify(upgradeShape(v)));
    expect(new Set(shapes).size).toBe(4);
  });
  it('is not a level table that says the same', () => {
    const w = world({ age: 5 });
    const a = stationExpansion(station('farm'), w);
    const b = stationExpansion(station('farm'), w);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
