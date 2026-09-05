export const enum Terrain {
  Grass = 0,
  Forest = 1,
  Hill = 2,
  Water = 3,
  Rock = 4,
  Sand = 5,
}
export const TERRAIN_NAMES = ['grass', 'forest', 'hill', 'water', 'rock', 'sand'] as const;

export interface PropInstance {
  kind: 'tree' | 'pine' | 'rock' | 'bush';
  variant: number;
  /** offset within the tile in tile units (-0.4..0.4) */
  ox: number;
  oy: number;
}

export interface GameMap {
  w: number;
  h: number;
  seed: number;
  terrain: Uint8Array;
  variant: Uint8Array;
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
