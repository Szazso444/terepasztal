import { hash2 } from '../engine/rng';
import { Biome, Terrain, type GameMap, type PropInstance, type PropKind } from '../world/tiles';
import { surfaceNoise } from './terrainMaterials';

/** What the renderer knows about a tile beyond the map planes. */
export interface ScatterContext {
  /** Track, a station, a building or placed decor stands here. */
  occupied(x: number, y: number): boolean;
  /** Paved town ground. */
  city(x: number, y: number): boolean;
  /** Ground too steep for rails: an exposed hill face. */
  steep(x: number, y: number): boolean;
}

/** Offsets stay inside the tile, like generated props. */
const clamp = (v: number) => Math.max(-0.42, Math.min(0.42, v));
const N4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/**
 * Extra nature for a tile, only where it belongs: reeds on shores, bushes and young trees at
 * forest edges, flower meadows in clusters, boulders at rock faces and mountain feet. Seeded by
 * world position, so it survives map expansion; purely visual, so it changes neither generation
 * nor saves. Tiles with generated props, buildings, track or town paving get nothing.
 */
export function scatterFor(
  map: GameMap,
  x: number,
  y: number,
  ctx: ScatterContext,
): PropInstance[] {
  const { w, h } = map,
    i = y * w + x;
  if (x < 0 || y < 0 || x >= w || y >= h) return [];
  const t = map.terrain[i] as Terrain;
  if (t !== Terrain.Grass && t !== Terrain.Hill && t !== Terrain.Sand) return [];
  if (map.props.has(i) || ctx.occupied(x, y) || ctx.city(x, y)) return [];
  const b = map.biome[i] as Biome,
    wx = x + map.originX,
    wy = y + map.originY,
    r = hash2(wx, wy, map.seed + 1301),
    out: PropInstance[] = [];
  const terrainAt = (dx: number, dy: number) => {
    const xx = x + dx,
      yy = y + dy;
    return xx < 0 || yy < 0 || xx >= w || yy >= h ? t : (map.terrain[yy * w + xx] as Terrain);
  };
  const put = (kind: PropKind, variants: number, k: number, ox = 0, oy = 0) =>
    out.push({
      kind,
      variant: Math.floor(hash2(wx + k, wy - k, map.seed + 1307) * variants),
      ox: clamp(ox + (hash2(wx * 5 + k, wy, map.seed + 1311) - 0.5) * 0.36),
      oy: clamp(oy + (hash2(wx, wy * 5 + k, map.seed + 1319) - 0.5) * 0.36),
    });

  // Shore: reeds lean out toward the water they grow in.
  const water = N4.filter(([dx, dy]) => terrainAt(dx, dy) === Terrain.Water);
  if (water.length && t !== Terrain.Sand && b !== Biome.Desert && b !== Biome.Ocean) {
    if (r < 0.42) {
      const [dx, dy] = water[Math.floor(hash2(wx, wy, map.seed + 1321) * water.length)];
      const n = r < 0.15 ? 2 : 1;
      for (let k = 0; k < n; k++) put('reeds', 2, k, dx * 0.3, dy * 0.3);
    }
    return out;
  }

  // Rock faces and mountain feet shed boulders.
  const nearRock = N4.some(([dx, dy]) => {
    const n = terrainAt(dx, dy);
    return n === Terrain.Mountain || n === Terrain.Rock;
  });
  if ((t === Terrain.Hill && ctx.steep(x, y)) || nearRock) {
    if (r < (nearRock ? 0.3 : 0.38)) put(r < 0.12 ? 'boulder' : 'rock', 3, 0);
    return out;
  }

  if (t === Terrain.Sand) {
    if (b === Biome.Desert && r < 0.05) put('boulder', 3, 0);
    return out;
  }

  // Forest edges soften into bushes and young trees instead of a hard wall.
  const nearForest = N4.some(([dx, dy]) => terrainAt(dx, dy) === Terrain.Forest);
  if (nearForest) {
    if (b === Biome.Taiga) {
      if (r < 0.3) put(r < 0.1 ? 'spruce' : 'bush', 3, 0);
    } else if (b === Biome.Swamp) {
      if (r < 0.3) put(r < 0.1 ? 'deadtree' : 'reeds', 2, 0);
    } else if (r < 0.34) put(r < 0.1 ? (b === Biome.Plains ? 'oak' : 'birch') : 'bush', 3, 0);
    return out;
  }

  // Open meadows: flowers gather in patches, with a bush at the patch rim.
  if (b === Biome.Plains || b === Biome.Forest) {
    const patch = surfaceNoise(wx * 0.33, wy * 0.33, map.seed + 1327);
    if (patch > 0.64 && r < 0.5) {
      put('flowers', 4, 0);
      if (r < 0.14) put('flowers', 4, 1);
    } else if (patch > 0.58 && patch <= 0.64 && r < 0.12) put('bush', 3, 0);
    return out;
  }
  if (b === Biome.Taiga && r < 0.03) put(r < 0.012 ? 'deadtree' : 'boulder', 2, 0);
  return out;
}
