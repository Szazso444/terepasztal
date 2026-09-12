import { Rng, hash2 } from '../engine/rng';
import { Terrain, Biome, type GameMap, type PropInstance, type PropKind } from './tiles';

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
  /** world coordinate of tile (0,0): the noise fields are sampled in world space so a map that
   *  grows around the start keeps every tile it already had */
  originX?: number;
  originY?: number;
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
  originX = 0,
  originY = 0,
): GameMap {
  const terrain = new Uint8Array(w * h).fill(fill);
  const variant = new Uint8Array(w * h);
  const biome = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) variant[y * w + x] = Math.floor(hash2(x, y, seed) * 4);
  const rs = 32;
  return {
    w,
    h,
    seed,
    originX,
    originY,
    terrain,
    variant,
    biome,
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
  const ox = params.originX ?? 0;
  const oy = params.originY ?? 0;
  const rng = new Rng(seed);
  const map = emptyMap(seed, w, h, Terrain.Grass, ox, oy);
  const { terrain } = map;
  const elevSeed = rng.int(1, 1e6);
  const moistSeed = rng.int(1, 1e6);
  const elev = new Float32Array(w * h);
  // the start basin sits at world (0,0) plus half the initial map; every later expansion keeps
  // the start chunk in the middle of the grid, so the grid centre is that same world point
  const rs = map.regionSize;
  const scx = (Math.floor((map.regionsX - 1) / 2) + 0.5) * rs;
  const scy = (Math.floor((map.regionsY - 1) / 2) + 0.5) * rs;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const wx = x + ox;
      const wy = y + oy;
      let e = fbm(wx / 22, wy / 22, elevSeed, 5);
      // smooth basin around the start point so the centre is buildable without a hard edge
      const cd = Math.hypot(x - scx, y - scy) / 26;
      if (cd < 1) {
        const k = 1 - cd * cd * (3 - 2 * cd);
        e = e * (1 - k) + 0.5 * k;
      }
      elev[y * w + x] = e;
    }
  // biome fields: low-frequency temperature and moisture, blended to mild plains/forest
  // conditions around the starting chunk
  const tempSeed = rng.int(1, 1e6);
  const biomeSeed = rng.int(1, 1e6);
  const { biome } = map;
  const temp = new Float32Array(w * h);
  const moist = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const wx = x + ox;
      const wy = y + oy;
      let t = fbm(wx / 60 + 300, wy / 60 + 300, tempSeed, 3);
      let m = fbm(wx / 14 + 100, wy / 14 + 100, moistSeed, 4);
      const mLow = fbm(wx / 44 + 500, wy / 44 + 500, biomeSeed, 3);
      m = m * 0.55 + mLow * 0.45;
      // start chunk: pull towards temperate, moderately moist
      const sd = Math.max(Math.abs(x - scx), Math.abs(y - scy)) / (rs * 0.9);
      const k = sd < 1 ? 1 - sd * sd * (3 - 2 * sd) : 0;
      t = t * (1 - k) + 0.5 * k;
      m = m * (1 - k) + 0.52 * k;
      temp[i] = t;
      moist[i] = m;
      const e = elev[i];
      // seas: a separate broad noise, never inside the start zone
      const sea = fbm((x + ox) / 70 + 1200, (y + oy) / 70 + 1200, biomeSeed + 11, 3);
      let b: Biome;
      if (k < 0.05 && sea < 0.34) b = Biome.Ocean;
      else if (t > 0.6 && m < 0.5) b = Biome.Desert;
      else if (t < 0.4) b = Biome.Taiga;
      else if (m > 0.6 && e < params.waterLevel + 0.2) b = Biome.Swamp;
      else if (m > 0.56) b = Biome.Forest;
      else b = Biome.Plains;
      biome[i] = b;
    }
  // smooth biome edges: majority of the 5x5 neighbourhood, twice
  for (let pass = 0; pass < 2; pass++) {
    const copy = new Uint8Array(biome);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const counts = [0, 0, 0, 0, 0, 0];
        for (let dy = -2; dy <= 2; dy++)
          for (let dx = -2; dx <= 2; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            counts[copy[ny * w + nx]]++;
          }
        let best = copy[y * w + x];
        for (let k = 0; k < 6; k++) if (counts[k] > counts[best]) best = k;
        biome[y * w + x] = best;
      }
  }
  // terrain per biome
  const islandSeed = rng.int(1, 1e6);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const e = elev[i];
      const m = moist[i];
      const b = biome[i] as Biome;
      let t: Terrain;
      if (b === Biome.Ocean) {
        // islands: bumps of a finer noise poke out of the sea
        const isl = fbm((x + ox) / 9 + 900, (y + oy) / 9 + 900, islandSeed, 3);
        if (isl > 0.74) t = isl > 0.8 ? Terrain.Grass : Terrain.Sand;
        else t = Terrain.Water;
      } else if (e < params.waterLevel) t = Terrain.Water;
      else if (e < params.waterLevel + 0.025) t = Terrain.Sand;
      else if (e > params.rockLevel) t = Terrain.Rock;
      else if (e > params.hillLevel) t = b === Biome.Swamp ? Terrain.Grass : Terrain.Hill;
      else
        switch (b) {
          case Biome.Desert:
            t = Terrain.Sand;
            break;
          case Biome.Forest:
            t = m > 0.42 ? Terrain.Forest : Terrain.Grass;
            break;
          case Biome.Taiga:
            t = m > 0.55 ? Terrain.Forest : Terrain.Grass;
            break;
          case Biome.Swamp: {
            const wet = fbm((x + ox) / 5 + 700, (y + oy) / 5 + 700, biomeSeed + 7, 2);
            t = wet > 0.66 ? Terrain.Water : Terrain.Grass;
            break;
          }
          default:
            t = m > params.forestDensity + 0.08 ? Terrain.Forest : Terrain.Grass;
        }
      terrain[i] = t;
    }
  carveRivers(map, elev, seed, params.waterLevel, scx, scy);
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
  raiseMountains(map);
  ensureStartResources(map);
  decorateProps(map, seed);
  ensureStartDeposits(map);
  return map;
}

