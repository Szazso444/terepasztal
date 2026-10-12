import { describe, expect, it } from 'vitest';
import {
  MINUS,
  NO_CHANGE,
  TIMES,
  contribution,
  multiplier,
  signedPercent,
  weekly,
} from './tooltipFormat';

const MULTIPLIERS = [0, 0.01, 0.25, 0.5, 0.8, 0.95, 0.996, 1.004, 1.1, 1.25, 1.5, 2, 3.333];

describe('the number tokens of a tooltip', () => {
  it('signs a percent with + above 1 and U+2212 below, from round(|m − 1| × 100)', () => {
    for (const m of MULTIPLIERS) {
      const s = signedPercent(m);
      expect(s, String(m)).toBe(`${m > 1 ? '+' : MINUS}${Math.round(Math.abs(m - 1) * 100)}%`);
      expect(s, 'never a hyphen').not.toContain('-');
    }
    expect(signedPercent(1.25)).toBe('+25%');
    expect(signedPercent(0.5)).toBe('−50%');
  });

  it('shows no change for exactly 1, with no sign and no number', () => {
    expect(signedPercent(1)).toBe(NO_CHANGE);
    expect(NO_CHANGE).not.toMatch(/\d/);
  });

  it('writes a multiplier with U+00D7 and two decimals', () => {
    expect(TIMES).toBe('×');
    for (const m of MULTIPLIERS) expect(multiplier(m)).toMatch(/^×\d+\.\d{2}$/);
    expect(multiplier(1.25)).toBe('×1.25');
  });

  it('signs a contribution and gives it two decimals', () => {
    expect(contribution(1.5)).toBe('+1.50');
    expect(contribution(0)).toBe('+0.00');
    expect(contribution(-0.25)).toBe(`${MINUS}0.25`);
  });

  it('gives a weekly amount one decimal', () => {
    expect(weekly(37.54)).toBe('37.5');
    expect(weekly(30)).toBe('30.0');
  });
});
