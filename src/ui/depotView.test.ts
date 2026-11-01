import { describe, expect, it, vi } from 'vitest';
import { STR } from '../strings';
import { defaultStop, type StopPlan } from '../sim/trains';
import { clampToRange, stepNumber } from './kit';
import {
  CHECK_MS,
  CHECK_REFUSED_MS,
  DWELL_BIG_STEP,
  DWELL_RANGE,
  DWELL_STEP,
  MAX_DWELL,
  appendStop,
  checkLifetime,
  clickedCount,
  copiesLike,
  editorSignature,
  foldStock,
  gateShown,
  haulShare,
  haulTone,
  locoStats,
  moveStopUp,
  movedPick,
  pruneToFree,
  refusalAt,
  removeStopAt,
  routeText,
  serviceResource,
  setPicked,
  staleGate,
  stateText,
  stateTone,
  stationRow,
  stockGroups,
  stockOrder,
  stopSummary,
  stripCars,
  trainRowText,
  trainsByDepot,
  trainsHomeAt,
  trainsShown,
  wagonStats,
  type GateAnswer,
  type StationInput,
  type TrainRowInput,
} from './depotView';

// the kit's controls play a sound when pressed; the context that plays it is a browser's
vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));

const row = (o: Partial<TrainRowInput> = {}): TrainRowInput => ({
  locoNames: ['Rocket'],
  wagonCount: 3,
  mode: 'schedule',
  routeNames: ['Quarry', 'Farm'],
  state: 'moving',
  blocked: false,
  next: 'Farm',
  cargoUnits: 24.4,
  weight: 31.6,
  power: 40,
  message: '',
  ...o,
});

describe('a train in the list', () => {
  it('names its engines, wagons and route on one line', () => {
    const t = trainRowText(row({ locoNames: ['Rocket', 'Class 08'], wagonCount: 1 }));
    expect(t.consist).toBe('Rocket + Class 08 + 1 wagon · Quarry > Farm');
    expect(trainRowText(row()).consist).toBe('Rocket + 3 wagons · Quarry > Farm');
  });

  it('says how it picks its stops when it is not on a schedule', () => {
    expect(routeText('freight', ['A', 'B'])).toBe(STR.train.mode.freight);
    expect(trainRowText(row({ mode: 'contract' })).consist).toBe(
      `Rocket + 3 wagons · ${STR.train.mode.contract}`,
    );
    // a schedule with no stops leaves the route out
    expect(trainRowText(row({ routeNames: [] })).consist).toBe('Rocket + 3 wagons');
  });

  it('gives its state, the station it heads for, the load and what is aboard', () => {
    const t = trainRowText(row({ message: 'Loaded 24 coal' }));
    expect(t.status).toBe(`${STR.depot.state.moving} → Farm`);
    expect(t.load).toBe('32 / 40 t');
    expect(t.over).toBe(false);
    expect(t.aboard).toBe(`${STR.depot.cargo(24)} · Loaded 24 coal`);
    expect(t.tone).toBe('good');
  });

  it('leaves the arrow out with no station to head for, and flags overweight', () => {
    const t = trainRowText(row({ next: null, weight: 50 }));
    expect(t.status).toBe(STR.depot.state.moving);
    expect(t.over).toBe(true);
    expect(t.aboard).toBe(STR.depot.cargo(24));
  });

  it('reads a train held behind another as held, in amber', () => {
    expect(stateText('moving', true)).toBe(STR.depot.state.held);
    expect(stateTone('moving', true)).toBe('warn');
    // blocked means nothing for a train that is not moving
    expect(stateText('loading', true)).toBe(STR.depot.state.loading);
  });

  it('colours every state the game has', () => {
    const states = Object.keys(STR.depot.state).filter((s) => s !== 'held');
    expect(states.length).toBeGreaterThan(8);
    for (const s of states) expect(['', 'good', 'info', 'warn', 'bad']).toContain(stateTone(s));
    for (const s of ['noRoute', 'stranded', 'noFuel', 'noPower', 'overweight'])
      expect(stateTone(s)).toBe('bad');
    expect(stateTone('waiting')).toBe('warn');
    expect(stateTone('loading')).toBe('info');
    expect(stateTone('idle')).toBe('');
    // a state the table does not know shows as it is
    expect(stateText('somethingNew')).toBe('somethingNew');
  });
});

