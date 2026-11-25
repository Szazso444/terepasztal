import { describe, it, expect, beforeEach } from 'vitest';
import { TradeDesk, BUY_MUL, SELL_MUL, DRIFTING } from './trade';
import { CARGO } from './cargo';
import { rules, DEFAULT_RULES } from './rules';
import { setSupplyMode, DEFAULT_SUPPLY } from './supply';
import { storeWith, storesWith } from '../testing/storeFixtures';
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
        const { stores, depot: stock } = storeWith({});
        const economy = new Economy();
        expect(desk.cycleSeconds(), 'the cycle').toBe(week);

        desk.set('food', 10);
        desk.tick(now, stores, economy);
        expect(desk.nextAt, 'the first tick starts the cycle').toBe(now + week);
        desk.tick(now + week - 1, stores, economy);
        expect(stock.get('food'), 'nothing settles before the cycle is out').toBe(0);
        desk.tick(now + week, stores, economy);
        expect(stock.get('food'), 'the deal settles when it is').toBe(10);
        expect(desk.nextAt, 'the next cycle follows on').toBe(now + 2 * week);
      },
      { shrink: ({ day, now }) => [...shrinkInt(now, 1)].map((n) => ({ day, now: n })) },
    );
  });
});

describe('TradeDesk and its store', () => {
  /** Two depot stores far apart, the second selected, and a desk that buys 10 food a cycle. */
  function desk() {
    const { stores, depots, stations } = storesWith([
      { amounts: {}, at: { x: 0, y: 0 } },
      { amounts: {}, at: { x: 200, y: 200 } },
    ]);
    const [a, b] = depots;
    stores.selected = stores.poolOf(b);
    const trade = new TradeDesk();
    const economy = new Economy();
    economy.money = 1e6;
    trade.set('food', 10);
    return { stores, stations, a, b, trade, economy };
  }

  it('a standing deal settles with its store, and with the selected store once that store is gone', () => {
    const { stores, stations, a, b, trade, economy } = desk();
    const week = trade.cycleSeconds();
    trade.storeKey = a.key;
    trade.tick(1, stores, economy);
    trade.tick(1 + week, stores, economy);
    expect(a.get('food'), 'its own store').toBe(10);
    expect(b.get('food'), 'not the selected one').toBe(0);

    // the depot goes; its goods go to the other store, out of reach as it is
    stations.splice(0, 1);
    stores.refresh();
    expect(stores.byKey(a.key)).toBeUndefined();
    expect(b.get('food'), 'what the depot held').toBe(10);
    trade.tick(1 + 2 * week, stores, economy);
    expect(b.get('food'), 'the selected store').toBe(20);
    expect(trade.storeKey, 'the desk keeps the key it was given').toBe(a.key);
  });

  it('settles with the selected store when it was given none, and buys only up to the cap', () => {
    const { stores, b, trade, economy } = desk();
    b.amounts.set('food', b.cap('food') - 4);
    trade.tick(1, stores, economy);
    trade.tick(1 + trade.cycleSeconds(), stores, economy);
    expect(b.get('food')).toBe(b.cap('food'));
  });

  it('keeps its store through a save, and an old desk has none', () => {
    const trade = new TradeDesk();
    trade.set('coal', -5);
    trade.storeKey = 'town:3';
    const back = new TradeDesk();
    back.load(JSON.parse(JSON.stringify(trade.toJSON())));
    expect(back.storeKey).toBe('town:3');
    expect(back.toJSON()).toEqual(trade.toJSON());
    // a desk with no store saves as a desk always did
    expect('storeKey' in new TradeDesk().toJSON()).toBe(false);
    const old = new TradeDesk();
    old.storeKey = 'st:9';
    old.load({ deals: { coal: -5 }, nextAt: 10, fuelMul: 1, driftDay: 0 });
    expect(old.storeKey).toBeNull();
    old.load(undefined);
    expect(old.storeKey).toBeNull();
  });
});
