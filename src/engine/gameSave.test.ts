import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Game } from '../game';
import { AutosavePause } from './autosavePause';
import { BrokenNumberWarning, StorageRefusalWarning } from './saveRefusal';
import { UNREADABLE_NOTICE_TTL } from './saveMessages';
import { SAVE_KEY, SAVE_MIN_VERSION, SLOTS_KEY, readSaveText, type SaveGame } from '../sim/save';
import { rules, DEFAULT_RULES } from '../sim/rules';
import { setSupplyMode, DEFAULT_SUPPLY } from '../sim/supply';
import { setSeasonOffset } from '../sim/weather';
import { resetStationIds } from '../sim/stations';
import { resetTrainIds } from '../sim/trains';
import { CHUNK_TILES, expandSave, ownsBorderChunk } from '../sim/expand';
import { unbuildable } from '../sim/build';
import { Commands } from '../sim/commands';
import type { HistoryStep } from '../sim/history';
import { INTENT_KEY, type Intent } from '../intent';
import { bootPlan } from './boot';
import { MAX_WORLD_CHUNKS } from '../sim/ground';
import { RegionState } from '../world/regions';
import { emptyMap } from '../world/mapgen';
import { Terrain, type GameMap } from '../world/tiles';
import { STR } from '../strings';
import { forAll, shrinkArray } from '../testing/property';
import { simWorld, line, station, mapParams, type SimWorld } from '../testing/simWorld';
import { townWith } from '../testing/storeFixtures';
import { startStock } from '../sim/step';
import type { Rng } from './rng';

// a purchase plays a sound; the context that plays it is a browser's
vi.mock('./audio', async (original) => ({
  ...(await original<typeof import('./audio')>()),
  sfx: vi.fn(),
}));

// What `Game.save` and `Game.saveSlot` make of an outcome: the toast, the console, the latch. The
// rules themselves (`saveOutcome`, `BrokenNumberWarning`, `StorageRefusalWarning`) are pinned in
// saveRefusal.test.ts, and what the end of a load and a purchase say in saveMessages.test.ts;
// this file pins that the game calls them and shows what they say. A `Game` cannot be constructed
// under Node (its `Toasts` build DOM), but its methods run on a stand-in that has the prototype
// and only the fields they read, so the real `save`, `saveSlot` and their helpers are what is
// tested.

