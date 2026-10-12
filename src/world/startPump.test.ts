import { describe, it, expect } from 'vitest';
import { generateMap, emptyMap, ensureStartResources, DEFAULT_MAP_PARAMS } from './mapgen';
import { tileLevels } from './elevation';
import { Terrain, startRegion, type GameMap } from './tiles';
import type { Rng } from '../engine/rng';
import { forAll, shrinkInt } from '../testing/property';

// The start chunk holds a tile a Water Pump can stand on (#310's start guarantee, for #320): Grass
// or Forest, level, with Water on one of its 4 sides. Level is the terraces' level tile
// (src/render/terrainRelief.ts `groundAllows`): every side on the map at the tile's own level in
// `tileLevels`, a side off the map at level 0.

const SIDES = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/** The start chunk's tiles, as map coordinates. */
function startTiles(m: GameMap) {
  const { rx, ry } = startRegion(m);
  const rs = m.regionSize;
  const out: { x: number; y: number }[] = [];
  for (let y = ry * rs; y < Math.min(m.h, (ry + 1) * rs); y++)
    for (let x = rx * rs; x < Math.min(m.w, (rx + 1) * rs); x++) out.push({ x, y });
  return out;
}

/**
 * Start chunk tiles a pump can stand on, as map indices; with `inChunk`, only those with their
 * Water side inside the start chunk, as the guarantee lays them.
 */
function pumpTiles(m: GameMap, inChunk = false): number[] {
  const levels = tileLevels(m);
  const { rx, ry } = startRegion(m);
  const rs = m.regionSize;
  const chunk = (x: number, y: number) => Math.floor(x / rs) === rx && Math.floor(y / rs) === ry;
  const out: number[] = [];
  for (const { x, y } of startTiles(m)) {
    const i = y * m.w + x;
    if (m.terrain[i] !== Terrain.Grass && m.terrain[i] !== Terrain.Forest) continue;
    let level = true;
    let water = false;
    for (const [dx, dy] of SIDES) {
      const nx = x + dx;
      const ny = y + dy;
      const on = nx >= 0 && ny >= 0 && nx < m.w && ny < m.h;
      if ((on ? levels[ny * m.w + nx] : 0) !== levels[i]) level = false;
      if (on && m.terrain[ny * m.w + nx] === Terrain.Water && (!inChunk || chunk(nx, ny)))
        water = true;
    }
    if (level && water) out.push(i);
  }
  return out;
}

describe('the start chunk', () => {
  // #320's measurement: 50 maps of 160 x 160, about 1.1 s alone. Before the guarantee, seeds 10,
  // 29 and 39 had no such tile: their lakes are shored with sand.
  it('holds a tile a Water Pump can stand on in 50 worlds at the default size and sliders', () => {
    const none: number[] = [];
    for (let seed = 1; seed <= 50; seed++) {
      const m = generateMap(seed, { w: 160, h: 160 }, 'simple');
      if (pumpTiles(m).length === 0) none.push(seed);
    }
    expect(none).toEqual([]);
  }, 40_000);

  interface Case {
    seed: number;
    full: boolean;
    w: number;
    h: number;
    ox: number;
    oy: number;
    waterLevel: number;
    hillLevel: number;
    rockLevel: number;
    forestDensity: number;
  }
  const genCase = (rng: Rng): Case => ({
    seed: rng.int(0, 2 ** 31 - 1),
    full: rng.chance(0.5),
    w: rng.int(32, 160),
    h: rng.int(32, 160),
    ox: rng.chance(0.5) ? -32 * rng.int(0, 2) : rng.int(-100, 100),
    oy: rng.chance(0.5) ? -32 * rng.int(0, 2) : rng.int(-100, 100),
    waterLevel: rng.int(10, 60) / 100,
    hillLevel: rng.int(45, 90) / 100,
    rockLevel: rng.int(50, 100) / 100,
    forestDensity: rng.int(30, 90) / 100,
  });
  function* shrinkCase(c: Case): Iterable<Case> {
    if (c.full) yield { ...c, full: false };
    for (const key of ['waterLevel', 'hillLevel', 'rockLevel', 'forestDensity'] as const)
      if (c[key] !== DEFAULT_MAP_PARAMS[key]) yield { ...c, [key]: DEFAULT_MAP_PARAMS[key] };
    for (const ox of shrinkInt(c.ox)) yield { ...c, ox };
    for (const oy of shrinkInt(c.oy)) yield { ...c, oy };
    for (const w of shrinkInt(c.w, 32)) yield { ...c, w };
    for (const h of shrinkInt(c.h, 32)) yield { ...c, h };
  }

  // 30 maps up to 160 tiles a side: about 0.4 s alone
  it('holds one with its water inside the chunk on any sliders, size, origin and chain', () => {
    forAll(
      genCase,
      (c) => {
        const { seed, full, w, h, ox, oy, ...sliders } = c;
        const m = generateMap(
          seed,
          { ...sliders, w, h, originX: ox, originY: oy },
          full ? 'full' : 'simple',
        );
        expect(pumpTiles(m, true).length).toBeGreaterThan(0);
      },
      { seeds: Array.from({ length: 30 }, (_, i) => i + 1), shrink: shrinkCase },
    );
  }, 20_000);
});

