import { describe, it, expect } from 'vitest';
import { facingRotation } from './toolRotation';
import { STR } from '../strings';
import { takenAt } from './resourceOrder';
import { DECOR_DEFS } from '../sim/build';

describe('a fuel building in the hand', () => {
  it('takes the first side that faces track', () => {
    expect(facingRotation([1, 3], 0, false)).toBe(1);
  });
  it('keeps a side that faces track', () => {
    expect(facingRotation([1, 3], 3, false)).toBe(3);
  });
  it('R steps only through the sides that face track, and back to the first', () => {
    expect(facingRotation([1, 3], 1, true)).toBe(3);
    expect(facingRotation([1, 3], 3, true)).toBe(1);
    expect(facingRotation([2], 2, true)).toBe(2);
  });
  it('with no track beside it stays as it is', () => {
    expect(facingRotation([], 2, true)).toBe(2);
  });
});

describe('the Fuel category', () => {
  it('is called Fuel and holds the three fuel buildings, the Fuel Pump from the Diesel age', () => {
    expect(STR.toolbar.services).toBe('Fuel');
    expect(DECOR_DEFS.find((d) => d.id === 'fuel_pump')?.tier).toBe(1);
  });
  it('names each building for what it hands out', () => {
    expect(takenAt('water').map((b) => b.id)).toEqual(['water_tower']);
    expect(takenAt('coal').map((b) => b.id)).toEqual(['fuel_stop']);
    expect(takenAt('oil')).toEqual([expect.objectContaining({ id: 'fuel_pump', tier: 1 })]);
  });
});
