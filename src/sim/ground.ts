import {
  buildMap,
  chunkKey,
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
 * chunk any build stored, and is left out.
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
 * store. Reads the keys only; a text that cannot be read is the load's to report (`groundOf`).
 */
export function lacksGround(world: GeneratedWorld): boolean {
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
 * text is kept as it was.
 */
export function groundOf(world: GeneratedWorld, generate: MapGenerator): BuiltMap {
  const built = buildMap(world.seed, world.params, storeOf(world.chunks), generate);
  world.chunks = built.chunks;
  return built;
}
