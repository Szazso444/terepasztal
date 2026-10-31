import { afterEach, describe, expect, it } from 'vitest';
import { LAST_AGE } from '../sim/ages';
import { MAX_LEVEL } from '../sim/levels';
import { rules } from '../sim/rules';
import { LEVELS, Station, stationDef, weeklyOutput } from '../sim/stations';
import type { Flow } from '../sim/stores';
import { fmtCost } from '../sim/stores';
import { setSupplyMode } from '../sim/supply';
import { TRAIN_COLOURS } from '../sim/trainColours';
import { STR } from '../strings';
import { trainFacts } from '../testing/trainFacts';
import { fmtDuration } from './numberFormat';
import {
  STATION_TABS,
  callState,
  fillTone,
  stationCargo,
  stationExpansion,
  stationOverview,
  stationTabs,
  stationTimetable,
  stationTrains,
  type CallFacts,
  type ContractFacts,
  type ReachSource,
  type StationFacts,
  type StationWorld,
} from './stationView';
import { upgradeHours } from './upgradeView';

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
    passengerPopulation: 0,
    occupants: new Set(),
    def,
    dock: null,
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
    perWeek: 0,
    outletName: null,
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

describe('the tabs of each kind', () => {
  it('gives a plain station, a harvest station and a warehouse all five', () => {
    expect(stationTabs(stationDef('station'))).toEqual(STATION_TABS);
    expect(stationTabs(stationDef('farm'))).toEqual(STATION_TABS);
    expect(stationTabs(stationDef('warehouse'))).toEqual(STATION_TABS);
    expect(stationTabs(stationDef('town'))).toEqual(STATION_TABS);
  });
  it('leaves a depot without a Timetable, of either gauge', () => {
    const shed = ['overview', 'cargo', 'trains', 'expansion'];
    expect(stationTabs(stationDef('depot'))).toEqual(shed);
    expect(stationTabs(stationDef('narrow_depot'))).toEqual(shed);
  });
});

describe('the Overview', () => {
  it('says what a plain station is at: platforms, loading, storage, crew, its people', () => {
    const s = holding('station', { passengers: 15 }, { occupants: new Set([7]), platforms: 2 });
    s.passengerPopulation = 38;
    const v = stationOverview(s, world({ perWeek: 15.2 }));
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
      { res: 'passengers', name: 'Passengers', tiles: null, perWeek: 15.2 },
    ]);
    expect(v.waiting).toEqual([{ res: 'passengers', amount: 15 }]);
  });
  it('counts no week for a station with storage of its own', () => {
    const v = stationOverview(holding('farm', { wheat: 3 }), world({ perWeek: 30 }));
    expect(v.week).toBeNull();
    expect(v.residents).toBeNull();
  });
  it('gives a harvest station the rate of its breakdown, none while it is closed', () => {
    const s = holding('farm', { wheat: 3 });
    expect(stationOverview(s, world({ perWeek: 41.26 })).production[0].perWeek).toBe(41.3);
    const shut = holding('farm', { wheat: 3 }, { closed: true });
    const v = stationOverview(shut, world({ perWeek: 0 }));
    expect(v.production[0].perWeek).toBe(0);
    expect(v.notes).toEqual([{ cls: 'amber', text: STR.upgrade.closed }]);
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
    const s = station('farm', { def: two, producedCargo: () => ['wheat', 'food'] });
    const v = stationOverview(s, world({ perWeek: 30 }));
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
  it('reads a store: the fullest good of its cap, what it handled, what works from it', () => {
    const near: ReachSource = { name: 'Mill', tiles: 2, store: 'st:1', makes: { food: 20.04 } };
    const far: ReachSource = { name: 'Quarry', tiles: 9, store: 'st:1', makes: { stone: 30 } };
    const other: ReachSource = { name: 'Kiln', tiles: 1, store: 'st:9', makes: { coal: 5 } };
    const none: ReachSource = { name: 'Dam', tiles: 1, store: null, makes: { power: 5 } };
    const idle: ReachSource = { name: 'Press', tiles: 3, store: 'st:1', makes: { wire: 0 } };
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
    const v = stationOverview(s, world({ reach: [far, other, near, none, idle] }));
    expect(v.facts[2].value).toBe('150 / 200 a good');
    expect(v.facts[2].meter).toBe(75);
    expect(v.week).toEqual([
      { res: 'coal', amount: 100 },
      { res: 'stone', amount: 61 },
      { res: 'wood', amount: 20 },
    ]);
    expect(v.production).toEqual([
      { res: 'food', name: 'Mill', tiles: 2, perWeek: 20 },
      { res: 'stone', name: 'Quarry', tiles: 9, perWeek: 30 },
    ]);
  });
  it('shows an empty week of a store as a week, not as none', () => {
    expect(stationOverview(station('depot', { dock: dock('st:1') }), world()).week).toEqual([]);
  });
  it('gives no reach to a station without a store', () => {
    const r: ReachSource = { name: 'Mill', tiles: 2, store: 'town:1', makes: { food: 20 } };
    expect(stationOverview(station('farm'), world({ reach: [r] })).production).toHaveLength(1);
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
