import { Rng, hash2 } from '../engine/rng';
import { Terrain, type GameMap, type PropInstance } from './tiles';

/** Smooth value noise built from the coordinate hash. */
function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
function fbm(x: number, y: number, seed: number, octaves = 4): number {
  let v = 0;
  let amp = 0.5;
  let f = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    v += valueNoise(x * f, y * f, seed + i * 31) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return v / norm;
}

export interface MapGenParams {
  w: number;
  h: number;
  waterLevel: number;
  hillLevel: number;
  rockLevel: number;
  forestDensity: number;
}
export const DEFAULT_MAP_PARAMS: MapGenParams = {
  w: 96,
  h: 96,
  waterLevel: 0.36,
  hillLevel: 0.64,
  rockLevel: 0.76,
  forestDensity: 0.56,
};

/** A flat map of one terrain type with no props (the editor's blank canvas). */
export function emptyMap(
  seed: number,
  w: number,
  h: number,
  fill: Terrain = Terrain.Grass,
): GameMap {
  const terrain = new Uint8Array(w * h).fill(fill);
  const variant = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) variant[y * w + x] = Math.floor(hash2(x, y, seed) * 4);
  const rs = 32;
  return {
    w,
    h,
    seed,
    terrain,
    variant,
    props: new Map(),
    regionSize: rs,
    regionsX: Math.max(1, Math.ceil(w / rs)),
    regionsY: Math.max(1, Math.ceil(h / rs)),
  };
}

export function generateMap(seed: number, p: Partial<MapGenParams> = {}): GameMap {
  const params = { ...DEFAULT_MAP_PARAMS, ...p };
  const w = params.w;
  const h = params.h;
  const rng = new Rng(seed);
  const map = emptyMap(seed, w, h);
  const { terrain } = map;
  const elevSeed = rng.int(1, 1e6);
  const moistSeed = rng.int(1, 1e6);
  const elev = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let e = fbm(x / 22, y / 22, elevSeed, 5);
      // gentle bowl so map edges trend towards rock/hills and the centre is buildable
      const dx = (x / w - 0.5) * 2;
      const dy = (y / h - 0.5) * 2;
      const d = Math.sqrt(dx * dx + dy * dy);
      e += Math.max(0, d - 0.75) * 0.5;
      // smooth basin around the start point so the centre is buildable without a hard edge
      const cd = Math.hypot(x - w / 2, y - h / 2) / 16;
      if (cd < 1) {
        const k = 1 - cd * cd * (3 - 2 * cd);
        e = e * (1 - k) + 0.5 * k;
      }
      elev[y * w + x] = e;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const e = elev[i];
      const m = fbm(x / 14 + 100, y / 14 + 100, moistSeed, 4);
      let t: Terrain;
      if (e < params.waterLevel) t = Terrain.Water;
      else if (e < params.waterLevel + 0.025) t = Terrain.Sand;
      else if (e > params.rockLevel) t = Terrain.Rock;
      else if (e > params.hillLevel) t = Terrain.Hill;
      else if (m > params.forestDensity) t = Terrain.Forest;
      else t = Terrain.Grass;
      terrain[i] = t;
    }
  // clean up lone tiles: majority filter for water/rock singletons
  const copy = new Uint8Array(terrain);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const t = copy[i];
      let same = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          if (copy[(y + dy) * w + x + dx] === t) same++;
        }
      if (same <= 1) terrain[i] = copy[(y + 1) * w + x];
    }
  ensureStartResources(map, rng);
  decorateProps(map, seed);
  return map;
}

/**
 * The starting chunk must offer every basic resource: water (pumps), forest (lumber), hill or
 * rock (quarries) and grass (farms). Missing ones are painted as small patches near the chunk's
 * corners, away from the central basin.
 */
