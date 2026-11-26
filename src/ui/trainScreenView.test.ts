import { describe, expect, it } from 'vitest';
import { STR } from '../strings';
import {
  cargoAboard,
  currentStopIndex,
  emergencyState,
  levelGain,
  perTileText,
  rangeText,
  recordText,
  splitFuel,
  tankRows,
  tankShare,
  tankTone,
  tankValue,
  type TankInput,
} from './trainScreenView';

const none: TankInput = {
  steam: false,
  diesel: false,
  electric: false,
  oilKind: 'oil',
  coal: 0,
  coalCap: 0,
  coalRate: 0,
  water: 0,
  waterCap: 0,
  waterRate: 0,
  oil: 0,
  oilCap: 0,
  oilRate: 0,
  battery: 0,
  batteryCap: 0,
  powerRate: 0,
};
const steam: TankInput = {
  ...none,
  steam: true,
  coal: 80,
  coalCap: 80,
  coalRate: 0.16,
  water: 120,
  waterCap: 120,
  waterRate: 0.2,
};

describe('a tank turns red and amber', () => {
  it('is red under five tiles of use, amber under a quarter', () => {
    expect(tankTone(80, 80, 0.16)).toBe('');
    expect(tankTone(19, 80, 0.16)).toBe('warn');
    expect(tankTone(0.79, 80, 0.16)).toBe('bad');
    expect(tankTone(0.8, 80, 0.16)).toBe('warn');
    expect(tankTone(0, 80, 0.16)).toBe('bad');
  });

  it('is never red when nothing is used, and an empty tank of no size is quiet', () => {
    expect(tankTone(0, 80, 0)).toBe('warn');
    expect(tankTone(0, 0, 0)).toBe('');
  });
});

describe('the tanks of a train', () => {
  it('lists fuel and water for a steam engine, naming the fuel', () => {
    const rows = tankRows(steam, 'Oil');
    expect(rows.map((r) => r.key)).toEqual(['fuel', 'water']);
    expect(rows[0].label).toBe(`${STR.train.fuel} (coal)`);
    expect(rows[0].icon).toBe('coal');
    expect(rows[1].label).toBe(STR.train.water);
  });

  it('lists the oil for a diesel engine under the oil is named', () => {
    const rows = tankRows({ ...none, diesel: true, oil: 50, oilCap: 100, oilRate: 0.05 }, 'Diesel');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: 'oil', label: 'Diesel', value: 50, cap: 100, tone: '' });
  });

  it('lists the battery carts of an electric train and no fuel tank', () => {
    const rows = tankRows(
      { ...none, electric: true, battery: 0.5, batteryCap: 60, powerRate: 0.12 },
      'Oil',
    );
    expect(rows.map((r) => r.key)).toEqual(['battery']);
    // half a unit is under five tiles of the power drawn
    expect(rows[0].tone).toBe('bad');
  });

  it('has no tank for an electric engine that draws from the wire alone', () => {
    expect(tankRows({ ...none, electric: true, powerRate: 0.12 }, 'Oil')).toEqual([]);
  });

  it('lists steam first, then oil, then the battery, as one train can hold all three', () => {
    const rows = tankRows(
      {
        ...steam,
        diesel: true,
        oil: 10,
        oilCap: 20,
        oilRate: 0.01,
        batteryCap: 60,
        battery: 60,
      },
      'Oil',
    );
    expect(rows.map((r) => r.key)).toEqual(['fuel', 'water', 'oil', 'battery']);
  });

  it('reads a tank as a value over its size, and how full it is', () => {
    expect(tankValue({ value: 79.6, cap: 120 })).toBe('80 / 120');
    expect(tankShare({ value: 30, cap: 120 })).toBe(0.25);
    expect(tankShare({ value: 200, cap: 120 })).toBe(1);
    expect(tankShare({ value: 5, cap: 0 })).toBe(0);
    expect(tankShare({ value: -3, cap: 10 })).toBe(0);
  });
});