/**
 * The starting chunk gets at least two coal seams and two oil seeps (full production chain): the
 * hill tiles nearest the chunk centre and low tiles a little way out, in a fixed order so an
 * expanded map picks the same tiles again. Skipped when the chunk already has them.
 */
export function ensureStartDeposits(map: GameMap) {
  const rs = map.regionSize;
  const rx = Math.floor((map.regionsX - 1) / 2);
  const ry = Math.floor((map.regionsY - 1) / 2);
  const x0 = rx * rs;
  const y0 = ry * rs;
  const x1 = Math.min(map.w, x0 + rs);
  const y1 = Math.min(map.h, y0 + rs);
  const cx = x0 + rs / 2;
  const cy = y0 + rs / 2;
  const has = (i: number, kind: PropKind) => map.props.get(i)?.some((p) => p.kind === kind);
  const place = (kind: PropKind, want: number, ok: (t: Terrain, d: number) => boolean) => {
    const cands: { i: number; d: number }[] = [];
    let have = 0;
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const i = y * map.w + x;
        if (has(i, kind)) {
          have++;
          continue;
        }
        const d = Math.hypot(x - cx, y - cy);
        if (ok(map.terrain[i] as Terrain, d)) cands.push({ i, d });
      }
    cands.sort((a, b) => a.d - b.d || a.i - b.i);
    for (let k = 0; have < want && k < cands.length; k += 3, have++) {
      const i = cands[k].i;
      map.props.set(i, [{ kind, variant: k % 3, ox: (hash2(i, 1, map.seed) - 0.5) * 0.3, oy: 0 }]);
    }
  };
  place('coal', 2, (t) => t === Terrain.Hill);
  place('oil', 2, (t, d) => (t === Terrain.Grass || t === Terrain.Sand) && d > 6 && d < 13);
}

