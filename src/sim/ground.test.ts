import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  GROUND_KEY,
  MIGRATIONS,
  SAVE_KEY,
  SAVE_VERSION,
  SLOTS_KEY,
  buildSave,
  continueMeta,
  freezeStoredSaves,
  listSlots,
  parseSave,
  readSave,
  readSlot,
  withGround,
  type SaveGame,
  type SaveParts,
} from './save';
import { expandSave } from './expand';
import { generatorOf, groundOf, lacksGround, storeOf, type GeneratedWorld } from './ground';
import { Builder } from './build';
import { Economy } from './economy';
import { Stockpile } from './stockpile';
import { DEFAULT_RULES, rules } from './rules';
import { DEFAULT_SUPPLY, setSupplyMode, supplyMode, type SupplyMode } from './supply';
import {
  CHUNK_TILES,
  PROP_KINDS,
  chunkKey,
  chunkOf,
  mapChunks,
  parseChunkKey,
  type ChunkStore,
  type MapGenerator,
} from '../world/chunks';
import { DEFAULT_MAP_PARAMS, emptyMap, generateMap, type MapGenParams } from '../world/mapgen';
import { Terrain, type GameMap, type PropInstance } from '../world/tiles';
import { RegionState } from '../world/regions';
import { TrackGraph, pieceCost } from '../world/track';
import { findPath } from '../world/pathfinding';
import { levelFromMap } from '../world/level';
import { Dir } from '../engine/iso';
import { hash2, type Rng } from '../engine/rng';
import { forAll, shrinkArray, shrinkInt } from '../testing/property';
import { buildRelief, groundAllows } from '../render/terrainRelief';

// the build rules play a sound when a piece goes down
vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));

/** A generator that must not run: every chunk the map covers is stored. */
const never: MapGenerator = () => {
  throw new Error('generated a chunk that is stored');
};
/** A changed generator: another world entirely, under the same seed. */
const changed: MapGenerator = (s, p) => ({ ...generateMap(s + 1, p), seed: s });
/** A generator that counts the maps it makes, and makes them as `generate` does. */
function counting(generate: MapGenerator) {
  const calls: Partial<MapGenParams>[] = [];
  const gen: MapGenerator = (s, p) => {
    calls.push(p);
    return generate(s, p);
  };
  return { gen, calls };
}

/** Where a chunk stores a prop offset: the nearest 256th of a tile. */
const stored = (v: number) => Math.max(-128, Math.min(127, Math.round(v * 256))) / 256;
/**
 * The first world tile, of those `a` has and `b` has too (and `only` allows), where the two differ:
 * terrain, biome and variant exactly, props exactly or, with `near`, kind and variant exactly and
 * offsets as a chunk stores them; null when none does.
 */
function firstDifference(
  a: GameMap,
  b: GameMap,
  { near = false, only }: { near?: boolean; only?: (wx: number, wy: number) => boolean } = {},
): string | null {
  const same = (p: PropInstance, q: PropInstance) =>
    p.kind === q.kind &&
    p.variant === q.variant &&
    (near ? stored(p.ox) === stored(q.ox) : p.ox === q.ox) &&
    (near ? stored(p.oy) === stored(q.oy) : p.oy === q.oy);
  for (let y = 0; y < a.h; y++)
    for (let x = 0; x < a.w; x++) {
      const wx = x + a.originX;
      const wy = y + a.originY;
      const bx = wx - b.originX;
      const by = wy - b.originY;
      if (bx < 0 || by < 0 || bx >= b.w || by >= b.h || (only && !only(wx, wy))) continue;
      const i = y * a.w + x;
      const j = by * b.w + bx;
      const where = `world tile (${wx}, ${wy})`;
      if (a.terrain[i] !== b.terrain[j]) return `terrain at ${where}`;
      if (a.biome[i] !== b.biome[j]) return `biome at ${where}`;
      if (a.variant[i] !== b.variant[j]) return `variant at ${where}`;
      const pa = a.props.get(i) ?? [];
      const pb = b.props.get(j) ?? [];
      if (pa.length !== pb.length || pa.some((p, k) => !same(p, pb[k])))
        return `props at ${where}: ${JSON.stringify(pa)} against ${JSON.stringify(pb)}`;
    }
  return null;
}

/** The keys of every chunk a frame covers, in rows. */
const keysOf = (p: Partial<MapGenParams>) =>
  mapChunks({ ...DEFAULT_MAP_PARAMS, ...p }).map(({ cx, cy }) => chunkKey(cx, cy));
/** Whether world tile (`wx`, `wy`) lies in a chunk the store holds. */
const inStore = (store: ChunkStore, wx: number, wy: number) =>
  Object.hasOwn(store, chunkKey(chunkOf(wx), chunkOf(wy)));

/** A generated world of `seed` on `frame`, nothing stored. */
const worldOf = (seed: number, frame: Partial<MapGenParams>): GeneratedWorld => ({
  kind: 'generated',
  seed,
  params: { ...DEFAULT_MAP_PARAMS, ...frame },
});

/** The parts of a small game on `world`, as `Game.snapshot` hands them to `buildSave`. */
function partsOf(world: SaveParts['world'], supply: SupplyMode = 'simple'): SaveParts {
  return {
    seed: world.seed,
    clock: { time: 900, speedIndex: 1 },
    economy: { money: 5000, tickets: 2, tier: 1, granted: [0], earned: 100 },
    track: [[3, 4, 'straight', 1, 'regular', 'regular']],
    stations: [],
    trains: [],
    contracts: { contracts: [] },
    inventory: { items: [], nextUid: 1 },
    gacha: {},
    camera: { x: 0, y: 0, zoomIndex: 2 },
    lastDay: 3,
    decor: [],
    wires: [],
    weather: {},
    world,
    rules: {},
    stockpile: { amounts: {} },
    buildings: [],
    regions: [true],
    seasonOffset: 0,
    towns: [],
    trade: { deals: {}, nextAt: 0, fuelMul: 1, driftDay: 0 },
    crafting: { recipes: [], stats: { unlocks: 0, crafts: 0, failures: 0 } },
    houses: { list: [], arrivals: [], visited: [] },
    supply,
    people: { rng: 7 },
  };
}
/**
 * A file of `version` on `world` as the build of that version stored it: before v19 a generated
 * world stored no ground. A file of v2 or older has no world description at all.
 */
