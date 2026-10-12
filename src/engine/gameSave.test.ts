import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Game } from '../game';
import { AutosavePause } from './autosavePause';
import { BrokenNumberWarning, StorageRefusalWarning } from './saveRefusal';
import { SAVE_KEY, type SaveGame } from '../sim/save';
import { STR } from '../strings';
import { forAll, shrinkArray } from '../testing/property';
import type { Rng } from './rng';

// What `Game.save` and `Game.saveSlot` make of an outcome: the toast, the console, the latch. The
// rules themselves (`saveOutcome`, `BrokenNumberWarning`, `StorageRefusalWarning`) are pinned in
// saveRefusal.test.ts; this file pins that the game calls them and shows what they say. A `Game` cannot be constructed under
// Node (its `Toasts` build DOM), but its methods run on a stand-in that has the prototype and
// only the fields they read, so the real `save`, `saveSlot` and their helpers are what is tested.

class MemoryStorage {
  items = new Map<string, string>();
  refuses = false;
  getItem(k: string) {
    return this.items.has(k) ? this.items.get(k)! : null;
  }
  setItem(k: string, v: string) {
    if (this.refuses) throw new Error('QuotaExceededError');
    this.items.set(k, String(v));
  }
  removeItem(k: string) {
    this.items.delete(k);
  }
}

interface Toast {
  text: string;
  kind: string;
}

/** A Game with the prototype's methods and the fields save and saveSlot read, and no DOM. */
function standIn() {
  const toasts: Toast[] = [];
  const pause = new AutosavePause();
  const host: Record<string, unknown> = Object.create(Game.prototype);
  let current: SaveGame = base(0);
  Object.assign(host, {
    keepStoredSave: false,
    autosavePause: pause,
    brokenNumberWarning: new BrokenNumberWarning(),
    storageRefusalWarning: new StorageRefusalWarning(),
    savedAt: null,
    toasts: { push: (text: string, kind: string) => toasts.push({ text, kind }) },
    snapshot: () => current,
  });
  return {
    game: host as unknown as Game,
    host,
    toasts,
    pause,
    /** The snapshot the game takes next. */
    take(snap: SaveGame) {
      current = snap;
    },
  };
}

/** A finite snapshot with numbers at several depths; `n` makes each one's `savedAt` its own. */
function base(n: number): SaveGame {
  return {
    savedAt: 1000 + n,
    economy: { money: 50, debt: 0 },
    stations: [
      { id: 1, cargo: [3, 4] },
      { id: 2, cargo: [5] },
    ],
    track: [
      [0, 1, 2],
      [3, 4, 5],
    ],
  } as unknown as SaveGame;
}
/** Numbers to break, with the path `firstNonFinite` names for each. */
const SPOTS: { path: string; set: (s: SaveGame, to: number) => void }[] = [
  { path: 'savedAt', set: (s, to) => ((s as unknown as { savedAt: number }).savedAt = to) },
  { path: 'economy.money', set: (s, to) => ((rec(s).economy as { money: number }).money = to) },
  {
    path: 'stations[1].cargo[0]',
    set: (s, to) => ((rec(s).stations as { cargo: number[] }[])[1].cargo[0] = to),
  },
  { path: 'track[1][2]', set: (s, to) => ((rec(s).track as number[][])[1][2] = to) },
];
function rec(s: SaveGame) {
  return s as unknown as Record<string, unknown>;
}
const BROKEN = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];

let store: MemoryStorage;
let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  store = new MemoryStorage();
  vi.stubGlobal('localStorage', store);
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const stored = () => JSON.stringify([...store.items]);