describe('the haul meter', () => {
  it('fills with the weight over what the engines can haul, never past full', () => {
    expect(haulShare(20, 40)).toBe(0.5);
    expect(haulShare(80, 40)).toBe(1);
    expect(haulShare(0, 40)).toBe(0);
    // engines that haul nothing: any weight is over
    expect(haulShare(5, 0)).toBe(1);
    expect(haulShare(0, 0)).toBe(0);
  });

  it('turns amber near the limit and red over it', () => {
    expect(haulTone(20, 40)).toBe('');
    expect(haulTone(34, 40)).toBe('');
    expect(haulTone(35, 40)).toBe('warn');
    expect(haulTone(40, 40)).toBe('warn');
    expect(haulTone(41, 40)).toBe('bad');
    expect(haulTone(1, 0)).toBe('bad');
  });
});

describe('the free stock, by model', () => {
  const tub = (uid: number, level = 1) => ({ uid, defId: 'mine_tub', level });

  it('makes one row of the copies of a model, and says how many are in the draft', () => {
    const [g, ...rest] = stockGroups([tub(1), tub(2), tub(3)], [2]);
    expect(rest).toEqual([]);
    expect(g.uids).toEqual([1, 2, 3]);
    expect(g.picked).toBe(1);
  });

  it('keeps copies of different levels apart, as they differ', () => {
    const rows = stockGroups([tub(1), tub(2, 3), tub(3)], [2]);
    expect(rows.map((g) => [g.level, g.uids, g.picked])).toEqual([
      [1, [1, 3], 0],
      [3, [2], 1],
    ]);
  });

  it('keeps a copy fitted with in-cab signalling apart: it works where the others do not', () => {
    const rows = stockGroups(
      [
        { uid: 1, defId: 'f7', level: 1 },
        { uid: 2, defId: 'f7', level: 1, inCab: true },
      ],
      [],
    );
    expect(rows.map((g) => [g.inCab, g.uids])).toEqual([
      [false, [1]],
      [true, [2]],
    ]);
  });

  it('holds nothing for a stock with nothing free', () => {
    expect(stockGroups([], [1, 2])).toEqual([]);
  });

  it('reads what can roll out first, by name, the higher level first, whatever is picked', () => {
    const rows = [
      { level: 1, name: 'Zebra', barred: false },
      { level: 1, name: 'Alpha', barred: true },
      { level: 1, name: 'Mule', barred: false },
      { level: 4, name: 'Mule', barred: false },
    ];
    const order = stockOrder(rows, (r) => r).map((r) => `${r.name} ${r.level}`);
    expect(order).toEqual(['Mule 4', 'Mule 1', 'Zebra 1', 'Alpha 1']);
  });
});

describe('what cannot roll out of this depot', () => {
  const line = (name: string, reason: string | null, picked = 0) => ({
    g: { name, picked },
    reason,
  });
  const names = (l: { g: { name: string } }[]) => l.map((x) => x.g.name);
  const lines = [line('A', null), line('B', 'other gauge'), line('C', 'other gauge')];

  it('folds under one line, and says what it folded', () => {
    const f = foldStock(lines, false);
    expect(names(f.shown)).toEqual(['A']);
    expect(f.folded).toBe(2);
    expect(f.reason).toBe('other gauge');
  });

  it('shows every row when it is opened, and still counts them', () => {
    const f = foldStock(lines, true);
    expect(names(f.shown)).toEqual(['A', 'B', 'C']);
    expect(f.folded).toBe(2);
  });

  it('gives no reason when the rows folded have different ones', () => {
    const f = foldStock([line('A', 'too big'), line('B', 'other gauge')], false);
    expect(f.reason).toBeNull();
  });

  it('leaves out a model in the train: it has to be seen to come off', () => {
    const f = foldStock([line('A', 'other gauge', 2), line('B', 'other gauge')], false);
    expect(names(f.shown)).toEqual(['A']);
    expect(f.folded).toBe(1);
  });

  it('folds nothing where everything can roll out', () => {
    const f = foldStock([line('A', null)], false);
    expect(f.folded).toBe(0);
    expect(f.reason).toBeNull();
  });
});

