import { describe, it, expect } from 'vitest';
import { advanceSpin, spinPhase, SPIN_CAP } from './wheelSpin';

describe('wheel layers', () => {
  it('go through every phase in order as the train rolls forward, and close the cycle', () => {
    let u = 0;
    const seen: number[] = [];
    for (let i = 0; i < 80; i++) {
      u = advanceSpin(u, 0.01, 0.4);
      const p = spinPhase(u, 8);
      if (seen[seen.length - 1] !== p) seen.push(p);
    }
    expect(seen.slice(0, 9)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 0]);
    // 80 steps of 0.01 over a 0.4 tile cycle: exactly two cycles
    expect(Math.min(u, 1 - u)).toBeLessThan(1e-9);
  });
  it('run the other way when the train rolls back', () => {
    let u = 0.5;
    const seen: number[] = [];
    for (let i = 0; i < 20; i++) {
      u = advanceSpin(u, -0.01, 0.4);
      const p = spinPhase(u, 8);
      if (seen[seen.length - 1] !== p) seen.push(p);
    }
    expect(seen.slice(0, 5)).toEqual([3, 2, 1, 0, 7]);
  });
  it('hold a fast train to a third of a cycle a frame, still forwards', () => {
    expect(advanceSpin(0, 5, 0.05)).toBeCloseTo(SPIN_CAP, 12);
    expect(advanceSpin(0.9, 5, 0.05)).toBeCloseTo(0.9 + SPIN_CAP - 1, 12);
    expect(advanceSpin(0.1, -5, 0.05)).toBeCloseTo(0.1 - SPIN_CAP + 1, 12);
  });
  it('stand still with the train, and ignore a cycle of no length', () => {
    expect(advanceSpin(0.3, 0, 0.4)).toBe(0.3);
    expect(advanceSpin(0.3, 1, 0)).toBe(0.3);
    expect(advanceSpin(0.3, NaN, 0.4)).toBe(0.3);
  });
  it('name a frame for every place in the cycle', () => {
    expect(spinPhase(0, 4)).toBe(0);
    expect(spinPhase(0.999999, 4)).toBe(3);
    expect(spinPhase(1, 4)).toBe(3);
    expect(spinPhase(0.25, 4)).toBe(1);
  });
});
