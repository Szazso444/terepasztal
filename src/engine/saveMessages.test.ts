import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  UNREADABLE_NOTICE_TTL,
  afterPurchase,
  groundAfterLoad,
  groundPassPending,
  loadStoresGround,
  purchaseGrows,
  startupToasts,
  type GroundReport,
  type ImplicitWrite,
  type PurchaseFacts,
  type Toast,
} from './saveMessages';
import {
  GROUND_KEY,
  SAVE_KEY,
  SAVE_VERSION,
  SLOTS_KEY,
  buildSave,
  freezeStoredSaves,
  readSaveText,
  withGround,
  type SaveParts,
  type SaveRefusal,
} from '../sim/save';
import { generatorOf } from '../sim/ground';
import { DEFAULT_MAP_PARAMS, emptyMap } from '../world/mapgen';
import { CHUNK_TILES, type MapGenerator } from '../world/chunks';
import { Terrain } from '../world/tiles';
import { STR } from '../strings';
import { forAll, shrinkArray } from '../testing/property';
import type { Rng } from './rng';

// The decisions the game makes about the writes it makes on its own and the saves it finds at
// start-up, as pure functions of what happened. Every input that matters is small, so each table
// is walked whole rather than sampled. That `Game` and `main.ts` show what these answer is pinned
// in gameSave.test.ts, on a stand-in game.

/** Every way a write the game makes on its own can end. */
const WRITES: ImplicitWrite[] = ['stored', 'storage', 'broken number', 'held'];
/** The texts that warn about an autosave; none is the answer to the write after a load. */
const AUTOSAVE_WARNINGS = [STR.settings.autosaveFailed, STR.settings.autosaveBroken];

/** A ground report with `added` chunks generated and `unreadable` chunks unread. */
function report(added: number, unreadable: number): GroundReport {
  const keys = (n: number, row: number) => Array.from({ length: n }, (_, i) => `${i},${row}`);
  return { added: keys(added, 0), unreadable: keys(unreadable, 1) };
}
/** Every ground a load can report: a level's (null) and generated ones of a few sizes. */
const GROUNDS: GroundReport[] = [null];
for (const added of [0, 1, 4])
  for (const unreadable of [0, 1, 3]) GROUNDS.push(report(added, unreadable));

// ------------------------------------------------------------------ the end of a load

describe('the end of a load', () => {
  it('stores the game exactly when the load generated ground', () => {
    for (const ground of GROUNDS)
      expect(loadStoresGround(ground), JSON.stringify(ground)).toBe(!!ground?.added.length);
    // ground stored but unreadable is kept as it was, not generated: it asks for no write
    expect(loadStoresGround(report(0, 5))).toBe(false);
  });

  it('gives unreadable ground one notice with the count, and nothing else does', () => {
    let seen = 0;
    for (const ground of GROUNDS)
      for (const write of [null, ...WRITES]) {
        const where = `${JSON.stringify(ground)} ${write}`;
        const said = groundAfterLoad(ground, write);
        const n = ground?.unreadable.length ?? 0;
        if (n === 0) {
          expect(said.notices, where).toEqual([]);
          continue;
        }
        seen++;
        const text = STR.saves.groundUnreadable(n);
        expect(said.notices, where).toEqual([
          { key: 'save:ground', text, ttl: UNREADABLE_NOTICE_TTL },
        ]);
        expect(
          said.toasts.filter((t) => t.text === text),
          where,
        ).toEqual([]);
      }
    expect(seen).toBeGreaterThan(0);
  });

  it('gives a write that did not store the game exactly one warning, worded for the ground', () => {
    for (const ground of GROUNDS)
      for (const write of [null, ...WRITES]) {
        const where = `${JSON.stringify(ground)} ${write}`;
        const said = groundAfterLoad(ground, write);
        const unreadable = ground?.unreadable.length ?? 0;
        const others = said.toasts.filter(
          (t) => unreadable === 0 || t.text !== STR.saves.groundUnreadable(unreadable),
        );
        const refused = write !== null && write !== 'stored';
        expect(others, where).toEqual(
          refused ? [{ text: STR.saves.groundUnsaved, kind: 'warn' }] : [],
        );
        // the autosave's own warnings are never the answer: one refusal, one warning
        for (const t of said.toasts) expect(AUTOSAVE_WARNINGS, where).not.toContain(t.text);
      }
    // worded for the ground, and for no particular cause, since any refusal gives it
    expect(STR.saves.groundUnsaved).toMatch(/ground/i);
    expect(STR.saves.groundUnsaved).not.toMatch(/broken|full|blocked/i);
  });

  it('says nothing about a level, nor about ground generated and stored', () => {
    expect(groundAfterLoad(null, null)).toEqual({ toasts: [], notices: [] });
    for (const added of [1, 4])
      expect(groundAfterLoad(report(added, 0), 'stored')).toEqual({ toasts: [], notices: [] });
  });
});

