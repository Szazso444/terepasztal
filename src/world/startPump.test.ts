import { describe, it, expect } from 'vitest';
import { generateMap, emptyMap, ensureStartResources, DEFAULT_MAP_PARAMS } from './mapgen';
import { tileLevels } from './elevation';
import { Terrain, startRegion, type GameMap } from './tiles';
import type { Rng } from '../engine/rng';
import { RULE_META } from '../sim/rules';
import { forAll, shrinkArray, shrinkInt } from '../testing/property';

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
  // 50 maps of 160 x 160, each world planning its rivers: about 7 s alone. In #320's measurement,
  // before the guarantee, seeds 10, 29 and 39 had no such tile: their lakes are shored with sand.
  it('holds a tile a Water Pump can stand on in 50 worlds at the default size and sliders', () => {
    const none: number[] = [];
    for (let seed = 1; seed <= 50; seed++) {
      const m = generateMap(seed, { w: 160, h: 160 }, 'simple');
      if (pumpTiles(m).length === 0) none.push(seed);
    }
    expect(none).toEqual([]);
  }, 140_000);

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

  // 30 maps up to 160 tiles a side: about 4 s alone
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
  }, 80_000);

  // 16 combinations of the Map sliders' ends, two worlds each, at 32 and 96 tiles: about 4 s
  it('holds one at every end of the Map sliders', () => {
    const keys = ['waterLevel', 'hillLevel', 'rockLevel', 'forestDensity'] as const;
    const ends = keys.map((key) => {
      const meta = RULE_META.find((m) => m.key === key)!;
      return [meta.min, meta.max];
    });
    for (let k = 0; k < 2 ** keys.length; k++) {
      const sliders = Object.fromEntries(keys.map((key, b) => [key, ends[b][(k >> b) & 1]]));
      for (const [seed, w] of [
        [1, 32],
        [2, 96],
      ]) {
        const m = generateMap(seed, { ...sliders, w, h: w }, seed === 1 ? 'full' : 'simple');
        expect(
          pumpTiles(m, true).length,
          `${JSON.stringify(sliders)}, seed ${seed}`,
        ).toBeGreaterThan(0);
      }
    }
  }, 80_000);

  // The worlds of the 50 above where the guarantee changes the ground: on develop seeds 10, 29 and
  // 39 had no pump tile, and seed 23 had one only with its water outside the start chunk. Six maps
  // each, up to 224 tiles a side: about 0.15 s a seed alone.
  it.each([10, 23, 29, 39])(
    'seed %i: every map that shares the start chunk has the same ground in it and a tile around',
    (seed) => {
      // [size, origin]: world chunk (2, 2) is the start chunk of each, at the map's edge in some
      const frames = [
        [32, 64],
        [64, 64],
        [96, 32],
        [128, 32],
        [160, 0],
        [224, -32],
      ] as const;
      const maps = frames.map(([w, o]) =>
        generateMap(seed, { w, h: w, originX: o, originY: o }, 'simple'),
      );
      const ground = (m: GameMap, wx: number, wy: number) => {
        const x = wx - m.originX;
        const y = wy - m.originY;
        return x >= 0 && y >= 0 && x < m.w && y < m.h ? m.terrain[y * m.w + x] : undefined;
      };
      const [ref] = maps.filter((m) => m.w === 160);
      for (const m of maps) {
        const at = `${m.w} x ${m.h} at (${m.originX}, ${m.originY})`;
        const { rx, ry } = startRegion(m);
        expect([rx * 32 + m.originX, ry * 32 + m.originY], at).toEqual([64, 64]);
        expect(pumpTiles(m, true).length, at).toBeGreaterThan(0);
        for (let wy = 63; wy <= 96; wy++)
          for (let wx = 63; wx <= 96; wx++) {
            const t = ground(m, wx, wy);
            if (t !== undefined)
              expect(t, `${at}, world tile (${wx}, ${wy})`).toBe(ground(ref, wx, wy));
          }
      }
    },
    10_000,
  );
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

