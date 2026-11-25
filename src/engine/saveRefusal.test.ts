import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BrokenNumberWarning,
  StorageRefusalWarning,
  saveOutcome,
  type SaveOutcome,
} from './saveRefusal';
import { firstNonFinite, writeSave, writeSlot, type SaveGame } from '../sim/save';
import { forAll, shrinkArray, shrinkInt } from '../testing/property';
import type { Rng } from './rng';

// ------------------------------------------------------------------ storage and snapshots

/** An in-memory `localStorage` that can be made to refuse every write, as full storage does. */
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
function stubStorage(refuses: boolean) {
  const store = new MemoryStorage();
  store.refuses = refuses;
  vi.stubGlobal('localStorage', store);
  return store;
}
afterEach(() => vi.unstubAllGlobals());

/** One step into a value: a key of an object or a position in a list. */
type Step = string | number;
const NON_FINITE = ['NaN', 'Infinity', '-Infinity'] as const;
type NonFinite = (typeof NON_FINITE)[number];

/** Finite JSON-like data: numbers, strings, flags, nulls, lists and records, nested a little. */
function genData(rng: Rng, depth: number): unknown {
  const r = rng.next();
  if (depth <= 0 || r < 0.45)
    return rng.chance(0.3) ? rng.int(-800, 800) / 8 : rng.int(-1000, 1000);
  if (r < 0.55) return rng.pick(['farm', 'Alder', '', 'NaN', 'Infinity']);
  if (r < 0.6) return rng.pick([true, false, null]);
  if (r < 0.8) return Array.from({ length: rng.int(0, 4) }, () => genData(rng, depth - 1));
  const rec: Record<string, unknown> = {};
  for (let i = rng.int(0, 4); i > 0; i--) rec[rng.pick(KEYS)] = genData(rng, depth - 1);
  return rec;
}
const KEYS = ['money', 'level', 'stations', 'track', 'x', 'y', 'id', 'cargo', '2', 'rot'];

/** The paths of every number in a value, in the order of a walk down its lists and records. */
function numberPaths(value: unknown, path: Step[] = []): Step[][] {
  if (typeof value === 'number') return [path];
  if (Array.isArray(value)) return value.flatMap((v, i) => numberPaths(v, [...path, i]));
  if (typeof value === 'object' && value !== null)
    return Object.entries(value).flatMap(([k, v]) => numberPaths(v, [...path, k]));
  return [];
}
function at(value: unknown, path: readonly Step[]): unknown {
  return path.reduce<unknown>((v, s) => (v as Record<Step, unknown>)[s], value);
}
function setAt(value: unknown, path: readonly Step[], to: unknown) {
  (at(value, path.slice(0, -1)) as Record<Step, unknown>)[path[path.length - 1]] = to;
}

/** A snapshot as data: the finite value, and which of its numbers are to be broken, and how. */
interface Case {
  data: Record<string, unknown>;
  /** positions among the data's numbers, taken modulo their count */
  breaks: { at: number; to: NonFinite }[];
  /** storage full or blocked: every write throws */
  refuses: boolean;
}
function genCase(rng: Rng): Case {
  // a snapshot always holds a number at the top, so there is something to break
  const data = { savedAt: rng.int(0, 1e6), ...(genData(rng, 3) as object) } as Record<
    string,
    unknown
  >;
  const pBreak = rng.pick([0, 0, 0.5, 1]);
  const breaks = rng.chance(pBreak)
    ? Array.from({ length: rng.int(1, 3) }, () => ({
        at: rng.int(0, 40),
        to: rng.pick(NON_FINITE),
      }))
    : [];
  return { data, breaks, refuses: rng.chance(0.5) };
}
function* shrinkCase(c: Case): Iterable<Case> {
  for (const breaks of shrinkArray(c.breaks)) yield { ...c, breaks };
  if (c.refuses) yield { ...c, refuses: false };
  for (let i = 0; i < c.breaks.length; i++)
    for (const n of shrinkInt(c.breaks[i].at))
      yield { ...c, breaks: c.breaks.map((b, j) => (j === i ? { ...b, at: n } : b)) };
}
/** The snapshot of a case, with the path of each number it broke. */
function snapshotOf(c: Case): { snap: SaveGame; broken: Step[][] } {
  const snap = structuredClone(c.data);
  const paths = numberPaths(snap);
  const broken = c.breaks.map((b) => paths[b.at % paths.length]);
  c.breaks.forEach((b, i) => setAt(snap, broken[i], Number(b.to)));
  return { snap: snap as unknown as SaveGame, broken };
}

