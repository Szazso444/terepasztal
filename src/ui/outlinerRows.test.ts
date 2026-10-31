import { describe, expect, it } from 'vitest';
import { TRAIN_COLOURS } from '../sim/trainColours';
import { STR } from '../strings';
import { tripWith, trainFacts } from '../testing/trainFacts';
import {
  DOUBLE_CLICK_MS,
  ROW_GOODS,
  contractRows,
  countsLine,
  groupTitle,
  inView,
  secondClick,
  stationRows,
  trainGroups,
  worksRows,
  type ContractFacts,
  type StationFacts,
  type TrainContext,
  type TrainRowFacts,
  type ViewRect,
  type WorksFacts,
} from './outlinerRows';

const VIEW: ViewRect = { x: 100, y: 50, w: 400, h: 200 };

describe('In view', () => {
  it('shows the rectangle, its four edges and four corners included', () => {
    for (const p of [
      { x: 100, y: 50 },
      { x: 500, y: 50 },
      { x: 100, y: 250 },
      { x: 500, y: 250 },
      { x: 300, y: 50 },
      { x: 300, y: 250 },
      { x: 100, y: 150 },
      { x: 500, y: 150 },
      { x: 300, y: 150 },
    ])
      expect(inView(VIEW, p), JSON.stringify(p)).toBe(true);
  });

  it('leaves out what lies just past an edge', () => {
    for (const p of [
      { x: 99.9, y: 150 },
      { x: 500.1, y: 150 },
      { x: 300, y: 49.9 },
      { x: 300, y: 250.1 },
    ])
      expect(inView(VIEW, p), JSON.stringify(p)).toBe(false);
  });

  it('with no rectangle everything is in view, and a point nowhere only then', () => {
    expect(inView(null, { x: 1e6, y: -1e6 })).toBe(true);
    expect(inView(null, null)).toBe(true);
    expect(inView(VIEW, null)).toBe(false);
  });
});

describe('the footer', () => {
  it('says what is in view of what there is, and in All only what there is', () => {
    expect(countsLine('view', 2, 7)).toBe(`${STR.outliner.inView(2)} · ${STR.outliner.inAll(7)}`);
    expect(countsLine('all', 7, 7)).toBe(STR.outliner.inAll(7));
  });
});

/** A train with a head at world point (x, y), tiles and pixels being the same here. */
function train(id: number, colour: number, x = 300, y = 150, more: Partial<TrainRowFacts> = {}) {
  return {
    ...trainFacts(),
    id,
    name: `Train ${id}`,
    colour,
    poses: [{ x, y }],
    ...more,
  } as TrainRowFacts;
}

const NAMES: Record<number, string> = { 1: 'Alder', 2: 'Birch', 3: 'Cedar' };
const context = (more: Partial<TrainContext> = {}): TrainContext => ({
  tilePoint: (x, y) => ({ x, y }),
  stationName: (id) => NAMES[id] ?? null,
  stuck: () => null,
  selected: null,
  following: null,
  expanded: null,
  ...more,
});