describe('building a train like another', () => {
  const tub = (uid: number, level = 1) => ({ uid, defId: 'mine_tub', level });
  const wanted = (level: number) => ({ defId: 'mine_tub', level });

  it('finds a free copy of each vehicle, in the order of the train', () => {
    const free = [{ uid: 1, defId: 'rocket', level: 1 }, tub(2)];
    expect(copiesLike([wanted(1), { defId: 'rocket', level: 1 }], free)).toEqual({
      uids: [2, 1],
      missing: 0,
    });
  });

  it('uses each copy once, and counts the vehicles it found none for', () => {
    expect(copiesLike([wanted(1), wanted(1), wanted(1)], [tub(1), tub(2)])).toEqual({
      uids: [1, 2],
      missing: 1,
    });
  });

  it('takes the copy nearest in level', () => {
    expect(copiesLike([wanted(3)], [tub(1, 1), tub(2, 4), tub(3, 3)]).uids).toEqual([3]);
    expect(copiesLike([wanted(3)], [tub(1, 1), tub(2, 4)]).uids).toEqual([2]);
  });

  it('never takes another model', () => {
    expect(copiesLike([wanted(1)], [{ uid: 1, defId: 'rocket', level: 1 }])).toEqual({
      uids: [],
      missing: 1,
    });
  });
});

describe('the stepper of a stock row', () => {
  const uids = [10, 11, 12];

  it('adds the next free copy, after what is already picked', () => {
    expect(setPicked([5], uids, 1, 4)).toEqual({ list: [5, 10], full: false });
    expect(setPicked([5, 10], uids, 2, 4)).toEqual({ list: [5, 10, 11], full: false });
  });

  it('takes the copy picked last off first, and keeps the order of the rest', () => {
    expect(setPicked([10, 5, 12, 11], uids, 1, 16)).toEqual({ list: [10, 5], full: false });
    expect(setPicked([10, 5], uids, 0, 16)).toEqual({ list: [5], full: false });
  });

  it('stops at the free copies, without calling the list full', () => {
    expect(setPicked([10, 11, 12], uids, 9, 16)).toEqual({ list: [10, 11, 12], full: false });
    expect(setPicked([], uids, 9, 16)).toEqual({ list: [10, 11, 12], full: false });
    expect(setPicked([10], uids, -3, 16)).toEqual({ list: [], full: false });
  });

  it('stops at the limit of the list, and says it was full', () => {
    expect(setPicked([1, 2, 3], uids, 2, 4)).toEqual({ list: [1, 2, 3, 10], full: true });
    expect(setPicked([1, 2, 3, 4], uids, 1, 4)).toEqual({ list: [1, 2, 3, 4], full: true });
    // a pick can always come off a full list
    expect(setPicked([1, 2, 3, 10], uids, 0, 4)).toEqual({ list: [1, 2, 3], full: false });
  });

  it('does not change the list it is given', () => {
    const list = [10];
    setPicked(list, uids, 3, 16);
    setPicked(list, uids, 0, 16);
    expect(list).toEqual([10]);
  });

  it('takes a click on a row for one more, and one fewer once every copy is picked', () => {
    expect(clickedCount({ uids, picked: 0 })).toBe(1);
    expect(clickedCount({ uids, picked: 2 })).toBe(3);
    expect(clickedCount({ uids, picked: 3 })).toBe(2);
    // the single copy a row used to toggle still does
    expect(clickedCount({ uids: [1], picked: 1 })).toBe(0);
  });
});

describe('the consist strip', () => {
  const stock: Record<number, { defId: string; level: number }> = {
    1: { defId: 'rocket', level: 1 },
    2: { defId: 'mav490', level: 2 },
    7: { defId: 'mine_tub', level: 1 },
    8: { defId: 'narrow_box', level: 3 },
  };
  const order = (locos: number[], wagons: number[]) =>
    stripCars(locos, wagons, (u) => stock[u]).map((c) => c.uid);

  it('shows the engines as picked, then the wagons as picked', () => {
    expect(order([2, 1], [8, 7])).toEqual([2, 1, 8, 7]);
    expect(stripCars([1], [7], (u) => stock[u])).toEqual([
      { uid: 1, defId: 'rocket', level: 1, loco: true },
      { uid: 7, defId: 'mine_tub', level: 1, loco: false },
    ]);
  });

  it('leaves out a pick that has left the stock', () => {
    expect(order([1, 99], [7])).toEqual([1, 7]);
  });

  it('is empty with nothing picked', () => {
    expect(order([], [])).toEqual([]);
  });

  it('moves a pick along the list, stopping at either end', () => {
    expect(movedPick([1, 2, 3], 3, 0)).toEqual([3, 1, 2]);
    expect(movedPick([1, 2, 3], 1, 1)).toEqual([2, 1, 3]);
    expect(movedPick([1, 2, 3], 2, -1)).toEqual([2, 1, 3]);
    expect(movedPick([1, 2, 3], 2, 9)).toEqual([1, 3, 2]);
  });

  it('leaves the list as it is for what is not in it', () => {
    expect(movedPick([1, 2], 9, 0)).toEqual([1, 2]);
  });
});

