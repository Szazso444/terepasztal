import { describe, it, expect, beforeEach } from 'vitest';
import { TradeDesk, BUY_MUL, SELL_MUL, DRIFTING } from './trade';
import { CARGO } from './cargo';
import { rules, DEFAULT_RULES } from './rules';
import { setSupplyMode, DEFAULT_SUPPLY } from './supply';
import { Stockpile } from './stockpile';
import { Economy } from './economy';
import { forAll, shrinkInt } from '../testing/property';

beforeEach(() => {
  Object.assign(rules, DEFAULT_RULES);
  setSupplyMode(DEFAULT_SUPPLY);
});

/** Whole cents: what a price shows and what a trade moves. */
const isCents = (v: number) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6;

describe('TradeDesk.spotQuote', () => {
  it("is the market screen's price per unit for every good, at any spot setting and fuel price", () => {
    forAll(
      (rng) => ({
        // the Spot price x slider: 0 to 5 in steps of 0.1, and anything a save may carry
        spot: rng.chance(0.2) ? rng.range(0, 5) : Math.round(rng.range(0, 5) * 10) / 10,
        // the fuel walk stays within 0.6 and 1.4
        fuelMul: rng.range(0.6, 1.4),
      }),
      ({ spot, fuelMul }) => {
        rules.spotPriceMul = spot;
        const trade = new TradeDesk();
        trade.fuelMul = fuelMul;
        for (const c of CARGO) {
          // the formula marketScreen computed for its buy and sell columns
          const drift = DRIFTING.includes(c.id) ? fuelMul : 1;
          const buy = Math.round(c.price * BUY_MUL * spot * drift * 100) / 100;
          const sell = Math.round(c.price * SELL_MUL * spot * drift * 100) / 100;
          const q = trade.spotQuote(c.id);
          expect(q, c.id).toEqual({ buy, sell });
          expect(isCents(q.buy) && isCents(q.sell), `${c.id} in whole cents`).toBe(true);
          // selling never pays more than buying costs, and neither price is negative
          expect(q.sell, c.id).toBeGreaterThanOrEqual(0);
          expect(q.sell, c.id).toBeLessThanOrEqual(q.buy);
        }
      },
    );
  });

  it('moves with the fuel price only for the fuels that drift', () => {
    forAll(
      (rng) => ({ a: rng.range(0.6, 1.4), b: rng.range(0.6, 1.4) }),
      ({ a, b }) => {
        const one = new TradeDesk(),
          two = new TradeDesk();
        one.fuelMul = a;
        two.fuelMul = b;
        for (const c of CARGO)
          if (!DRIFTING.includes(c.id))
            expect(one.spotQuote(c.id), c.id).toEqual(two.spotQuote(c.id));
      },
    );
  });
});

describe('TradeDesk.cycleSeconds', () => {
  it('is seven in-game days at any day length, and a standing deal settles once per cycle', () => {
    // The day length is the only setting the cycle follows: there is no setting of its own for it.
    forAll(
      (rng) => ({ day: rng.int(3, 120) * 10, now: rng.int(1, 100_000) }),
      ({ day, now }) => {
        rules.daySeconds = day;
        const week = 7 * day;
        const desk = new TradeDesk();
        const stock = new Stockpile();
        const economy = new Economy();
        const cap = () => 1000;
        expect(desk.cycleSeconds(), 'the cycle').toBe(week);

        desk.set('food', 10);
        desk.tick(now, stock, economy, cap);
        expect(desk.nextAt, 'the first tick starts the cycle').toBe(now + week);
        desk.tick(now + week - 1, stock, economy, cap);
        expect(stock.get('food'), 'nothing settles before the cycle is out').toBe(0);
        desk.tick(now + week, stock, economy, cap);
        expect(stock.get('food'), 'the deal settles when it is').toBe(10);
        expect(desk.nextAt, 'the next cycle follows on').toBe(now + 2 * week);
      },
      { shrink: ({ day, now }) => [...shrinkInt(now, 1)].map((n) => ({ day, now: n })) },
    );
  });
});
