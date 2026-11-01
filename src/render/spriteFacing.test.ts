import { describe, expect, it } from 'vitest';
import { spriteFacing, snapTrainPixel } from './spriteFacing';
import { advanceSpin, spinPhase } from './wheelSpin';

describe('dense intact train renders', () => {
  it('halves the maximum heading jump without bending the image', () => {
    const turn = Math.PI * 2;
    for (const count of [48, 96]) {
      for (let i = -1000; i <= 1000; i++) {
        const angle = (i / 1000) * turn;
        const f = spriteFacing(angle, count);
        const error = Math.atan2(
          Math.sin(angle - (f * turn) / count),
          Math.cos(angle - (f * turn) / count),
        );
        expect(Math.abs(error)).toBeLessThanOrEqual(Math.PI / count + 1e-10);
      }
    }
    expect(spriteFacing(0, 96)).toBe(0);
    expect(spriteFacing(turn, 96)).toBe(0);
    expect(spriteFacing(-Math.PI / 2, 96)).toBe(72);
  });

  it('limits placement error to half the old rounding error', () => {
    for (let i = -1000; i <= 1000; i++) {
      const x = i / 997;
      expect(Math.abs(snapTrainPixel(x) - x)).toBeLessThanOrEqual(1 / 12 + 1e-12);
    }
  });

  it('uses travelled distance for integrated frames, including stops and reverse', () => {
    const cycle = 0.1083296553;
    const u = advanceSpin(0.1, cycle / 8, cycle);
    expect(spinPhase(u, 8)).toBe(1);
    expect(advanceSpin(u, 0, cycle)).toBe(u);
    expect(advanceSpin(u, -cycle / 8, cycle)).toBeCloseTo(0.1);
  });
});
