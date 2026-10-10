import { describe, it, expect } from 'vitest';
import {
  MAX_PHASES,
  PhaseCounter,
  WHEEL_CYCLE_TILES,
  WheelRolls,
  phaseIndex,
  phaseKey,
} from './runningGear';

const STILL = 'rolling/loco_rocket_body_f6';

/** An atlas stub holding `keys`, recording every key it is asked about. */
function stub(keys: Iterable<string> | 'all') {
  const asked: string[] = [];
  const set = keys === 'all' ? null : new Set(keys);
  return {
    asked,
    atlas: {
      has(key: string) {
        asked.push(key);
        return set === null || set.has(key);
      },
    },
  };
}

describe('phaseKey', () => {
  it('is the still key for phase 0 and `_w<k>` after it', () => {
    expect(phaseKey(STILL, 0)).toBe(STILL);
    expect(phaseKey(STILL, 1)).toBe(`${STILL}_w1`);
    expect(phaseKey(STILL, 11)).toBe(`${STILL}_w11`);
  });
});

describe('PhaseCounter', () => {
  it('counts the still frame and its consecutive phases', () => {
    const { atlas } = stub([STILL, `${STILL}_w1`, `${STILL}_w2`, `${STILL}_w4`]);
    // the gap at _w3 ends the run: _w4 is not a phase
    expect(new PhaseCounter(atlas).count(STILL)).toBe(3);
  });

  it('gives 1 to a still frame without _w1', () => {
    const { atlas } = stub([STILL, `${STILL}_w2`]);
    expect(new PhaseCounter(atlas).count(STILL)).toBe(1);
  });

  it('stops at MAX_PHASES when the atlas answers yes to everything', () => {
    const { atlas, asked } = stub('all');
    expect(new PhaseCounter(atlas).count(STILL)).toBe(MAX_PHASES);
    expect(MAX_PHASES).toBe(16);
    expect(asked.length).toBe(MAX_PHASES - 1);
  });

  it('asks the atlas about a key once', () => {
    const { atlas, asked } = stub([STILL, `${STILL}_w1`]);
    const counter = new PhaseCounter(atlas);
    expect(counter.count(STILL)).toBe(2);
    const probes = asked.length;
    for (let i = 0; i < 5; i++) expect(counter.count(STILL)).toBe(2);
    expect(asked.length).toBe(probes);
  });

  it('keeps each counter to its own atlas', () => {
    const a = new PhaseCounter(stub('all').atlas),
      b = new PhaseCounter(stub([STILL]).atlas);
    expect(a.count(STILL)).toBe(MAX_PHASES);
    expect(b.count(STILL)).toBe(1);
  });
});

describe('phaseIndex', () => {
  it('steps through every phase in order over one cycle, then wraps', () => {
    for (const n of [2, 3, 8, 16]) {
      const step = WHEEL_CYCLE_TILES / n;
      for (let k = 0; k < 3 * n; k++)
        // the middle of each phase's stretch of travel
        expect(phaseIndex((k + 0.5) * step, n), `n ${n}, step ${k}`).toBe(k % n);
    }
  });

  it('steps backwards for travel the other way', () => {
    const n = 8,
      step = WHEEL_CYCLE_TILES / n;
    for (let k = 1; k <= 2 * n; k++)
      expect(phaseIndex(-(k - 0.5) * step, n)).toBe(((-k % n) + n) % n);
  });

  it('gives the same phase for the same distance', () => {
    for (const roll of [0, 0.123, 7.77, -3.21])
      expect(phaseIndex(roll, 8)).toBe(phaseIndex(roll, 8));
  });

  it('stays in range for any distance', () => {
    const rolls = [-1e9, -0.01, -0, 1e15, 1e300, Number.MAX_VALUE, -Number.MAX_VALUE, NaN];
    for (const n of [1, 2, 7, 16])
      for (const roll of [...rolls, Infinity, -Infinity]) {
        const i = phaseIndex(roll, n);
        expect(Number.isInteger(i) && i >= 0 && i < n, `roll ${roll}, n ${n}: ${i}`).toBe(true);
        expect(Object.is(i, -0)).toBe(false);
      }
    expect(phaseIndex(NaN, 8)).toBe(0);
    expect(phaseIndex(Infinity, 8)).toBe(0);
  });

  it('is always 0 with one phase', () => {
    for (const roll of [0, 0.3, 1, -2.5, 1e9]) expect(phaseIndex(roll, 1)).toBe(0);
  });
});

describe('WheelRolls', () => {
  it('starts a train at 0 and adds the distance it runs', () => {
    const r = new WheelRolls();
    expect(r.advance(1, 40, false)).toBe(0);
    expect(r.advance(1, 40.25, false)).toBeCloseTo(0.25, 12);
    expect(r.advance(1, 41, false)).toBeCloseTo(1, 12);
  });

  it('counts down while the train runs tail first', () => {
    const r = new WheelRolls();
    r.advance(1, 10, true);
    expect(r.advance(1, 10.5, true)).toBeCloseTo(-0.5, 12);
    expect(r.advance(1, 11, false)).toBeCloseTo(0, 12);
  });

  it('keeps the roll of a train at rest, also when it turns round', () => {
    const r = new WheelRolls();
    r.advance(1, 3, false);
    const roll = r.advance(1, 3.3, false);
    expect(r.advance(1, 3.3, false)).toBe(roll);
    expect(r.advance(1, 3.3, true)).toBe(roll);
    expect(r.advance(1, 3.3, false)).toBe(roll);
  });

  it('does not turn when the distance goes down, and measures from the new value', () => {
    const r = new WheelRolls();
    r.advance(1, 50, false);
    const roll = r.advance(1, 50.2, false)!;
    expect(r.advance(1, 2, false)).toBe(roll);
    expect(r.advance(1, 2.1, false)).toBeCloseTo(roll + 0.1, 12);
  });

  it('has no roll for a missing or non-finite distance', () => {
    const r = new WheelRolls();
    r.advance(1, 5, false);
    r.advance(1, 5.4, false);
    for (const d of [undefined, NaN, Infinity, -Infinity]) {
      expect(r.advance(1, d, false)).toBeUndefined();
      expect(r.has(1)).toBe(false);
    }
    // the next finite distance is a first sight
    expect(r.advance(1, 9, false)).toBe(0);
  });

  it('forgets a dropped train', () => {
    const r = new WheelRolls();
    r.advance(1, 0, false);
    r.advance(2, 0, false);
    r.advance(1, 0.4, false);
    r.drop(1);
    expect(r.has(1)).toBe(false);
    expect(r.has(2)).toBe(true);
    expect(r.advance(1, 0.9, false)).toBe(0);
  });
});