describe('the Trains tab', () => {
  it('groups by colour, the colours in their order and those with none last', () => {
    const list = trainGroups(
      [train(1, 0), train(2, 4), train(3, 1), train(4, 0), train(5, 4)],
      null,
      context(),
    );
    expect(list.rows.map((g) => g.colour)).toEqual([1, 4, 0]);
    expect(list.rows.map((g) => g.rows.map((r) => r.id))).toEqual([[3], [2, 5], [1, 4]]);
    expect(list.rows[0].hex).toBe(TRAIN_COLOURS[1]);
    expect(list.rows[2].title).toBe(STR.outliner.ungrouped);
  });

  it('a colour holds its group even with one train, and an empty colour has none', () => {
    const list = trainGroups([train(1, 2)], null, context());
    expect(list.rows).toHaveLength(1);
    expect(list.rows[0].title).toBe(groupTitle(2));
    expect(list.rows[0].rows[0].hex).toBe(TRAIN_COLOURS[2]);
  });

  it('In view goes by the head of the train, and counts what it left out', () => {
    const list = trainGroups(
      [train(1, 0, 300, 150), train(2, 0, 500, 250), train(3, 0, 501, 250)],
      VIEW,
      context(),
    );
    expect(list.rows[0].rows.map((r) => r.id)).toEqual([1, 2]);
    expect(list.shown).toBe(2);
    expect(list.total).toBe(3);
  });

  it('a train not on the map is in All and in no view', () => {
    const lost = train(1, 0, 0, 0, { poses: [] });
    expect(trainGroups([lost], VIEW, context()).shown).toBe(0);
    expect(trainGroups([lost], null, context()).shown).toBe(1);
  });

  it('goes by where the head is drawn: a hill lifts it into the view or out', () => {
    const lift: Partial<TrainContext> = { tilePoint: (x, y) => ({ x, y: y - 20 }) };
    expect(trainGroups([train(1, 0, 300, 265)], VIEW, context(lift)).shown).toBe(1);
    expect(trainGroups([train(1, 0, 300, 60)], VIEW, context(lift)).shown).toBe(0);
  });

  it('a row: cargo summed by good, from and to, and a chip', () => {
    const t = train(1, 0, 300, 150, {
      route: [1, 2, 3],
      routeIndex: 2,
      wagons: [
        { cargo: 'coal', amount: 10.4, level: 1, def: { capacity: 20 } },
        { cargo: 'wood', amount: 3, level: 1, def: { capacity: 20 } },
        { cargo: 'coal', amount: 5, level: 1, def: { capacity: 20 } },
        { cargo: null, amount: 0, level: 1, def: { capacity: 20 } },
      ],
    });
    const [row] = trainGroups([t], null, context()).rows[0].rows;
    expect(row.cargo).toEqual([
      { res: 'coal', amount: 15 },
      { res: 'wood', amount: 3 },
    ]);
    expect(row.from).toBe('Birch');
    expect(row.to).toBe('Cedar');
    expect(row.chip.text).toBe(STR.outliner.status.moving);
  });

  it('a route of one stop has no from, and none has neither', () => {
    const one = trainGroups([train(1, 0, 0, 0, { route: [2] })], null, context());
    expect(one.rows[0].rows[0]).toMatchObject({ from: null, to: 'Birch' });
    const none = trainGroups([train(1, 0, 0, 0, { route: [] })], null, context());
    expect(none.rows[0].rows[0]).toMatchObject({ from: null, to: null });
  });

  it('marks the train picked and the train followed', () => {
    const [row] = trainGroups([train(1, 0)], null, context({ selected: 1, following: 1 })).rows[0]
      .rows;
    expect(row).toMatchObject({ selected: true, following: true, detail: null });
  });

  it('only the open row has a detail, with what the sim has for it', () => {
    const t = train(1, 0, 300, 150, {
      route: [1, 2],
      routeIndex: 1,
      hasSteam: true,
      fuelKind: 'coal',
      coal: 5,
      coalCap: 20,
      coalRate: 1,
      water: 40,
      waterCap: 40,
      waterRate: 0.1,
      lastTrip: tripWith({ income: 700 }, 7),
      wagons: [{ cargo: 'coal', amount: 15, level: 1, def: { capacity: 20 } }],
    });
    const list = trainGroups([t, train(2, 0)], null, context({ expanded: 1 }));
    const [open, closed] = list.rows[0].rows;
    expect(closed.detail).toBeNull();
    expect(open.detail).toEqual({
      load: 75,
      tanks: [
        { res: 'coal', share: 25, low: true },
        { res: 'water', share: 100, low: false },
      ],
      next: 'Birch',
      eta: null,
      income: STR.outliner.perWeek('$700'),
    });
  });
});

const station = (id: number, more: Partial<StationFacts> = {}): StationFacts => ({
  id,
  name: `Station ${id}`,
  level: 2,
  closed: false,
  goods: [],
  fill: 0.5,
  at: { x: 300, y: 150 },
  ...more,
});

describe('the Stations tab', () => {
  it('names the level, the goods held most, and how full it is', () => {
    const goods = [
      { res: 'wood', amount: 3.9 },
      { res: 'coal', amount: 120 },
      { res: 'iron', amount: 8 },
      { res: 'wheat', amount: 40 },
    ];
    const [row] = stationRows([station(1, { goods, fill: 0.204 })], null).rows;
    expect(row.level).toBe(STR.outliner.level(2));
    expect(row.goods).toEqual([
      { res: 'coal', amount: 120 },
      { res: 'wheat', amount: 40 },
      { res: 'iron', amount: 8 },
    ]);
    expect(row.goods).toHaveLength(ROW_GOODS);
    expect(row.fill).toBe(20);
    expect(row.chip).toBeNull();
  });

  it('a full station says so, and a closed one says that instead', () => {
    expect(stationRows([station(1, { fill: 1 })], null).rows[0].chip?.text).toBe(STR.outliner.full);
    expect(stationRows([station(1, { fill: 1, closed: true })], null).rows[0].chip?.text).toBe(
      STR.outliner.closed,
    );
    expect(stationRows([station(1, { fill: 0.99 })], null).rows[0].chip).toBeNull();
  });

  it('In view goes by where it stands, its edge included', () => {
    const list = stationRows(
      [
        station(1, { at: { x: 500, y: 250 } }),
        station(2, { at: { x: 500.5, y: 250 } }),
        station(3, { at: { x: 100, y: 50 } }),
      ],
      VIEW,
    );
    expect(list.rows.map((r) => r.id)).toEqual([1, 3]);
    expect(list.total).toBe(3);
  });
});