describe('the trains of a depot', () => {
  const trains = [
    { name: 'A', home: 1 },
    { name: 'B', home: 2 },
    { name: 'C', home: 1 },
    { name: 'D', home: null },
  ];
  const names = (l: { name: string }[]) => l.map((t) => t.name);
  const depots = [
    { id: 2, name: 'Narrow' },
    { id: 1, name: 'Main' },
  ];

  it('lists the trains of the depot chosen, in the order of the fleet', () => {
    expect(names(trainsShown(trains, 'here', 1))).toEqual(['A', 'C']);
    expect(names(trainsShown(trains, 'here', 2))).toEqual(['B']);
    expect(trainsShown(trains, 'here', 3)).toEqual([]);
  });

  it('lists every train under All', () => {
    expect(names(trainsShown(trains, 'all', 1))).toEqual(['A', 'B', 'C', 'D']);
  });

  it('lists every train when there is no depot to choose', () => {
    expect(names(trainsShown(trains, 'here', null))).toEqual(['A', 'B', 'C', 'D']);
  });

  it('groups all the trains by depot, in the order of the depots, those of none last', () => {
    expect(trainsByDepot(trains, depots).map((g) => [g.title, names(g.trains)])).toEqual([
      ['Narrow', ['B']],
      ['Main', ['A', 'C']],
      [STR.depot.noHome, ['D']],
    ]);
  });

  it('counts the trains of a depot from where each belongs', () => {
    const homes = [1, 2, 1, null];
    expect(trainsHomeAt(homes, 1)).toBe(2);
    expect(trainsHomeAt(new Map([[{}, 2]]).values(), 2)).toBe(1);
    expect(trainsHomeAt(homes, 9)).toBe(0);
  });

  it('gives no head to a depot with no train', () => {
    const groups = trainsByDepot([{ home: 1 }], depots);
    expect(groups.map((g) => g.depotId)).toEqual([1]);
  });

  it('puts a train of a depot not on the list with those of none', () => {
    const groups = trainsByDepot([{ home: 9 }], depots);
    expect(groups.map((g) => g.title)).toEqual([STR.depot.noHome]);
  });
});

describe('the gates in the depot bar', () => {
  const answer = (at: number, lifetime: number): GateAnswer => ({ at, lifetime, reason: null });

  it('says a train can leave, or that it cannot and why', () => {
    expect(gateShown(answer(0, 1)).tone).toBe('ok');
    const shut = gateShown({ at: 0, lifetime: 1, reason: 'No track at the gates' });
    expect(shut).toEqual({
      text: STR.depot.gateShut,
      tone: 'bad',
      why: 'No track at the gates',
    });
  });

  it('shows nothing until the gate has been asked about', () => {
    expect(gateShown(undefined)).toEqual({ text: '', tone: '', why: '' });
  });

  it('asks about a depot it has no answer for before any other', () => {
    const answers = new Map([[1, answer(0, 10)]]);
    expect(staleGate([1, 2], answers, 50)).toBe(2);
  });

  it('asks about the answer that ran out longest ago, one at a time', () => {
    const answers = new Map([
      [1, answer(0, 40)],
      [2, answer(0, 10)],
    ]);
    expect(staleGate([1, 2], answers, 50)).toBe(2);
    expect(staleGate([1, 2], answers, 20)).toBe(2);
  });

  it('asks nothing while every answer stands', () => {
    const answers = new Map([[1, answer(0, 40)]]);
    expect(staleGate([1], answers, 39)).toBeNull();
    expect(staleGate([], answers, 39)).toBeNull();
  });
});