// ------------------------------------------------------------------ a chunk purchase

/** Every combination of what a purchase can find. */
const FACTS: PurchaseFacts[] = [];
for (const edge of [false, true])
  for (const implicitWrites of [false, true])
    for (const autosaves of [false, true]) FACTS.push({ edge, implicitWrites, autosaves });

const bought: Toast = { text: STR.overview.bought, kind: 'good' };
const growRefused: Toast = { text: STR.overview.growRefused, kind: 'warn' };
const growHeld: Toast = { text: STR.overview.growHeld, kind: 'warn' };
const growing: Toast = { text: STR.overview.growing, kind: 'info' };

describe('a chunk purchase', () => {
  it('grows the map on the edge, unless a loop error holds the write growing makes', () => {
    for (const f of FACTS)
      expect(purchaseGrows(f), JSON.stringify(f)).toBe(f.edge && f.implicitWrites);
  });

  it('does and says what each outcome of growing calls for', () => {
    for (const f of FACTS) {
      // the outcomes of growing the game can reach: tried and stored or refused, or not tried
      const outcomes = purchaseGrows(f) ? [true, false] : [null];
      for (const grown of outcomes) {
        const where = `${JSON.stringify(f)} grown ${grown}`;
        const after = afterPurchase(f, grown);
        expect(after.said.notices, where).toEqual([]);
        if (grown === true) {
          // the grown game holds the purchase: the page reloads into it and nothing else is said
          expect(after, where).toEqual({
            said: { toasts: [growing], notices: [] },
            reload: true,
            store: false,
          });
          continue;
        }
        expect(after.reload, where).toBe(false);
        const held = f.edge && !f.implicitWrites;
        expect(after.said.toasts, where).toEqual([
          ...(grown === false ? [growRefused] : []),
          bought,
          ...(held ? [growHeld] : []),
        ]);
        // stored at once where the autosave would store it, unless growing wrote it or tried to
        expect(after.store, where).toBe(!f.edge && f.autosaves);
      }
    }
  });

  it('says a refused growth write did not grow the map, and writes nothing more', () => {
    for (const f of FACTS.filter(purchaseGrows)) {
      const after = afterPurchase(f, false);
      expect(after.said.toasts, JSON.stringify(f)).toEqual([growRefused, bought]);
      expect(after.store).toBe(false);
      expect(after.reload).toBe(false);
    }
  });
});

// ------------------------------------------------------------------ start-up

describe('start-up', () => {
  const REFUSALS: (SaveRefusal | null)[] = [
    null,
    'json',
    'notSave',
    'damaged',
    'tooLarge',
    'storage',
  ];

  it('counts the saves the pass could not store with their ground in one warning', () => {
    for (const n of [0, 1, 2, 7, 40])
      for (const refused of REFUSALS) {
        const where = `refused ${n}, stored game ${refused}`;
        const toasts = startupToasts({ refused: n }, refused);
        const ground = toasts.filter((t) => t.text === STR.saves.groundRefused(n));
        expect(ground, where).toEqual(
          n > 0 ? [{ text: STR.saves.groundRefused(n), kind: 'warn' }] : [],
        );
      }
  });

  it('names a stored game refused for the size of its map, and no other refusal', () => {
    for (const n of [0, 3])
      for (const refused of REFUSALS) {
        const where = `refused ${n}, stored game ${refused}`;
        const toasts = startupToasts({ refused: n }, refused);
        expect(toasts.length, where).toBe((n > 0 ? 1 : 0) + (refused === 'tooLarge' ? 1 : 0));
        if (refused === 'tooLarge')
          expect(toasts.at(-1), where).toEqual({ text: STR.saves.refused.tooLarge, kind: 'warn' });
      }
  });
});

