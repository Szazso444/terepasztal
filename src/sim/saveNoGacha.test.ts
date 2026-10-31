import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  KNOWN_SAVE_KEYS,
  MIGRATIONS,
  SAVE_KEY,
  SAVE_QUIET_VERSION,
  SAVE_VERSION,
  buildSave,
  continueMeta,
  migrate,
  parseSave,
  readSaveText,
  type SaveGame,
  type SaveParts,
} from './save';
import { continueText, formatNote } from '../ui/saveSlots';

/** The format `origin/develop` wrote while the gacha was still in the save. */
const LAST_GACHA_FORMAT = 23;

/**
 * A file as the last build with a gacha wrote it: its gacha section and a little of everything
 * else. Written out by hand so it stays that shape when the build it describes is gone.
 */
function v23(over: Record<string, unknown> = {}): SaveGame {
  return {
    version: LAST_GACHA_FORMAT,
    savedAt: 1790000000000,
    seed: 777,
    clock: { time: 1234.5, speedIndex: 2 },
    economy: {
      money: 12345,
      tickets: 17,
      tier: 2,
      granted: [1, 2],
      earned: 9000,
      hsUnlocked: true,
    },
    track: [[4, 8, 'straight', 1, 'branch', 'branch']],
    stations: [],
    trains: [],
    contracts: { contracts: [], nextId: 1, nextRefresh: 40, stats: { completed: 0, failed: 0 } },
    inventory: { items: [], nextUid: 1 },
    gacha: { pity: 7, totalPulls: 31, rng: 99 },
    camera: { x: 10, y: 20, zoomIndex: 3 },
    lastDay: 42,
    ...over,
  } as unknown as SaveGame;
}
const text = (j: SaveGame) => JSON.stringify(j);

describe('the step from v23', () => {
  const step = () => MIGRATIONS.find((m) => m.from === LAST_GACHA_FORMAT)!;

  it('takes the gacha out of the file, and nothing else', () => {
    const before = v23();
    const after = migrate(v23());
    expect(after.version).toBe(SAVE_VERSION);
    expect('gacha' in after).toBe(false);
    for (const key of Object.keys(before))
      if (key !== 'gacha' && key !== 'version') expect(after[key], key).toEqual(before[key]);
  });

  it('runs on a file with no gacha section too', () => {
    const j = v23();
    delete j.gacha;
    expect(() => migrate(j)).not.toThrow();
  });

  it('is quiet: the file loads with no note and no mark of another format', () => {
    expect(step().quiet).toBe(true);
    const j = parseSave(text(v23()))!;
    expect(j.loadedFrom).toBeUndefined();
    expect(j.migrationNotes).toBeUndefined();
  });

  it('leaves its note out of what an older file is told, and tells the rest', () => {
    const j = migrate(v23({ version: LAST_GACHA_FORMAT - 1, trains: [{ id: 1 }] }));
    expect(j.loadedFrom).toBe(LAST_GACHA_FORMAT - 1);
    expect(j.migrationNotes).toHaveLength(1);
    expect(j.migrationNotes?.[0].startsWith(`v${LAST_GACHA_FORMAT - 1}→`)).toBe(true);
    expect(j.migrationNotes?.join(' ')).not.toMatch(/gacha/i);
  });

  it('still says where a newer file came from', () => {
    const j = migrate(v23({ version: SAVE_VERSION + 2 }));
    expect(j.loadedFrom).toBe(SAVE_VERSION + 2);
    expect(j.migrationNotes).toEqual([]);
  });
});

describe('a new save', () => {
  it('does not know the gacha: its section is no field of the format', () => {
    expect(KNOWN_SAVE_KEYS.has('gacha')).toBe(false);
  });

  it('is not written with a section the old file held', () => {
    const j = parseSave(text(v23()))!;
    const { version, savedAt, loadedFrom, migrationNotes, ...rest } = j;
    void [version, savedAt, loadedFrom, migrationNotes];
    const next = buildSave(rest as unknown as SaveParts, j);
    expect('gacha' in next).toBe(false);
    expect(readSaveText(JSON.stringify(next))).toEqual({ save: next });
  });
});

describe('the line Continue shows for an old file', () => {
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

  const NOW = 1790000600000;
  const line = (j: SaveGame) => {
    stored.set(SAVE_KEY, text(j));
    const meta = continueMeta()!;
    return continueText({ meta, live: false }, NOW);
  };

  it('is the line the same save shows in this format', () => {
    const now: SaveGame = { ...v23(), version: SAVE_VERSION };
    delete now.gacha;
    expect(line(v23())).toEqual(line(now));
    expect(line(v23()).format).toBeNull();
  });

  it('still marks a file some step has to tell the player about', () => {
    const older = v23({ version: SAVE_QUIET_VERSION - 1 });
    expect(line(older).format).toBe(formatNote(SAVE_QUIET_VERSION - 1));
    expect(line(older).format).not.toBeNull();
  });
});

describe('the quiet versions', () => {
  it('start past the last step that has something to tell', () => {
    const told = MIGRATIONS.filter((m) => !m.quiet).map((m) => m.from);
    expect(SAVE_QUIET_VERSION).toBe(Math.max(...told) + 1);
    expect(SAVE_QUIET_VERSION).toBeLessThanOrEqual(LAST_GACHA_FORMAT);
  });
});
