import { afterEach, describe, expect, it } from 'vitest';
import { RESOURCE_GROUPS, barGroups, makersOf, usersOf, takenAt } from './resourceOrder';
import { DEFAULT_SUPPLY, setSupplyMode } from '../sim/supply';

afterEach(() => setSupplyMode(DEFAULT_SUPPLY));

describe('resource bar order', () => {
  it('funds first, then building, fuel and power, food, people', () => {
    expect(RESOURCE_GROUPS.map((g) => g[0])).toEqual([
      'money',
      'wood',
      'coal',
      'wheat',
      'passengers',
    ]);
    expect(RESOURCE_GROUPS[1]).toEqual([
      'wood',
      'stone',
      'sand',
      'iron_ore',
      'iron',
      'copper_ore',
      'wire',
    ]);
    expect(RESOURCE_GROUPS[2]).toEqual(['coal', 'water', 'crude', 'oil', 'diesel', 'power']);
    expect(RESOURCE_GROUPS[3]).toEqual(['wheat', 'food']);
    expect(RESOURCE_GROUPS[4]).toEqual(['passengers', 'population']);
  });
  it('a resource stays off the bar until something can make it', () => {
    const flat = barGroups(0, () => 0).flat();
    expect(flat).not.toContain('oil'); // Oil Refinery is tier 1
    expect(flat).not.toContain('power'); // Power Plant is tier 1
    expect(barGroups(1, () => 0).flat()).toEqual(expect.arrayContaining(['oil', 'power']));
  });
  it('stock shows a locked resource', () => {
    expect(barGroups(0, (id) => (id === 'oil' ? 5 : 0)).flat()).toContain('oil');
  });
  it('full-chain cargo stays off the bar in the simple chain', () => {
    // with the simple chain active, full-chain ids are never listed
    expect(barGroups(2, () => 0).flat()).not.toContain('iron_ore');
  });
  it('no empty group is left', () => {
    for (const g of barGroups(0, () => 0)) expect(g.length).toBeGreaterThan(0);
  });
  it('makers and users come from the content', () => {
    expect(makersOf('wheat').map((r) => r.id)).toContain('farm');
    expect(usersOf('wheat').map((r) => r.id)).toContain('windmill');
    expect(makersOf('power').map((r) => r.id)).toEqual(
      expect.arrayContaining(['power_plant', 'hydro_plant']),
    );
    expect(takenAt('water').map((r) => r.id)).toContain('water_tower');
    expect(takenAt('coal').map((r) => r.id)).toContain('fuel_stop');
  });
  it('makers follow the supply mode', () => {
    expect(makersOf('oil').every((r) => r.kind !== 'decor')).toBe(true);
  });
  it('the full chain brings its own cargo and makers onto the bar', () => {
    expect(makersOf('iron_ore')).toEqual([]);
    setSupplyMode('full');
    expect(makersOf('iron_ore').length).toBeGreaterThan(0);
    const groups = barGroups(2, () => 0);
    expect(groups.find((g) => g.includes('iron_ore'))).toEqual(
      expect.arrayContaining(['wood', 'iron_ore']),
    );
    expect(groups.flat()).toEqual(expect.arrayContaining(['crude', 'diesel']));
    expect(groups.flat()).not.toContain('oil');
  });
});