// ------------------------------------------------------------------ saveOutcome

describe('saveOutcome', () => {
  it('names the reason from the real writers: stored, storage, or a broken number', () => {
    // writeSave and writeSlot refuse a snapshot that holds a number JSON cannot write, and a
    // storage that is full or blocked; whatever the snapshot and the storage, the outcome is
    // decided by those two facts alone, and a stored save is neither refusal.
    const seen = {
      stored: 0,
      storage: 0,
      broken: 0,
      brokenAndFull: 0,
      slotBroken: 0,
      slotStorage: 0,
    };
    forAll(
      genCase,
      (c) => {
        const { snap, broken } = snapshotOf(c);
        const holdsBroken = broken.length > 0;
        const want: SaveOutcome['kind'] =
          !holdsBroken && !c.refuses ? 'stored' : holdsBroken ? 'broken number' : 'storage';
        for (const writer of ['save', 'slot'] as const) {
          const store = stubStorage(c.refuses);
          const stored = writer === 'save' ? writeSave(snap) : writeSlot('a name', snap);
          let asked = 0;
          const out = saveOutcome(stored, () => {
            asked++;
            return firstNonFinite(snap);
          });
          expect(out.kind, `${writer}: ${holdsBroken ? 'broken' : 'finite'}`).toBe(want);
          // the walk of the snapshot is paid for only by a write that failed
          expect(asked, `${writer}: the snapshot is walked once, after a failed write`).toBe(
            stored ? 0 : 1,
          );
          if (out.kind === 'broken number') {
            // the path leads to a number JSON cannot write, and nothing was written
            const there = at(snap, parsePath(out.path));
            expect(typeof there === 'number' && !Number.isFinite(there), out.path).toBe(true);
            expect(store.items.size, 'nothing written').toBe(0);
          }
          if (writer === 'slot') {
            seen.slotBroken += want === 'broken number' ? 1 : 0;
            seen.slotStorage += want === 'storage' ? 1 : 0;
          }
        }
        seen[want === 'broken number' ? 'broken' : want]++;
        if (holdsBroken && c.refuses) seen.brokenAndFull++;
      },
      { shrink: shrinkCase },
    );
    // the seeds reach every outcome, and the two causes together
    for (const [branch, n] of Object.entries(seen)) expect(n, branch).toBeGreaterThan(0);
  });

  it('is stored whenever the write was, whatever the finder says, and asks it nothing', () => {
    let asked = 0;
    const finder = () => {
      asked++;
      return 'economy.money';
    };
    expect(saveOutcome(true, finder)).toEqual({ kind: 'stored' });
    expect(asked).toBe(0);
  });

  it('is a broken number for any path from the finder, the empty path included, else storage', () => {
    expect(saveOutcome(false, () => 'economy.money')).toEqual({
      kind: 'broken number',
      path: 'economy.money',
    });
    expect(saveOutcome(false, () => 'track[3][1]')).toEqual({
      kind: 'broken number',
      path: 'track[3][1]',
    });
    // firstNonFinite gives '' when the snapshot is itself the number: still a broken number
    expect(saveOutcome(false, () => '')).toEqual({ kind: 'broken number', path: '' });
    expect(saveOutcome(false, () => null)).toEqual({ kind: 'storage' });
  });
});

/** A path as `firstNonFinite` writes it, back to steps: `a.b[0].c` is a, b, 0, c. */
function parsePath(path: string): Step[] {
  const out: Step[] = [];
  const re = /\[(\d+)\]|\.?([^.[\]]+)/g;
  for (let m = re.exec(path); m; m = re.exec(path)) out.push(m[1] !== undefined ? +m[1] : m[2]);
  return out;
}

// ------------------------------------------------------------------ BrokenNumberWarning

type Kind = SaveOutcome['kind'];
const KINDS: readonly Kind[] = ['stored', 'storage', 'broken number'];

