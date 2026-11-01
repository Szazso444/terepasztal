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
import { Economy } from './economy';
import { continueText, formatNote } from '../ui/saveSlots';

/** The format the last build with a gacha and tickets wrote. */
const LAST_GACHA_FORMAT = 23;

/**
 * A file as the last build with a gacha wrote it: its gacha section, the tickets in the economy
 * and on a contract, and a little of everything else. Written out by hand so it stays that shape
 * when the build it describes is gone.
 */
function contract(id: number, tickets: number) {
  return {
    id,
    templateId: 'local',
    name: 'Local haul',
    rarity: 'rare',
    cargo: 'wood',
    amount: 20,
    delivered: 4,
    originId: 1,
    destId: 2,
    payout: 900,
    tickets,
    duration: 300,
    expires: 2000,
    acceptedAt: 1000,
    status: 'active',
    trainId: null,
  };
}
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
    contracts: {
      contracts: [contract(1, 6), contract(2, 0)],
      nextId: 3,
      nextRefresh: 40,
      stats: { completed: 0, failed: 0 },
      completedToday: 2,
      rng: 5,
    },
    inventory: {
      items: [
        {
          uid: 1,
          defId: 'rocket',
          kind: 'loco',
          level: 2,
          assigned: null,
          dupes: 3,
          obtainedAt: 5,
        },
      ],
      nextUid: 2,
    },
    gacha: { pity: 7, totalPulls: 31, rng: 99 },
    camera: { x: 10, y: 20, zoomIndex: 3 },
    lastDay: 42,
    rules: { startMoney: 40000, startTickets: 9, payoutMul: 2 },
    ...over,
  } as unknown as SaveGame;
}
const text = (j: SaveGame) => JSON.stringify(j);

/** The notes of the steps after this one, which a file of v23 is told. */
const LATER_NOTES = MIGRATIONS.filter((m) => m.from > LAST_GACHA_FORMAT && !m.quiet).length;

describe('the step from v23', () => {
  const step = () => MIGRATIONS.find((m) => m.from === LAST_GACHA_FORMAT)!;

  it('takes the gacha and every ticket out of the file, and nothing else', () => {
    const before = v23();
    const after = migrate(v23());
    expect(after.version).toBe(SAVE_VERSION);
    expect('gacha' in after).toBe(false);
    expect(after.economy).toEqual({ money: 12345, tier: 2, earned: 9000, hsUnlocked: true });
    expect(after.rules).toEqual({ startMoney: 40000, payoutMul: 2 });
    const { tickets: _, ...plain } = contract(1, 6);
    void _;
    expect(after.contracts).toEqual({
      contracts: [
        { ...plain, id: 1 },
        { ...plain, id: 2 },
      ],
      nextId: 3,
      nextRefresh: 40,
      stats: { completed: 0, failed: 0 },
      rng: 5,
    });
    expect(after.inventory).toEqual({
      items: [{ uid: 1, defId: 'rocket', kind: 'loco', level: 2, assigned: null, obtainedAt: 5 }],
      nextUid: 2,
    });
    expect(JSON.stringify(after)).not.toMatch(/ticket|gacha|granted|completedToday|dupes/i);
    const changed = ['gacha', 'economy', 'rules', 'contracts', 'inventory', 'version'];
    for (const key of Object.keys(before))
      if (!changed.includes(key)) expect(after[key], key).toEqual(before[key]);
  });

  it('takes the tickets out of the level a level game carries', () => {
    const level = { id: 'l', w: 8, h: 8, start: { money: 5, tickets: 3, tier: 1 } };
    const j = migrate(v23({ world: { kind: 'level', seed: 777, level } }));
    expect(j.world).toEqual({
      kind: 'level',
      seed: 777,
      level: { ...level, start: { money: 5, tier: 1 } },
    });
  });

  it('refunds nothing: the money stands as the file held it', () => {
    expect(migrate(v23()).economy.money).toBe(12345);
  });

  it.each([
    ['no gacha section', (j: Record<string, unknown>) => delete j.gacha],
    ['no rules', (j: Record<string, unknown>) => delete j.rules],
    ['no world', (j: Record<string, unknown>) => delete j.world],
    ['an inventory of no shape', (j: Record<string, unknown>) => (j.inventory = 'x')],
    ['no item list', (j: Record<string, unknown>) => (j.inventory = { nextUid: 1 })],
    ['an item of no shape', (j: Record<string, unknown>) => (j.inventory = { items: [1] })],
    ['contracts of no shape', (j: Record<string, unknown>) => (j.contracts = 'x')],
    ['no contract list', (j: Record<string, unknown>) => (j.contracts = { nextId: 1 })],
    ['a contract of no shape', (j: Record<string, unknown>) => (j.contracts = { contracts: [1] })],
    [
      'a world with no level',
      (j: Record<string, unknown>) => (j.world = { kind: 'level', seed: 7 }),
    ],
  ])('runs on a file with %s too', (_, edit) => {
    const j = v23();
    edit(j);
    expect(() => migrate(j)).not.toThrow();
  });

  it.each([
    ['no tickets at all', ''],
    ['tickets of no number', '"tickets":"many",'],
    ['tickets the file cannot hold', '"tickets":1e999,'],
  ])('loads a file with %s: its value is gone either way', (_, tickets) => {
    const raw = text(v23());
    expect(raw).toContain('"tickets":17,');
    const read = readSaveText(raw.replace('"tickets":17,', tickets));
    expect('save' in read && read.save.economy.money).toBe(12345);
  });

  it('is quiet: the file loads with no note and no mark of another format', () => {
    expect(step().quiet).toBe(true);
    const j = parseSave(text(v23()))!;
    expect(j.migrationNotes).toHaveLength(LATER_NOTES);
    expect(j.migrationNotes?.join(' ')).not.toMatch(/gacha/i);
  });

  it('leaves its note out of what an older file is told, and tells the rest', () => {
    const j = migrate(v23({ version: LAST_GACHA_FORMAT - 1, trains: [{ id: 1 }] }));
    expect(j.loadedFrom).toBe(LAST_GACHA_FORMAT - 1);
    expect(j.migrationNotes).toHaveLength(1 + LATER_NOTES);
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

  it('holds no ticket: its economy reads without one', () => {
    const j = v23({ version: SAVE_VERSION });
    delete j.gacha;
    const economy = j.economy as unknown as Record<string, unknown>;
    delete economy.tickets;
    delete economy.granted;
    expect(parseSave(text(j))?.economy).toEqual(economy);
  });

  it('is written by an economy that keeps no ticket and no ticket book', () => {
    const e = new Economy();
    e.setAge(2);
    const j = e.toJSON();
    expect(Object.keys(j).sort()).toEqual(['earned', 'hsUnlocked', 'money', 'tier']);
    const back = new Economy();
    back.load({ ...j, tickets: 40, granted: [1] } as typeof j);
    expect(back.toJSON()).toEqual(j);
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

  it('in this format marks nothing', () => {
    const now: SaveGame = { ...v23(), version: SAVE_VERSION };
    delete now.gacha;
    expect(line(now).format).toBeNull();
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
  });
});
