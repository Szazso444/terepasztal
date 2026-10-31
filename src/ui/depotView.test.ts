import { describe, expect, it, vi } from 'vitest';
import { STR } from '../strings';
import { defaultStop, type StopPlan } from '../sim/trains';
import { clampToRange } from './kit';
import {
  DWELL_BIG_STEP,
  DWELL_STEP,
  MAX_DWELL,
  appendStop,
  dispatchReason,
  editorSignature,
  haulShare,
  haulTone,
  locoStats,
  moveStopUp,
  removeStopAt,
  routeText,
  serviceResource,
  stateText,
  stateTone,
  stationRow,
  stopSummary,
  togglePick,
  trainRowText,
  wagonStats,
  type DispatchInput,
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

describe('picking vehicles for a new train', () => {
  it('adds a vehicle, and takes it out when it is picked again', () => {
    expect(togglePick([], 5, 4)).toEqual({ list: [5], full: false });
    expect(togglePick([5, 6], 5, 4)).toEqual({ list: [6], full: false });
  });

  it('refuses a vehicle past the limit and says it was full', () => {
    expect(togglePick([1, 2, 3, 4], 9, 4)).toEqual({ list: [1, 2, 3, 4], full: true });
    // a picked one can always be taken out of a full list
    expect(togglePick([1, 2, 3, 4], 3, 4)).toEqual({ list: [1, 2, 4], full: false });
  });

  it('does not change the list it is given', () => {
    const list = [1, 2];
    togglePick(list, 3, 4);
    togglePick(list, 1, 4);
    expect(list).toEqual([1, 2]);
  });
});

describe('what stops Dispatch', () => {
  const ready: DispatchInput = {
    locos: 1,
    mixedGauge: false,
    barred: null,
    weight: 10,
    haul: 40,
    preview: null,
  };

  it('lets a consist through that has an engine, fits, and has a gate', () => {
    expect(dispatchReason(ready)).toBeNull();
  });

  it('says what is missing, in the order the game would refuse it', () => {
    expect(dispatchReason({ ...ready, locos: 0, preview: 'no gate' })).toBe(STR.fleet.needLoco);
    expect(dispatchReason({ ...ready, mixedGauge: true, barred: 'wrong depot' })).toBe(
      STR.fleet.mixedGauge,
    );
    expect(dispatchReason({ ...ready, barred: 'wrong depot', weight: 90 })).toBe('wrong depot');
    expect(dispatchReason({ ...ready, weight: 90.4, haul: 40.2, preview: 'no gate' })).toBe(
      STR.fleet.tooHeavy(90, 40),
    );
    expect(dispatchReason({ ...ready, preview: 'Gate 3,4: a train stands on it' })).toBe(
      'Gate 3,4: a train stands on it',
    );
  });

  it('lets a consist weigh exactly what the engines haul', () => {
    expect(dispatchReason({ ...ready, weight: 40, haul: 40 })).toBeNull();
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

  it('keeps every dwell time the game could hold inside what the field shows', () => {
    // a field of step 5 shows a time of any multiple of 5 as it is; a step of 15 would round 10 to 15
    const range = { min: 0, max: MAX_DWELL, step: DWELL_STEP, bigStep: DWELL_BIG_STEP };
    for (let v = 0; v <= MAX_DWELL; v += 5) expect(clampToRange(v, range)).toBe(v);
    expect(DWELL_BIG_STEP % DWELL_STEP).toBe(0);
    expect(MAX_DWELL).toBe(600);
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

  it('is the same for the same stops, the same next stop and the same stations', () => {
    const s = [defaultStop(1), defaultStop(2)];
    expect(editorSignature(s, 0, rows)).toBe(editorSignature([{ ...s[0] }, { ...s[1] }], 0, rows));
  });

  it('changes with a stop edited, the stop it heads for, or a station built', () => {
    const s = [defaultStop(1), defaultStop(2)];
    const base = editorSignature(s, 0, rows);
    expect(editorSignature([{ ...s[0], minDwell: 15 }, s[1]], 0, rows)).not.toBe(base);
    expect(editorSignature(s, 1, rows)).not.toBe(base);
    expect(editorSignature(s, 0, [...rows, { ...rows[0], id: 2 }])).not.toBe(base);
    expect(editorSignature(s, 0, [{ ...rows[0], hasPlatform: false }])).not.toBe(base);
  });
});