describe('what refuses a train at the depot chosen', () => {
  const main = { id: 1, name: 'Main' };

  it('is what the game answers', () => {
    expect(refusalAt({ reason: 'Too heavy', depot: main }, main)).toBe('Too heavy');
    expect(refusalAt({ reason: 'Too heavy', depot: null }, null)).toBe('Too heavy');
  });

  it('is nothing for a train that goes from there', () => {
    expect(refusalAt({ reason: null, depot: main }, main)).toBeNull();
  });

  it('names the depot chosen when the consist would go from another one', () => {
    const answer = { reason: null, depot: { id: 2 } };
    expect(refusalAt(answer, main)).toBe(STR.fleet.wrongDepot('Main'));
  });

  it('does not quote the gates of a depot the train was not asked to leave', () => {
    const answer = { reason: 'Gate 9,9: a train stands on it', depot: { id: 2 } };
    expect(refusalAt(answer, main)).toBe(STR.fleet.wrongDepot('Main'));
  });

  it('has nothing against a train when no depot is chosen', () => {
    expect(refusalAt({ reason: null, depot: main }, null)).toBeNull();
  });
});

describe('the picks of a draft that are still free', () => {
  it('keeps what is free, in the order picked, and drops what has left the stock', () => {
    expect(pruneToFree([5, 2, 9, 3], [1, 2, 3, 5])).toEqual([5, 2, 3]);
    expect(pruneToFree([5, 2], [])).toEqual([]);
    expect(pruneToFree([], [1, 2])).toEqual([]);
  });

  it('does not change the lists it is given', () => {
    const picks = [1, 2];
    pruneToFree(picks, [2]);
    expect(picks).toEqual([1, 2]);
  });
});

describe('how long the answer to "would it roll out?" stands', () => {
  it('asks again soon after a go or a cheap refusal, and rarely after a refusal at the gate', () => {
    expect(checkLifetime(false)).toBe(CHECK_MS);
    expect(checkLifetime(true)).toBe(CHECK_REFUSED_MS);
    expect(CHECK_REFUSED_MS).toBeGreaterThan(CHECK_MS);
  });
});

describe('the lines of a vehicle in the stock', () => {
  const loco = { type: 'steam', size: 'medium', speed: 1.25, power: 130, crew: 3 };

  it('gives an engine its type, size, speed, power and crew at its level', () => {
    expect(locoStats(loco, 1)).toBe(
      `${STR.roster.type.steam} · ${STR.roster.size.medium} · ${STR.depot.speed} 1.3 · ${STR.depot.power} 130 t · ${STR.roster.crew} 3`,
    );
    expect(locoStats(loco, 1.08)).toContain(`${STR.depot.power} 140 t`);
    // no size on the entry: small, as the game reads it
    expect(locoStats({ ...loco, size: undefined }, 1)).toContain(STR.roster.size.small);
  });

  it('gives a wagon what it carries, its size, capacity and weight', () => {
    const wagon = { carries: 'mineral', size: 'small', capacity: 32, weight: 8 };
    expect(wagonStats(wagon, 1)).toBe(
      `${STR.roster.carries.mineral} · ${STR.roster.size.small} · 32u · 8t`,
    );
    expect(wagonStats(wagon, 1.16)).toContain('37u');
  });

  it('gives a refuelling cart what it adds instead', () => {
    const cart = { carries: 'mineral', capacity: 0, weight: 8, service: 'coal', serviceCap: 120 };
    expect(wagonStats({ ...cart, service: 'coal' as const }, 1)).toBe(
      `${STR.depot.cartLine('coal', 120)} · 8t`,
    );
    expect(serviceResource('fuel')).toBe('oil');
    expect(serviceResource('battery')).toBe('power');
    expect(serviceResource('coal')).toBe('coal');
  });
});

describe('the stop list edits', () => {
  const stops = (): StopPlan[] => [defaultStop(1), defaultStop(2), defaultStop(3)];

  it('moves a stop up a place and leaves the first where it is', () => {
    const s = stops();
    expect(moveStopUp(s, 2)).toBe(true);
    expect(s.map((x) => x.stationId)).toEqual([1, 3, 2]);
    expect(moveStopUp(s, 0)).toBe(false);
    expect(moveStopUp(s, 9)).toBe(false);
    expect(s.map((x) => x.stationId)).toEqual([1, 3, 2]);
  });

  it('takes a stop out, or says there was none', () => {
    const s = stops();
    expect(removeStopAt(s, 1)).toBe(true);
    expect(s.map((x) => x.stationId)).toEqual([1, 3]);
    expect(removeStopAt(s, 5)).toBe(false);
    expect(removeStopAt(s, -1)).toBe(false);
    expect(s).toHaveLength(2);
  });

  it('adds a stop at the end with the stop the game defaults to', () => {
    const s = stops();
    const added = appendStop(s, 7);
    expect(s[3]).toBe(added);
    expect(added).toEqual(defaultStop(7));
  });

  it('keeps every whole second a stop could hold exactly as the field shows it', () => {
    for (let v = 0; v <= MAX_DWELL; v++) expect(clampToRange(v, DWELL_RANGE)).toBe(v);
    expect(MAX_DWELL).toBe(600);
  });

  it('moves a time by 15 s a press and by 5 s with Shift, from any second', () => {
    expect(DWELL_STEP).toBe(15);
    expect(DWELL_BIG_STEP).toBe(5);
    expect(stepNumber(0, 1, DWELL_RANGE)).toBe(15);
    expect(stepNumber(7, 1, DWELL_RANGE)).toBe(22);
    expect(stepNumber(7, 1, DWELL_RANGE, true)).toBe(12);
    expect(stepNumber(595, 1, DWELL_RANGE)).toBe(600);
    expect(stepNumber(3, -1, DWELL_RANGE)).toBe(0);
  });
});