// ------------------------------------------------------------------ whether the pass has work

/**
 * An in-memory `localStorage`; `blocked` makes every read and write throw, as a blocked storage
 * does, and `full` every write, as a full one does.
 */
class MemoryStorage {
  items = new Map<string, string>();
  blocked = false;
  full = false;
  getItem(k: string) {
    if (this.blocked) throw new Error('SecurityError');
    return this.items.has(k) ? this.items.get(k)! : null;
  }
  setItem(k: string, v: string) {
    if (this.blocked) throw new Error('SecurityError');
    if (this.full) throw new Error('QuotaExceededError');
    this.items.set(k, String(v));
  }
  removeItem(k: string) {
    this.items.delete(k);
  }
}

/** A save whose generated world stores no ground: the kind the start-up pass gives it to. */
function lackingGround(seed: number, size = 64): string {
  const world = {
    kind: 'generated' as const,
    seed,
    params: { ...DEFAULT_MAP_PARAMS, w: size, h: size },
  };
  const parts = {
    seed,
    clock: { time: 900, speedIndex: 1 },
    economy: { money: 5000, tickets: 2, tier: 1, granted: [0], earned: 100 },
    track: [],
    stations: [],
    trains: [],
    contracts: { contracts: [] },
    inventory: { items: [], nextUid: 1 },
    camera: { x: 0, y: 0, zoomIndex: 2 },
    lastDay: 3,
    world,
    rules: {},
    regions: [true],
    supply: 'simple',
  } as unknown as SaveParts;
  return JSON.stringify(buildSave(parts));
}

describe('whether the start-up pass has work to do', () => {
  afterEach(() => vi.unstubAllGlobals());

  // slow because each of 48 combinations of pass state, Continue save, slots and storage runs the
  // start-up pass over generated maps: 0.42 s alone, so a limit of 30 s
  it('is yes whenever the pass gives a save its ground, and no only when it gives none', () => {
    const lacking = lackingGround(5);
    const continued: (string | null)[] = [null, lacking, '{oops'];
    const slots: (string | null)[] = [null, '{}', JSON.stringify({ a: lacking }), '{oops'];
    const seen = { worked: 0, idle: 0, idleYes: 0 };
    for (const done of [false, true])
      for (const c of continued)
        for (const s of slots)
          for (const blocked of [false, true]) {
            const where = `pass done ${done}, Continue ${c?.slice(0, 8)}, slots ${s?.slice(0, 8)}, blocked ${blocked}`;
            const store = new MemoryStorage();
            if (done) store.items.set(GROUND_KEY, String(SAVE_VERSION));
            if (c !== null) store.items.set(SAVE_KEY, c);
            if (s !== null) store.items.set(SLOTS_KEY, s);
            store.blocked = blocked;
            vi.stubGlobal('localStorage', store);
            const pending = groundPassPending();
            const before = [store.items.get(SAVE_KEY), store.items.get(SLOTS_KEY)];
            let maps = 0;
            const counting: MapGenerator = (seed, p) => {
              maps++;
              return generatorOf('simple')(seed, p);
            };
            const pass = freezeStoredSaves(() => counting);
            const touched = pass.frozen + pass.refused + pass.tooLarge;
            if (maps > 0 || touched > 0) {
              expect(pending, `${where}: the pass gave ground, the answer was no`).toBe(true);
              seen.worked++;
            } else {
              seen.idle++;
              if (pending) seen.idleYes++;
            }
            if (!pending) {
              expect(maps, where).toBe(0);
              expect(touched, where).toBe(0);
              expect([store.items.get(SAVE_KEY), store.items.get(SLOTS_KEY)], where).toEqual(
                before,
              );
            }
          }
    // both answers are reached, and a yes that finds nothing (text that holds no save) is allowed
    expect(seen.worked).toBeGreaterThan(0);
    expect(seen.idle).toBeGreaterThan(seen.idleYes);
  }, 30_000);

  it('is no once the pass has run, with no game stored, and when storage cannot be read', () => {
    const store = new MemoryStorage();
    vi.stubGlobal('localStorage', store);
    expect(groundPassPending()).toBe(false);
    store.items.set(SAVE_KEY, lackingGround(2));
    expect(groundPassPending()).toBe(true);
    store.items.set(GROUND_KEY, String(SAVE_VERSION));
    expect(groundPassPending()).toBe(false);
    store.items.delete(GROUND_KEY);
    store.blocked = true;
    expect(groundPassPending()).toBe(false);
    // storage the page may not even name
    vi.stubGlobal('localStorage', undefined);
    expect(groundPassPending()).toBe(false);
  });
});

