import { describe, expect, it } from 'vitest';
import { fmtDuration } from './numberFormat';

describe('a duration as the game prints it', () => {
  it('is in days from a day up, and hours and minutes under it', () => {
    // a day is 240 s in the default rules
    expect(fmtDuration(240 * 4.1)).toBe('4.1d');
    expect(fmtDuration(240)).toBe('1.0d');
    expect(fmtDuration(240 * 0.5)).toBe('12h 00m');
    expect(fmtDuration(0)).toBe('0h 00m');
  });
});
