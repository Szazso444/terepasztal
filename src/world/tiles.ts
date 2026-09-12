export const enum Terrain {
  Grass = 0,
  Forest = 1,
  Hill = 2,
  Water = 3,
  Rock = 4,
  Sand = 5,
  /** the raised heart of a large stone field; nothing can be built on it */
  Mountain = 6,
}
export const TERRAIN_NAMES = [
  'grass',
  'forest',
  'hill',
  'water',
  'rock',
  'sand',
  'mountain',
] as const;

export const enum Biome {
  Plains = 0,
  Forest = 1,
  Desert = 2,
  Taiga = 3,
  Swamp = 4,
  Ocean = 5,
}
export const BIOME_NAMES = ['plains', 'forest', 'desert', 'taiga', 'swamp', 'ocean'] as const;

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
  | 'oil';
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
export function regionOf(map: GameMap, x: number, y: number) {
  return Math.floor(y / map.regionSize) * map.regionsX + Math.floor(x / map.regionSize);
}
