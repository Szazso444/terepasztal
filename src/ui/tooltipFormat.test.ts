import { describe, expect, it } from 'vitest';
import type { Rng } from '../engine/rng';
import { forAll } from '../testing/property';
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

/** Reads a token back: U+2212 and + as signs, × dropped. */
const readBack = (token: string) => Number(token.replace(MINUS, '-').replace(/[+×%]/g, ''));

/** A multiplier as the content has them: any, a whole percent, or just off 1. */
function genMultiplier(rng: Rng): number {
  const r = rng.next();
  if (r < 0.4) return rng.range(0, 4);
  if (r < 0.8) return rng.int(0, 400) / 100;
  return 1 + ((rng.chance(0.5) ? 1 : -1) * rng.int(1, 9)) / 1000;
}

describe('the number tokens, over seeded values', () => {
  it('give a signed percent of round(|m − 1| × 100), + above 1, U+2212 below, a dash at 1', () => {
    forAll(genMultiplier, (m) => {
      const s = signedPercent(m);
      if (m === 1) {
        expect(s).toBe(NO_CHANGE);
        return;
      }
      expect(s).toMatch(/^[+−]\d+%$/);
      expect(s.startsWith('+')).toBe(m > 1);
      expect(Math.abs(readBack(s))).toBe(Math.round(Math.abs(m - 1) * 100));
    });
  });

  it('write a multiplier that reads back to within half a hundredth', () => {
    forAll(genMultiplier, (m) => {
      const s = multiplier(m);
      expect(s).toMatch(/^×\d+\.\d\d$/);
      expect(Math.abs(readBack(s) - m)).toBeLessThanOrEqual(0.005 + 1e-9);
    });
  });

  it('sign a contribution with + or U+2212, never a hyphen, reading back to within half a hundredth', () => {
    forAll(
      (rng) => (rng.chance(0.1) ? 0 : rng.range(-10, 10)),
      (v) => {
        const s = contribution(v);
        expect(s).toMatch(/^[+−]\d+\.\d\d$/);
        expect(s.startsWith(MINUS)).toBe(v < 0);
        expect(Math.abs(readBack(s) - v)).toBeLessThanOrEqual(0.005 + 1e-9);
      },
    );
  });

  it('give a weekly amount one decimal, reading back to within half a tenth', () => {
    forAll(
      (rng) => (rng.chance(0.5) ? rng.range(0, 500) : rng.int(0, 5000) / 10),
      (v) => {
        const s = weekly(v);
        expect(s).toMatch(/^\d+\.\d$/);
        expect(Math.abs(Number(s) - v)).toBeLessThanOrEqual(0.05 + 1e-9);
      },
    );
  });
});
