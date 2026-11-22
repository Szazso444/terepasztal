import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyMap } from './mapgen';
import { LEVELS_KEY, getLevel, isLevel, levelFromMap, listLevels, saveLevel } from './level';
import type { LevelData } from './level';

let stored: Map<string, string>;
beforeEach(() => {
  stored = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => stored.get(k) ?? null,
    setItem: (k: string, v: string) => void stored.set(k, v),
    removeItem: (k: string) => void stored.delete(k),
  });
});
afterEach(() => void vi.unstubAllGlobals());

/** A level file from a build with tickets: its start block holds some. */
function oldLevel(): LevelData {
  const level = levelFromMap(emptyMap(5, 32, 32), 'Old line', 'old');
  level.start = { money: 7000, tickets: 12, tier: 1, stockMul: 2 };
  return level;
}
const inStorage = () => stored.get(LEVELS_KEY) ?? '';

describe('a level file with start tickets', () => {
  it('is a level, and loads with the rest of its start block as it was', () => {
    const level = oldLevel();
    expect(isLevel(JSON.parse(JSON.stringify(level)))).toBe(true);
    stored.set(LEVELS_KEY, JSON.stringify([level]));
    expect(getLevel('old')?.start).toEqual({ money: 7000, tier: 1, stockMul: 2 });
    expect(listLevels()).toHaveLength(1);
  });

  it('is written back without them, by a save of it or of a level beside it', () => {
    saveLevel(oldLevel());
    expect(inStorage()).not.toContain('tickets');
    stored.set(LEVELS_KEY, JSON.stringify([oldLevel()]));
    saveLevel(levelFromMap(emptyMap(6, 32, 32), 'New line', 'new'));
    expect(inStorage()).not.toContain('tickets');
    expect(
      listLevels()
        .map((l) => l.id)
        .sort(),
    ).toEqual(['new', 'old']);
  });
});

describe('a new level', () => {
  it('starts with money, an age and the stock, and holds no ticket', () => {
    const level = levelFromMap(emptyMap(5, 32, 32), 'New line');
    expect(level.start).toEqual({ money: 25000, tier: 0, stockMul: 1 });
  });
});