/** Outcomes of a run of saves, from runs that never break to ones that mostly do. */
function genOutcomes(rng: Rng): Kind[] {
  const weights = rng.pick([
    [1, 1, 1],
    [6, 1, 1],
    [1, 6, 1],
    [1, 1, 6],
    [1, 0, 3],
    [0, 1, 4],
    [0, 0, 1],
  ]);
  const bag = KINDS.flatMap((k, i) => Array<Kind>(weights[i]).fill(k));
  return Array.from({ length: rng.int(0, 40) }, () => rng.pick(bag));
}

/** The warnings a latch for `reason` gives, read from the sequence alone. */
function oracleFor(reason: Exclude<Kind, 'stored'>, outcomes: readonly Kind[]): boolean[] {
  return outcomes.map((k, i) => {
    if (k !== reason) return false;
    // a refusal is warned about unless an earlier one for the same reason in the same stretch
    // (since the last stored save) already was
    const stretch = outcomes.slice(outcomes.slice(0, i).lastIndexOf('stored') + 1, i);
    return !stretch.includes(reason);
  });
}
/** The warnings the broken-number rule gives. */
function oracle(outcomes: readonly Kind[]): boolean[] {
  return oracleFor('broken number', outcomes);
}
function run(latch: { note(k: Kind): boolean }, outcomes: readonly Kind[]): boolean[] {
  return outcomes.map((k) => latch.note(k));
}