describe('the texts of a refused save', () => {
  it('say the game holds a broken value and the last save is kept, without a word of storage', () => {
    for (const text of [STR.settings.saveBroken, STR.settings.autosaveBroken]) {
      expect(text).toMatch(/broken value/i);
      expect(text).toMatch(/last save is kept/i);
      expect(text).not.toMatch(/storage|full|blocked/i);
    }
    // and none is another text, so a refused autosave cannot show the manual one by accident
    const all = [
      STR.settings.saved,
      STR.settings.saveFailed,
      STR.settings.saveBroken,
      STR.settings.autosaveBroken,
      STR.settings.autosaveFailed,
    ];
    expect(new Set(all).size).toBe(all.length);
  });

  it('say storage refused a silent save and progress is not kept, without a word of broken values', () => {
    const text = STR.settings.autosaveFailed;
    expect(text).toMatch(/storage/i);
    expect(text).toMatch(/full or blocked/i);
    expect(text).toMatch(/not kept/i);
    expect(text).not.toMatch(/broken/i);
  });
});

// ------------------------------------------------------------------ Game.save and Game.saveSlot

type Op = 'manual' | 'implicit' | 'slot' | 'trip';
interface Step {
  op: Op;
  /** which of SPOTS holds a broken number, or none */
  spot: number | null;
  to: number;
  /** storage full or blocked for this write */
  full: boolean;
}
function genSteps(rng: Rng): Step[] {
  const pBroken = rng.pick([0.2, 0.5, 0.8]);
  const pFull = rng.pick([0, 0.3, 0.7]);
  return Array.from({ length: rng.int(0, 25) }, () => ({
    op: rng.pick(['manual', 'implicit', 'implicit', 'slot', 'trip'] as const),
    spot: rng.chance(pBroken) ? rng.int(0, SPOTS.length - 1) : null,
    to: rng.pick(BROKEN),
    full: rng.chance(pFull),
  }));
}