/**
 * The starting chunk must offer every basic resource: water (pumps), forest (lumber), hill or
 * rock (quarries) and grass (farms). Missing ones are painted as small patches near the chunk's
 * corners, away from the central basin.
 */
export function ensureStartResources(map: GameMap) {
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
  let ci = Math.floor(hash2(map.seed, 3, 41) * 4);
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
 * Rivers: start on high ground, walk downhill (with a little wander) until water or the map edge,
 * carving water; the lower half runs two tiles wide. Deserts dry a river out; the start basin
 * is left alone so the first chunk stays buildable.
 */
function carveRivers(
  map: GameMap,
  elev: Float32Array,
  seed: number,
  waterLevel: number,
  scx: number,
  scy: number,
) {
  const { w, h, terrain, biome, originX, originY } = map;
  const rs = map.regionSize;
  // one candidate source per world chunk, fixed by the chunk's world coordinates, so the same
  // rivers reappear wherever the map's edges happen to be
  for (let ry = 0; ry < map.regionsY; ry++)
    for (let rx = 0; rx < map.regionsX; rx++) {
      const cx = rx + Math.floor(originX / rs);
      const cy = ry + Math.floor(originY / rs);
      if (hash2(cx, cy, seed + 77) > 0.5) continue;
      const x0 = rx * rs + 4 + Math.floor(hash2(cx, cy, seed + 78) * (rs - 8));
      const y0 = ry * rs + 4 + Math.floor(hash2(cx, cy, seed + 79) * (rs - 8));
      if (x0 < 1 || y0 < 1 || x0 >= w - 1 || y0 >= h - 1) continue;
      const i0 = y0 * w + x0;
      if (elev[i0] < waterLevel + 0.22 || biome[i0] === Biome.Ocean || biome[i0] === Biome.Desert)
        continue;
      if (Math.hypot(x0 - scx, y0 - scy) < 22) continue;
      let x = x0;
      let y = y0;
      const path: number[] = [];
      let dry = 0;
      for (let step = 0; step < 220; step++) {
        path.push(y * w + x);
        if (terrain[y * w + x] === Terrain.Water && step > 3) break;
        let bx = x;
        let by = y;
        let be = Infinity;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 1 || ny < 1 || nx >= w - 1 || ny >= h - 1) continue;
            const ni = ny * w + nx;
            if (path.includes(ni)) continue;
            // a little position-fixed noise so rivers meander the same way every time
            const ev = elev[ni] + (hash2(nx + originX, ny + originY, seed + 80) - 0.5) * 0.02;
            if (ev < be) {
              be = ev;
              bx = nx;
              by = ny;
            }
          }
        if (bx === x && by === y) break;
        x = bx;
        y = by;
        if (biome[y * w + x] === Biome.Desert && ++dry > 12) break;
        if (Math.hypot(x - scx, y - scy) < 14) break;
      }
      if (path.length < 12) continue;
      path.forEach((i, k) => {
        const px = i % w;
        const py = Math.floor(i / w);
        terrain[i] = Terrain.Water;
        if (k > path.length / 2) {
          const j = py * w + Math.min(w - 1, px + 1);
          if (terrain[j] !== Terrain.Water) terrain[j] = Terrain.Water;
        }
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nx = px + dx;
          const ny = py + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const ni = ny * w + nx;
          if (terrain[ni] === Terrain.Hill || terrain[ni] === Terrain.Rock)
            terrain[ni] = Terrain.Grass;
        }
      });
    }
}

