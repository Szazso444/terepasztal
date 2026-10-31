import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_RULES, rules } from '../sim/rules';
import type { TrainState } from '../sim/trains';
import { STR } from '../strings';
import { trainFacts, tripWith } from '../testing/trainFacts';
import { CLIMB_SPEED } from '../world/railProfile';
import {
  LOW_TANK_TILES,
  arrivalOf,
  climbSpeed,
  jobLine,
  lastStopId,
  loadShare,
  nextStopId,
  problemOf,
  tanksOf,
  trainChip,
  trainOverview,
  weeklyFlow,
  weeklyIncome,
} from './trainView';

beforeEach(() => {
  Object.assign(rules, DEFAULT_RULES);
});

describe('the status chip', () => {
  it('has a word for every state', () => {
    const states: TrainState[] = [
      'moving',
      'loading',
      'waiting',
      'idle',
      'yielding',
      'noRoute',
      'stranded',
      'noFuel',
      'noPower',
      'overweight',
    ];
    for (const state of states)
      expect(trainChip({ state, blocked: false }, null).text).toBeTruthy();
  });

  it('a running train held behind another says so', () => {
    expect(trainChip({ state: 'moving', blocked: true }, null)).toMatchObject({
      sev: 'attention',
      text: STR.outliner.status.held,
    });
    expect(trainChip({ state: 'loading', blocked: true }, null).text).toBe(
      STR.outliner.status.loading,
    );
  });

  it('stuck goes over what holds a train, never over what stopped it', () => {
    expect(trainChip({ state: 'moving', blocked: true }, 90)).toMatchObject({
      sev: 'critical',
      text: STR.outliner.stuck,
    });
    expect(trainChip({ state: 'noFuel', blocked: false }, 90).text).toBe(
      STR.outliner.status.noFuel,
    );
  });

  it('out of fuel is the worst there is, and running is good', () => {
    expect(trainChip({ state: 'noFuel', blocked: false }, null).sev).toBe('critical');
    expect(trainChip({ state: 'moving', blocked: false }, null).sev).toBe('good');
  });
});

describe('from and to', () => {
  it('the next stop is the one the route points at, round the end too', () => {
    expect(nextStopId(trainFacts({ route: [5, 6, 7], routeIndex: 1 }))).toBe(6);
    expect(nextStopId(trainFacts({ route: [5, 6, 7], routeIndex: 4 }))).toBe(6);
  });

  it('a service stop goes before it', () => {
    expect(nextStopId(trainFacts({ route: [5, 6], detour: 9 }))).toBe(9);
  });

  it('no route has no stop', () => {
    expect(nextStopId(trainFacts())).toBeNull();
    expect(lastStopId(trainFacts())).toBeNull();
    expect(lastStopId(trainFacts({ route: [5] }))).toBeNull();
  });

  it('the last stop is the one before, round the start too', () => {
    expect(lastStopId(trainFacts({ route: [5, 6, 7], routeIndex: 1 }))).toBe(5);
    expect(lastStopId(trainFacts({ route: [5, 6, 7], routeIndex: 0 }))).toBe(7);
  });
});

describe('the load', () => {
  it('is what is on board of what the wagons can hold', () => {
    const wagons = [
      { cargo: 'coal', amount: 10, level: 1, def: { capacity: 20 } },
      { cargo: null, amount: 0, level: 1, def: { capacity: 20 } },
    ];
    expect(loadShare({ wagons })).toBe(0.25);
  });

  it('no wagons, no load', () => {
    expect(loadShare({ wagons: [] })).toBe(0);
  });
});