function oldFile(world: unknown, version: number, supply: SupplyMode = 'simple') {
  const file: Record<string, unknown> = {
    ...partsOf(world as SaveParts['world'], supply),
    version,
    savedAt: 1_700_000_000_000 + version,
  };
  if (version < 3) delete file.world;
  if (version < 9) delete file.supply;
  return file;
}

beforeEach(() => Object.assign(rules, DEFAULT_RULES));

describe('the ground a save stores', () => {
  // 15 worlds of up to 96 tiles a side, each generated twice: about 0.5 s alone
  it('comes back byte for byte through the save text, for several seeds, frames and chains', () => {
    const frames: Partial<MapGenParams>[] = [
      { w: 32, h: 32 },
      { w: 96, h: 96 },
      // grown twice from 32 tiles, as expandSave grows a world
      { w: 160, h: 160, originX: -64, originY: -64 },
      // an edge off the chunk grid holds part of a chunk
      { w: 70, h: 45 },
    ];
    for (const seed of [1, 7412, 20260912])
      for (const frame of frames)
        for (const supply of ['simple', 'full'] as const) {
          if (supply === 'full' && frame.w !== 96) continue;
          const at = `seed ${seed}, ${JSON.stringify(frame)}, ${supply}`;
          const world = worldOf(seed, frame);
          const first = groundOf(world, generatorOf(supply));
          expect(first.added, at).toEqual(keysOf(frame));
          const text = JSON.stringify(buildSave(partsOf(world, supply)));
          const read = parseSave(text)!.world as GeneratedWorld;
          // every chunk's text as it was written
          expect(Object.keys(read.chunks!), at).toEqual(Object.keys(world.chunks!));
          for (const [k, t] of Object.entries(world.chunks!)) expect(read.chunks![k], at).toBe(t);
          const again = groundOf(read, never);
          expect(again.added, at).toEqual([]);
          expect(again.unreadable, at).toEqual([]);
          // the planes exactly as the first load had them, and generation's own planes
          expect(firstDifference(again.map, first.map), at).toBeNull();
          const generated = generateMap(seed, world.params, supply);
          expect(firstDifference(again.map, generated, { near: true }), at).toBeNull();
          // and written again, the store is the same text
          expect(JSON.stringify(read.chunks), at).toBe(JSON.stringify(world.chunks));
        }
  }, 20_000);

  it('is never changed by the generator a later load runs, before or after the world grows', () => {
    for (const seed of [1, 31337]) {
      const world = worldOf(seed, { w: 96, h: 96 });
      const old = groundOf(world, generatorOf('simple'));
      const save = parseSave(JSON.stringify(buildSave(partsOf(world))))!;
      const before = { ...(save.world as GeneratedWorld).chunks! };
      // a load with every chunk stored never runs the generator, whatever it would make
      const loaded = groundOf(save.world as GeneratedWorld, never);
      expect(firstDifference(loaded.map, old.map)).toBeNull();
      // grown, the stub that differs from generateMap makes the new ring and nothing else
      expandSave(save);
      const grown = save.world as GeneratedWorld;
      const stub = counting(changed);
      const built = groundOf(grown, stub.gen);
      expect(stub.calls).toEqual([grown.params]);
      for (const [k, t] of Object.entries(before)) expect(grown.chunks![k], k).toBe(t);
      expect(firstDifference(old.map, built.map)).toBeNull();
      const now = changed(seed, grown.params);
      // the stub would have made other ground where the chunks are stored
      expect(firstDifference(old.map, now)).not.toBeNull();
      const fresh = (wx: number, wy: number) => !inStore(before, wx, wy);
      expect(firstDifference(built.map, now, { near: true, only: fresh })).toBeNull();
    }
  });

  it('reports a stored chunk it cannot read, generates its ground for the load, and keeps its text', () => {
    const world = worldOf(5, { w: 64, h: 64 });
    const fine = groundOf(world, generatorOf('simple'));
    world.chunks = { ...world.chunks, '1,0': 'not a chunk' };
    const built = groundOf(world, generatorOf('simple'));
    expect(built.unreadable).toEqual(['1,0']);
    expect(built.added).toEqual([]);
    expect(world.chunks['1,0']).toBe('not a chunk');
    expect(firstDifference(built.map, fine.map)).toBeNull();
  });

  it('is read from what a save holds, leaving out anything that is no chunk', () => {
    const t = groundOf(worldOf(1, { w: 32, h: 32 }), generatorOf('simple')).chunks['0,0'];
    expect(storeOf({ '0,0': t, '-1,2': t, x: t, '01,1': t, '1,1': 5, '2,2': null })).toEqual({
      '0,0': t,
      '-1,2': t,
    });
    for (const v of [undefined, null, 'text', 3, [t], true]) expect(storeOf(v)).toEqual({});
    // a world lacks ground while a chunk its map covers has no text
    const world = worldOf(1, { w: 64, h: 32 });
    expect(lacksGround(world)).toBe(true);
    world.chunks = { '0,0': t };
    expect(lacksGround(world)).toBe(true);
    world.chunks = { '0,0': t, '1,0': 'unread' };
    expect(lacksGround(world)).toBe(false);
  });
});

