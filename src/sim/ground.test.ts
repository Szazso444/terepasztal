import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  GROUND_KEY,
  MIGRATIONS,
  SAVE_KEY,
  SAVE_VERSION,
  SLOTS_KEY,
  buildSave,
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
import type { SupplyMode } from './supply';
import {
  CHUNK_TILES,
  chunkKey,
  chunkOf,
  mapChunks,
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
});

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
