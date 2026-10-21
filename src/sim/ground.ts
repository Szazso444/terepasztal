import {
  CHUNK_TILES,
  buildMap,
  chunkKey,
  chunkOf,
  mapChunks,
  parseChunkKey,
  type BuiltMap,
  type ChunkStore,
  type MapGenerator,
} from '../world/chunks';
import { DEFAULT_MAP_PARAMS, generateMap } from '../world/mapgen';
import type { WorldSpec } from './save';
import type { SupplyMode } from './supply';

/**
 * The ground of a generated world: its map built from the chunks its save stores, the chunks it
 * lacks generated and stored with them (src/world/chunks.ts). A load never generates a stored
 * chunk again, so a change to map generation reaches only the chunks generated after it.
 */

/** A generated world's description, as a save holds it. */
export type GeneratedWorld = Extract<WorldSpec, { kind: 'generated' }>;

/**
 * The most chunks the map of a generated world may cover: 1024, a square of 32 x 32 chunks. The
 * code that sells growth has no upper limit of its own (`ownsBorderChunk` asks `expandSave` for
 * another ring whenever an owned chunk touches the map's edge), so growth stops here: a ring that
 * would take the map past it is not added (`ringsWithinBound`), and the purchase stands without
 * it. So this is the largest world the game reaches, and no world a player makes is refused. A
 * new game starts with at most 15 x 15 chunks (the top of `rules.mapSize`, 480 tiles), well below
 * it. It also keeps a save whose description names an absurd map (a hand edit, an import) from
 * being generated in full, which hangs the game before its menu. One constant, so it can be
 * raised; a save made at a higher bound is refused by a build with a lower one.
 */
export const MAX_WORLD_CHUNKS = 1024;
/** No map reaches further than this many tiles from the origin of tile coordinates. */
const MAX_TILE_COORD = 2 ** 30;

/**
 * The chunks one axis of a map covers, counted as `mapChunks` walks them; null when the origin or
 * the size is no finite number, or reaches further than any map does: a size over a line of
 * MAX_WORLD_CHUNKS chunks (whatever the other axis is, it is too large to allocate), or a
 * coordinate so large that a walk over it would not advance.
 */
function chunksAlong(origin: unknown, size: unknown): number | null {
  if (typeof origin !== 'number' || typeof size !== 'number') return null;
  if (!Number.isFinite(origin) || !Number.isFinite(size)) return null;
  if (size > MAX_WORLD_CHUNKS * CHUNK_TILES) return null;
  if (Math.abs(origin) > MAX_TILE_COORD || Math.abs(origin + size) > MAX_TILE_COORD) return null;
  return Math.max(0, chunkOf(origin + size - 1) - chunkOf(origin) + 1);
}

/**
 * Whether the map a save's `world` describes is one the game builds: at most MAX_WORLD_CHUNKS
 * chunks, counted without walking them, so an absurd size is answered at once. Takes what a save
 * holds, a file's `world` as read or a `WorldSpec`, and answers from its `params` merged over the
 * defaults as a load reads them. A level carries its own ground and is always within the bound;
 * so is anything that is no world description, which is not generated. A size or origin that is
 * no finite number describes no map the game can build, and is beyond the bound.
 */
export function worldWithinBound(world: unknown): boolean {
  if (typeof world !== 'object' || world === null || Array.isArray(world)) return true;
  const spec = world as { kind?: unknown; params?: unknown };
  if (spec.kind === 'level') return true;
  const given = spec.params;
  const p: Record<string, unknown> = {
    ...DEFAULT_MAP_PARAMS,
    ...(typeof given === 'object' && given !== null && !Array.isArray(given) ? given : {}),
  };
  const across = chunksAlong(p.originX ?? 0, p.w);
  const down = chunksAlong(p.originY ?? 0, p.h);
  return across !== null && down !== null && across * down <= MAX_WORLD_CHUNKS;
}

/** What `groundOf` throws for a world beyond the bound: it generates nothing. */
export class WorldTooLarge extends Error {
  constructor() {
    super(`the map is larger than ${MAX_WORLD_CHUNKS} chunks, which the game does not build`);
  }
}

/**
 * Map generation of a game's production chain, the generator its ground is made with: the chain
 * the save names (anything but `full` is the simple one, as `setSupplyMode` reads it), never the
 * game-wide switch.
 */
export function generatorOf(supply: SupplyMode | undefined): MapGenerator {
  const chain: SupplyMode = supply === 'full' ? 'full' : 'simple';
  return (seed, params) => generateMap(seed, params, chain);
}

/**
 * The store a save holds for a world, as buildMap reads it: every text under a key chunkKey
 * writes. Anything else (no table at all, a key no chunk has, a value that is no text) is no
 * chunk any build stored, and is left out of the build. It is not lost: `groundOf` carries it
 * through to the world's table untouched.
 */
export function storeOf(v: unknown): ChunkStore {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return {};
  const out: ChunkStore = {};
  for (const [k, text] of Object.entries(v))
    if (typeof text === 'string' && parseChunkKey(k)) out[k] = text;
  return out;
}

/**
 * Whether a load of `world` would generate ground: a chunk its map covers has no text in its
 * store. Reads the keys only; a text that cannot be read is the load's to report (`groundOf`). A
 * world beyond the bound (`worldWithinBound`) is refused by a load and generates nothing.
 */
export function lacksGround(world: GeneratedWorld): boolean {
  if (!worldWithinBound(world)) return false;
  const store = storeOf(world.chunks);
  const p = { ...DEFAULT_MAP_PARAMS, ...world.params };
  return mapChunks(p).some(({ cx, cy }) => !Object.hasOwn(store, chunkKey(cx, cy)));
}

/**
 * The map of a generated world, from the chunks it stores (`buildMap`): the chunks its store
 * lacks are made with `generate` (`generatorOf` the save's chain) and their text joins the
 * world's store, which this sets on `world` itself, so a save written from it keeps them. What it
 * reports: `added`, the chunks generated now, which a loaded game writes at once; `unreadable`,
 * the stored texts it could not read, whose ground is generated now for this load only and whose
 * text is kept as it was. Whatever else the world's table holds is kept too (`withUnread`). A
 * world beyond the bound (`worldWithinBound`) is not built: this throws WorldTooLarge before it
 * generates anything, and a load asks first (`readSaveText` refuses such a save).
 */
export function groundOf(world: GeneratedWorld, generate: MapGenerator): BuiltMap {
  if (!worldWithinBound(world)) throw new WorldTooLarge();
  const built = buildMap(world.seed, world.params, storeOf(world.chunks), generate);
  built.chunks = withUnread(world.chunks, built.chunks);
  world.chunks = built.chunks;
  return built;
}

/**
 * The table a world keeps after a build: `built`, the build's store, and with it every entry of
 * the `held` table the build did not read (`storeOf`), as it was and where it was, so a save
 * written from it carries what this build does not know. An entry under a key the map covers
 * gives way to the chunk's text. A `held` that is no table is replaced, as there is nothing to
 * carry. The table is typed as a ChunkStore, which is what the build reads; one loaded from a
 * file may hold more.
 */
function withUnread(held: unknown, built: ChunkStore): ChunkStore {
  if (typeof held !== 'object' || held === null || Array.isArray(held)) return built;
  const table = new Map<string, unknown>();
  for (const [key, value] of Object.entries(held))
    table.set(key, Object.hasOwn(built, key) ? built[key] : value);
  for (const [key, text] of Object.entries(built)) if (!table.has(key)) table.set(key, text);
  // fromEntries defines every key as a property of its own, a "__proto__" entry included
  return Object.fromEntries(table) as ChunkStore;
}
