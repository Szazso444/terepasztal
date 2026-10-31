import { describe, expect, it } from 'vitest';
import { compactLevel, needsCompact, topbarCompact, type CompactLevel } from './fit';

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
  it('tightens when the menu bar or the weather text would be cut, though the bar fits', () => {
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

describe('compactLevel', () => {
  /** A bar that overflows at every level below `fitsFrom`, and the levels it was laid out at. */
  const bar = (fitsFrom: number) => {
    const measured: CompactLevel[] = [];
    return {
      measured,
      overflows: (level: CompactLevel) => {
        measured.push(level);
        return level < fitsFrom;
      },
    };
  };

  it('keeps the normal spacing, and measures nothing more, when the bar fits', () => {
    const b = bar(0);
    expect(compactLevel(b.overflows)).toBe(0);
    expect(b.measured).toEqual([0]);
  });
  it('goes to step 1 (tighter spacing, no weather text) when that is enough, era name kept', () => {
    const b = bar(1);
    expect(compactLevel(b.overflows)).toBe(1);
    expect(b.measured).toEqual([0, 1]);
  });
  it('goes to step 2 (the era name gone as well) only when step 1 is still short', () => {
    const b = bar(2);
    expect(compactLevel(b.overflows)).toBe(2);
    expect(b.measured).toEqual([0, 1]);
  });
  it('stays at step 2 when nothing fits, as there is nothing tighter', () => {
    expect(compactLevel(() => true)).toBe(2);
  });
  it('gives the same answer for the same room, whatever the last one was', () => {
    // the room is all it reads: asked twice, or from either side of a width, it does not flip
    for (const fitsFrom of [0, 1, 2]) {
      const first = compactLevel(bar(fitsFrom).overflows);
      expect(compactLevel(bar(fitsFrom).overflows)).toBe(first);
      expect(first).toBe(fitsFrom);
    }
  });
  it('has no answer while the bar is not laid out, at any level', () => {
    expect(compactLevel(() => null)).toBeNull();
    expect(compactLevel((level) => (level === 0 ? true : null))).toBeNull();
  });
  it('reads the measurements of topbarCompact level by level', () => {
    // 1366 wide: the weather text is cut at step 0 and the bar fits at step 1 with the era name
    const widths: Record<CompactLevel, { bar: [number, number]; weather: [number, number] }> = {
      0: { bar: [1366, 1366], weather: [96, 20] },
      1: { bar: [1290, 1366], weather: [0, 0] },
      2: { bar: [1230, 1366], weather: [0, 0] },
    };
    const at = (level: CompactLevel) =>
      topbarCompact(box(...widths[level].bar), [box(420, 420), box(...widths[level].weather)]);
    expect(compactLevel(at)).toBe(1);
    // 1280 wide: even step 1 overflows
    widths[1].bar = [1300, 1280];
    widths[0].bar = [1366, 1280];
    widths[2].bar = [1230, 1280];
    expect(compactLevel(at)).toBe(2);
  });
});