/** Large stone fields rise in the middle: rock tiles two deep inside a field become mountains. */
function raiseMountains(map: GameMap) {
  const { w, h, terrain } = map;
  const isRock = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < w && y < h && terrain[y * w + x] === Terrain.Rock;
  const inner = new Uint8Array(w * h);
  for (let pass = 0; pass < 2; pass++) {
    const src = pass === 0 ? null : new Uint8Array(inner);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (terrain[i] !== Terrain.Rock) continue;
        let ok = true;
        for (let dy = -1; dy <= 1 && ok; dy++)
          for (let dx = -1; dx <= 1 && ok; dx++) {
            if (!dx && !dy) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (!isRock(nx, ny)) ok = false;
            else if (src && !src[ny * w + nx]) ok = false;
          }
        inner[i] = ok ? 1 : 0;
      }
  }
  for (let i = 0; i < inner.length; i++) if (inner[i]) terrain[i] = Terrain.Mountain;
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
      const wx = x + map.originX;
      const wy = y + map.originY;
      const r = hash2(wx, wy, seed + 5);
      const b = map.biome[i] as Biome;
      const put = (kind: PropKind, variants: number, k = 0) =>
        list.push({
          kind,
          variant: Math.floor(hash2(wx + k, wy - k, seed + 9) * variants),
          ox: (hash2(wx * 3 + k, wy, seed + 7) - 0.5) * 0.7,
          oy: (hash2(wx, wy * 3 + k, seed + 8) - 0.5) * 0.7,
        });
      if (t === Terrain.Forest) {
        const n = 1 + Math.floor(hash2(wx, wy, seed + 6) * 2.5);
        for (let k = 0; k < n; k++) {
          const a = hash2(wx * 3 + k, wy, seed + 7);
          let kind: PropKind;
          if (b === Biome.Taiga) kind = a > 0.35 ? 'spruce' : 'pine';
          else if (b === Biome.Swamp) kind = a > 0.6 ? 'deadtree' : a > 0.3 ? 'tree' : 'reeds';
          else if (b === Biome.Plains) kind = a > 0.6 ? 'oak' : a > 0.3 ? 'tree' : 'birch';
          else kind = a > 0.7 ? 'pine' : a > 0.45 ? 'oak' : a > 0.2 ? 'tree' : 'birch';
          put(kind, 3, k);
        }
      } else if (t === Terrain.Grass) {
        if (b === Biome.Swamp) {
          if (r > 0.86) put(r > 0.97 ? 'deadtree' : 'reeds', 2);
        } else if (b === Biome.Taiga) {
          if (r > 0.95) put(r > 0.985 ? 'spruce' : 'bush', 3);
        } else if (b === Biome.Plains) {
          if (r > 0.9) put(r > 0.985 ? 'oak' : r > 0.955 ? 'bush' : 'flowers', r > 0.955 ? 3 : 4);
        } else if (b === Biome.Ocean) {
          if (r > 0.9) put('palm', 2);
        } else if (r > 0.94) put(r > 0.985 ? 'tree' : r > 0.965 ? 'bush' : 'flowers', 3);
      } else if (t === Terrain.Sand) {
        if (b === Biome.Desert) {
          if (r > 0.93) put(r > 0.985 ? 'boulder' : r > 0.965 ? 'deadtree' : 'cactus', 3);
        } else if (b === Biome.Ocean && r > 0.9) put('palm', 2);
      } else if (t === Terrain.Hill && r > 0.93) {
        put('boulder', 3);
      }
      // deposits for the full production chain: coal seams crop out on some hills, oil seeps
      // through low ground (swamps, sand and now and then plain grass). Their own hash keeps
      // them independent of the vegetation above.
      const d = hash2(wx, wy, seed + 12);
      if (t === Terrain.Hill && d > 0.95) {
        list.length = 0;
        put('coal', 3);
      } else if (
        (t === Terrain.Sand && b !== Biome.Ocean && d > 0.975) ||
        (t === Terrain.Grass && (b === Biome.Swamp ? d > 0.975 : d > 0.994))
      ) {
        list.length = 0;
        put('oil', 3);
      }
      if (list.length) map.props.set(i, list);
    }
}