describe('a save from before saves kept their ground', () => {
  it('gets it on its first load, and a second load reads it alone', () => {
    for (const supply of ['simple', 'full'] as const) {
      const world = worldOf(20260912, { w: 96, h: 96, originX: -32, originY: -32 });
      const save = parseSave(JSON.stringify(oldFile(world, 18, supply)))!;
      const step = MIGRATIONS.find((m) => m.from === 18)!;
      expect(save.loadedFrom).toBe(18);
      expect(save.migrationNotes).toEqual([`v18→v19: ${step.note}`]);
      expect(save.world).toEqual({ ...world, chunks: {} });
      // the first load generates every chunk with the save's chain, and stores them
      const gen = counting(generatorOf(save.supply));
      const first = groundOf(save.world as GeneratedWorld, gen.gen);
      expect(gen.calls).toHaveLength(1);
      expect(first.added).toEqual(keysOf(world.params));
      expect(
        firstDifference(first.map, generateMap(world.seed, world.params, supply), { near: true }),
      ).toBeNull();
      // the game writes the save at once: the next load reads only the stored chunks
      const written = buildSave(partsOf(save.world!, save.supply));
      const next = parseSave(JSON.stringify(written))!;
      expect(next.loadedFrom).toBeUndefined();
      const second = groundOf(next.world as GeneratedWorld, never);
      expect(second.added).toEqual([]);
      expect(firstDifference(second.map, first.map)).toBeNull();
    }
  });

  it('keeps a level as it was: a level stores its own ground', () => {
    const level = {
      ...levelFromMap(emptyMap(5, 40, 40), 'Test', 'test'),
      createdAt: 0,
      updatedAt: 0,
    };
    const world = { kind: 'level', seed: 5, level };
    const save = parseSave(JSON.stringify(oldFile(world, 18)))!;
    expect(save.world).toEqual(world);
  });
});

/** An in-memory `localStorage` that counts its writes and may hold at most `quota` characters. */
class MemoryStorage {
  items = new Map<string, string>();
  writes = 0;
  constructor(public quota = Infinity) {}
  getItem(k: string) {
    return this.items.has(k) ? this.items.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.writes++;
    let size = String(v).length;
    for (const [key, held] of this.items) if (key !== k) size += held.length;
    if (size > this.quota) throw new Error('QuotaExceededError');
    this.items.set(k, String(v));
  }
  removeItem(k: string) {
    this.writes++;
    this.items.delete(k);
  }
}