describe('the tanks', () => {
  it('a steam engine has fuel and water, with the tiles each lasts', () => {
    const t = trainFacts({
      hasSteam: true,
      fuelKind: 'wood',
      coal: 12,
      coalCap: 40,
      coalRate: 0.5,
      water: 30,
      waterCap: 60,
      waterRate: 2,
    });
    expect(tanksOf(t)).toEqual([
      { res: 'wood', have: 12, cap: 40, tiles: 24, low: false },
      { res: 'water', have: 30, cap: 60, tiles: 15, low: false },
    ]);
  });

  it('a diesel shows only its oil, an electric train only its battery carts', () => {
    const diesel = trainFacts({
      hasDiesel: true,
      oilKind: 'diesel',
      oil: 5,
      oilCap: 9,
      oilRate: 1,
    });
    expect(tanksOf(diesel).map((k) => k.res)).toEqual(['diesel']);
    const electric = trainFacts({ hasElectric: true, batteryCap: 10, battery: 4, powerRate: 1 });
    expect(tanksOf(electric).map((k) => k.res)).toEqual(['power']);
    expect(tanksOf(trainFacts({ hasElectric: true }))).toEqual([]);
  });

  it('a tank close to empty is low', () => {
    const at = (coal: number) =>
      tanksOf(trainFacts({ hasSteam: true, coal, coalCap: 50, coalRate: 1 }))[0].low;
    expect(at(LOW_TANK_TILES - 0.5)).toBe(true);
    expect(at(LOW_TANK_TILES)).toBe(false);
  });
});

describe('a week of the last loop', () => {
  it('nothing before the first loop closes', () => {
    const open = { ...tripWith({ income: 500 }, 7), endedAt: 0 };
    expect(weeklyIncome(null)).toBeNull();
    expect(weeklyIncome(open)).toBeNull();
    expect(weeklyFlow(open, { coal: 5 })).toBeNull();
  });

  it('a loop of two weeks counts half', () => {
    expect(weeklyIncome(tripWith({ income: 1000 }, 14))).toBeCloseTo(500);
    expect(weeklyFlow(tripWith({}, 14), { coal: 8 })).toEqual([{ res: 'coal', amount: 4 }]);
  });

  it('leaves out dust and what the filter leaves out', () => {
    const rec = { coal: 7, refuel_coal: 7, wood: 0.01 };
    expect(weeklyFlow(tripWith({}, 7), rec, (k) => !k.startsWith('refuel_'))).toEqual([
      { res: 'coal', amount: 7 },
    ]);
    expect(weeklyFlow(tripWith({}, 7), { wood: 0.01 })).toBeNull();
  });
});

describe('the arrival', () => {
  const running = { pathTotal: 30, pathProgress: 10, freeSpeed: 2 };

  it('is the way left over the speed it runs at', () => {
    expect(arrivalOf(trainFacts(running))).toEqual({ tiles: 20, seconds: 10 });
  });

  it('a train that has not run yet is timed at its top speed', () => {
    const t = trainFacts({ ...running, freeSpeed: 0, maxSpeed: 4 });
    expect(arrivalOf(t)?.seconds).toBe(5);
  });

  it('a train that stands or makes way has none', () => {
    expect(arrivalOf(trainFacts({ ...running, state: 'loading' }))).toBeNull();
    expect(arrivalOf(trainFacts({ ...running, holding: true }))).toBeNull();
    expect(arrivalOf(trainFacts({ state: 'moving' }))).toBeNull();
  });
});

describe('the problem box', () => {
  it('a train that runs has none', () => {
    expect(problemOf(trainFacts(), null)).toBeNull();
    expect(problemOf(trainFacts({ state: 'loading' }), null)).toBeNull();
  });

  it('out of fuel offers the emergency refuel and the stops', () => {
    expect(problemOf(trainFacts({ state: 'noFuel' }), null)).toMatchObject({
      sev: 'critical',
      title: STR.depot.state.noFuel,
      actions: ['refuel', 'stops'],
    });
  });

  it('says what the simulation noted, when it did', () => {
    const t = trainFacts({ state: 'noRoute', lastMessage: 'Birch has no platform' });
    expect(problemOf(t, null)?.text).toBe('Birch has no platform');
    expect(problemOf(trainFacts({ state: 'noRoute' }), null)?.text).toBe(
      STR.trainPanel.problem.noRoute,
    );
  });

  it('overweight offers the Depot, where a consist is changed', () => {
    expect(problemOf(trainFacts({ state: 'overweight' }), null)?.actions).toEqual(['depot']);
  });

  it('a stranded train offers nothing: only laying the track helps', () => {
    expect(problemOf(trainFacts({ state: 'stranded' }), null)?.actions).toEqual([]);
  });

  it('stuck tells for how long, in whole hours', () => {
    const hours = (n: number) => (n / 24) * rules.daySeconds;
    expect(problemOf(trainFacts({ blocked: true }), hours(3.5))?.title).toBe(
      STR.trainPanel.problem.stuckFor(3),
    );
  });

  it('a stop for good goes before being stuck, being stuck before hunger', () => {
    const t = trainFacts({ state: 'noFuel', hungry: true });
    expect(problemOf(t, 90)?.title).toBe(STR.depot.state.noFuel);
    expect(problemOf(trainFacts({ hungry: true }), 90)?.sev).toBe('critical');
    expect(problemOf(trainFacts({ hungry: true }), null)?.sev).toBe('attention');
  });
});