// ------------------------------------------------------------------ the same, over any storage

/** What a stored save text can be, as the start-up pass meets it. */
type StoredKind = 'lacking' | 'grounded' | 'bundle' | 'tooLarge' | 'notSave' | 'damaged' | 'empty';
const STORED_KINDS: StoredKind[] = [
  'lacking',
  'grounded',
  'bundle',
  'tooLarge',
  'notSave',
  'damaged',
  'empty',
];
/** The slot table's text: a table of named saves (an entry may be no text at all), or not one. */
type SlotsText = { entries: (StoredKind | 'number')[] } | '{oops' | '[]' | 'null' | '5';

/** Every storage state the pass can meet, as a case: kinds, not texts, so a failure reads short. */
interface StorageCase {
  /** `GROUND_KEY`: null when the pass never ran, else what it holds ('' being no version at all) */
  flag: string | null;
  continued: StoredKind | null;
  slots: SlotsText | null;
  /** reads and writes throw */
  blocked: boolean;
  /** writes throw */
  full: boolean;
}

/** A generator that costs nothing and counts the maps it makes. */
function flatGround(count: { maps: number }): MapGenerator {
  return (seed, p) => {
    count.maps++;
    const q = { ...DEFAULT_MAP_PARAMS, ...p };
    return emptyMap(seed, q.w, q.h, Terrain.Grass, q.originX ?? 0, q.originY ?? 0);
  };
}