describe('the saves stored when this version first runs', () => {
  let store: MemoryStorage;
  const use = (s: MemoryStorage) => {
    store = s;
    vi.stubGlobal('localStorage', s);
  };
  beforeEach(() => use(new MemoryStorage()));
  afterEach(() => vi.unstubAllGlobals());

  const small = (seed: number) => worldOf(seed, { w: 64, h: 64 });
  const level = {
    kind: 'level',
    seed: 9,
    level: { ...levelFromMap(emptyMap(9, 32, 32), 'L', 'l'), createdAt: 0, updatedAt: 0 },
  };
  /** Continue's save and named saves of every kind a player can have stored. */
  function storeSaves() {
    const continued = JSON.stringify(oldFile(worldOf(1, { w: 96, h: 96 }), 18));
    const slots: Record<string, string> = {
      full: JSON.stringify(oldFile(small(2), 18, 'full')),
      old: JSON.stringify(oldFile(small(3), 5)),
      // a file from before world descriptions: the default world of its seed
      ancient: JSON.stringify(oldFile(worldOf(4, {}), 2)),
      level: JSON.stringify(oldFile(level, 18)),
      damaged: '{"seed":1,"version":13}',
      notJson: '{oops',
    };
    // a save written since keeps its ground already
    const world = small(6);
    groundOf(world, generatorOf('simple'));
    slots.current = JSON.stringify(buildSave(partsOf(world)));
    store.items.set(SAVE_KEY, continued);
    store.items.set(SLOTS_KEY, JSON.stringify(slots));
    return { continued, slots };
  }
  const slotTexts = (): Record<string, string> =>
    JSON.parse(store.items.get(SLOTS_KEY)!) as Record<string, string>;

  it('each get their ground once, and nothing else of them changes', () => {
    const { continued, slots } = storeSaves();
    const listed = listSlots();
    const gen = counting(changed);
    const report = freezeStoredSaves(() => gen.gen);
    expect(report).toEqual({ ran: true, frozen: 4, refused: 0 });
    expect(gen.calls).toHaveLength(4);
    expect(store.items.get(GROUND_KEY)).toBe(String(SAVE_VERSION));
    // Continue's save and the named ones that had no ground hold it now, and only that is new
    const after = slotTexts();
    const pairs: [string, string][] = [
      [continued, store.items.get(SAVE_KEY)!],
      ...['full', 'old', 'ancient'].map((n): [string, string] => [slots[n], after[n]]),
    ];
    for (const [was, now] of pairs) {
      const a = JSON.parse(was) as Record<string, unknown>;
      const b = JSON.parse(now) as Record<string, unknown>;
      const world = b.world as GeneratedWorld;
      expect(b).toEqual({ ...a, world: { ...(a.world ?? worldOf(4, {})), chunks: world.chunks } });
      expect(Object.keys(world.chunks!)).toEqual(keysOf(world.params));
    }
    // the rest are as they were, byte for byte, and the list shows what it showed
    for (const n of ['level', 'damaged', 'notJson', 'current']) expect(after[n], n).toBe(slots[n]);
    expect(listSlots()).toEqual(listed);
    // each loads from its ground alone: the generator it was given that day, not today's
    const loads: [SaveGame | null, number][] = [
      [readSave(), 1],
      [readSlot('full'), 2],
      [readSlot('old'), 3],
      [readSlot('ancient'), 4],
    ];
    for (const [save, seed] of loads) {
      const world = save!.world as GeneratedWorld;
      expect(world.seed).toBe(seed);
      const built = groundOf(world, never);
      expect(firstDifference(built.map, changed(seed, world.params), { near: true })).toBeNull();
    }
    // once only: the next start finds the pass done, generates nothing and writes nothing
    const writes = store.writes;
    const again = counting(changed);
    expect(freezeStoredSaves(() => again.gen)).toEqual({ ran: false, frozen: 0, refused: 0 });
    expect(again.calls).toEqual([]);
    expect(store.writes).toBe(writes);
  });

  it('are given their chain: a full-chain save its oil', () => {
    storeSaves();
    freezeStoredSaves();
    const oil = (save: SaveGame | null) =>
      [...groundOf(save!.world as GeneratedWorld, never).map.props.values()].some((l) =>
        l.some((p) => p.kind === 'oil'),
      );
    const full = readSlot('full')!;
    expect(full.supply).toBe('full');
    expect(oil(full)).toBe(true);
    expect(oil(readSave())).toBe(false);
  });

  it('stay as they were where storage will not keep them with their ground, and are counted', () => {
    const { continued, slots } = storeSaves();
    // what each save's ground adds to what storage holds (a named save is a text in a table)
    const grounded = (raw: string) => withGround(raw, (s) => generatorOf(s.supply))!;
    const added = (raw: string, inTable: boolean) =>
      inTable
        ? JSON.stringify(grounded(raw)).length - JSON.stringify(raw).length
        : grounded(raw).length - raw.length;
    const first = added(slots.full, true);
    expect(added(slots.old, true)).toBeGreaterThan(10);
    let size = 0;
    for (const v of store.items.values()) size += v.length;
    // room for the first named save's ground and a little more, but not for the next one's
    use(Object.assign(new MemoryStorage(size + first + 10), { items: store.items }));
    expect(added(continued, false)).toBeGreaterThan(first + 10);
    const report = freezeStoredSaves();
    expect(report).toEqual({ ran: true, frozen: 1, refused: 3 });
    // Continue's save would not fit and is as it was; of the named ones, the one that fit has it
    expect(store.items.get(SAVE_KEY)).toBe(continued);
    const after = slotTexts();
    expect(Object.keys(slots).filter((n) => after[n] !== slots[n])).toEqual(['full']);
    expect(after.full).toBe(grounded(slots.full));
    // a save left as it was still lacks its ground, and gets it when it is loaded
    expect(lacksGround(readSave()!.world as GeneratedWorld)).toBe(true);
    expect(lacksGround(readSlot('old')!.world as GeneratedWorld)).toBe(true);
    expect(lacksGround(readSlot('full')!.world as GeneratedWorld)).toBe(false);
  });

  it('are left as they were where the file holds a number JSON cannot write', () => {
    // the step from v8 drops the reputation, so the save loads; the file itself still holds it
    const file = JSON.stringify({
      ...oldFile(small(1), 8),
      economy: { money: 1, tickets: 0, tier: 0, granted: [], reputation: 7 },
    });
    const raw = file.replace('"reputation":7', '"reputation":1e999');
    expect(parseSave(raw)).not.toBeNull();
    expect(withGround(raw, () => generatorOf('simple'))).toBeNull();
    store.items.set(SAVE_KEY, raw);
    expect(freezeStoredSaves()).toEqual({ ran: true, frozen: 0, refused: 0 });
    expect(store.items.get(SAVE_KEY)).toBe(raw);
  });

  it('run again on the next start when storage would not keep that the pass ran', () => {
    storeSaves();
    const s = store;
    const setItem = s.setItem.bind(s);
    s.setItem = (k, v) => {
      if (k === GROUND_KEY) throw new Error('blocked');
      setItem(k, v);
    };
    expect(freezeStoredSaves().frozen).toBe(4);
    s.setItem = setItem;
    // every save has its ground: the second pass generates nothing and only says it ran
    const writes = s.writes;
    const again = counting(changed);
    expect(freezeStoredSaves(() => again.gen)).toEqual({ ran: true, frozen: 0, refused: 0 });
    expect(again.calls).toEqual([]);
    expect(s.writes).toBe(writes + 1);
    expect(s.items.get(GROUND_KEY)).toBe(String(SAVE_VERSION));
  });

  it('in a diagnostics bundle get their ground in the save it carries, the bundle otherwise kept', () => {
    const inner = oldFile(small(7), 18);
    const bundle = {
      diagnostics: 1,
      saveVersion: 18,
      at: '2026-10-09T12:00:00.000Z',
      traffic: { sections: [] },
      save: inner,
    };
    const raw = JSON.stringify(bundle);
    store.items.set(SAVE_KEY, raw);
    store.items.set(SLOTS_KEY, JSON.stringify({ bundle: raw }));
    const shown = [continueMeta(), listSlots()];
    const gen = counting(changed);
    expect(freezeStoredSaves(() => gen.gen)).toEqual({ ran: true, frozen: 2, refused: 0 });
    expect(gen.calls).toHaveLength(2);
    for (const [where, now] of [
      ['Continue', store.items.get(SAVE_KEY)!],
      ['named', slotTexts().bundle],
    ]) {
      const b = JSON.parse(now) as Record<string, unknown> & { save: { world: GeneratedWorld } };
      const chunks = b.save.world.chunks!;
      expect(Object.keys(chunks), where).toEqual(keysOf(small(7).params));
      // the ground goes into the save the bundle carries; the bundle and the save as they were
      expect(b, where).toEqual({
        ...bundle,
        save: { ...inner, world: { ...(inner.world as GeneratedWorld), chunks } },
      });
    }
    expect([continueMeta(), listSlots()]).toEqual(shown);
    // each loads from its ground alone, as the generator of that day made it
    for (const save of [readSave(), readSlot('bundle')]) {
      const world = save!.world as GeneratedWorld;
      const built = groundOf(world, never);
      expect(firstDifference(built.map, changed(7, world.params), { near: true })).toBeNull();
    }
  });

  it('leave a save whose map cannot be made as it was, counted neither frozen nor refused', () => {
    const { continued, slots } = storeSaves();
    // a named save that is no text at all stays in the table as it was
    store.items.set(SLOTS_KEY, JSON.stringify({ ...slots, odd: 5 }));
    // generation fails for one world: the 'old' named save's, seed 3
    const gen: MapGenerator = (s, p) => {
      if (s === 3) throw new Error('generation failed');
      return changed(s, p);
    };
    expect(freezeStoredSaves(() => gen)).toEqual({ ran: true, frozen: 3, refused: 0 });
    const after = slotTexts() as Record<string, unknown>;
    expect(after.old).toBe(slots.old);
    expect(after.odd).toBe(5);
    expect(store.items.get(SAVE_KEY)).not.toBe(continued);
    expect(Object.keys(slots).filter((n) => after[n] !== slots[n])).toEqual(['full', 'ancient']);
    expect(store.items.get(GROUND_KEY)).toBe(String(SAVE_VERSION));
    // it lacks its ground still, and gets it when it is loaded
    expect(lacksGround(readSlot('old')!.world as GeneratedWorld)).toBe(true);
  });

  it('are not touched where storage cannot be read', () => {
    storeSaves();
    const s = store;
    s.getItem = () => {
      throw new Error('blocked');
    };
    const writes = s.writes;
    expect(freezeStoredSaves(() => never)).toEqual({ ran: false, frozen: 0, refused: 0 });
    expect(s.writes).toBe(writes);
  });

  // 30 stored games of up to 7 x 7 chunks of hashed ground, each written, read and built from its
  // store: about 1.6 s alone
  it('that store part of their ground get only the chunks they lack, every stored text kept', () => {
    let rings = 0;
    forAll(
      genGrownSave,
      (c) => {
        store.items.clear();
        const world = worldOf(c.seed, { w: 32 * c.side, h: 32 * c.side });
        // a field a later build may add to the description stays with it too
        Object.assign(world, { later: { kept: [1, 'a'] } });
        groundOf(world, hashedGen(1));
        const save = parseSave(JSON.stringify(buildSave(partsOf(world))))!;
        // main.ts grows a save ring by ring as it reads it and writes it at once, before the game
        // stores the ground of the new rings
        for (let r = 0; r < c.rings; r++) expandSave(save);
        const grown = save.world as GeneratedWorld;
        const before = { ...grown.chunks! };
        expect(Object.keys(before)).toEqual(keysOf(world.params));
        const raw = JSON.stringify(save);
        if (c.inSlot) store.items.set(SLOTS_KEY, JSON.stringify({ grown: raw }));
        else store.items.set(SAVE_KEY, raw);
        const gen = counting(hashedGen(2));
        expect(freezeStoredSaves(() => gen.gen)).toEqual({ ran: true, frozen: 1, refused: 0 });
        expect(gen.calls).toEqual([grown.params]);
        // every stored text as it was, the chunks it lacked added, and nothing else of the file new
        const now = c.inSlot ? slotTexts().grown : store.items.get(SAVE_KEY)!;
        const file = JSON.parse(now) as SaveGame;
        const chunks = (file.world as GeneratedWorld).chunks!;
        for (const [k, t] of Object.entries(before)) expect(chunks[k], `chunk ${k}`).toBe(t);
        expect(Object.keys(chunks).sort()).toEqual(keysOf(grown.params).sort());
        const was = JSON.parse(raw) as SaveGame;
        expect(file).toEqual({ ...was, world: { ...was.world, chunks } });
        rings += Object.keys(chunks).length - Object.keys(before).length;
        // read from the store alone: each chunk the ground of the generator that first covered it
        const loaded = (c.inSlot ? readSlot('grown') : readSave())!;
        const map = groundOf(loaded.world as GeneratedWorld, never).map;
        const p = { ...DEFAULT_MAP_PARAMS, ...grown.params };
        const old = (wx: number, wy: number) => inStore(before, wx, wy);
        const where =
          firstDifference(map, hashedGen(1)(c.seed, p), { only: old }) ??
          firstDifference(map, hashedGen(2)(c.seed, p), { only: (wx, wy) => !old(wx, wy) });
        if (where) throw new Error(where);
      },
      { seeds: Array.from({ length: 30 }, (_, i) => i + 1), shrink: shrinkGrownSave },
    );
    expect(rings).toBeGreaterThan(0);
  }, 30_000);
});