// The guarantee on start chunks made by hand, against a search of every tile: ponds shored with
// sand, hills, mountains, rock, forest or grass, with stray tiles of each around them.
describe('the start guarantee on any start chunk', () => {
  interface Patch {
    t: Terrain;
    x: number;
    y: number;
    w: number;
    h: number;
  }
  /** Patches painted in order over a grass chunk that has a wood and a hill in two corners. */
  interface PumpCase {
    patches: Patch[];
  }
  const SHORES = [
    Terrain.Sand,
    Terrain.Sand,
    Terrain.Hill,
    Terrain.Mountain,
    Terrain.Rock,
    Terrain.Forest,
    Terrain.Grass,
  ];
  const STRAYS = [Terrain.Hill, Terrain.Mountain, Terrain.Sand, Terrain.Forest, Terrain.Rock];
  function genPump(rng: Rng): PumpCase {
    const patches: Patch[] = [];
    for (let k = rng.int(1, 3); k > 0; k--) {
      const w = rng.int(k === 1 ? 2 : 1, 4);
      const h = rng.int(k === 1 ? 2 : 1, 4);
      const x = rng.int(1, 31 - w);
      const y = rng.int(1, 31 - h);
      // a pond, mostly ringed by a shore of one ground
      if (rng.chance(0.85))
        patches.push({ t: rng.pick(SHORES), x: x - 1, y: y - 1, w: w + 2, h: h + 2 });
      patches.push({ t: Terrain.Water, x, y, w, h });
    }
    for (let k = rng.int(0, 10); k > 0; k--)
      patches.push({ t: rng.pick(STRAYS), x: rng.int(0, 31), y: rng.int(0, 31), w: 1, h: 1 });
    return { patches };
  }
  /** The chunk, a 32 x 32 map, with forest and hills enough that startResources paints nothing. */
  function pumpMap(c: PumpCase) {
    const m = emptyMap(1, 32, 32, Terrain.Grass);
    // a wood and a hill in two corners; a patch may still paint over them
    for (let y = 0; y < 2; y++) for (let x = 0; x < 3; x++) m.terrain[y * 32 + x] = Terrain.Forest;
    for (let y = 30; y < 32; y++) for (let x = 0; x < 2; x++) m.terrain[y * 32 + x] = Terrain.Hill;
    for (const p of c.patches)
      for (let y = Math.max(0, p.y); y < Math.min(32, p.y + p.h); y++)
        for (let x = Math.max(0, p.x); x < Math.min(32, p.x + p.w); x++)
          m.terrain[y * 32 + x] = p.t;
    const n = (pred: (t: number) => boolean) => m.terrain.filter(pred).length;
    const paints =
      n((t) => t === Terrain.Water) < 4 ||
      n((t) => t === Terrain.Forest) < 6 ||
      n((t) => t === Terrain.Hill || t === Terrain.Rock) < 4 ||
      n((t) => t === Terrain.Grass) < 20;
    return { m, paints };
  }
  const steep = (t: number) => t === Terrain.Hill || t === Terrain.Mountain;
  /**
   * The search: every tile beside the chunk's water, what making it a pump tile changes (itself
   * to grass unless it is grass or forest, every hill or mountain side to grass), the fewest
   * changes first, then nearest the centre (16, 16), then in reading order.
   */
  function search(m: GameMap) {
    let best: { i: number; cost: number; d: number; changes: [number, Terrain][] } | null = null;
    for (let i = 0; i < 32 * 32; i++) {
      const x = i % 32;
      const y = Math.floor(i / 32);
      const t = m.terrain[i];
      if (t === Terrain.Water) continue;
      const sides = SIDES.map(([dx, dy]) => [x + dx, y + dy]).filter(
        ([sx, sy]) => sx >= 0 && sy >= 0 && sx < 32 && sy < 32,
      );
      if (!sides.some(([sx, sy]) => m.terrain[sy * 32 + sx] === Terrain.Water)) continue;
      const changes: [number, Terrain][] = [];
      if (t !== Terrain.Grass && t !== Terrain.Forest) changes.push([i, Terrain.Grass]);
      for (const [sx, sy] of sides)
        if (steep(m.terrain[sy * 32 + sx])) changes.push([sy * 32 + sx, Terrain.Grass]);
      const d = Math.hypot(x - 16, y - 16);
      if (!best || changes.length < best.cost || (changes.length === best.cost && d < best.d))
        best = { i, cost: changes.length, d, changes };
    }
    return best;
  }

  // 100 chunks of 32 x 32: about 0.2 s alone
  it('changes nothing where a pump tile is, and else the fewest tiles, nearest the centre', () => {
    const seen = new Set<string>();
    forAll(
      genPump,
      (c) => {
        const { m, paints } = pumpMap(c);
        // a chunk short of a resource gets a patch painted first; that is not this claim
        if (paints) return;
        const before = m.terrain.slice();
        const had = pumpTiles(m, true).length > 0;
        const best = had ? null : search(m);
        ensureStartResources(m);
        const want = before.slice();
        for (const [i, t] of best?.changes ?? []) want[i] = t;
        // the tiles that differ from the search's answer, as (x, y, got, want)
        const wrong = [...want.keys()]
          .filter((i) => m.terrain[i] !== want[i])
          .map((i) => [i % 32, Math.floor(i / 32), m.terrain[i], want[i]]);
        expect(wrong).toEqual([]);
        // and the tile it made is one a pump stands on
        expect(pumpTiles(m, true).length).toBeGreaterThan(0);
        if (best) expect(pumpTiles(m, true)).toContain(best.i);
        seen.add(had ? 'had one' : `${best!.cost} changed`);
        if (best && before[best.i] === Terrain.Forest) seen.add('forest kept');
        if (best?.changes.some(([i]) => before[i] === Terrain.Mountain)) seen.add('mountain side');
      },
      {
        shrink: function* (c) {
          for (const patches of shrinkArray(c.patches)) yield { patches };
        },
      },
    );
    // every kind of chunk ran: one with a pump tile, and fixes of one to three changes
    for (const kind of [
      'had one',
      '1 changed',
      '2 changed',
      '3 changed',
      'forest kept',
      'mountain side',
    ])
      expect(seen, kind).toContain(kind);
  });
});