describe('ensureStartResources', () => {
  /**
   * A 32 x 32 grass chunk with every resource startResources counts (forest, a hill, grass) and
   * a pond of 3 x 3 water tiles ringed by `shore`, so no grass or forest is beside its water.
   */
  function chunkWithPond(shore: Terrain) {
    const m = emptyMap(1, 32, 32, Terrain.Grass);
    const set = (x: number, y: number, t: Terrain) => (m.terrain[y * 32 + x] = t);
    for (let y = 2; y < 4; y++) for (let x = 2; x < 6; x++) set(x, y, Terrain.Forest);
    for (let y = 26; y < 28; y++) for (let x = 26; x < 28; x++) set(x, y, Terrain.Hill);
    // a 3 x 3 pond at (21..23, 9..11), ringed by the shore
    for (let y = 8; y <= 12; y++) for (let x = 20; x <= 24; x++) set(x, y, shore);
    for (let y = 9; y <= 11; y++) for (let x = 21; x <= 23; x++) set(x, y, Terrain.Water);
    return m;
  }
  const changed = (a: Uint8Array, b: Uint8Array) =>
    [...a.keys()].filter((i) => a[i] !== b[i]).map((i) => [i % 32, Math.floor(i / 32), b[i]]);

  it('leaves a chunk that holds a pump tile as it was', () => {
    const m = chunkWithPond(Terrain.Sand);
    m.terrain[10 * 32 + 20] = Terrain.Grass;
    const before = m.terrain.slice();
    ensureStartResources(m);
    expect(changed(before, m.terrain)).toEqual([]);
  });

  it('turns the shore tile nearest the centre to grass where the water is shored with sand', () => {
    const m = chunkWithPond(Terrain.Sand);
    expect(pumpTiles(m)).toEqual([]);
    const before = m.terrain.slice();
    ensureStartResources(m);
    // every sand tile beside the pond costs one change; (20, 11) and (21, 12) are nearest the
    // centre (16, 16), both sqrt(41) out, and (20, 11) comes first in reading order
    expect(changed(before, m.terrain)).toEqual([[20, 11, Terrain.Grass]]);
    expect(pumpTiles(m)).toEqual([11 * 32 + 20]);
  });

  it('turns the hills beside the shore tile to grass where the water lies in the hills', () => {
    const m = chunkWithPond(Terrain.Hill);
    expect(pumpTiles(m)).toEqual([]);
    const before = m.terrain.slice();
    ensureStartResources(m);
    // every hill beside the pond has two hill sides and grass beyond, three changes each; of the
    // nearest, (20, 11) turns grass with its hill sides (20, 10) and (20, 12)
    expect(changed(before, m.terrain)).toEqual([
      [20, 10, Terrain.Grass],
      [20, 11, Terrain.Grass],
      [20, 12, Terrain.Grass],
    ]);
    expect(pumpTiles(m)).toEqual([11 * 32 + 20]);
  });

  it('changes the fewest tiles before it looks at the distance', () => {
    const m = chunkWithPond(Terrain.Hill);
    // a pool of one tile, shored with sand, farther out than the pond in the hills: a sand tile
    // beside it is one change, against three for the pond's nearest shore tile (20, 11)
    m.terrain[22 * 32 + 8] = Terrain.Water;
    for (const [x, y] of [
      [7, 22],
      [9, 22],
      [8, 21],
      [8, 23],
    ])
      m.terrain[y * 32 + x] = Terrain.Sand;
    const before = m.terrain.slice();
    ensureStartResources(m);
    // (9, 22) is the pool's shore tile nearest the centre, sqrt(85) out
    expect(changed(before, m.terrain)).toEqual([[9, 22, Terrain.Grass]]);
    expect(pumpTiles(m)).toEqual([22 * 32 + 9]);
  });
});