describe('Game.save and Game.saveSlot', () => {
  it('show, log and warn as the rules say, for any run of saves, refusals and loop errors', () => {
    const seen = {
      stored: 0,
      storageToast: 0,
      brokenToast: 0,
      autosaveWarned: 0,
      autosaveSilenced: 0,
      autosaveStorageWarned: 0,
      autosaveStorageSilenced: 0,
      pausedSkipped: 0,
      manualAfterPause: 0,
      slotBroken: 0,
    };
    forAll(
      genSteps,
      (steps) => {
        store = new MemoryStorage();
        vi.stubGlobal('localStorage', store);
        warn.mockClear();
        const g = standIn();
        // The model of the game, read from the steps alone: a latch for each reason. A manual save
        // or a slot refused counts as the warning shown, so the autosave after it stays silent.
        let warned = false;
        let warnedStorage = false;
        steps.forEach((step, i) => {
          const where = `step ${i}: ${step.op}`;
          if (step.op === 'trip') {
            g.pause.trip();
            return;
          }
          const snap = base(i + 1);
          if (step.spot !== null) SPOTS[step.spot].set(snap, step.to);
          g.take(snap);
          store.refuses = step.full;
          const paused = g.pause.paused;
          const before = stored();
          const shown = g.toasts.length;
          const logged = warn.mock.calls.length;
          const savedAt = g.host.savedAt;
          const result =
            step.op === 'slot' ? g.game.saveSlot('a name') : g.game.save(step.op === 'implicit');
          const texts = g.toasts.slice(shown);

          if (step.op === 'implicit' && paused) {
            // a loop error stops implicit saves: nothing is written, said or logged
            expect(result, where).toBe(false);
            expect(texts, where).toEqual([]);
            expect(stored(), where).toBe(before);
            expect(warn.mock.calls.length, where).toBe(logged);
            seen.pausedSkipped++;
            return;
          }
          if (step.op === 'manual' && paused) seen.manualAfterPause++;

          const out = step.spot !== null ? 'broken' : step.full ? 'storage' : 'stored';
          expect(result, where).toBe(out === 'stored');

          // the toast
          if (step.op === 'implicit') {
            const warns = out === 'broken' && !warned;
            const warnsStorage = out === 'storage' && !warnedStorage;
            expect(texts, where).toEqual(
              warns
                ? [{ text: STR.settings.autosaveBroken, kind: 'warn' }]
                : warnsStorage
                  ? [{ text: STR.settings.autosaveFailed, kind: 'warn' }]
                  : [],
            );
            if (warns) seen.autosaveWarned++;
            else if (out === 'broken') seen.autosaveSilenced++;
            if (warnsStorage) seen.autosaveStorageWarned++;
            else if (out === 'storage') seen.autosaveStorageSilenced++;
          } else {
            const want: Toast =
              out === 'stored'
                ? {
                    text:
                      step.op === 'slot' ? STR.settings.slotSaved('a name') : STR.settings.saved,
                    kind: 'good',
                  }
                : {
                    text: out === 'storage' ? STR.settings.saveFailed : STR.settings.saveBroken,
                    kind: 'warn',
                  };
            expect(texts, where).toEqual([want]);
            if (out === 'broken' && step.op === 'slot') seen.slotBroken++;
          }
          if (out === 'stored') seen.stored++;
          if (out === 'storage' && step.op !== 'implicit') seen.storageToast++;
          if (out === 'broken' && step.op !== 'implicit') seen.brokenToast++;

          // the console: the path of the first broken number, once, never in a toast
          if (out === 'broken') {
            expect(warn.mock.calls.length, `${where}: one console.warn`).toBe(logged + 1);
            expect(String(warn.mock.calls[logged][0]), where).toContain(SPOTS[step.spot!].path);
            for (const t of texts) expect(t.text, where).not.toContain(SPOTS[step.spot!].path);
          } else {
            expect(warn.mock.calls.length, `${where}: no console.warn`).toBe(logged);
          }

          // the store: a refusal leaves what was stored before; a stored save is written
          if (out === 'stored') {
            expect(stored(), where).not.toBe(before);
            if (step.op !== 'slot')
              expect(store.items.get(SAVE_KEY), where).toBe(JSON.stringify(snap));
          } else {
            expect(stored(), `${where}: the last save is kept`).toBe(before);
          }
          // the settings screen's "saved at" moves on a stored save only
          if (step.op !== 'slot')
            expect(g.host.savedAt, where).toBe(out === 'stored' ? snap.savedAt : savedAt);

          // the latches, by the model
          if (out === 'stored') warned = warnedStorage = false;
          else if (out === 'broken') warned = true;
          else warnedStorage = true;
        });
      },
      { shrink: (steps) => shrinkArray(steps) },
    );
    // the seeds reach every branch the properties are about
    for (const [branch, n] of Object.entries(seen)) expect(n, branch).toBeGreaterThan(0);
  });

  it('writes nothing, says nothing and feeds no latch while the page reloads into a stored save', () => {
    const g = standIn();
    g.host.keepStoredSave = true;
    const snap = base(1);
    SPOTS[1].set(snap, Number.NaN);
    g.take(snap);
    expect(g.game.save(false)).toBe(false);
    expect(g.game.save(true)).toBe(false);
    expect(g.toasts).toEqual([]);
    expect(store.items.size).toBe(0);
    expect(warn).not.toHaveBeenCalled();
    // the latch was not fed: with the reload over, the first autosave refused still warns
    g.host.keepStoredSave = false;
    expect(g.game.save(true)).toBe(false);
    expect(g.toasts).toEqual([{ text: STR.settings.autosaveBroken, kind: 'warn' }]);
    // and the same for storage: refusals while reloading feed nothing, the first one after warns
    g.toasts.length = 0;
    g.host.keepStoredSave = true;
    g.take(base(2));
    store.refuses = true;
    expect(g.game.save(true)).toBe(false);
    expect(g.toasts).toEqual([]);
    g.host.keepStoredSave = false;
    expect(g.game.save(true)).toBe(false);
    expect(g.toasts).toEqual([{ text: STR.settings.autosaveFailed, kind: 'warn' }]);
  });
});