/** A stored game grown since its ground was last written whole, kept as Continue or a named save. */
interface GrownSave {
  seed: number;
  /** chunks a side before it grew */
  side: number;
  /** rings it grew by */
  rings: number;
  inSlot: boolean;
}
const genGrownSave = (rng: Rng): GrownSave => ({
  seed: rng.int(0, 2 ** 31 - 1),
  side: rng.int(1, 3),
  rings: rng.int(1, 2),
  inSlot: rng.chance(0.5),
});
function* shrinkGrownSave(c: GrownSave): Iterable<GrownSave> {
  for (const side of shrinkInt(c.side, 1)) yield { ...c, side };
  for (const rings of shrinkInt(c.rings, 1)) yield { ...c, rings };
  if (c.inSlot) yield { ...c, inSlot: false };
}

describe('a world that grows', () => {
  it('keeps the ground it stores, and the next load generates the new ring alone', () => {
    for (const seed of [1, 7412]) {
      const world = worldOf(seed, { w: 96, h: 96 });
      groundOf(world, generatorOf('simple'));
      const save = parseSave(JSON.stringify(buildSave(partsOf(world))))!;
      const before = (save.world as GeneratedWorld).chunks!;
      expandSave(save);
      const grown = save.world as GeneratedWorld;
      expect(grown.chunks).toEqual(before);
      const built = groundOf(grown, generatorOf('simple'));
      expect(built.added).toEqual(keysOf(grown.params).filter((k) => !Object.hasOwn(before, k)));
      // the generator unchanged, the grown world is generation's of the grown parameters
      const whole = generateMap(seed, grown.params);
      expect(firstDifference(built.map, whole, { near: true })).toBeNull();
    }
  });

  // 20 worlds grown by up to three rings at once, to up to 288 tiles a side: about 0.5 s alone
  it('changes only the frame of its description, and the next load adds just the new rings', () => {
    forAll(
      (rng) => ({ seed: rng.int(0, 2 ** 31 - 1), side: rng.int(1, 3), ring: rng.int(1, 3) }),
      (c) => {
        // a field a later build may add to the description travels with it, as the store does
        const world: GeneratedWorld = { ...worldOf(c.seed, { w: 32 * c.side, h: 32 * c.side }) };
        Object.assign(world, { later: { kept: [1, 'a'] } });
        groundOf(world, hashedGen(1));
        const save = parseSave(JSON.stringify(buildSave(partsOf(world))))!;
        const was = structuredClone(save.world) as GeneratedWorld;
        expandSave(save, c.ring);
        const grown = save.world as GeneratedWorld;
        const d = CHUNK_TILES * c.ring;
        const { w, h, originX = 0, originY = 0 } = was.params;
        const frame = { w: w + 2 * d, h: h + 2 * d, originX: originX - d, originY: originY - d };
        expect(grown).toEqual({ ...was, params: { ...was.params, ...frame } });
        // the next load makes the chunks of the new rings and nothing else
        const gen = counting(hashedGen(2));
        const built = groundOf(grown, gen.gen);
        expect(gen.calls).toEqual([grown.params]);
        expect(built.added).toEqual(
          keysOf(grown.params).filter((k) => !Object.hasOwn(was.chunks!, k)),
        );
        expect(built.added).toHaveLength((c.side + 2 * c.ring) ** 2 - c.side ** 2);
        for (const [k, t] of Object.entries(was.chunks!)) expect(grown.chunks![k], k).toBe(t);
      },
      {
        seeds: Array.from({ length: 20 }, (_, i) => i + 1),
        shrink: function* (c) {
          for (const side of shrinkInt(c.side, 1)) yield { ...c, side };
          for (const ring of shrinkInt(c.ring, 1)) yield { ...c, ring };
        },
      },
    );
  }, 10_000);

  it('mixes stored and new ground after a generator change, and track crosses the seam', () => {
    for (const seed of [1, 7412, 31337]) {
      const world = worldOf(seed, { w: 96, h: 96 });
      const old = groundOf(world, generatorOf('simple')).map;
      const save = parseSave(JSON.stringify(buildSave(partsOf(world))))!;
      save.regions = new Array<boolean>(9).fill(true);
      expandSave(save);
      const grown = save.world as GeneratedWorld;
      const map = groundOf(grown, changed).map;
      const now = changed(seed, grown.params);
      // the stored chunks as they were, the new ring the changed generator's, meeting at a seam
      expect(firstDifference(old, map)).toBeNull();
      const ring = (wx: number, wy: number) => wx < 0 || wy < 0 || wx >= 96 || wy >= 96;
      expect(firstDifference(map, now, { near: true, only: ring })).toBeNull();
      expect(firstDifference(old, now)).not.toBeNull();

      // the build rules of a game on the grown map: every chunk owned, the ground the renderer's
      // relief allows, materials enough
      const regions = new RegionState(map);
      regions.load(new Array<boolean>(regions.unlocked.length).fill(true));
      const track = new TrackGraph(map.w, map.h);
      const stock = new Stockpile();
      for (const [k, v] of Object.entries(pieceCost('straight'))) stock.add(k, v * 1000);
      const builder = new Builder(map, regions, track, new Economy(), stock);
      const relief = buildRelief(map, new Set());
      builder.groundCheck = (x, y, need) => groundAllows(map, relief, x, y, need);

      // ordinary ground: no water, rock or mountain, and level, three tiles on either side
      const ordinary = (x: number, y: number) => {
        const t = map.terrain[y * map.w + x];
        return (
          (t === Terrain.Grass || t === Terrain.Forest || t === Terrain.Sand) &&
          groundAllows(map, relief, x, y, 'level')
        );
      };
      // the west seam (world x 0, map x 32) and the north one (world y 0, map y 32)
      const seam = CHUNK_TILES;
      const across = (along: number) =>
        [-3, -2, -1, 0, 1, 2].map((d) => ({ d, x: seam + d, y: along }));
      let laid = 0;
      for (const axis of ['x', 'y'] as const) {
        const at = (p: { x: number; y: number }) => (axis === 'x' ? p : { x: p.y, y: p.x });
        const row = Array.from({ length: 96 }, (_, i) => seam + i).find((along) =>
          across(along).every((p) => ordinary(at(p).x, at(p).y)),
        );
        expect(row, `seed ${seed}: a row of ordinary ground across the ${axis} seam`).toBeDefined();
        const tiles = across(row!).map(at);
        for (const t of tiles) {
          const rot = axis === 'x' ? 1 : 0;
          const check = builder.checkTrack(t.x, t.y, { kind: 'straight', cls: 'regular' }, rot);
          expect(check.reason, `seed ${seed}: (${t.x}, ${t.y})`).toBeUndefined();
          expect(builder.placeTrack(t.x, t.y, { kind: 'straight', cls: 'regular' }, rot)).toBe(
            true,
          );
          laid++;
        }
        // a train finds its way from the new ground onto the stored ground
        const [from, to] = [tiles[0], tiles[tiles.length - 1]];
        const path = findPath(
          track,
          { ...from, in: axis === 'x' ? Dir.W : Dir.N },
          (x, y) => x === to.x && y === to.y,
        );
        expect(path, `seed ${seed}: a way across the ${axis} seam`).not.toBeNull();
      }
      expect(laid).toBe(12);
    }
  });
});