describe('BrokenNumberWarning', () => {
  it('warns exactly when a save is refused for a broken number and none was warned since a stored save', () => {
    const seen = { warned: 0, repeatSilenced: 0, rewarned: 0, storageBetween: 0, noBreak: 0 };
    forAll(
      genOutcomes,
      (outcomes) => {
        const got = run(new BrokenNumberWarning(), outcomes);
        const want = oracle(outcomes);
        got.forEach((w, i) => expect(w, `save ${i}, ${outcomes[i]}`).toBe(want[i]));

        // never for a stored save or a refusal by storage
        got.forEach((w, i) => {
          if (w) expect(outcomes[i], `warned at ${i}`).toBe('broken number');
        });
        // one warning per stretch of saves between stored ones that holds a break
        const stretches = outcomes
          .join(',')
          .split('stored')
          .filter((s) => s.includes('broken number')).length;
        expect(got.filter(Boolean).length, 'warnings').toBe(stretches);

        if (got.some(Boolean)) seen.warned++;
        else if (!outcomes.includes('broken number')) seen.noBreak++;
        if (stretches >= 2) seen.rewarned++;
        outcomes.forEach((k, i) => {
          if (k === 'broken number' && !got[i]) seen.repeatSilenced++;
          if (
            k === 'storage' &&
            outcomes.slice(0, i).includes('broken number') &&
            outcomes.slice(i).includes('broken number')
          )
            seen.storageBetween++;
        });
      },
      { shrink: (outcomes) => shrinkArray(outcomes) },
    );
    // the seeds reach every branch, including a refusal repeated after its warning, a stored
    // save lifting the latch, and storage failures inside a stretch (they must not lift it)
    for (const [branch, n] of Object.entries(seen)) expect(n, branch).toBeGreaterThan(0);
  });

  it('is silent for storage and stored saves from the start, and warns on the first break', () => {
    const latch = new BrokenNumberWarning();
    expect(run(latch, ['stored', 'storage', 'storage', 'stored'])).toEqual([
      false,
      false,
      false,
      false,
    ]);
    expect(latch.note('broken number')).toBe(true);
  });

  it('keeps quiet through storage failures and repeats, until some save is stored', () => {
    const latch = new BrokenNumberWarning();
    expect(
      run(latch, ['broken number', 'broken number', 'storage', 'broken number', 'storage']),
    ).toEqual([true, false, false, false, false]);
    expect(run(latch, ['stored', 'broken number', 'broken number'])).toEqual([false, true, false]);
  });

  it('is one latch per instance: a fresh one, as after a reload, starts unwarned', () => {
    // several games side by side, each outcome aimed at one of them; 'reload' replaces that one
    let reloadedWarned = 0;
    forAll(
      (rng) => {
        const games = rng.int(1, 3);
        return Array.from({ length: rng.int(0, 40) }, () => ({
          game: rng.int(0, games - 1),
          kind: rng.chance(0.1) ? ('reload' as const) : rng.pick(KINDS),
        }));
      },
      (steps) => {
        const latches = [0, 1, 2].map(() => new BrokenNumberWarning());
        const since: Kind[][] = [[], [], []];
        steps.forEach(({ game, kind }, i) => {
          if (kind === 'reload') {
            if (since[game].includes('broken number')) reloadedWarned++;
            latches[game] = new BrokenNumberWarning();
            since[game] = [];
            return;
          }
          const got = latches[game].note(kind);
          since[game].push(kind);
          expect(got, `step ${i}, ${kind} at game ${game}`).toBe(oracle(since[game]).at(-1));
        });
      },
      { shrink: (steps) => shrinkArray(steps) },
    );
    expect(reloadedWarned).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------------ StorageRefusalWarning

describe('StorageRefusalWarning', () => {
  it('warns exactly when a save is refused by storage and none was warned since a stored save', () => {
    const seen = { warned: 0, repeatSilenced: 0, rewarned: 0, brokenBetween: 0, noRefusal: 0 };
    forAll(
      genOutcomes,
      (outcomes) => {
        const got = run(new StorageRefusalWarning(), outcomes);
        const want = oracleFor('storage', outcomes);
        got.forEach((w, i) => expect(w, `save ${i}, ${outcomes[i]}`).toBe(want[i]));

        // never for a stored save or a refusal for a broken number
        got.forEach((w, i) => {
          if (w) expect(outcomes[i], `warned at ${i}`).toBe('storage');
        });
        // one warning per stretch of saves between stored ones that holds a storage refusal
        const stretches = outcomes
          .join(',')
          .split('stored')
          .filter((s) => s.includes('storage')).length;
        expect(got.filter(Boolean).length, 'warnings').toBe(stretches);

        if (got.some(Boolean)) seen.warned++;
        else if (!outcomes.includes('storage')) seen.noRefusal++;
        if (stretches >= 2) seen.rewarned++;
        outcomes.forEach((k, i) => {
          if (k === 'storage' && !got[i]) seen.repeatSilenced++;
          if (
            k === 'broken number' &&
            outcomes.slice(0, i).includes('storage') &&
            outcomes.slice(i).includes('storage')
          )
            seen.brokenBetween++;
        });
      },
      { shrink: (outcomes) => shrinkArray(outcomes) },
    );
    // the seeds reach every branch, including a refusal repeated after its warning, a stored save
    // lifting the latch, and broken numbers inside a stretch (they must not lift it)
    for (const [branch, n] of Object.entries(seen)) expect(n, branch).toBeGreaterThan(0);
  });

  it('is silent for broken numbers and stored saves from the start, and warns on the first refusal', () => {
    const latch = new StorageRefusalWarning();
    expect(run(latch, ['stored', 'broken number', 'broken number', 'stored'])).toEqual([
      false,
      false,
      false,
      false,
    ]);
    expect(latch.note('storage')).toBe(true);
  });

  it('keeps quiet through broken numbers and repeats, until some save is stored', () => {
    const latch = new StorageRefusalWarning();
    expect(run(latch, ['storage', 'storage', 'broken number', 'storage', 'broken number'])).toEqual(
      [true, false, false, false, false],
    );
    expect(run(latch, ['stored', 'storage', 'storage'])).toEqual([false, true, false]);
  });

  it('is its own latch: beside the broken-number one, each follows its rule and they never both warn', () => {
    // the game feeds every outcome to both; neither one's warning silences or sets off the other
    const seen = { both: 0, storageAfterBroken: 0, brokenAfterStorage: 0 };
    forAll(
      genOutcomes,
      (outcomes) => {
        const broken = new BrokenNumberWarning();
        const storage = new StorageRefusalWarning();
        const got = outcomes.map((k) => [broken.note(k), storage.note(k)] as const);
        const wantBroken = oracle(outcomes);
        const wantStorage = oracleFor('storage', outcomes);
        got.forEach(([b, st], i) => {
          expect(b, `save ${i}, ${outcomes[i]}: broken number`).toBe(wantBroken[i]);
          expect(st, `save ${i}, ${outcomes[i]}: storage`).toBe(wantStorage[i]);
          expect(b && st, `save ${i}: one warning at most`).toBe(false);
        });
        const firstB = got.findIndex(([b]) => b);
        const firstS = got.findIndex(([, st]) => st);
        if (firstB >= 0 && firstS >= 0) seen.both++;
        if (firstB >= 0 && firstS > firstB) seen.storageAfterBroken++;
        if (firstS >= 0 && firstB > firstS) seen.brokenAfterStorage++;
      },
      { shrink: (outcomes) => shrinkArray(outcomes) },
    );
    for (const [branch, n] of Object.entries(seen)) expect(n, branch).toBeGreaterThan(0);
  });

  it('is one latch per instance: a fresh one, as after a reload, starts unwarned', () => {
    const latch = new StorageRefusalWarning();
    expect(run(latch, ['storage', 'storage'])).toEqual([true, false]);
    expect(run(new StorageRefusalWarning(), ['storage', 'storage'])).toEqual([true, false]);
  });
});

// ------------------------------------------------------------------ the two together

describe('a refused save through the real writers', () => {
  it('warns once per stretch of autosaves refused for a broken number, whatever storage does', () => {
    // Each minute's autosave is a snapshot that holds a broken number or not, against storage that
    // refuses or not; the warning follows the outcome the real `writeSave` gives, not the inputs.
    interface Minute {
      broken: boolean;
      full: boolean;
    }
    let warnings = 0;
    forAll(
      (rng): Minute[] => {
        const pBroken = rng.pick([0.1, 0.5, 0.9]);
        const pFull = rng.pick([0, 0.3, 0.8]);
        return Array.from({ length: rng.int(0, 30) }, () => ({
          broken: rng.chance(pBroken),
          full: rng.chance(pFull),
        }));
      },
      (minutes) => {
        const latch = new BrokenNumberWarning();
        const kinds: Kind[] = [];
        const shown = minutes.map(({ broken, full }) => {
          stubStorage(full);
          const snap = { savedAt: broken ? Number.NaN : 1, economy: { money: 5 } } as SaveGame;
          const out = saveOutcome(writeSave(snap), () => firstNonFinite(snap));
          kinds.push(out.kind);
          return latch.note(out.kind);
        });
        // the outcomes are the facts, and the warnings follow the rule over them
        minutes.forEach(({ broken, full }, i) =>
          expect(kinds[i]).toBe(broken ? 'broken number' : full ? 'storage' : 'stored'),
        );
        expect(shown).toEqual(oracle(kinds));
        warnings += shown.filter(Boolean).length;
      },
      { shrink: (minutes) => shrinkArray(minutes) },
    );
    expect(warnings).toBeGreaterThan(0);
  });

  it('warns once per stretch of autosaves refused by storage, whatever the numbers hold', () => {
    // A stored game that outgrows storage is refused every minute: the player hears it once, and
    // again only after some save has gone through. The outcome is the real `writeSave`'s.
    interface Minute {
      broken: boolean;
      full: boolean;
    }
    const seen = { warned: 0, silenced: 0, brokenWhileFull: 0 };
    forAll(
      (rng): Minute[] => {
        const pBroken = rng.pick([0, 0.2, 0.6]);
        const pFull = rng.pick([0.3, 0.7, 1]);
        return Array.from({ length: rng.int(0, 30) }, () => ({
          broken: rng.chance(pBroken),
          full: rng.chance(pFull),
        }));
      },
      (minutes) => {
        const latch = new StorageRefusalWarning();
        const kinds: Kind[] = [];
        const shown = minutes.map(({ broken, full }) => {
          stubStorage(full);
          const snap = { savedAt: broken ? Number.NaN : 1, economy: { money: 5 } } as SaveGame;
          const out = saveOutcome(writeSave(snap), () => firstNonFinite(snap));
          kinds.push(out.kind);
          return latch.note(out.kind);
        });
        expect(shown).toEqual(oracleFor('storage', kinds));
        seen.warned += shown.filter(Boolean).length;
        seen.silenced += kinds.filter((k, i) => k === 'storage' && !shown[i]).length;
        // a broken number in full storage is a broken number, and leaves the storage latch alone
        seen.brokenWhileFull += minutes.filter((m) => m.broken && m.full).length;
      },
      { shrink: (minutes) => shrinkArray(minutes) },
    );
    for (const [branch, n] of Object.entries(seen)) expect(n, branch).toBeGreaterThan(0);
  });
});
