import { describe, it, expect } from 'vitest';
import { bogieFrame } from './frames';

const atlas = (...keys: string[]) => ({ has: (k: string) => keys.includes(k) });

describe('bogieFrame', () => {
  it("uses a vehicle's own bogie style when the atlas has it", () => {
    expect(bogieFrame(atlas('rolling/bogie_y25_f3'), 'y25', 'bogie', 3)).toBe(
      'rolling/bogie_y25_f3',
    );
  });

  it('falls back to the generic truck of the same kind', () => {
    // a style drawn for one kind or facing never stands in for another
    const a = atlas('rolling/bogie_y25_f3');
    expect(bogieFrame(a, 'y25', 'bogie3', 3)).toBe('rolling/bogie3_f3');
    expect(bogieFrame(a, 'y25', 'bogie', 4)).toBe('rolling/bogie_f4');
    expect(bogieFrame(a, undefined, 'bogie', 3)).toBe('rolling/bogie_f3');
  });
});