const contract = (id: number, more: Partial<ContractFacts> = {}): ContractFacts => ({
  id,
  rarity: 'common',
  cargo: 'coal',
  amount: 100,
  delivered: 25.7,
  payout: 1200,
  expires: 500,
  remaining: 0.5,
  dest: 'Birch',
  ends: [{ x: 300, y: 150 }, null],
  ...more,
});

describe('the Contracts tab', () => {
  it('lists the nearest deadline first', () => {
    const list = contractRows(
      [contract(1, { expires: 900 }), contract(2, { expires: 200 }), contract(3)],
      100,
      null,
    );
    expect(list.rows.map((r) => r.id)).toEqual([2, 3, 1]);
  });

  it('a row: good and destination, progress, pay', () => {
    const [row] = contractRows([contract(1)], 100, null).rows;
    expect(row.title).toBe('Coal → Birch');
    expect(row.progress).toBe('25 / 100');
    expect(row.share).toBe(26);
    expect(row.pay).toBe('+$1,200');
    expect(row.atRisk).toBe(false);
  });

  it('with little time left and goods owed it is at risk; all delivered it is not', () => {
    const late = { remaining: 0.2 };
    expect(contractRows([contract(1, late)], 0, null).rows[0].atRisk).toBe(true);
    expect(contractRows([contract(1, { ...late, delivered: 100 })], 0, null).rows[0].atRisk).toBe(
      false,
    );
  });

  it('never counts time below nothing', () => {
    const [row] = contractRows([contract(1, { expires: 50 })], 100, null).rows;
    expect(row.left).toBe('0h 00m');
  });

  it('In view: either end of it will do', () => {
    const away = { x: 9000, y: 9000 };
    const list = contractRows(
      [
        contract(1, { ends: [{ x: 300, y: 150 }, away] }),
        contract(2, { ends: [away, { x: 500, y: 250 }] }),
        contract(3, { ends: [away, away] }),
        contract(4, { ends: [null, null] }),
      ],
      0,
      VIEW,
    );
    expect(list.rows.map((r) => r.id).sort()).toEqual([1, 2]);
    expect(list.total).toBe(4);
  });
});

const works = (key: number, more: Partial<WorksFacts> = {}): WorksFacts => ({
  key,
  name: 'Sawmill',
  level: 1,
  res: 'planks',
  perWeek: 42.4,
  status: { kind: 'running' },
  store: 'Alder',
  at: { x: 300, y: 150 },
  ...more,
});

describe('the Works tab', () => {
  it('a row: what it makes a week, and where it goes', () => {
    const [row] = worksRows([works(1)], null).rows;
    expect(row).toMatchObject({
      res: 'planks',
      rate: STR.outliner.perWeek('+42'),
      store: 'Alder',
      chip: null,
    });
  });

  it('says what stops it', () => {
    const chip = (status: WorksFacts['status']) =>
      worksRows([works(1, { status })], null).rows[0].chip?.text;
    expect(chip({ kind: 'running' })).toBeUndefined();
    expect(chip({ kind: 'starved', missing: 'coal' })).toBe(STR.outliner.noInput);
    expect(chip({ kind: 'full' })).toBe(STR.outliner.full);
    expect(chip({ kind: 'closed' })).toBe(STR.outliner.closed);
    expect(chip({ kind: 'noStore', range: 8 })).toBe(STR.outliner.noStore);
  });

  it('In view goes by where it stands', () => {
    const list = worksRows([works(1), works(2, { at: { x: 99, y: 150 } })], VIEW);
    expect(list.rows.map((r) => r.key)).toEqual([1]);
    expect(list.shown).toBe(1);
    expect(list.total).toBe(2);
  });
});

describe('a double-click on a name', () => {
  it('is two clicks on one train, close together', () => {
    const first = { id: 1, at: 1000 };
    expect(secondClick(first, 1, 1000 + DOUBLE_CLICK_MS)).toBe(true);
    expect(secondClick(first, 1, 1000 + DOUBLE_CLICK_MS + 1)).toBe(false);
    expect(secondClick(first, 2, 1100)).toBe(false);
    expect(secondClick(null, 1, 1100)).toBe(false);
  });
});
