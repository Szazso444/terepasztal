import { describe, it, expect, beforeEach } from 'vitest';
import { simWorld, line, station } from '../testing/simWorld';
import { rules, DEFAULT_RULES } from './rules';
import type { Station } from './stations';
import { STR } from '../strings';

beforeEach(() => Object.assign(rules, DEFAULT_RULES));

/** A flat world with a long line on row 30, every chunk owned so the builder may pay anywhere. */
function world() {
  const w = simWorld({ terrain: 'grass', size: 96 });
  w.regions.unlocked.fill(true);
  line(w, 2, 30, 90);
  return w;
}

/** The store of a depot the builder placed. */
function storeOf(w: ReturnType<typeof world>, depot: Station) {
  return w.stores.byKey(`st:${depot.id}`)!;
}

describe('paying from stores', () => {
  it('a station pays from the nearest store that holds its cost', () => {
    const w = world();
    // the farm goes at (40, 29): depot A is 5 tiles off, depot B 12
    const a = storeOf(w, station(w, 'depot', 40, 24));
    const b = storeOf(w, station(w, 'depot', 52, 24));
    a.add('wood', 10);
    a.add('stone', 100);
    b.add('wood', 100);
    b.add('stone', 100);
    const check = w.builder.checkStation(40, 29, 'farm');
    expect(check).toMatchObject({ ok: true, cost: { wood: 30, stone: 10 }, payer: b.key });
    expect(w.builder.payerAt(check.cost, 40, 29)!.key).toBe(b.key);
    expect(w.builder.placeStation(40, 29, 'farm')).not.toBeNull();
    expect([b.get('wood'), b.get('stone')]).toEqual([70, 90]);
    expect([a.get('wood'), a.get('stone')]).toEqual([10, 100]);
  });

  it('nothing in reach: refused with the reach in the reason', () => {
    const w = world();
    const far = storeOf(w, station(w, 'depot', 70, 24));
    far.add('wood', 1000);
    far.add('stone', 1000);
    const check = w.builder.checkStation(40, 29, 'farm');
    expect(check.ok).toBe(false);
    expect(check.reason).toBe(STR.build.noStoreInReach(24, '30 wood, 10 stone'));
    expect(w.builder.placeStation(40, 29, 'farm')).toBeNull();
    expect(far.get('wood')).toBe(1000);
  });

  it('two stores together are not enough', () => {
    const w = world();
    const a = storeOf(w, station(w, 'depot', 40, 24));
    const b = storeOf(w, station(w, 'depot', 52, 24));
    for (const s of [a, b]) {
      s.add('wood', 20);
      s.add('stone', 100);
    }
    const check = w.builder.checkStation(40, 29, 'farm');
    expect(check.ok).toBe(false);
    // the shortfall named is the nearest store's, not the two summed
    expect(check.reason).toBe(STR.build.noStoreInReach(24, '10 wood'));
    expect(w.builder.placeStation(40, 29, 'farm')).toBeNull();
    expect([a.get('wood'), b.get('wood')]).toEqual([20, 20]);
  });

  it('a removed station refunds to the nearest store', () => {
    const w = world();
    const a = storeOf(w, station(w, 'depot', 40, 24));
    const b = storeOf(w, station(w, 'depot', 52, 24));
    a.add('wood', 30);
    a.add('stone', 10);
    const farm = w.builder.placeStation(40, 29, 'farm')!;
    expect([a.get('wood'), a.get('stone')]).toEqual([0, 0]);
    expect(w.builder.removeStation(farm)).toBe(true);
    // half the list price comes back, to A and not to B
    expect([a.get('wood'), a.get('stone')]).toEqual([15, 5]);
    expect([b.get('wood'), b.get('stone')]).toEqual([0, 0]);
  });

  it('free mode pays nothing', () => {
    const w = world();
    const a = storeOf(w, station(w, 'depot', 40, 24));
    a.add('wood', 30);
    a.add('stone', 10);
    w.builder.free = true;
    const farm = w.builder.placeStation(40, 29, 'farm')!;
    expect(farm).not.toBeNull();
    expect([a.get('wood'), a.get('stone')]).toEqual([30, 10]);
    // nor does it need a store in reach
    expect(w.builder.placeStation(80, 29, 'farm')).not.toBeNull();
    w.builder.removeStation(farm);
    expect([a.get('wood'), a.get('stone')]).toEqual([30, 10]);
  });
});
