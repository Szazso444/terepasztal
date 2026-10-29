import { describe, expect, it } from 'vitest';
import { needsCompact, topbarCompact } from './fit';

const box = (scrollWidth: number, clientWidth: number) => ({ scrollWidth, clientWidth });

describe('needsCompact', () => {
  it('is true only when the content is wider than its box', () => {
    expect(needsCompact(1418, 1278)).toBe(true);
    expect(needsCompact(1278, 1278)).toBe(false);
    expect(needsCompact(900, 1278)).toBe(false);
  });
});

describe('topbarCompact', () => {
  const fits = box(420, 420);
  it('keeps the normal spacing when the bar fits and nothing in it is cut', () => {
    expect(topbarCompact(box(1278, 1278), [fits, box(96, 96)])).toBe(false);
  });
  it('tightens when the bar overflows', () => {
    expect(topbarCompact(box(1418, 1278), [fits, fits])).toBe(true);
  });
  it('tightens when the screen buttons or the weather text would be cut, though the bar fits', () => {
    expect(topbarCompact(box(1278, 1278), [box(420, 300), fits])).toBe(true);
    expect(topbarCompact(box(1278, 1278), [fits, box(96, 20)])).toBe(true);
  });
  it('counts a hidden box (no weather) as fitting', () => {
    expect(topbarCompact(box(1278, 1278), [fits, box(0, 0)])).toBe(false);
  });
  it('has no answer while the bar is not laid out', () => {
    expect(topbarCompact(box(0, 0), [fits])).toBeNull();
  });
});
