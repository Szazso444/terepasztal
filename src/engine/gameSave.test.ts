import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Game } from '../game';
import { AutosavePause } from './autosavePause';
import { BrokenNumberWarning, StorageRefusalWarning } from './saveRefusal';
import { SAVE_KEY, type SaveGame } from '../sim/save';
import { CHUNK_TILES, ownsBorderChunk } from '../sim/expand';
import { MAX_WORLD_CHUNKS } from '../sim/ground';
import { RegionState } from '../world/regions';
import { emptyMap } from '../world/mapgen';
import { Terrain } from '../world/tiles';
import { STR } from '../strings';
import { forAll, shrinkArray } from '../testing/property';
import type { Rng } from './rng';

// a purchase plays a sound; the context that plays it is a browser's
vi.mock('./audio', async (original) => ({
  ...(await original<typeof import('./audio')>()),
  sfx: vi.fn(),
}));

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
    } = {},
  ) {
    const g = standIn();
    const size = over.size ?? 160;
    const map = emptyMap(1, size, size);
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
    // own a chunk one ring out, then buy the edge chunk beside it, with growing held by a loop error
    b.regions.own(b.inner[0]);
    const edge = b.regions
      .neighbours(b.inner[0])
      .find((i) => !b.regions.unlocked[i] && !b.inner.includes(i))!;
    b.pause.trip();
    expect(b.game.buyChunk(edge, true)).toBe(true);
    expect(b.toasts).toEqual([bought, { text: STR.overview.growHeld, kind: 'warn' }]);
    expect(store.items.size).toBe(0);
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
});

// ------------------------------------------------------------------ Game.fixBuiltTiles

describe('Game.fixBuiltTiles', () => {
  it('gives the map what the repair answers, and redraws those tiles and no others', () => {
    const g = standIn();
    const map = emptyMap(1, 16, 16, Terrain.Grass);
    const idx = (x: number, y: number) => y * map.w + x;
    map.terrain[idx(3, 5)] = Terrain.Rock; // under a platform: grass, a platform may not stand on rock
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