export function ensureStartResources(map: GameMap, rng: Rng) {
  const rs = map.regionSize;
  const rx = Math.floor((map.regionsX - 1) / 2);
  const ry = Math.floor((map.regionsY - 1) / 2);
  const x0 = rx * rs;
  const y0 = ry * rs;
  const x1 = Math.min(map.w, x0 + rs);
  const y1 = Math.min(map.h, y0 + rs);
  const count = (pred: (t: Terrain) => boolean) => {
    let n = 0;
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) if (pred(map.terrain[y * map.w + x] as Terrain)) n++;
    return n;
  };
  const corners = [
    [x0 + 4, y0 + 4],
    [x1 - 5, y0 + 4],
    [x0 + 4, y1 - 5],
    [x1 - 5, y1 - 5],
  ];
  let ci = rng.int(0, 3);
  const paint = (t: Terrain, r: number) => {
    const [cx, cy] = corners[ci % 4];
    ci++;
    for (let y = cy - r; y <= cy + r; y++)
      for (let x = cx - r; x <= cx + r; x++) {
        if (x < x0 || y < y0 || x >= x1 || y >= y1) continue;
        if (Math.abs(x - cx) + Math.abs(y - cy) > r + 1) continue;
        map.terrain[y * map.w + x] = t;
      }
  };
  if (count((t) => t === Terrain.Water) < 4) paint(Terrain.Water, 1);
  if (count((t) => t === Terrain.Forest) < 6) paint(Terrain.Forest, 2);
  if (count((t) => t === Terrain.Hill || t === Terrain.Rock) < 4) paint(Terrain.Hill, 1);
  if (count((t) => t === Terrain.Grass) < 20) paint(Terrain.Grass, 3);
}

/**
 * (Re)generate decorative props from the terrain. With a rectangle only those tiles are redone,
 * which is what the editor needs after painting. Deterministic per tile and seed.
 */
export function decorateProps(
  map: GameMap,
  seed: number,
  rect?: { x0: number; y0: number; x1: number; y1: number },
) {
  const w = map.w;
  const h = map.h;
  const terrain = map.terrain;
  const x0 = rect ? Math.max(0, rect.x0) : 0;
  const y0 = rect ? Math.max(0, rect.y0) : 0;
  const x1 = rect ? Math.min(w - 1, rect.x1) : w - 1;
  const y1 = rect ? Math.min(h - 1, rect.y1) : h - 1;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const i = y * w + x;
      map.props.delete(i);
      const t = terrain[i] as Terrain;
      const list: PropInstance[] = [];
      const r = hash2(x, y, seed + 5);
      if (t === Terrain.Forest) {
        const n = 1 + Math.floor(hash2(x, y, seed + 6) * 2.5);
        for (let k = 0; k < n; k++) {
          const a = hash2(x * 3 + k, y, seed + 7);
          const b = hash2(x, y * 3 + k, seed + 8);
          list.push({
            kind: a > 0.45 ? 'pine' : 'tree',
            variant: Math.floor(hash2(x + k, y - k, seed + 9) * 3),
            ox: (a - 0.5) * 0.7,
            oy: (b - 0.5) * 0.7,
          });
        }
      } else if (t === Terrain.Grass && r > 0.96) {
        list.push({
          kind: r > 0.985 ? 'tree' : 'bush',
          variant: Math.floor(r * 30) % 3,
          ox: ((r * 7) % 0.6) - 0.3,
          oy: ((r * 13) % 0.6) - 0.3,
        });
      } else if (t === Terrain.Rock && r > 0.55) {
        list.push({
          kind: 'rock',
          variant: Math.floor(r * 10) % 3,
          ox: ((r * 5) % 0.5) - 0.25,
          oy: ((r * 11) % 0.5) - 0.25,
        });
      } else if (t === Terrain.Hill && r > 0.9) {
        list.push({
          kind: 'rock',
          variant: 0,
          ox: ((r * 5) % 0.4) - 0.2,
          oy: ((r * 11) % 0.4) - 0.2,
        });
      }
      if (list.length) map.props.set(i, list);
    }
}
