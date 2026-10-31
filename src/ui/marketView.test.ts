import { describe, expect, it } from 'vitest';
import {
  DEAL_MAX,
  dealCount,
  dealFrom,
  dealMoney,
  dealSides,
  daysUntil,
  driftTone,
  moneyTone,
  pickMarketTab,
  signedMoney,
  tradeOff,
  tradedGoods,
} from './marketView';

describe('the goods the market lists', () => {
  const cargo = [
    { id: 'coal', class: 'mineral' },
    { id: 'passengers', class: 'people' },
    { id: 'wire', class: 'bulk' },
    { id: 'crude', class: 'liquid' },
  ];

  it('leaves out people, and what the production chain does not have', () => {
    expect(tradedGoods(cargo, (c) => c.id !== 'wire').map((c) => c.id)).toEqual(['coal', 'crude']);
    expect(tradedGoods(cargo, () => true).map((c) => c.id)).toEqual(['coal', 'wire', 'crude']);
  });
});

describe('a trade button', () => {
  const s = { hasStore: true, money: 100, price: 32, have: 240 };

  it('is on when there is a store, money for one unit, and stock to sell', () => {
    expect(tradeOff('buy', s)).toBeNull();
    expect(tradeOff('sell', s)).toBeNull();
  });

  it('is off with no store, and says so before anything else', () => {
    expect(tradeOff('buy', { ...s, hasStore: false, money: 0 })).toBe('noStore');
    expect(tradeOff('sell', { ...s, hasStore: false, have: 0 })).toBe('noStore');
  });

  it('is off to buy below the price of one unit, and on at it', () => {
    expect(tradeOff('buy', { ...s, money: 31.99 })).toBe('noMoney');
    expect(tradeOff('buy', { ...s, money: 32 })).toBeNull();
  });

  it('is off to sell with less than one unit in the store', () => {
    expect(tradeOff('sell', { ...s, have: 0.9 })).toBe('nothing');
    expect(tradeOff('sell', { ...s, have: 1 })).toBeNull();
  });
});

describe('a standing deal is one signed number', () => {
  it('reads as a buy or a sell side, the other side nothing', () => {
    expect(dealSides(30)).toEqual({ buy: 30, sell: 0 });
    expect(dealSides(-50)).toEqual({ buy: 0, sell: 50 });
    expect(dealSides(0)).toEqual({ buy: 0, sell: 0 });
  });

  it('is made by one side: buy positive, sell negative, and the other side is gone', () => {
    expect(dealFrom('buy', 30)).toBe(30);
    expect(dealFrom('sell', 50)).toBe(-50);
    expect(dealSides(dealFrom('sell', 50)).buy).toBe(0);
  });

  it('ends with an amount of nothing, and stays inside the range, whole', () => {
    expect(dealFrom('buy', 0)).toBe(0);
    expect(dealFrom('sell', 0)).toBeCloseTo(0);
    expect(dealFrom('buy', 99999)).toBe(DEAL_MAX);
    expect(dealFrom('sell', -5)).toBeCloseTo(0);
    expect(dealFrom('buy', 25.9)).toBe(25);
    expect(dealFrom('buy', NaN)).toBe(0);
  });

  it('costs money to buy and earns it to sell', () => {
    expect(dealMoney(30, 10, 5)).toBe(-300);
    expect(dealMoney(-50, 10, 5)).toBe(250);
    expect(dealMoney(0, 10, 5)).toBeCloseTo(0);
  });

  it('counts the deals that are set', () => {
    expect(dealCount([30, 0, -50, 0])).toBe(2);
    expect(dealCount([])).toBe(0);
  });
});

describe('how numbers read', () => {
  it('puts the sign before the dollar, not after it', () => {
    expect(signedMoney(-2588)).toBe('−$2,588');
    expect(signedMoney(396)).toBe('+$396');
    expect(signedMoney(0)).toBe('$0');
    expect(signedMoney(-0.4)).toBe('$0');
  });

  it('tones a cost red, an income green, nothing dim', () => {
    expect(moneyTone(-1)).toBe('bad');
    expect(moneyTone(1)).toBe('good');
    expect(moneyTone(0)).toBe('dim');
  });

  it('tones a fuel dearer than its base red and a cheaper one green, within 2% dim', () => {
    expect(driftTone(1.14)).toBe('bad');
    expect(driftTone(0.8)).toBe('good');
    expect(driftTone(1.02)).toBe('dim');
    expect(driftTone(0.98)).toBe('dim');
  });

  it('counts whole days to the next settlement, up', () => {
    expect(daysUntil(0, 240)).toBe(0);
    expect(daysUntil(1, 240)).toBe(1);
    expect(daysUntil(241, 240)).toBe(2);
    expect(daysUntil(-5, 240)).toBe(0);
  });

  it('keeps the tab it was on for one that does not exist', () => {
    expect(pickMarketTab('deals', 'spot')).toBe('deals');
    expect(pickMarketTab('x', 'deals')).toBe('deals');
  });
});
