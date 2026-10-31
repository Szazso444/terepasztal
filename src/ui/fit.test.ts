import { describe, expect, it } from 'vitest';
import {
  NOW_PLAYING_WIDTH,
  compactLevel,
  foldCount,
  needsCompact,
  topbarCompact,
  type CompactLevel,
} from './fit';
import { foldedEntries, type MenuId } from './menuBarModel';

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

describe('foldCount', () => {
  it('folds nothing when the bar fits with every label', () => {
    const asked: number[] = [];
    expect(
      foldCount(9, (n) => {
        asked.push(n);
        return false;
      }),
    ).toBe(0);
    expect(asked).toEqual([0]);
  });
  it('folds as few as fit, measuring no further', () => {
    const asked: number[] = [];
    expect(
      foldCount(9, (n) => {
        asked.push(n);
        return n < 4;
      }),
    ).toBe(4);
    expect(asked).toEqual([0, 1, 2, 3, 4]);
  });
  it('folds all of them when nothing fits: the menu bar is cut from there', () => {
    expect(foldCount(9, () => true)).toBe(9);
  });
  it('has no answer while the bar is not laid out', () => {
    expect(foldCount(9, () => null)).toBeNull();
    expect(foldCount(9, (n) => (n === 0 ? true : null))).toBeNull();
  });
  it('gives the same answer for the same room, whatever came before', () => {
    const at = (room: number) => foldCount(9, (n) => n * 40 < room);
    expect(at(90)).toBe(at(90));
    expect(at(90)).toBe(3);
  });
  it('keeps room for the now-playing widget', () => {
    expect(NOW_PLAYING_WIDTH).toBe(190);
  });
});

describe('which labels fold at which width', () => {
  /**
   * The bar as measured in a game at `compact-2`, the now-playing room kept: all it holds but the
   * labels (the same in both languages, to a third of a pixel), and each label with its gap. The
   * fourth fold in English at 1280 lands within a pixel of the edge, as in the game.
   */
  const REST = 1100;
  const LABEL: Record<'en' | 'hu', Partial<Record<MenuId, number>>> = {
    en: {
      menu: 33.8,
      save: 31,
      savedGames: 78.2,
      settings: 49.3,
      audio: 35,
      fleet: 30.8,
      economy: 54.1,
      view: 30.1,
      notifications: 72.2,
    },
    hu: {
      menu: 33.8,
      save: 43.4,
      savedGames: 91.1,
      settings: 63.6,
      audio: 32.7,
      fleet: 35.3,
      economy: 57.5,
      view: 35.4,
      notifications: 65,
    },
  };
  const folded = (width: number, language: 'en' | 'hu') => {
    const label = LABEL[language];
    const all = Object.values(label).reduce((a, b) => a + b, 0);
    const widthWithout = (ids: readonly MenuId[]) =>
      REST + all - ids.reduce((a, id) => a + (label[id] ?? 0), 0);
    const count = foldCount(
      foldedEntries('play', Infinity).length,
      (n) => widthWithout(foldedEntries('play', n)) > width,
    );
    return foldedEntries('play', count ?? 0);
  };

  it('keeps every label at 1920 and 1600', () => {
    for (const language of ['en', 'hu'] as const) {
      expect(folded(1920, language)).toEqual([]);
      expect(folded(1600, language)).toEqual([]);
    }
  });
  it('folds Notifications and Saved Games at 1366 in English, and Settings too in Hungarian', () => {
    expect(folded(1366, 'en')).toEqual(['notifications', 'savedGames']);
    expect(folded(1366, 'hu')).toEqual(['notifications', 'savedGames', 'settings']);
  });
  it('folds Audio as well at 1280, and Save too in Hungarian; the menus keep their names', () => {
    expect(folded(1280, 'en')).toEqual(['notifications', 'savedGames', 'settings', 'audio']);
    expect(folded(1280, 'hu')).toEqual([
      'notifications',
      'savedGames',
      'settings',
      'audio',
      'save',
    ]);
  });
});
