import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyMap } from './mapgen';
import {
  LEVELS_KEY,
  getLevel,
  isLevel,
  layableTrack,
  levelFromMap,
  listLevels,
  saveLevel,
} from './level';
import { TRACK_ITEMS, type TrackTuple } from './track';
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

describe('a level file written by an older build', () => {
  it('lays a bridge piece as a straight over a bridge, as an old save becomes', () => {
    const { track, buildings } = layableTrack([[4, 8, 'bridge', 1, 'main']]);
    expect(track).toEqual([[4, 8, 'straight', 1, 'main', undefined]]);
    expect(buildings).toEqual([[4, 8, 'bridge_wood', 0]]);
  });

  it('keeps a bridge the file already holds on that tile', () => {
    const { buildings } = layableTrack(
      [[4, 8, 'bridge', 0, 'branch']],
      [[4, 8, 'bridge_stone', 0]],
    );
    expect(buildings).toEqual([[4, 8, 'bridge_stone', 0]]);
  });

  it('leaves out a piece this build has no picture for', () => {
    const { track } = layableTrack([
      [1, 1, 'curve', 0, 'hyperloop'],
      [2, 2, 'crossing', 0, 'narrow', 'trunk'],
      [3, 3, 'straight', 0, 'branch'],
    ]);
    expect(track).toEqual([[3, 3, 'straight', 0, 'branch', undefined]]);
  });

  it('keeps every piece the build bar can lay, the default line included', () => {
    const all = TRACK_ITEMS.map((it): TrackTuple => [0, 0, it.kind, 0, it.cls, it.cls2]);
    expect(layableTrack(all).track).toHaveLength(all.length);
    expect(layableTrack([[0, 0, 'straight', 0]]).track).toHaveLength(1);
  });
});