/**
 * A generator unlike generateMap and unlike every other salt: each plane is hashed from the world
 * tile, so a salt makes the same ground wherever the frame lies, and another salt other ground.
 * Prop offsets are whole 256ths of a tile, so a chunk stores them exactly.
 */
function hashedGen(salt: number): MapGenerator {
  return (seed, params) => {
    const p = { ...DEFAULT_MAP_PARAMS, ...params };
    const m = emptyMap(seed, p.w, p.h, Terrain.Grass, p.originX ?? 0, p.originY ?? 0);
    for (let y = 0; y < m.h; y++)
      for (let x = 0; x < m.w; x++) {
        const at = (k: number) => hash2(x + m.originX, y + m.originY, salt * 8 + k);
        const i = y * m.w + x;
        m.terrain[i] = Math.floor(at(0) * 16);
        m.biome[i] = Math.floor(at(1) * 16);
        m.variant[i] = Math.floor(at(2) * 4);
        if (at(3) < 0.25)
          m.props.set(i, [
            {
              kind: PROP_KINDS[Math.floor(at(4) * PROP_KINDS.length)],
              variant: Math.floor(at(5) * 8),
              ox: Math.floor(at(6) * 200 - 100) / 256,
              oy: Math.floor(at(7) * 200 - 100) / 256,
            },
          ]);
      }
    return m;
  };
}