class MemoryStorage {
  items = new Map<string, string>();
  refuses = false;
  /** the longest text it keeps: room for some saves and not for larger ones */
  limit = Number.POSITIVE_INFINITY;
  getItem(k: string) {
    return this.items.has(k) ? this.items.get(k)! : null;
  }
  setItem(k: string, v: string) {
    if (this.refuses || String(v).length > this.limit) throw new Error('QuotaExceededError');
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

/** A notice the game pushed, with the lifetime it was given. */
interface PushedNotice {
  key: string;
  kind: string;
  text: string;
  target: unknown;
  ttl: number;
}

/** A Game with the prototype's methods and the fields save and saveSlot read, and no DOM. */
function standIn() {
  const toasts: Toast[] = [];
  const notices: PushedNotice[] = [];
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
    notices: {
      push: (n: Omit<PushedNotice, 'ttl'>, ttl: number) => notices.push({ ...n, ttl }),
    },
    snapshot: () => current,
  });
  return {
    game: host as unknown as Game,
    host,
    toasts,
    notices,
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

// ------------------------------------------------------------------ reloads into a stored save

describe('Game.loadSlot, Game.loadSave and Game.importSave', () => {
  /** A save in the oldest format a load still reads, as a slot or a file the player has. */
  const SAVED = JSON.stringify({
    version: SAVE_MIN_VERSION,
    savedAt: 1700000000000,
    seed: 12345,
    clock: { time: 0, speedIndex: 1 },
    economy: { money: 1000, tickets: 0, tier: 0, granted: [] },
    track: [],
    stations: [],
    trains: [],
    contracts: { contracts: [] },
    inventory: { items: [] },
    gacha: {},
    camera: { x: 0, y: 0, zoomIndex: 2 },
    lastDay: 0,
  });

  it.each(['a save slot', 'the stored game', 'an imported save'] as const)(
    'reload straight into play with %s',
    (way) => {
      const session = new MemoryStorage();
      vi.stubGlobal('sessionStorage', session);
      const reload = vi.fn();
      vi.stubGlobal('location', { hash: '#from-before', reload });
      const g = standIn();
      const stop = vi.fn();
      Object.assign(g.host, { loop: { stop }, tooltip: { stack: { closeAll: vi.fn() } } });
      if (way === 'a save slot') {
        store.setItem(SLOTS_KEY, JSON.stringify({ mine: SAVED }));
        expect(g.game.loadSlot('mine')).toBe(true);
      } else if (way === 'the stored game') {
        store.setItem(SAVE_KEY, SAVED);
        expect(g.game.loadSave()).toBe(true);
      } else expect(g.game.importSave(SAVED)).toEqual({ ok: true });

      // the game it reloads into is the stored one, and the game being left does not save over it
      expect((JSON.parse(store.getItem(SAVE_KEY)!) as SaveGame).seed).toBe(12345);
      expect(g.host.keepStoredSave).toBe(true);
      expect(stop).toHaveBeenCalledTimes(1);
      expect(reload).toHaveBeenCalledTimes(1);
      // the boot carries the intent out: the stored game, the loading screen, then the reveal,
      // with the music as loading finishes, since the player clicked to load
      const intent = JSON.parse(session.getItem(INTENT_KEY)!) as Intent;
      expect(intent).toEqual({ action: 'continue' });
      expect(bootPlan(intent)).toEqual({
        loading: true,
        reveal: true,
        clickToBegin: true,
        music: 'loaded',
      });
    },
  );
});

// ------------------------------------------------------------------ Game.buyChunk

describe('Game.buyChunk', () => {
  const MONEY = 100_000;
  /**
   * A game on a 5 x 5 chunk grid that owns its start chunk, in the middle. Every chunk next to it
   * is an inner one; the ring beyond lies on the grid's edge. The snapshot a save takes holds the
   * ownership and the money, so a stored save shows what the purchase did.
   */
  function buying(
    over: {
      autosave?: boolean;
      mode?: 'play' | 'editor';
      kind?: 'generated' | 'level';
      size?: number;
      /** a map of that size to share: a purchase reads its frame and never changes it */
      map?: GameMap;
    } = {},
  ) {
    const g = standIn();
    const size = over.size ?? 160;
    const map = over.map ?? emptyMap(1, size, size);
    const regions = new RegionState(map, 0);
    const economy = {
      money: MONEY,
      canAfford(price: number) {
        return this.money >= price;
      },
    };
    Object.assign(g.host, {
      regions,
      economy,
      map,
      spec: { kind: over.kind ?? 'generated' },
      settings: { autosave: over.autosave ?? true },
      mode: over.mode ?? 'play',
      world: { rebuildFog() {} },
      overview: { rebuildRegions() {} },
      ui: { minimap: { rebuildBase() {} } },
      snapshot: () => ({
        ...base(1),
        regions: [...regions.unlocked],
        economy: { money: economy.money },
      }),
    });
    const inner = regions.neighbours(regions.unlocked.indexOf(true));
    // owning every one of them still leaves the grid's edge alone
    if (size === 160)
      expect(
        ownsBorderChunk(
          regions.unlocked.map((v, i) => v || inner.includes(i)),
          size,
          size,
        ),
      ).toBe(false);
    return { ...g, regions, economy, inner, map };
  }
  const storedSave = () => JSON.parse(store.items.get(SAVE_KEY)!) as SaveGame;
  const bought = { text: STR.overview.bought, kind: 'good' };

  it('stores an inner purchase at once: the chunk is owned and the money spent in the save', () => {
    for (const kind of ['generated', 'level'] as const) {
      store.items.clear();
      const b = buying({ kind });
      const i = b.inner[0];
      const price = b.regions.price(i);
      expect(b.game.buyChunk(i, true)).toBe(true);
      expect(b.toasts).toEqual([bought]);
      const save = storedSave();
      expect((save.regions as boolean[])[i], kind).toBe(true);
      expect((save.economy as { money: number }).money, kind).toBe(MONEY - price);
    }
  });

  it('writes nothing where the autosave writes nothing, and still makes the purchase', () => {
    const refusals: [
      string,
      (b: ReturnType<typeof buying>) => void,
      Parameters<typeof buying>[0]?,
    ][] = [
      ['autosave off', () => {}, { autosave: false }],
      ['not a game being played', () => {}, { mode: 'editor' }],
      ['after a loop error', (b) => b.pause.trip()],
      ['while the page reloads into a stored save', (b) => (b.host.keepStoredSave = true)],
    ];
    for (const [why, refuse, options] of refusals) {
      store.items.clear();
      const b = buying(options);
      refuse(b);
      const i = b.inner[0];
      expect(b.game.buyChunk(i, true), why).toBe(true);
      expect(b.regions.unlocked[i], why).toBe(true);
      expect(b.economy.money, why).toBe(MONEY - b.regions.price(i));
      expect(store.items.size, why).toBe(0);
      expect(b.toasts, why).toEqual([bought]);
      expect(warn, why).not.toHaveBeenCalled();
    }
  });

  it('warns once when storage refuses it, as the autosave does, until a save goes through', () => {
    const b = buying();
    const refused = [bought, { text: STR.settings.autosaveFailed, kind: 'warn' }];
    store.refuses = true;
    expect(b.game.buyChunk(b.inner[0], true)).toBe(true);
    expect(b.toasts).toEqual(refused);
    expect(b.regions.unlocked[b.inner[0]]).toBe(true);
    expect(store.items.size).toBe(0);
    b.toasts.length = 0;
    expect(b.game.buyChunk(b.inner[1], true)).toBe(true);
    expect(b.toasts).toEqual([bought]);
    // once a save goes through, the next refusal warns again
    store.refuses = false;
    b.toasts.length = 0;
    expect(b.game.buyChunk(b.inner[2], true)).toBe(true);
    expect(b.toasts).toEqual([bought]);
    expect((storedSave().regions as boolean[]).filter(Boolean).length).toBe(4);
    store.refuses = true;
    b.toasts.length = 0;
    expect(b.game.buyChunk(b.inner[3], true)).toBe(true);
    expect(b.toasts).toEqual(refused);
  });

  it('is refused for a broken number as the autosave is, and still makes the purchase', () => {
    const b = buying();
    b.host.snapshot = () => ({ ...base(1), economy: { money: Number.NaN } });
    expect(b.game.buyChunk(b.inner[0], true)).toBe(true);
    expect(b.regions.unlocked[b.inner[0]]).toBe(true);
    expect(b.toasts).toEqual([bought, { text: STR.settings.autosaveBroken, kind: 'warn' }]);
    expect(store.items.size).toBe(0);
    // the console names the first broken number, once
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('economy.money');
    // and the warning is not repeated until some save has gone through
    b.toasts.length = 0;
    expect(b.game.buyChunk(b.inner[1], true)).toBe(true);
    expect(b.toasts).toEqual([bought]);
  });

  it('leaves a chunk on the grid edge to growing the map, which stores the game itself', () => {
    const b = buying();
    // own a chunk one ring out, then buy the edge chunk beside it; a loop error holds growing
    b.regions.own(b.inner[0]);
    const edge = b.regions
      .neighbours(b.inner[0])
      .find((i) => !b.regions.unlocked[i] && !b.inner.includes(i))!;
    b.pause.trip();
    expect(b.game.buyChunk(edge, true)).toBe(true);
    expect(b.toasts).toEqual([bought, { text: STR.overview.growHeld, kind: 'warn' }]);
    expect(store.items.size).toBe(0);
  });

  it('says a refused growth write did not grow the map, and writes nothing more for it', () => {
    const refusals: [string, (b: ReturnType<typeof buying>) => void][] = [
      ['storage', () => (store.refuses = true)],
      [
        'a broken number',
        (b) => (b.host.snapshot = () => ({ ...base(1), economy: { money: Number.NaN } })),
      ],
    ];
    for (const [why, refuse] of refusals) {
      store = new MemoryStorage();
      vi.stubGlobal('localStorage', store);
      const b = buying();
      b.regions.own(b.inner[0]);
      const edge = b.regions
        .neighbours(b.inner[0])
        .find((i) => !b.regions.unlocked[i] && !b.inner.includes(i))!;
      refuse(b);
      expect(b.game.buyChunk(edge, true), why).toBe(true);
      expect(b.regions.unlocked[edge], why).toBe(true);
      // one warning for the one refusal: no autosave follows the growth write to repeat it
      expect(b.toasts, why).toEqual([{ text: STR.overview.growRefused, kind: 'warn' }, bought]);
      expect(store.items.size, why).toBe(0);
      expect(b.host.savedAt, why).toBe(null);
    }
  });

  it('stores a purchase on the grid edge at once when the world cannot grow any more', () => {
    // a world of MAX_WORLD_CHUNKS chunks (32 x 32): no ring fits, so owning its edge asks for none
    const b = buying({ size: 32 * CHUNK_TILES });
    // the corner lies sixteen rings out, which costs more than the start of a game affords
    const money = (b.economy.money = MONEY * 1000);
    const side = b.map.regionsX;
    expect(side * side).toBe(MAX_WORLD_CHUNKS);
    // the corner chunk is on the edge; owning it and buying its neighbour leaves the map as it is
    b.regions.own(0);
    expect(ownsBorderChunk(b.regions.unlocked, b.map.w, b.map.h)).toBe(false);
    const i = 1;
    expect(b.regions.isRevealed(i)).toBe(true);
    const price = b.regions.price(i);
    expect(b.game.buyChunk(i, true)).toBe(true);
    expect(b.toasts).toEqual([bought]);
    const save = storedSave();
    expect((save.regions as boolean[])[i]).toBe(true);
    expect((save.economy as { money: number }).money).toBe(money - price);
  });

  // The oracle: what buyChunk did and said before its toasts moved into saveMessages.ts (#391),
  // written out step by step from the code it replaced. The move was to change no purchase's
  // outcome, #288's inner purchase stored at once and #390's last ring included.

  /** One purchase: where the chunk lies, what the game is, and how a write of it ends. */
  interface Purchase {
    /** an inner chunk; a chunk on the grid's edge; the edge of a world with no ring left to add */
    where: 'inner' | 'edge' | 'last ring';
    kind: 'generated' | 'level';
    autosave: boolean;
    mode: 'play' | 'editor';
    loopError: boolean;
    /** the page reloads into a stored save (`keepStoredSave`) */
    reloading: boolean;
    /** how a write ends; `room for the game only`: storage keeps the game, not it grown a ring */
    write: 'ok' | 'storage' | 'broken number' | 'room for the game only';
  }
  interface PurchaseEffects {
    toasts: Toast[];
    /** what the store holds after: nothing, the game as it stands, or that game grown by a ring */
    stored: 'nothing' | 'game' | 'grown';
    reload: boolean;
    /** console lines naming a broken number */
    logged: number;
  }
  const growing = { text: STR.overview.growing, kind: 'info' };
  const growRefused = { text: STR.overview.growRefused, kind: 'warn' };
  const growHeld = { text: STR.overview.growHeld, kind: 'warn' };
  const autosaveFailed = { text: STR.settings.autosaveFailed, kind: 'warn' };
  const autosaveBroken = { text: STR.settings.autosaveBroken, kind: 'warn' };

  /** buyChunk before #391, on a game whose autosave latches are clear. */
  function before391(c: Purchase): PurchaseEffects {
    const edge = c.kind === 'generated' && c.where === 'edge';
    const held = edge && c.loopError;
    const toasts: Toast[] = [];
    if (edge && !held) {
      // writeSave(expandSave(snapshot)), then the reload into it; no latch, no console
      if (c.write === 'ok') return { toasts: [growing], stored: 'grown', reload: true, logged: 0 };
      // and nothing else is written for the purchase, even where the game ungrown would fit
      toasts.push(growRefused);
    }
    toasts.push(bought);
    if (held) toasts.push(growHeld);
    let stored: PurchaseEffects['stored'] = 'nothing';
    let logged = 0;
    // `if (!edge && autosave && mode === 'play') this.save(true)`, and save(true) itself
    if (!edge && c.autosave && c.mode === 'play' && !c.reloading && !c.loopError) {
      if (c.write === 'ok' || c.write === 'room for the game only') stored = 'game';
      else if (c.write === 'storage') toasts.push(autosaveFailed);
      else {
        toasts.push(autosaveBroken);
        logged = 1;
      }
    }
    return { toasts, stored, reload: false, logged };
  }

  it('does and says what it did before its decisions moved, for every purchase', () => {
    const cases: Purchase[] = [];
    for (const where of ['inner', 'edge', 'last ring'] as const)
      for (const kind of ['generated', 'level'] as const)
        for (const autosave of [true, false])
          for (const mode of ['play', 'editor'] as const)
            for (const loopError of [false, true])
              for (const reloading of [false, true])
                for (const write of [
                  'ok',
                  'storage',
                  'broken number',
                  'room for the game only',
                ] as const)
                  cases.push({ where, kind, autosave, mode, loopError, reloading, write });
    // one map of each size for every case: the largest takes a while to build
    const maps = {
      160: emptyMap(1, 160, 160),
      last: emptyMap(1, 32 * CHUNK_TILES, 32 * CHUNK_TILES),
    };
    const seen = new Set<string>();
    for (const c of cases) {
      const why = JSON.stringify(c);
      store = new MemoryStorage();
      vi.stubGlobal('localStorage', store);
      const session = new MemoryStorage();
      vi.stubGlobal('sessionStorage', session);
      const reload = vi.fn();
      vi.stubGlobal('location', { hash: '#from-before', reload });
      warn.mockClear();

      const last = c.where === 'last ring';
      const b = buying({
        kind: c.kind,
        autosave: c.autosave,
        mode: c.mode,
        size: last ? 32 * CHUNK_TILES : undefined,
        map: last ? maps.last : maps[160],
      });
      if (last) b.economy.money = MONEY * 1000;
      const money = b.economy.money;
      let i = b.inner[0];
      if (c.where === 'edge') {
        b.regions.own(b.inner[0]);
        i = b.regions
          .neighbours(b.inner[0])
          .find((j) => !b.regions.unlocked[j] && !b.inner.includes(j))!;
      } else if (last) {
        b.regions.own(0);
        i = 1;
      }
      const price = b.regions.price(i);
      // the snapshot a write takes: the world, so growing has a frame to grow, and the purchase
      const snap = () =>
        ({
          ...base(1),
          stations: [],
          trains: [],
          track: [],
          camera: { x: 0, y: 0, zoomIndex: 2 },
          world:
            c.kind === 'generated'
              ? { kind: 'generated', seed: 1, params: { w: b.map.w, h: b.map.h } }
              : { kind: 'level', seed: 1 },
          regions: [...b.regions.unlocked],
          economy: { money: c.write === 'broken number' ? Number.NaN : b.economy.money },
        }) as unknown as SaveGame;
      const rebuilt = { fog: 0, regions: 0, minimap: 0 };
      Object.assign(b.host, {
        snapshot: snap,
        world: { rebuildFog: () => rebuilt.fog++ },
        overview: { rebuildRegions: () => rebuilt.regions++ },
        ui: { minimap: { rebuildBase: () => rebuilt.minimap++ } },
      });
      if (c.loopError) b.pause.trip();
      if (c.reloading) b.host.keepStoredSave = true;
      store.refuses = c.write === 'storage';
      // the game grown a ring is longer by the ring's chunks: there is room for the game alone
      if (c.write === 'room for the game only') store.limit = JSON.stringify(snap()).length + 16;

      expect(b.game.buyChunk(i, true), why).toBe(true);

      // what the case says of the grid holds: only the edge purchase leaves an edge chunk owned
      expect(ownsBorderChunk(b.regions.unlocked, b.map.w, b.map.h), why).toBe(c.where === 'edge');
      const want = before391(c);
      // the purchase is made, whatever became of the writes
      expect(b.regions.unlocked[i], why).toBe(true);
      expect(b.economy.money, why).toBe(money - price);
      expect(b.toasts, why).toEqual(want.toasts);
      const text = store.items.get(SAVE_KEY);
      const stored =
        text === undefined
          ? 'nothing'
          : text === JSON.stringify(snap())
            ? 'game'
            : text === JSON.stringify(expandSave(snap(), 1))
              ? 'grown'
              : `something else: ${text.slice(0, 80)}`;
      expect(stored, why).toBe(want.stored);
      expect(
        [...store.items.keys()].filter((k) => k !== SAVE_KEY),
        why,
      ).toEqual([]);
      // the settings screen's "saved at" moves with the game's own save, not the grown one
      expect(b.host.savedAt, why).toBe(want.stored === 'game' ? 1001 : null);
      expect(warn.mock.calls.length, why).toBe(want.logged);
      // a reload lands in the grown game, at the speed it ran; the map is not redrawn first
      expect(reload.mock.calls.length, why).toBe(want.reload ? 1 : 0);
      expect(session.items.get(INTENT_KEY), why).toBe(
        want.reload ? JSON.stringify({ action: 'continue', keepSpeed: true }) : undefined,
      );
      const redrawn = want.reload ? 0 : 1;
      expect(rebuilt, why).toEqual({ fog: redrawn, regions: redrawn, minimap: redrawn });
      seen.add(want.reload ? 'reload' : `${want.stored} ${want.toasts.map((t) => t.text)}`);
    }
    // every outcome of a purchase is among the cases
    for (const outcome of [
      'reload',
      `nothing ${[growRefused.text, bought.text]}`,
      `nothing ${[bought.text, growHeld.text]}`,
      `game ${[bought.text]}`,
      `nothing ${[bought.text]}`,
      `nothing ${[bought.text, autosaveFailed.text]}`,
      `nothing ${[bought.text, autosaveBroken.text]}`,
    ])
      expect(seen, outcome).toContain(outcome);
  });
});

// ------------------------------------------------------------------ the end of Game.applySave

describe('the end of a load (Game.storeLoadedGround)', () => {
  const settle = (g: ReturnType<typeof standIn>) =>
    (g.game as unknown as { storeLoadedGround(): void }).storeLoadedGround();
  /** What building the map did: `added` chunks generated, `unreadable` chunks unread. */
  const ground = (added: number, unreadable: number) => ({
    added: Array.from({ length: added }, (_, i) => `${i},0`),
    unreadable: Array.from({ length: unreadable }, (_, i) => `${i},1`),
  });
  const unsaved = { text: STR.saves.groundUnsaved, kind: 'warn' };

  it('stores the ground the load generated at once, and says nothing when it is stored', () => {
    const g = standIn();
    g.host.ground = ground(3, 0);
    const snap = base(4);
    g.take(snap);
    settle(g);
    expect(store.items.get(SAVE_KEY)).toBe(JSON.stringify(snap));
    expect(g.host.savedAt).toBe(snap.savedAt);
    expect(g.toasts).toEqual([]);
    expect(g.notices).toEqual([]);
  });

  it('writes and says nothing for a level, or a load that generated no ground', () => {
    for (const built of [null, ground(0, 0)]) {
      const g = standIn();
      g.host.ground = built;
      settle(g);
      expect(store.items.size).toBe(0);
      expect(g.toasts).toEqual([]);
      expect(g.notices).toEqual([]);
    }
  });

  it('gives a write storage refuses one warning, worded for the ground', () => {
    const g = standIn();
    g.host.ground = ground(2, 0);
    store.refuses = true;
    settle(g);
    expect(g.toasts).toEqual([unsaved]);
    expect(store.items.size).toBe(0);
    expect(g.host.savedAt).toBe(null);
    // the ground's warning does not say progress is lost: the first autosave refused says so, once
    expect(g.game.save(true)).toBe(false);
    expect(g.game.save(true)).toBe(false);
    expect(g.toasts).toEqual([unsaved, { text: STR.settings.autosaveFailed, kind: 'warn' }]);
  });

  it('gives a write refused for a broken number one warning, worded for the ground', () => {
    const g = standIn();
    g.host.ground = ground(1, 0);
    g.host.snapshot = () => ({ ...base(1), economy: { money: Number.NaN } });
    settle(g);
    expect(g.toasts).toEqual([unsaved]);
    expect(store.items.size).toBe(0);
    // the console names the broken number, the toast does not
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('economy.money');
    // and the first autosave refused after it tells of the broken value, once
    expect(g.game.save(true)).toBe(false);
    expect(g.game.save(true)).toBe(false);
    expect(g.toasts).toEqual([unsaved, { text: STR.settings.autosaveBroken, kind: 'warn' }]);
  });

  it('gives a write held (a loop error, a reload into a stored save) the same one warning', () => {
    const holds: [string, (g: ReturnType<typeof standIn>) => void][] = [
      ['a loop error', (g) => g.pause.trip()],
      ['a reload into a stored save', (g) => (g.host.keepStoredSave = true)],
    ];
    for (const [why, hold] of holds) {
      const g = standIn();
      g.host.ground = ground(2, 0);
      hold(g);
      settle(g);
      expect(g.toasts, why).toEqual([unsaved]);
      expect(store.items.size, why).toBe(0);
    }
  });

  it('gives stored ground it could not read one toast and one notice, and no write', () => {
    const g = standIn();
    g.host.ground = ground(0, 2);
    settle(g);
    const text = STR.saves.groundUnreadable(2);
    expect(g.toasts).toEqual([{ text, kind: 'warn' }]);
    expect(g.notices).toEqual([
      { key: 'save:ground', kind: 'warn', text, target: null, ttl: UNREADABLE_NOTICE_TTL },
    ]);
    expect(store.items.size).toBe(0);
    // with ground generated as well, the write is made and its refusal follows the notice's toast
    const h = standIn();
    h.host.ground = ground(1, 2);
    store.refuses = true;
    settle(h);
    expect(h.toasts).toEqual([{ text, kind: 'warn' }, unsaved]);
    expect(h.notices).toHaveLength(1);
  });

  /** What building the map did, as a case: chunks generated and chunks unread, or a level. */
  type Built = { added: number; unreadable: number } | null;
  type Hold = 'none' | 'a loop error' | 'a reload into a stored save';
  type LoadWrite = 'ok' | 'storage' | 'broken number';
  const BUILT: Built[] = [null];
  for (const added of [0, 3]) for (const unreadable of [0, 2]) BUILT.push({ added, unreadable });
  const HOLDS: Hold[] = ['none', 'a loop error', 'a reload into a stored save'];
  const LOAD_WRITES: LoadWrite[] = ['ok', 'storage', 'broken number'];

  /** A stand-in at the end of a load: its ground, what holds a write, and how a write ends. */
  function loaded(built: Built, hold: Hold, write: LoadWrite, storage: MemoryStorage) {
    const g = standIn();
    g.host.ground = built && ground(built.added, built.unreadable);
    if (hold === 'a loop error') g.pause.trip();
    if (hold === 'a reload into a stored save') g.host.keepStoredSave = true;
    const snap = base(0);
    if (write === 'broken number') SPOTS[1].set(snap, Number.NaN);
    g.take(snap);
    storage.refuses = write === 'storage';
    return g;
  }

  /**
   * The oracle: the end of `applySave` before #391 (`groundUnreadable` as a toast and a notice of
   * 180 s, then `if (added && !this.save(true)) groundUnsaved`) on a game whose latches are clear,
   * with the one change #391 asks for: `save(true)`'s own warning about the same refusal
   * (`autosaveFailed`, `autosaveBroken`) is gone.
   */
  function loadBefore391(built: Built, hold: Hold, write: LoadWrite) {
    const toasts: Toast[] = [];
    const notices: PushedNotice[] = [];
    const unreadable = built?.unreadable ?? 0;
    if (unreadable > 0) {
      const text = STR.saves.groundUnreadable(unreadable);
      toasts.push({ text, kind: 'warn' });
      notices.push({ key: 'save:ground', kind: 'warn', text, target: null, ttl: 180 });
    }
    const added = (built?.added ?? 0) > 0;
    const writes = added && hold === 'none';
    const stored = writes && write === 'ok';
    if (added && !stored) toasts.push(unsaved);
    return { toasts, notices, stored, logged: writes && write === 'broken number' ? 1 : 0 };
  }

  it('does and says what it did before, less the second warning, for every load', () => {
    let refusedOnce = 0;
    for (const built of BUILT)
      for (const hold of HOLDS)
        for (const write of LOAD_WRITES) {
          const why = JSON.stringify({ built, hold, write });
          store = new MemoryStorage();
          vi.stubGlobal('localStorage', store);
          warn.mockClear();
          const g = loaded(built, hold, write, store);
          settle(g);
          const want = loadBefore391(built, hold, write);
          expect(g.toasts, why).toEqual(want.toasts);
          expect(g.notices, why).toEqual(want.notices);
          expect([...store.items], why).toEqual(
            want.stored ? [[SAVE_KEY, JSON.stringify(base(0))]] : [],
          );
          expect(g.host.savedAt, why).toBe(want.stored ? base(0).savedAt : null);
          expect(warn.mock.calls.length, why).toBe(want.logged);
          // one refusal, one warning: never the autosave's as well
          const unread = STR.saves.groundUnreadable(built?.unreadable ?? 0);
          const warnings = g.toasts.filter((t) => t.text !== unread);
          expect(warnings.length, why).toBeLessThanOrEqual(1);
          if (warnings.length) refusedOnce++;
        }
    expect(refusedOnce).toBeGreaterThan(0);
  });

  /** Run `steps` on `g` as the Game.save property above does: what each step returned and said. */
  function transcript(g: ReturnType<typeof standIn>, steps: Step[], storage: MemoryStorage) {
    return steps.map((step, i) => {
      if (step.op === 'trip') {
        g.pause.trip();
        return 'trip';
      }
      const snap = base(i + 1);
      if (step.spot !== null) SPOTS[step.spot].set(snap, step.to);
      g.take(snap);
      storage.refuses = step.full;
      const shown = g.toasts.length;
      const logged = warn.mock.calls.length;
      const result =
        step.op === 'slot' ? g.game.saveSlot('a name') : g.game.save(step.op === 'implicit');
      return {
        result,
        toasts: g.toasts.slice(shown),
        logged: warn.mock.calls.slice(logged).map((call: unknown[]) => String(call[0])),
      };
    });
  }

  it('leaves every later save saying what it says on a game whose load wrote nothing', () => {
    const seen = { refusedThenWarned: 0, storedThenWarned: 0 };
    forAll(
      (rng: Rng) => ({
        built: rng.pick(BUILT),
        hold: rng.pick(HOLDS),
        write: rng.pick(LOAD_WRITES),
        steps: genSteps(rng),
      }),
      (c) => {
        // the game after a load whose end ran, then the run of saves
        const a = new MemoryStorage();
        vi.stubGlobal('localStorage', a);
        const g = loaded(c.built, c.hold, c.write, a);
        settle(g);
        const after = transcript(g, c.steps, a);
        // the same game whose load made no write and said nothing: the same run of saves
        const b = new MemoryStorage();
        vi.stubGlobal('localStorage', b);
        const plain = transcript(loaded(null, c.hold, c.write, b), c.steps, b);
        expect(after, 'the saves after the load against the same saves without it').toEqual(plain);
        const warned = after.some(
          (s) =>
            s !== 'trip' &&
            s.toasts.some(
              (t) =>
                t.text === STR.settings.autosaveFailed || t.text === STR.settings.autosaveBroken,
            ),
        );
        const want = loadBefore391(c.built, c.hold, c.write);
        const refusedLoad = (c.built?.added ?? 0) > 0 && !want.stored;
        if (warned && want.stored) seen.storedThenWarned++;
        if (warned && refusedLoad) seen.refusedThenWarned++;
      },
      {
        shrink: (c) => Array.from(shrinkArray(c.steps), (steps) => ({ ...c, steps })),
      },
    );
    // the seeds reach a refused load write followed by a refused autosave, and a stored one too
    for (const [branch, n] of Object.entries(seen)) expect(n, branch).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------------ Game.fixBuiltTiles

describe('Game.fixBuiltTiles', () => {
  it('gives the map what the repair answers, and redraws those tiles and no others', () => {
    const g = standIn();
    const map = emptyMap(1, 16, 16, Terrain.Grass);
    const idx = (x: number, y: number) => y * map.w + x;
    // under a platform: grass, a platform may not stand on rock
    map.terrain[idx(3, 5)] = Terrain.Rock;
    map.terrain[idx(6, 2)] = Terrain.Water; // under a farm: grass
    map.terrain[idx(9, 10)] = Terrain.Water; // under a platform: the water it stands on
    map.terrain[idx(11, 3)] = Terrain.Hill; // under a platform across a dip: the land stays
    map.terrain[idx(12, 12)] = Terrain.Rock; // nothing built on it
    // the terrain a redraw finds when it reads the map: the repair is in the map before the redraw
    const drawn: string[] = [];
    Object.assign(g.host, {
      map,
      world: {
        retile: (x: number, y: number) => drawn.push(`${x},${y}:${map.terrain[idx(x, y)]}`),
      },
    });
    const works = (x: number, y: number, id: string) => [x, y, id, 0, 1, null, 0];
    const save = {
      track: [],
      stations: [{ defId: 'farm', x: 6, y: 2, rot: 0 }],
      buildings: [
        works(3, 5, 'bridge_wood'),
        works(9, 10, 'bridge_stone'),
        works(11, 3, 'bridge_wood'),
      ],
    } as unknown as SaveGame;
    (g.game as unknown as { fixBuiltTiles(j: SaveGame): void }).fixBuiltTiles(save);
    expect(drawn.sort()).toEqual([`3,5:${Terrain.Grass}`, `6,2:${Terrain.Grass}`]);
    expect(map.terrain[idx(3, 5)]).toBe(Terrain.Grass);
    expect(map.terrain[idx(6, 2)]).toBe(Terrain.Grass);
    expect(map.terrain[idx(9, 10)]).toBe(Terrain.Water);
    expect(map.terrain[idx(11, 3)]).toBe(Terrain.Hill);
    expect(map.terrain[idx(12, 12)]).toBe(Terrain.Rock);
    // the rest of the map is as it was
    expect(map.terrain.filter((t) => t === Terrain.Grass).length).toBe(16 * 16 - 3);
  });
});

// ------------------------------------------------------------------ a headless Game

/** What the renderer and the panels are to a headless game: all of it is itself, and calling it answers itself. */
const inert: object = new Proxy(function inert() {}, {
  get: (_target, key) => (key === 'then' ? undefined : inert),
  apply: () => inert,
});

/** A Game with the prototype's methods over the domains of `w`, and no renderer, panels or DOM. */
function gameOn(w: SimWorld): Game {
  const host: Record<string, unknown> = Object.create(Game.prototype);
  Object.assign(host, {
    seed: w.seed,
    spec: { kind: 'generated', seed: w.seed, params: mapParams(w.map.w) },
    map: w.map,
    regions: w.regions,
    track: w.track,
    builder: w.builder,
    economy: w.economy,
    stores: w.stores,
    towns: w.towns,
    houses: w.houses,
    power: w.power,
    catenary: w.catenary,
    weather: w.weather,
    inventory: w.inventory,
    fleet: w.fleet,
    people: w.people,
    contracts: w.contracts,
    gacha: w.gacha,
    crafting: w.crafting,
    contractJobs: w.contractJobs,
    trade: w.trade,
    clock: w.clock,
    notices: w.notices,
    commands: new Commands(w),
    camera: { x: 640, y: 320, zoomIndex: 2, zoom: 1, centerOn() {} },
    sim: { lastDay: 0 },
    settings: { weather: false },
    saveExtra: {},
    orphaned: new Set<number>(),
    signalAspect: new Map<number, string>(),
    ground: null,
    season: null,
    toasts: { push() {} },
    atlas: { has: () => false },
    world: inert,
    overview: inert,
    ui: inert,
    powerLines: inert,
  });
  return host as unknown as Game;
}

// ------------------------------------------------------------------ roads in a save and a load

// `Game` cannot be constructed under Node, but its `snapshot` and `applySave` run on a stand-in that
// has the prototype and, for fields, the real domains of a headless world (src/testing/simWorld.ts,
// wired as `Game.init` wires them). The renderer and the panels are inert. What these tests pin is
// that the game calls `Roads.toJSON` and `Roads.load`, and the load repair, on the way through: the
// snapshot's `roads` field is a required one, but a dropped `roads.load` in `applySave` would lose
// every road on load without a word.
describe('roads through Game.snapshot and Game.applySave', () => {
  const SEED = 11;
  const SIZE = 64;
  // a load applies the save's tuning; every test, and every case of a property, starts from the defaults
  const reset = () => {
    Object.assign(rules, DEFAULT_RULES);
    setSupplyMode(DEFAULT_SUPPLY);
    setSeasonOffset(0);
    resetStationIds(1);
    resetTrainIds(1);
  };
  beforeEach(reset);

  const column = (x: number, y0: number, y1: number) =>
    Array.from({ length: y1 - y0 + 1 }, (_, i) => [x, y0 + i] as [number, number]);
  const row = (y: number, x0: number, x1: number) =>
    Array.from({ length: x1 - x0 + 1 }, (_, i) => [x0 + i, y] as [number, number]);

  /**
   * A game with a line of track along row 20, two streets across it (level crossings at 16,20 and
   * 24,20) joined by a road along row 23, a depot far from any road (its door gets its reach tile
   * alone) and a house below the road, which gets its spur to it. `built` counts the roads the
   * player laid; the spurs follow them in the list.
   */
  function scene() {
    const w = simWorld({ seed: SEED, size: SIZE, terrain: 'grass' });
    station(w, 'depot', 44, 44);
    line(w, 10, 20, 30);
    w.builder.free = true;
    const laid = [...column(16, 17, 23), ...row(23, 17, 24), ...column(24, 17, 22)];
    for (const [x, y] of laid) expect(w.builder.placeRoad(x, y), `road at ${x},${y}`).toBe(true);
    const built = w.builder.roads.size;
    expect(w.builder.placeDecor(20, 26, 'townhouse', 0), 'the house').not.toBeNull();
    w.builder.free = false;
    return { w, built };
  }

  /** The roads of a world as a save is to keep them: tiles, joins, what each joins of the places built, crossings. */
  function roadsOf(w: SimWorld) {
    const roads = w.builder.roads;
    const doors = w.builder.streetDoors();
    return {
      tiles: roads.toJSON(),
      joins: Array.from({ length: SIZE * SIZE }, (_, k) =>
        roads.joins(k % SIZE, Math.floor(k / SIZE)),
      ),
      links: roads.list().map(({ x, y }) => w.builder.roadLinks(x, y, doors)),
      crossings: [...roads.crossingKeys()].sort((a, b) => a - b),
    };
  }

  /** A new world of the saved game's seed with `save` loaded into it, its ground first made as `spoil` says. */
  function loaded(save: SaveGame, spoil: (map: GameMap) => void = () => {}) {
    const w = simWorld({ seed: SEED, size: SIZE, terrain: 'grass' });
    spoil(w.map);
    gameOn(w).applySave(structuredClone(save));
    return w;
  }

  it('come back through a save and a load: the roads, their joins and the level crossings', () => {
    const { w, built } = scene();
    const before = roadsOf(w);
    // the scene holds what the test is about
    expect(before.crossings).toEqual(
      [w.track.key(16, 20), w.track.key(24, 20)].sort((a, b) => a - b),
    );
    expect(
      before.tiles.length,
      'a spur and a lone reach tile follow the laid roads',
    ).toBeGreaterThan(built + 1);
    expect(
      before.links.some((l) => l.doors !== 0),
      'a road that leads into a building',
    ).toBe(true);

    // the snapshot keeps them, and the stored game is read back as a load reads it
    const saved = gameOn(w).snapshot();
    expect(saved.roads).toEqual(before.tiles);
    const read = readSaveText(JSON.stringify(saved));
    if (!('save' in read)) throw new Error(read.error);

    const back = loaded(read.save);
    expect(roadsOf(back)).toEqual(before);
    // and the track they cross is there to cross
    expect([...back.track.pieces.keys()]).toEqual([...w.track.pieces.keys()]);
  });

  it('take off the roads a load made unfit for one, with no refund, and no others', () => {
    const { w } = scene();
    const saved = gameOn(w).snapshot();
    const tiles = saved.roads ?? [];
    expect(tiles.length, 'the roads the save keeps').toBeGreaterThan(20);
    const spur = tiles[tiles.length - 1];
    // a refund would show: the save's tuning pays all of a road back, and with no goods saved
    // the load puts nothing over what the stores hold by then
    saved.rules = { ...saved.rules, refundRate: 1 };
    saved.stores = undefined;

    // the ground this load makes is not the one the roads were laid on: water under a street, rock
    // under a level crossing, a mountain under the road between them, water under the last spur
    const spoilt: [number, number, Terrain][] = [
      [16, 22, Terrain.Water],
      [16, 20, Terrain.Rock],
      [24, 23, Terrain.Mountain],
      [spur[0], spur[1], Terrain.Water],
    ];
    const treated = loaded(saved, (map) => {
      for (const [x, y, t] of spoilt) map.terrain[y * map.w + x] = t;
    });
    const control = loaded(saved);

    const gone = new Set(spoilt.map(([x, y]) => `${x},${y}`));
    expect(control.builder.roads.toJSON(), 'on the ground they were laid on').toEqual(tiles);
    expect(treated.builder.roads.toJSON()).toEqual(
      tiles.filter(([x, y]) => !gone.has(`${x},${y}`)),
    );
    // the track the rock crossing was on stays, now with no road across it
    expect(treated.track.get(16, 20)).toBeDefined();
    expect([...treated.builder.roads.crossingKeys()]).toEqual([treated.track.key(24, 20)]);
    // nothing was paid back: the money and the stock are the control's, which took nothing off
    expect(treated.economy.money).toBe(control.economy.money);
    expect(treated.stores.toJSON()).toEqual(control.stores.toJSON());
    // ... where taking a road up by hand does pay back, under this tuning, to the depot
    const depot = control.stores.nearest(16, 22, Infinity)[0];
    const stone = depot.get('stone');
    expect(control.builder.removeRoad(16, 22)).toBe(true);
    expect(depot.get('stone')).toBeGreaterThan(stone);
    // the repair took the roads off and bent no ground for them
    for (const [x, y, t] of spoilt) expect(treated.map.terrain[y * treated.map.w + x]).toBe(t);
  });

  /** The scene's track, depot and house with the roads `laid` tried in that order, for free: the builder refuses what it must. */
  function sceneOf(laid: readonly (readonly [number, number])[]) {
    const w = simWorld({ seed: SEED, size: SIZE, terrain: 'grass' });
    station(w, 'depot', 44, 44);
    line(w, 10, 20, 30);
    w.builder.free = true;
    expect(w.builder.placeDecor(20, 26, 'townhouse', 0), 'the house').not.toBeNull();
    for (const [x, y] of laid) w.builder.placeRoad(x, y);
    w.builder.free = false;
    return w;
  }

  /** Roads to try laying, and ground for a load to make: tiles round the track, the house and the depot. */
  interface RoadCase {
    laid: [number, number][];
    spoil: [number, number, Terrain][];
  }
  // water, rock and a mountain twice each: ground that holds no road, six in ten
  const GROUNDS = [
    Terrain.Water,
    Terrain.Rock,
    Terrain.Mountain,
    Terrain.Water,
    Terrain.Rock,
    Terrain.Mountain,
    Terrain.Hill,
    Terrain.Forest,
    Terrain.Sand,
    Terrain.Grass,
  ];
  function genRoadCase(rng: Rng): RoadCase {
    // runs of road, a step at a time, with now and then a jump, often onto the track's row 20
    const jump = (): [number, number] => [rng.int(12, 28), rng.chance(0.3) ? 20 : rng.int(17, 27)];
    const laid: [number, number][] = [];
    let at = jump();
    for (let n = rng.int(0, 45); n > 0; n--) {
      laid.push(at);
      if (!rng.chance(0.8)) at = jump();
      else {
        const [dx, dy] = rng.pick([
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]);
        at = [Math.min(30, Math.max(10, at[0] + dx)), Math.min(28, Math.max(16, at[1] + dy))];
      }
    }
    // ground a load makes: on a road laid, on a crossing of the track, or anywhere
    const crossings = laid.filter(([, y]) => y === 20);
    const spoil: [number, number, Terrain][] = Array.from({ length: rng.int(0, 12) }, () => {
      const at =
        rng.chance(0.4) && laid.length
          ? laid
          : rng.chance(0.5) && crossings.length
            ? crossings
            : null;
      const [x, y] = at ? rng.pick(at) : [rng.int(10, 46), rng.int(16, 46)];
      return [x, y, rng.pick(GROUNDS)];
    });
    return { laid, spoil };
  }
  function* shrinkRoadCase(c: RoadCase): Iterable<RoadCase> {
    for (const laid of shrinkArray(c.laid)) yield { ...c, laid };
    for (const spoil of shrinkArray(c.spoil)) yield { ...c, spoil };
  }

  // a second long: a hundred worlds, each saved and loaded three times
  it('survive any roads and any ground a load makes: only the roads the ground cannot hold go, unpaid', () => {
    const seen = { roads: 0, crossings: 0, gone: 0, goneCrossings: 0 };
    forAll(
      genRoadCase,
      ({ laid, spoil }) => {
        reset();
        const w = sceneOf(laid);
        const saved = gameOn(w).snapshot();
        // a refund would show, as in the test above
        saved.rules = { ...saved.rules, refundRate: 1 };
        saved.stores = undefined;
        const tiles = saved.roads ?? [];

        // on the ground they were laid on, the roads come back as they were
        const before = roadsOf(w);
        const control = loaded(saved);
        expect(roadsOf(control)).toEqual(before);

        // on other ground, exactly the roads its repaired ground cannot hold are gone
        const treated = loaded(saved, (map) => {
          for (const [x, y, t] of spoil) map.terrain[y * map.w + x] = t;
        });
        const ground = (x: number, y: number) => treated.map.terrain[y * treated.map.w + x];
        const kept = tiles.filter(([x, y]) => unbuildable(ground(x, y)) === null);
        expect(treated.builder.roads.toJSON()).toEqual(kept);
        // and no road stands where the builder would refuse one for the ground
        for (const { x, y } of treated.builder.roads.list())
          expect(unbuildable(ground(x, y)), `${x},${y}`).toBeNull();
        // nothing was paid back
        expect(treated.economy.money).toBe(control.economy.money);
        // the track under a level crossing stays; one the ground left no road on is no crossing
        expect(treated.track.pieces.size).toBe(control.track.pieces.size);
        const crossings = [...control.builder.roads.crossingKeys()];
        expect([...treated.builder.roads.crossingKeys()]).toEqual(
          crossings.filter((k) => treated.builder.roads.has(k % SIZE, Math.floor(k / SIZE))),
        );

        // the repaired game saves and loads again as it is: on its own ground, nothing more goes
        const again = gameOn(treated).snapshot();
        const read = readSaveText(JSON.stringify(again));
        if (!('save' in read)) throw new Error(read.error);
        const settled = loaded(read.save, (map) => map.terrain.set(treated.map.terrain));
        expect(roadsOf(settled)).toEqual(roadsOf(treated));

        seen.roads += tiles.length;
        seen.crossings += crossings.length;
        seen.gone += tiles.length - kept.length;
        seen.goneCrossings += crossings.length - treated.builder.roads.crossingKeys().size;
      },
      { shrink: shrinkRoadCase },
    );
    // the seeds reach roads kept, roads taken off, and level crossings among both
    for (const [what, n] of Object.entries(seen)) expect(n, what).toBeGreaterThan(20);
  }, 20_000);
});

// ------------------------------------------------------------------ stores in a save and a load

// The goods of every store go through `Game.snapshot` and `Game.applySave`, as the roads do above;
// a file from before the stores (v20) brings its global stockpile into the start depot, and a new
// game finds its start stock there.
describe('stores through Game.snapshot and Game.applySave', () => {
  const SEED = 11;
  const SIZE = 64;
  const reset = () => {
    Object.assign(rules, DEFAULT_RULES);
    setSupplyMode(DEFAULT_SUPPLY);
    setSeasonOffset(0);
    resetStationIds(1);
    resetTrainIds(1);
  };
  beforeEach(reset);

  const fresh = () => simWorld({ seed: SEED, size: SIZE, terrain: 'grass' });
  /**
   * A depot, a town with a warehouse in its reach and a warehouse outside every town, the stores
   * of each holding goods, and power in the grid.
   */
  function scene() {
    const w = fresh();
    const depot = station(w, 'depot', 44, 44);
    // the town and the warehouses stand by track
    line(w, 8, 13, 20);
    line(w, 28, 41, 34);
    const town = townWith(w, { food: 50, wheat: 5 }, { x: 12, y: 12 });
    const inTown = station(w, 'warehouse', 15, 12);
    const alone = station(w, 'warehouse', 30, 40);
    const dock = w.stores.byKey(`st:${depot.id}`)!;
    dock.amounts.set('wood', 123);
    dock.amounts.set('coal', 7);
    w.stores.byKey(`st:${alone.id}`)!.amounts.set('stone', 80);
    w.stores.grid.amounts.set('power', 30);
    town.famine = true;
    return { w, depot, inTown, alone };
  }
  /** `save` read back as a load reads it, then loaded into a new world of its seed. */
  function loaded(save: SaveGame) {
    const read = readSaveText(JSON.stringify(save));
    if (!('save' in read)) throw new Error(read.error);
    const w = fresh();
    gameOn(w).applySave(read.save);
    return w;
  }
  const goods = (w: SimWorld, key: string) =>
    Object.fromEntries([...(w.stores.byKey(key)?.amounts ?? [])].filter(([, n]) => n > 0));

  it("keep every store's goods and famine, a depot's too, through a save and a load", () => {
    const { w, depot } = scene();
    const saved = gameOn(w).snapshot();
    expect(saved.stockpile, 'no stockpile is written').toBeUndefined();
    const back = loaded(saved);
    expect(back.stores.toJSON()).toEqual(w.stores.toJSON());
    expect(goods(back, `st:${depot.id}`)).toEqual({ wood: 123, coal: 7 });
    expect(
      back.stores
        .all()
        .filter((s) => s.famine)
        .map((s) => s.kind),
    ).toEqual(['town']);
  });

  it('a v20 save keeps its stockpile in the start depot and its warehouse goods', () => {
    const { w, depot, inTown, alone } = scene();
    const v20 = gameOn(w).snapshot() as SaveGame & { stations: { id: number }[] };
    v20.version = 20;
    delete v20.stores;
    v20.stockpile = { amounts: { wood: 400, power: 50 }, famine: false };
    const storage = (id: number, s: Record<string, number>) =>
      (v20.stations.find((st) => st.id === id)!.storage = s);
    storage(alone.id, { stone: 80 });
    storage(inTown.id, { iron: 30 });

    const back = loaded(v20);
    const town = back.stores.all().find((s) => s.kind === 'town')!;
    expect(goods(back, `st:${depot.id}`)).toEqual({ wood: 400 });
    expect(goods(back, 'grid')).toEqual({ power: 50 });
    expect(goods(back, `st:${alone.id}`)).toEqual({ stone: 80 });
    // a warehouse in a town keeps no store of its own: its goods are the town's
    expect(back.stores.byKey(`st:${inTown.id}`)).toBeUndefined();
    expect(goods(back, town.key)).toEqual({ iron: 30 });
    // and no station holds goods of its own any more
    for (const s of back.builder.stations) expect(s.storage.size, s.name).toBe(0);
  });

  it('a save with no depot loads and keeps its goods', () => {
    const w = fresh();
    const v20 = gameOn(w).snapshot();
    expect(v20.stations, 'nothing stands').toEqual([]);
    v20.version = 20;
    delete v20.stores;
    v20.stockpile = { amounts: { wood: 400, power: 50 }, famine: true };

    const back = loaded(v20);
    // the load grants the depot every game has, and the stockpile waits in it
    const depot = back.builder.depots()[0];
    expect(depot, 'the depot granted on load').toBeDefined();
    expect(goods(back, `st:${depot.id}`)).toEqual({ wood: 400 });
    // the stockpile's famine is not carried to the depot, where nobody may eat
    expect(back.stores.byKey(`st:${depot.id}`)!.famine).toBe(false);
    expect(goods(back, 'grid')).toEqual({ power: 50 });
  });

  it('start a load from clean stores: nothing of the game it loads over stays', () => {
    const { w } = scene();
    const saved = gameOn(w).snapshot();
    const over = fresh();
    // the game running before the load: goods under the grid's key, which every save has, and a
    // famine there
    over.stores.grid.amounts.set('power', 99);
    over.stores.grid.amounts.set('coal', 12);
    over.stores.grid.famine = true;
    gameOn(over).applySave(structuredClone(saved));
    expect(over.stores.toJSON()).toEqual(w.stores.toJSON());
  });

  /** A step of the game before: taking it back in the game after would be a mistake. */
  const stale: HistoryStep = {
    label: 'a step of the game before',
    undo: () => {
      throw new Error('undone across a load');
    },
    redo: () => {
      throw new Error('redone across a load');
    },
  };

  it('a load leaves nothing to undo or redo', () => {
    const saved = gameOn(scene().w).snapshot();
    const game = gameOn(fresh());
    const { history } = game.commands;
    history.push(stale);
    history.push({ label: 'and another', undo: () => ({ ok: true }), redo: () => ({ ok: true }) });
    history.undo();
    game.applySave(structuredClone(saved));
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
    expect(history.undo().ok).toBe(false);
  });

  it('a new game leaves nothing to undo', () => {
    const game = gameOn(fresh());
    game.commands.history.push(stale);
    game.startFresh();
    expect(game.commands.history.canUndo).toBe(false);
    expect(game.commands.history.undo().ok).toBe(false);
  });

  it('a new game puts the start stock in the start depot', () => {
    const w = fresh();
    gameOn(w).startFresh();
    const depot = w.builder.depots()[0];
    expect(depot, 'the start depot').toBeDefined();
    const dock = w.stores.dockOf(depot)!;
    expect(dock.get('water')).toBe(600 * rules.startStock);
    for (const [id, n] of Object.entries(startStock()))
      expect(dock.get(id), id).toBe(Math.round(n * rules.startStock));
  });

  /** A level's start block: the default goods, in the first age. */
  const levelStart = { money: 25000, tickets: 3, tier: 0, stockMul: 1 };
  /** The start stock a level's start block brings, by good. */
  const levelStock = () =>
    Object.fromEntries(
      Object.entries(startStock()).map(([id, n]) => [id, Math.round(n * rules.startStock)]),
    );

  it('a level with no stations starts with its stock in the depot it is granted', () => {
    const w = fresh();
    expect(w.builder.stations, 'premise: nothing stands').toEqual([]);
    gameOn(w).startFresh(levelStart);
    const depot = w.builder.depots()[0];
    expect(depot, 'the start depot').toBeDefined();
    expect(goods(w, `st:${depot.id}`)).toEqual(levelStock());
  });

  it("a level with a warehouse and no depot starts with its stock in the warehouse's store", () => {
    const w = fresh();
    line(w, 26, 31, 36);
    const house = station(w, 'warehouse', 30, 30);
    gameOn(w).startFresh(levelStart);
    expect(w.builder.depots(), 'no depot is added').toEqual([]);
    expect(goods(w, `st:${house.id}`)).toEqual(levelStock());
  });

  it('a level with only a town starts with its stock in the town store', () => {
    const w = fresh();
    line(w, 26, 31, 36);
    const hall = station(w, 'town', 30, 30);
    gameOn(w).startFresh(levelStart);
    expect(w.builder.depots(), 'no depot is added').toEqual([]);
    expect(goods(w, `town:${w.towns.byStation(hall.id)!.id}`)).toEqual(levelStock());
  });
});
