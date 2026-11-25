import { describe, it, expect, vi } from 'vitest';
import { Economy } from './economy';
import { STR } from '../strings';
import { forAll } from '../testing/property';

describe('Economy.spend', () => {
  it('pays what the money covers, and refuses anything more with one warning in its own words', () => {
    forAll(
      (rng) => {
        const money = [0, rng.int(0, 5000), rng.range(-200, 5000)][rng.int(0, 2)];
        const cost = [money, money + 0.01, rng.range(0, 6000), 0][rng.int(0, 3)];
        return { money, cost };
      },
      ({ money, cost }) => {
        const e = new Economy();
        const posted = vi.fn();
        e.onMessage = posted;
        e.money = money;
        const paid = e.spend(cost);
        expect(paid).toBe(money >= cost);
        expect(e.money).toBe(paid ? money - cost : money);
        expect(posted.mock.calls).toEqual(paid ? [] : [[STR.build.funds, 'warn']]);
      },
    );
  });
});