/**
 * A world's life: its seed, the chunks a side it starts with, then the rings it grows by before
 * each later load.
 */
interface Life {
  seed: number;
  side: number;
  grows: number[];
}
const genLife = (rng: Rng): Life => ({
  seed: rng.int(0, 2 ** 31 - 1),
  side: rng.int(1, 3),
  grows: Array.from({ length: rng.int(1, 3) }, () => rng.pick([0, 1, 1, 2])),
});
function* shrinkLife(l: Life): Iterable<Life> {
  for (const side of shrinkInt(l.side, 1)) yield { ...l, side };
  for (const grows of shrinkArray(l.grows, (g) => shrinkInt(g)))
    if (grows.length) yield { ...l, grows };
}

describe('a world grown again and again, under another generator at every load', () => {
  // 30 lives of up to four loads on maps up to 480 tiles a side, every plane compared at each
  // load: about 2 s alone
  it('keeps every chunk as the load that first covered it made it, text and planes', () => {
    let mixed = 0;
    let idle = 0;
    let overruled = 0;
    forAll(
      genLife,
      (life) => {
        const { seed } = life;
        let text = JSON.stringify(
          buildSave(partsOf(worldOf(seed, { w: 32 * life.side, h: 32 * life.side }))),
        );
        /** the text each chunk was first stored with, and the load that made it */
        const first = new Map<string, string>();
        const madeAt = new Map<string, number>();
        /** the load that made the chunk of world tile (`wx`, `wy`), by chunk row and column */
        const epochOf = new Map<number, number>();
        const epochAt = (wx: number, wy: number) =>
          epochOf.get((chunkOf(wx) + 64) * 128 + chunkOf(wy) + 64);
        /** the map each load's generator made, on that load's frame; none where it made none */
        const made: (GameMap | null)[] = [];
        for (let load = 0; load <= life.grows.length; load++) {
          const save = parseSave(text)!;
          // main.ts grows a save ring by ring as it reads it, and writes it before the game starts
          for (let r = 0; r < (load ? life.grows[load - 1] : 0); r++) expandSave(save);
          const world = parseSave(JSON.stringify(save))!.world as GeneratedWorld;
          const params = { ...DEFAULT_MAP_PARAMS, ...world.params };
          const before = storeOf(world.chunks);
          const fresh = keysOf(params).filter((k) => !Object.hasOwn(before, k));
          const gen = counting(hashedGen(load));
          const built = groundOf(world, gen.gen);
          // the generator runs once when the map covers a chunk the store lacks, else not at all
          expect(gen.calls, `load ${load}`).toEqual(fresh.length ? [params] : []);
          if (!fresh.length) idle++;
          expect(built.added, `load ${load}`).toEqual(fresh);
          expect(built.unreadable).toEqual([]);
          // every chunk stored at an earlier load is the very text it was first stored with
          for (const [k, t] of first) expect(world.chunks![k], `chunk ${k}, load ${load}`).toBe(t);
          expect(Object.keys(world.chunks!).sort()).toEqual(keysOf(params).sort());
          for (const k of fresh) {
            first.set(k, world.chunks![k]);
            madeAt.set(k, load);
            const { cx, cy } = parseChunkKey(k)!;
            epochOf.set((cx + 64) * 128 + cy + 64, load);
          }
          made.push(fresh.length ? hashedGen(load)(seed, params) : null);
          // each tile is the ground of the load that first covered its chunk
          const epochs = new Set(madeAt.values());
          if (epochs.size > 1) mixed++;
          for (const e of epochs) {
            const where = firstDifference(built.map, made[e]!, {
              only: (wx, wy) => epochAt(wx, wy) === e,
            });
            if (where) throw new Error(`load ${load}: ground first made at load ${e}: ${where}`);
          }
          // and this load's generator would have made other ground where a chunk was stored
          if (overruled < 5 && Object.keys(before).length) {
            const now = hashedGen(load)(seed, params);
            const kept = (wx: number, wy: number) => inStore(before, wx, wy);
            if (firstDifference(built.map, now, { only: kept })) overruled++;
          }
          // the game writes the save as soon as it loads
          text = JSON.stringify(buildSave(partsOf(world)));
        }
      },
      { seeds: Array.from({ length: 30 }, (_, i) => i + 1), shrink: shrinkLife, shrinkBudget: 100 },
    );
    // worlds that mixed ground of several loads ran, loads that grew nothing, and generators that
    // would have changed stored ground
    expect(mixed).toBeGreaterThan(0);
    expect(idle).toBeGreaterThan(0);
    expect(overruled).toBeGreaterThan(0);
  }, 40_000);

  // three maps of real ground up to 224 tiles a side, for each seed: about 0.6 s alone
  it('keeps each ring of real ground as the generator of its day made it, over two growths', () => {
    const changedAgain: MapGenerator = (s, p) => ({ ...generateMap(s + 2, p), seed: s });
    for (const seed of [1, 7412]) {
      const gens = [generatorOf('simple'), changed, changedAgain];
      const world = worldOf(seed, { w: 96, h: 96 });
      const maps: GameMap[] = [];
      const firstTexts: ChunkStore = {};
      let save = parseSave(JSON.stringify(buildSave(partsOf(world))))!;
      gens.forEach((gen, load) => {
        if (load) expandSave(save);
        const w = save.world as GeneratedWorld;
        const built = groundOf(w, gen);
        for (const [k, t] of Object.entries(firstTexts))
          expect(w.chunks![k], `seed ${seed}, chunk ${k}, load ${load}`).toBe(t);
        for (const k of built.added) firstTexts[k] = w.chunks![k];
        maps.push(gen(seed, w.params));
        save = parseSave(JSON.stringify(buildSave(partsOf(w))))!;
      });
      const last = groundOf(save.world as GeneratedWorld, never).map;
      // ring by ring, the ground of the generator of the load that first covered it
      const ringOf = (wx: number, wy: number) =>
        Math.max(0, -chunkOf(wx), -chunkOf(wy), chunkOf(wx) - 2, chunkOf(wy) - 2);
      maps.forEach((m, ring) => {
        const where = firstDifference(last, m, {
          near: true,
          only: (wx, wy) => ringOf(wx, wy) === ring,
        });
        expect(where, `seed ${seed}, ring ${ring}`).toBeNull();
      });
      // the generators differ where the rings meet them
      expect(firstDifference(maps[1], maps[2], { near: true })).not.toBeNull();
    }
  }, 10_000);
});