describe('whether the start-up pass has work to do, over any storage', () => {
  afterEach(() => vi.unstubAllGlobals());

  // one chunk a map, so the pass is quick; the texts are made once
  const lacking = lackingGround(5, CHUNK_TILES);
  const grounded = withGround(lacking, () => flatGround({ maps: 0 }))!;
  const TEXTS: Record<StoredKind, string> = {
    lacking,
    grounded,
    bundle: JSON.stringify({ diagnostics: 1, save: JSON.parse(lacking) }),
    // a map past MAX_WORLD_CHUNKS: refused, and nothing of it generated
    tooLarge: lackingGround(5, 33 * CHUNK_TILES),
    notSave: '{"hello":1}',
    damaged: '{oops',
    empty: '',
  };

  it('has save texts of the kinds it names', () => {
    expect(grounded).not.toBe(null);
    expect(withGround(grounded, () => flatGround({ maps: 0 }))).toBe(null);
    expect('save' in readSaveText(lacking)).toBe(true);
    expect('save' in readSaveText(TEXTS.bundle)).toBe(true);
    expect(readSaveText(TEXTS.tooLarge)).toEqual({ error: 'tooLarge' });
    expect(readSaveText(TEXTS.notSave)).toEqual({ error: 'notSave' });
    expect(readSaveText(TEXTS.damaged)).toEqual({ error: 'json' });
  });

  function genCase(rng: Rng): StorageCase {
    const slotsText = (): SlotsText =>
      rng.chance(0.7)
        ? {
            entries: Array.from({ length: rng.int(0, 4) }, () =>
              rng.chance(0.1) ? ('number' as const) : rng.pick(STORED_KINDS),
            ),
          }
        : rng.pick(['{oops', '[]', 'null', '5'] as const);
    return {
      flag: rng.chance(0.7) ? null : rng.pick(['', '18', String(SAVE_VERSION)]),
      continued: rng.chance(0.3) ? null : rng.pick(STORED_KINDS),
      slots: rng.chance(0.3) ? null : slotsText(),
      blocked: rng.chance(0.1),
      full: rng.chance(0.25),
    };
  }

  /** Simpler cases, simplest first: storage that works, fewer saves, no flag. */
  function* shrinkCase(c: StorageCase): Iterable<StorageCase> {
    if (c.blocked) yield { ...c, blocked: false };
    if (c.full) yield { ...c, full: false };
    if (c.flag !== null) yield { ...c, flag: null };
    if (c.continued !== null) yield { ...c, continued: null };
    if (c.slots !== null) yield { ...c, slots: null };
    if (c.slots !== null && typeof c.slots === 'object')
      for (const entries of shrinkArray(c.slots.entries)) yield { ...c, slots: { entries } };
  }

  function storageOf(c: StorageCase): MemoryStorage {
    const store = new MemoryStorage();
    if (c.flag !== null) store.items.set(GROUND_KEY, c.flag);
    if (c.continued !== null) store.items.set(SAVE_KEY, TEXTS[c.continued]);
    if (c.slots !== null) {
      const table =
        typeof c.slots === 'object'
          ? JSON.stringify(
              Object.fromEntries(
                c.slots.entries.map((k, i) => [`save ${i}`, k === 'number' ? 7 : TEXTS[k]]),
              ),
            )
          : c.slots;
      store.items.set(SLOTS_KEY, table);
    }
    store.blocked = c.blocked;
    store.full = c.full;
    return store;
  }

  it('is no only where the pass makes no map, stores nothing and changes no save', () => {
    const seen = { worked: 0, idle: 0, idleYes: 0, refusedYes: 0 };
    forAll(
      genCase,
      (c) => {
        const store = storageOf(c);
        vi.stubGlobal('localStorage', store);
        const pending = groundPassPending();
        const before = [store.items.get(SAVE_KEY), store.items.get(SLOTS_KEY)];
        const count = { maps: 0 };
        const pass = freezeStoredSaves(() => flatGround(count));
        const touched = pass.frozen + pass.refused + pass.tooLarge;
        const after = [store.items.get(SAVE_KEY), store.items.get(SLOTS_KEY)];
        if (!pending) {
          // a no never lets a pass with work run before the loading text is painted
          expect(count.maps, 'maps made after a no').toBe(0);
          expect(touched, 'saves counted after a no').toBe(0);
          expect(after, 'saves changed after a no').toEqual(before);
        } else {
          // a yes is never given to a pass that returns at once
          expect(pass.ran, 'a yes for a pass that did not run').toBe(true);
        }
        if (count.maps > 0 || touched > 0) seen.worked++;
        else {
          seen.idle++;
          if (pending) seen.idleYes++;
        }
        if (pending && pass.refused > 0) seen.refusedYes++;
      },
      { shrink: shrinkCase },
    );
    // the seeds reach a pass with work, one without, a yes that finds none, and a full storage
    for (const [branch, n] of Object.entries(seen)) expect(n, branch).toBeGreaterThan(0);
    expect(seen.idle).toBeGreaterThan(seen.idleYes);
  });

  it('is no after the pass has run on storage that keeps what it is given: one frame, once', () => {
    forAll(
      (rng) => ({ ...genCase(rng), blocked: false, full: false }),
      (c) => {
        const store = storageOf(c);
        vi.stubGlobal('localStorage', store);
        freezeStoredSaves(() => flatGround({ maps: 0 }));
        expect(groundPassPending(), 'a yes after the pass ran').toBe(false);
        // and the next start's pass has nothing to do
        const count = { maps: 0 };
        const again = freezeStoredSaves(() => flatGround(count));
        expect(again.ran, 'the pass ran twice').toBe(false);
        expect(count.maps, 'maps made by a second pass').toBe(0);
      },
      { shrink: (c) => Array.from(shrinkCase(c)).filter((d) => !d.blocked && !d.full) },
    );
  });
});