describe('the range and the use per tile', () => {
  it('shows whole tiles, and infinity for a train that uses nothing', () => {
    expect(rangeText(492.9)).toBe(`492 ${STR.train.tiles}`);
    expect(rangeText(Infinity)).toBe('∞');
  });

  it('lists what is used per tile, or a dash', () => {
    expect(
      perTileText({
        coalRate: 0.16,
        waterRate: 0.2,
        oilRate: 0,
        oilKind: 'oil',
        powerRate: 0,
      }),
    ).toBe('0.16 coal, 0.20 water');
    expect(
      perTileText({
        coalRate: 0,
        waterRate: 0,
        oilRate: 0,
        oilKind: 'oil',
        powerRate: 0.115,
      }),
    ).toBe('0.12 power');
    expect(
      perTileText({
        coalRate: 0,
        waterRate: 0,
        oilRate: 0,
        oilKind: 'oil',
        powerRate: 0,
      }),
    ).toBe('-');
  });
});

describe('a loop record', () => {
  it('lists what is a twentieth of a unit or more, to a tenth, and a dash for nothing', () => {
    expect(recordText({ coal: 12.34, water: 0.04, wood: 3 })).toBe('12.3 coal, 3 wood');
    expect(recordText({})).toBe('-');
    expect(recordText({ coal: 0.01 })).toBe('-');
  });

  it('writes a refuelling with a plus', () => {
    expect(recordText({ refuel_coal: 40 })).toBe('40 +coal');
  });

  it('splits the fuel into what was used and what was refuelled', () => {
    expect(splitFuel({ coal: 5, water: 2, refuel_coal: 40 })).toEqual({
      used: { coal: 5, water: 2 },
      refuelled: { refuel_coal: 40 },
    });
    expect(splitFuel({})).toEqual({ used: {}, refuelled: {} });
  });
});

describe('the cargo aboard', () => {
  it('sums by cargo over the wagons, the most first, and leaves empty wagons out', () => {
    expect(
      cargoAboard([
        { cargo: 'coal', amount: 20 },
        { cargo: 'iron', amount: 30 },
        { cargo: 'coal', amount: 15 },
        { cargo: null, amount: 0 },
        { cargo: 'wood', amount: 0 },
      ]),
    ).toEqual([
      ['coal', 35],
      ['iron', 30],
    ]);
    expect(cargoAboard([])).toEqual([]);
  });
});

describe('the emergency refuel', () => {
  const full = { ...steam, diesel: false };
  const state = (t: Partial<TankInput>) => emergencyState({ ...full, ...t });

  it('is off with the tanks full, and says so', () => {
    expect(state({})).toEqual({ disabled: true, title: STR.train.tanksFull });
    // a tank within a thousandth of full counts as full
    expect(state({ coal: 79.99 }).disabled).toBe(true);
  });

  it('is on once any tank has room', () => {
    expect(state({ coal: 60 })).toEqual({ disabled: false, title: STR.train.emergencyHint });
    expect(state({ water: 100 }).disabled).toBe(false);
    expect(state({ steam: false, diesel: true, oil: 3, oilCap: 50 }).disabled).toBe(false);
  });

  it('is off for a train with no fuel or water tank', () => {
    expect(emergencyState({ ...full, steam: false, diesel: false })).toEqual({
      disabled: true,
      title: STR.train.noTanks,
    });
  });
});

describe('the level of a vehicle', () => {
  it('says what the level adds, in whole percent', () => {
    expect(levelGain(2, 1.08, 'speed and power')).toBe(
      STR.train.levelGain(2, 8, 'speed and power'),
    );
    expect(levelGain(3, 1.16, 'capacity')).toContain('+16 %');
  });

  it('says a model of level 1 is as built', () => {
    expect(levelGain(1, 1, 'capacity')).toBe(STR.train.levelBase);
  });
});

describe('the stop a train heads for', () => {
  it('is its place in the program, wrapped to the list', () => {
    expect(currentStopIndex(true, 1, 4)).toBe(1);
    expect(currentStopIndex(true, 5, 4)).toBe(1);
  });

  it('is none while the train works a contract job', () => {
    expect(currentStopIndex(false, 1, 4)).toBe(-1);
  });

  it('survives an empty program', () => {
    expect(currentStopIndex(true, 0, 0)).toBe(0);
  });
});