describe('the seams of a world grown under a changed generator', () => {
  // four worlds of 160 tiles a side, each seam row checked against the build rules: about 0.2 s
  it('take track on every row of ordinary ground across each of the four seams', () => {
    const straight = { kind: 'straight', cls: 'regular' } as const;
    for (const seed of [1, 7412, 31337, 20260912]) {
      const world = worldOf(seed, { w: 96, h: 96 });
      groundOf(world, generatorOf('simple'));
      const save = parseSave(JSON.stringify(buildSave(partsOf(world))))!;
      expandSave(save);
      const map = groundOf(save.world as GeneratedWorld, changed).map;
      const regions = new RegionState(map);
      regions.load(new Array<boolean>(regions.unlocked.length).fill(true));
      const track = new TrackGraph(map.w, map.h);
      const stock = new Stockpile();
      for (const [k, v] of Object.entries(pieceCost('straight'))) stock.add(k, v * 1000);
      const builder = new Builder(map, regions, track, new Economy(), stock);
      const relief = buildRelief(map, new Set());
      builder.groundCheck = (x, y, need) => groundAllows(map, relief, x, y, need);
      const ordinary = (t: { x: number; y: number }) => {
        const k = map.terrain[t.y * map.w + t.x];
        return (
          (k === Terrain.Grass || k === Terrain.Forest || k === Terrain.Sand) &&
          groundAllows(map, relief, t.x, t.y, 'level')
        );
      };
      // the stored chunks fill map tiles 32 to 127 on either axis; the ring lies outside them
      const seams = [
        { name: 'west', axis: 'x', at: 32 },
        { name: 'east', axis: 'x', at: 128 },
        { name: 'north', axis: 'y', at: 32 },
        { name: 'south', axis: 'y', at: 128 },
      ] as const;
      const rowsOf = (s: (typeof seams)[number]) => {
        const rows: { x: number; y: number }[][] = [];
        for (let along = 32; along < 128; along++) {
          const tiles = [-3, -2, -1, 0, 1, 2].map((d) =>
            s.axis === 'x' ? { x: s.at + d, y: along } : { x: along, y: s.at + d },
          );
          if (tiles.every(ordinary)) rows.push(tiles);
        }
        return rows;
      };
      for (const s of seams) {
        const rows = rowsOf(s);
        expect(
          rows.length,
          `seed ${seed}: ordinary ground across the ${s.name} seam`,
        ).toBeGreaterThan(0);
        // the rows straddle the seam: one side stored, the other the changed generator's
        const rot = s.axis === 'x' ? 1 : 0;
        for (const row of rows)
          for (const t of row) {
            const check = builder.checkTrack(t.x, t.y, straight, rot);
            if (!check.ok)
              throw new Error(
                `seed ${seed}, ${s.name} seam: a straight at (${t.x}, ${t.y}) refused: ${check.reason}`,
              );
          }
      }
      // one row a seam laid, and a train finds its way across each
      for (const s of seams) {
        const row = rowsOf(s)[0];
        const rot = s.axis === 'x' ? 1 : 0;
        for (const t of row) expect(builder.placeTrack(t.x, t.y, straight, rot)).toBe(true);
        const [from, to] = [row[0], row[row.length - 1]];
        const path = findPath(
          track,
          { ...from, in: s.axis === 'x' ? Dir.W : Dir.N },
          (x, y) => x === to.x && y === to.y,
        );
        expect(path, `seed ${seed}: a way across the ${s.name} seam`).not.toBeNull();
      }
    }
  });
});

describe('the chain a save is given its ground in', () => {
  beforeEach(() => setSupplyMode(DEFAULT_SUPPLY));
  afterEach(() => setSupplyMode(DEFAULT_SUPPLY));

  // the start-up pass gives a stored save `generatorOf(save.supply)`; a load gives
  // `generatorOf(supplyMode())` once the game has taken the save's chain (`setSupplyMode`), so a
  // save gets the same ground whichever of the two generates it
  it('is the one a load runs the game in, for anything a file holds as its chain', () => {
    const p = { w: 64, h: 64 };
    const full = generateMap(2, p, 'full');
    const simple = generateMap(2, p, 'simple');
    expect(firstDifference(full, simple), 'the chains make other ground').not.toBeNull();
    for (const held of ['full', 'simple', undefined, null, 'FULL', 'medium', 1] as unknown[]) {
      setSupplyMode(held as SupplyMode);
      const atLoad = generatorOf(supplyMode())(2, p);
      const atStart = generatorOf(held as SupplyMode)(2, p);
      expect(firstDifference(atStart, atLoad), `supply ${String(held)}`).toBeNull();
      const chain = held === 'full' ? full : simple;
      expect(firstDifference(atStart, chain), `supply ${String(held)}`).toBeNull();
    }
  });
});