describe('what a stop says it does', () => {
  it('is empty for a stop that only loads and unloads as asked', () => {
    expect(stopSummary({ ...defaultStop(1), waitFull: false, refuel: false })).toEqual([]);
  });

  it('lists every setting that is not the plain one, in a fixed order', () => {
    const s: StopPlan = {
      ...defaultStop(1),
      load: 'none',
      unload: 'all',
      pass: true,
      depart: 'reverse',
      minDwell: 30,
      maxDwell: 90,
    };
    expect(stopSummary(s)).toEqual([
      STR.depot.stopSum.loadNone,
      STR.depot.stopSum.unloadAll,
      STR.depot.stopSum.waitFull,
      STR.depot.stopSum.refuel,
      STR.depot.stopSum.pass,
      STR.depot.stopSum.departReverse,
      STR.depot.stopSum.atLeast(30),
      STR.depot.stopSum.leaveAfter(90),
    ]);
  });

  it('says a stop that unloads nothing and leaves forward', () => {
    const s: StopPlan = {
      ...defaultStop(1),
      waitFull: false,
      refuel: false,
      unload: 'none',
      depart: 'forward',
    };
    expect(stopSummary(s)).toEqual([STR.depot.stopSum.unloadNone, STR.depot.stopSum.departForward]);
  });
});

describe('the Add stop list', () => {
  const st = (o: Partial<StationInput> = {}): StationInput => ({
    id: 4,
    name: 'Quarry',
    produces: ['Stone', 'Iron'],
    refuelsFuel: false,
    refuelsWater: false,
    hasPlatform: true,
    ...o,
  });

  it('tags a station with what it produces and whether it refuels', () => {
    expect(stationRow(st()).tags).toEqual(['Stone, Iron']);
    expect(stationRow(st({ refuelsFuel: true, refuelsWater: true })).tags).toEqual([
      'Stone, Iron',
      STR.depot.fuelTag,
      STR.depot.waterTag,
    ]);
  });

  it('shows a dash for a station that produces nothing', () => {
    expect(stationRow(st({ produces: [] })).tags).toEqual(['-']);
  });

  it('says why a station without platform track cannot be a stop', () => {
    const r = stationRow(st({ hasPlatform: false }));
    expect(r.hasPlatform).toBe(false);
    expect(r.tags.at(-1)).toBe(STR.station.noPlatform);
  });
});

describe('when the editor draws itself again', () => {
  const rows = [
    stationRow({
      id: 1,
      name: 'A',
      produces: [],
      refuelsFuel: false,
      refuelsWater: false,
      hasPlatform: true,
    }),
  ];

  it('is the same for the same stops and the same stations', () => {
    const s = [defaultStop(1), defaultStop(2)];
    expect(editorSignature(s, rows)).toBe(editorSignature([{ ...s[0] }, { ...s[1] }], rows));
  });

  it('changes with a stop edited or a station built', () => {
    const s = [defaultStop(1), defaultStop(2)];
    const base = editorSignature(s, rows);
    expect(editorSignature([{ ...s[0], minDwell: 15 }, s[1]], rows)).not.toBe(base);
    expect(editorSignature(s, [...rows, { ...rows[0], id: 2 }])).not.toBe(base);
    expect(editorSignature(s, [{ ...rows[0], hasPlatform: false }])).not.toBe(base);
    expect(editorSignature(s.slice(0, 1), rows)).not.toBe(base);
  });
});
