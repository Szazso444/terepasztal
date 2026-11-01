export const enum Terrain {
  Grass = 0,
  Forest = 1,
  Hill = 2,
  Water = 3,
  Rock = 4,
  Sand = 5,
  /** the raised heart of a large stone field; nothing can be built on it */
  Mountain = 6,
  /** a glacier: ice where a river would run above the snow line (glaciers.ts); nothing stands on it */
  Ice = 7,
}
export const TERRAIN_NAMES = [
  'grass',
  'forest',
  'hill',
  'water',
  'rock',
  'sand',
  'mountain',
  'ice',
] as const;

/**
 * Ids are stored in saves (src/world/chunks.ts), so they are appended and never renumbered. Plains
 * to Ocean are climates: generation picks one for every tile. Lake, River, Beach and Mountain are
 * landforms a tile's climate is relabelled to (generateMap's biome rules); the climate stays
 * readable under them (climateAt).
 */
export const enum Biome {
  Plains = 0,
  Forest = 1,
  Desert = 2,
  Taiga = 3,
  Swamp = 4,
  Ocean = 5,
  /** water that is neither sea nor river */
  Lake = 6,
  /** water the river pass made of land */
  River = 7,
  /** sand on the sea shore */
  Beach = 8,
  /** a mountain and the rock of its field */
  Mountain = 9,
}
export const BIOME_NAMES = [
  'plains',
  'forest',
  'desert',
  'taiga',
  'swamp',
  'ocean',
  'lake',
  'river',
  'beach',
  'mountain',
] as const;
/** The climates, ids 0 to CLIMATES - 1: the biomes generation picks before any landform rule. */
export const CLIMATES = 6;

export type PropKind =
  | 'tree'
  | 'pine'
  | 'rock'
  | 'bush'
  | 'birch'
  | 'spruce'
  | 'oak'
  | 'palm'
  | 'cactus'
  | 'deadtree'
  | 'flowers'
  | 'reeds'
  | 'boulder'
  /** deposits: a coal seam on a hill, an oil seep on low ground (full production chain) */
  | 'coal'
  | 'oil'
  /** a tile of a wheat field on plains grass (generateMap's wheat pass) */
  | 'wheat';
export interface PropInstance {
  kind: PropKind;
  variant: number;
  /** offset within the tile in tile units (-0.4..0.4) */
  ox: number;
  oy: number;
}

export interface GameMap {
  w: number;
  h: number;
  seed: number;
  /** world coordinate of tile (0,0); grows negative as the map expands around the start */
  originX: number;
  originY: number;
  terrain: Uint8Array;
  variant: Uint8Array;
  /** per-tile biome id (see Biome) */
  biome: Uint8Array;
  /**
   * per-tile climate, as a biome id: the biome a tile had before any rule relabelled it by its
   * landform (Lake, River, Beach, Mountain). generateMap fills it with climates (ids below
   * CLIMATES), and a map built from stored chunks has it as stored (a chunk stored before the
   * plane holds its biome there). A map from a level or the editor's blank map has none, and there
   * every tile's climate is its biome. Read it through climateAt or climateAtIndex.
   */
  climate?: Uint8Array;
  /**
   * per-tile water level of each Water tile, 0 to MAX_LEVEL: the level its surface stands at
   * (levelTarget). Rivers on high ground stand above level 0 and never rise downstream. A map
   * without the plane, a level or the editor's, and a chunk stored before it, has all its water at
   * level 0, as has a tile whose terrain is not Water.
   */
  waterSurface?: Uint8Array;
  /**
   * per-tile flow of each river tile: the tiles of rain it gathers, 1 to FLOW_CAP (0 in a chunk
   * stored before the plane), 0 elsewhere
   */
  flow?: Uint16Array;
  /**
   * per-tile downstream side of each river tile, as Dir + 1 (1 N, 2 E, 3 S, 4 W): the tile its
   * water runs into, which is water or off the map. 0 elsewhere.
   */
  flowDir?: Uint8Array;
  /**
   * per-tile water features, a byte each, laid out in src/world/waterfalls.ts: a waterfall's drop
   * and the edge it falls over, on the river tile the water falls from, with bits kept for the
   * headwater kind (#356). Read a waterfall through waterfallAt. A map without the plane, a level
   * or the editor's, and a chunk stored before it, has no waterfalls.
   */
  feature?: Uint8Array;
  /** per-tile decoration, sparse */
  props: Map<number, PropInstance[]>;
  /** region size in tiles (regions are square blocks) */
  regionSize: number;
  regionsX: number;
  regionsY: number;
}

export function idx(map: GameMap, x: number, y: number) {
  return y * map.w + x;
}
export function inBounds(map: GameMap, x: number, y: number) {
  return x >= 0 && y >= 0 && x < map.w && y < map.h;
}
export function terrainAt(map: GameMap, x: number, y: number): Terrain {
  if (!inBounds(map, x, y)) return Terrain.Rock;
  return map.terrain[idx(map, x, y)] as Terrain;
}
/** The planes the climate is read from, so a worker's copy of the map can read it too. */
export type ClimateMap = Pick<GameMap, 'w' | 'h' | 'biome' | 'climate'>;
/**
 * The climate under a tile: its climate plane's value where the map has one, its biome otherwise.
 * Off the map it is plains, as the biome there is (`biomeAt` in src/sim/biomes.ts).
 */
export function climateAt(map: ClimateMap, x: number, y: number): Biome {
  if (x < 0 || y < 0 || x >= map.w || y >= map.h) return Biome.Plains;
  return climateAtIndex(map, y * map.w + x);
}
/** climateAt for tile index `i` (`y * w + x`), which must be on the map. */
export function climateAtIndex(map: Pick<ClimateMap, 'biome' | 'climate'>, i: number): Biome {
  return (map.climate ?? map.biome)[i] as Biome;
}
export function regionOf(map: GameMap, x: number, y: number) {
  return Math.floor(y / map.regionSize) * map.regionsX + Math.floor(x / map.regionSize);
}
/**
 * The chunk a game starts in: the middle of the grid, the one nearer the origin when the count is
 * even. Growing the map by a ring on every side keeps it on the same world tiles.
 */
export function startRegion(map: GameMap) {
  return { rx: Math.floor((map.regionsX - 1) / 2), ry: Math.floor((map.regionsY - 1) / 2) };
}