describe('the contract line', () => {
  const job = { name: 'Coal run', destId: 2 };
  const name = () => 'Birch';

  it('none without a job', () => {
    expect(jobLine(trainFacts(), name)).toBeNull();
  });

  it('says the job at work, and how many wait', () => {
    const one = STR.trainSide.onContract('Coal run', 'Birch');
    expect(jobLine(trainFacts({ job, jobs: [] }), name)).toBe(one);
    expect(jobLine(trainFacts({ job, jobs: [job, job] }), name)).toBe(
      `${one} · ${STR.trainSide.queuedContracts(2)}`,
    );
  });

  it('a job waiting its turn is told as the next, not as one of those behind it', () => {
    expect(jobLine(trainFacts({ jobs: [job] }), name)).toBe(
      STR.trainSide.onContract('Coal run', 'Birch'),
    );
  });
});

describe('the climb', () => {
  it('is the top speed under its load, at what a climb leaves', () => {
    expect(climbSpeed({ maxSpeed: 2, loadFactor: 0.5 })).toBe(CLIMB_SPEED);
  });
});

describe('the Overview tab', () => {
  const stations = (id: number) => (id === 2 ? 'Birch' : null);

  it('reads the train as it is, and rounds what it shows', () => {
    const t = {
      ...trainFacts({
        route: [1, 2],
        routeIndex: 1,
        pathTotal: 12,
        pathProgress: 2.4,
        freeSpeed: 2,
        maxSpeed: 2.5,
        hasSteam: true,
        fuelKind: 'coal',
        coal: 10,
        coalCap: 40,
        coalRate: 0.5,
        water: 40,
        waterCap: 40,
        waterRate: 1,
        rangeTiles: 20.7,
        wagons: [{ cargo: 'coal', amount: 7.6, level: 1, def: { capacity: 20 } }],
        lastTrip: tripWith({ income: 980.4, loaded: { coal: 14 } }, 7),
      }),
      speed: 1.24,
    };
    const v = trainOverview(t, stations, null);
    expect(v.next).toBe('Birch');
    expect(v.speed).toBe(`1.20 ${STR.trainSide.tilesPerSec}`);
    expect(v.topSpeed).toBe(`2.50 ${STR.trainSide.tilesPerSec}`);
    expect(v.load).toBe(38);
    expect(v.cargo).toEqual([{ res: 'coal', amount: 8, share: 38 }]);
    expect(v.supplies.map((k) => [k.res, k.share, k.tiles])).toEqual([
      ['coal', 25, 20],
      ['water', 100, 40],
    ]);
    expect(v.range).toBe(STR.trainPanel.tiles(20));
    expect(v.income).toBe('$980');
    expect(v.flows.map((f) => f.goods)).toEqual([null, [{ res: 'coal', amount: '14' }], null]);
    expect(v.problem).toBeNull();
  });

  it('a train on the wires has no range to run out of, and says what it draws', () => {
    const t = { ...trainFacts({ hasElectric: true, powerRate: 1.25 }), speed: 0 };
    const v = trainOverview(t, stations, null);
    expect(v.range).toBe(STR.trainPanel.unlimited);
    expect(v.electric).toBe(`1.25 ${STR.trainSide.perTile}`);
    expect(v.supplies).toEqual([]);
  });

  it('no loop yet: no money, no flows', () => {
    const v = trainOverview({ ...trainFacts(), speed: 0 }, stations, null);
    expect(v.income).toBeNull();
    expect(v.flows.every((f) => f.goods === null)).toBe(true);
  });
});
