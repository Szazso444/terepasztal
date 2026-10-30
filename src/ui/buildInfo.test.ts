import { describe, it, expect, beforeEach } from 'vitest';
import { simWorld, line } from '../testing/simWorld';
import { depotWith } from '../testing/storeFixtures';
import { rules, DEFAULT_RULES } from '../sim/rules';
import { setSupplyMode } from '../sim/supply';
import { stationDef } from '../sim/stations';
import { Terrain } from '../world/tiles';
import { STR } from '../strings';
import { paymentOf } from './buildInfo';

beforeEach(() => {
  Object.assign(rules, DEFAULT_RULES);
  setSupplyMode('simple');
});

/**
 * A lumber yard's site on forest beside a line, where placing it costs more than its listed price:
 * a near depot holding the listed price exactly, and a farther one, still in reach, holding plenty.
 */
function forestSite() {
  const w = simWorld({ terrain: 'grass', size: 96, supply: 'full' });
  for (let i = 0; i < w.regions.unlocked.length; i++) w.regions.own(i);
  line(w, 2, 30, 90);
  const at = { x: 40, y: 29 };
  w.map.terrain[at.y * w.map.w + at.x] = Terrain.Forest;
  const listed = stationDef('lumber').cost;
  const near = depotWith(w, { ...listed }, { x: 36, y: 22 });
  const far = depotWith(w, { wood: 500, stone: 500 }, { x: 60, y: 22 });
  return { w, at, listed, near, far };
}

describe("the build card's payment", () => {
  it('names the store that pays the price placing costs there, not the nearest that holds the list', () => {
    const { w, at, listed, near, far } = forestSite();
    const check = w.builder.checkStation(at.x, at.y, 'lumber');
    expect(check.ok).toBe(true);
    // the forest makes the real price more than the list, which the near depot alone holds
    expect(near.canAfford(check.cost)).toBe(false);
    expect(near.canAfford(listed)).toBe(true);
    expect(w.builder.payerAt(listed, at.x, at.y)?.key).toBe(near.key);
    expect(check.payer).toBe(far.key);
    expect(paymentOf(w.builder, { check, at })).toEqual({
      ok: true,
      text: STR.build.paidFrom(w.stores.label(far)),
      short: [],
    });
  });

  it('gives the refusal with the real amounts when no store in reach holds that price', () => {
    const { w, at, near, far } = forestSite();
    far.amounts.clear();
    const check = w.builder.checkStation(at.x, at.y, 'lumber');
    expect(check.ok).toBe(false);
    const pay = paymentOf(w.builder, { check, at })!;
    expect(pay.ok).toBe(false);
    expect(pay.text).toBe(check.reason);
    expect(pay.text).not.toContain('Paid from');
    expect(pay.short.sort()).toEqual(Object.keys(near.missing(check.cost)).sort());
    expect(pay.short.length).toBeGreaterThan(0);
  });

  it('says nothing of a refusal for another reason, of free work, or with nothing under the pointer', () => {
    const { w, at } = forestSite();
    // a depot's tile: occupied, whatever the stores hold
    const occupied = w.builder.checkStation(36, 22, 'lumber');
    expect(occupied.ok).toBe(false);
    expect(paymentOf(w.builder, { check: occupied, at: { x: 36, y: 22 } })).toBeNull();
    w.builder.free = true;
    const free = w.builder.checkStation(at.x, at.y, 'lumber');
    expect(paymentOf(w.builder, { check: free, at })).toBeNull();
    expect(paymentOf(w.builder, null)).toBeNull();
  });
});
