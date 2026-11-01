import { describe, expect, it } from 'vitest';
import { DIR_DX, DIR_DY } from '../engine/iso';
import { tileLevels, levelAt, MAX_LEVEL } from './elevation';
import { generateMapPlanes, type MapPlanes } from './mapgen';
import {
  MASSIF_LINE,
  MOUNTAIN_SHAPES,
  SCULPT_REACH,
  coverMountains,
  massifAt,
  sculptMountains,
  shapeAt,
  type MountainShape,
  type SculptField,
} from './mountains';
import { Terrain, startRegion } from './tiles';
import { MAX_WATER_LEVEL } from './waterfalls';

/** Twenty worlds of 160 x 160, generated once for the tests that read them. */
const SIZE = 160;
const SEEDS = Array.from({ length: 20 }, (_, i) => 101 + i * 37);
const worlds = (() => {
  let made: MapPlanes[] | undefined;
  return () => (made ??= SEEDS.map((seed) => generateMapPlanes(seed, { w: SIZE, h: SIZE })));
})();

/** The land a tile's level has beyond what terrain and water give: above the ordinary level. */
const raisedTiles = ({ map }: MapPlanes) => {
  const ordinary = tileLevels({ ...map, generatedLevel: undefined });
  return map.generatedLevel!.reduce((n, v, i) => n + (v > ordinary[i] ? 1 : 0), 0);
};

/** A field of grass, `w` x `w`, with `water` tiles. */
const flat = (w: number, water: (x: number, y: number) => boolean = () => false): SculptField => {
  const terrain = new Uint8Array(w * w);
  for (let y = 0; y < w; y++)
    for (let x = 0; x < w; x++) if (water(x, y)) terrain[y * w + x] = Terrain.Water;
  return { w, h: w, originX: 0, originY: 0, terrain };
};
const NOWHERE = { x0: 0, y0: 0, x1: 0, y1: 0 };

describe('sculptMountains', () => {
  const W = 240;
  // a seed with a massif in the middle of the field
  const SEED = 3;
  const all = { x0: 0, y0: 0, x1: W, y1: W };
  const inner = { x0: SCULPT_REACH, y0: SCULPT_REACH, x1: W - SCULPT_REACH, y1: W - SCULPT_REACH };

  it('changes nothing it is given and repeats exactly', () => {
    const field = flat(W);
    const before = field.terrain.slice();
    const a = sculptMountains(field, all, NOWHERE, SEED);
    expect(field.terrain).toEqual(before);
    expect(sculptMountains(field, all, NOWHERE, SEED)).toEqual(a);
    expect(a.some((v) => v > 0)).toBe(true);
  });

  it('raises nothing outside the tiles asked for', () => {
    const levels = sculptMountains(flat(W), inner, NOWHERE, SEED);
    for (let y = 0; y < W; y++)
      for (let x = 0; x < W; x++)
        if (x < inner.x0 || y < inner.y0 || x >= inner.x1 || y >= inner.y1)
          expect(levels[y * W + x]).toBe(0);
  });

  it('gives a tile the same level whatever lies further off than SCULPT_REACH', () => {
    const whole = sculptMountains(flat(W), inner, NOWHERE, SEED);
    // a smaller span, with water everywhere just beyond its reach
    const small = { x0: 40, y0: 40, x1: 100, y1: 100 };
    const beyond = (x: number, y: number) =>
      x < small.x0 - SCULPT_REACH ||
      y < small.y0 - SCULPT_REACH ||
      x >= small.x1 + SCULPT_REACH ||
      y >= small.y1 + SCULPT_REACH;
    const cut = sculptMountains(flat(W, beyond), small, NOWHERE, SEED);
    for (let y = small.y0; y < small.y1; y++)
      for (let x = small.x0; x < small.x1; x++)
        expect(cut[y * W + x], `${x},${y}`).toBe(whole[y * W + x]);
    expect(cut.some((v) => v > 0)).toBe(true);
  });

  it('falls away to nothing at water and at what is kept clear', () => {
    const lake = (x: number, y: number) => Math.hypot(x - 120, y - 120) < 12;
    const keep = { x0: 60, y0: 60, x1: 100, y1: 100 };
    const field = flat(W, lake);
    const levels = sculptMountains(field, all, keep, SEED);
    for (let y = 0; y < W; y++)
      for (let x = 0; x < W; x++) {
        const v = levels[y * W + x];
        if (lake(x, y)) expect(v).toBe(0);
        if (x >= keep.x0 && y >= keep.y0 && x < keep.x1 && y < keep.y1) expect(v).toBe(0);
      }
  });
});

describe('coverMountains', () => {
  const W = 240;
  const SEED = 3;
  // the tiles of a massif, well inside the field
  const massif: number[] = [];
  for (let y = 8; y < W - 8; y++)
    for (let x = 8; x < W - 8; x++) if (massifAt(x, y, SEED) > MASSIF_LINE) massif.push(y * W + x);
  const span = { x0: 0, y0: 0, x1: W, y1: W };
  const covered = (level: number, keep = NOWHERE, water = (_x: number, _y: number) => false) => {
    const f = flat(W, water);
    f.terrain.fill(Terrain.Sand);
    for (let i = 0; i < W * W; i++)
      if (water(i % W, Math.floor(i / W))) f.terrain[i] = Terrain.Water;
    coverMountains(f, new Uint8Array(W * W).fill(level), span, keep, SEED);
    return f.terrain;
  };

  it('finds a massif to test on', () => {
    expect(massif.length).toBeGreaterThan(1000);
  });

  it('is mountain on the heights, rock below them, whatever lay there', () => {
    const top = covered(16);
    const middle = covered(8);
    for (const i of massif) {
      expect(top[i]).toBe(Terrain.Mountain);
      expect(middle[i]).toBe(Terrain.Rock);
    }
  });

  it('is grass or forest on the low slopes, and grass on a valley floor', () => {
    const low = covered(1);
    const floor = covered(0);
    expect(massif.some((i) => low[i] === Terrain.Forest)).toBe(true);
    expect(massif.some((i) => low[i] === Terrain.Grass)).toBe(true);
    for (const i of massif) expect(floor[i]).toBe(Terrain.Grass);
  });

  it('puts rock on a cliff at any height', () => {
    const f = flat(W);
    const levels = new Uint8Array(W * W).fill(1);
    const i = massif[0];
    levels[i + 1] = 4;
    coverMountains(f, levels, span, NOWHERE, SEED);
    expect(f.terrain[i]).toBe(Terrain.Rock);
  });

  it('gives a Mountain tile two rings of Rock, on the ground outside the massif too', () => {
    const f = flat(W);
    f.terrain.fill(Terrain.Sand);
    coverMountains(f, new Uint8Array(W * W).fill(16), span, NOWHERE, SEED);
    const stone = (t: number) => t === Terrain.Rock || t === Terrain.Mountain;
    let bare = 0;
    for (let y = 10; y < W - 10; y++)
      for (let x = 10; x < W - 10; x++) {
        if (f.terrain[y * W + x] !== Terrain.Mountain) continue;
        for (let dy = -2; dy <= 2; dy++)
          for (let dx = -2; dx <= 2; dx++) if (!stone(f.terrain[(y + dy) * W + x + dx])) bare++;
      }
    expect(bare).toBe(0);
  });

  it('keeps the ground that holds raised water up', () => {
    const f = flat(W);
    const [i] = massif;
    f.terrain.fill(Terrain.Hill);
    f.terrain[i + 1] = Terrain.Water;
    f.waterSurface = new Uint8Array(W * W);
    f.waterSurface[i + 1] = 2;
    coverMountains(f, new Uint8Array(W * W), span, NOWHERE, SEED);
    expect(f.terrain[i]).toBe(Terrain.Hill);
  });

  it('keeps off water, what is kept clear and the ground outside the massifs', () => {
    const [i] = massif;
    const x = i % W;
    const y = Math.floor(i / W);
    const keep = { x0: x, y0: y, x1: x + 1, y1: y + 1 };
    expect(covered(16, keep)[i]).toBe(Terrain.Sand);
    expect(covered(16, NOWHERE, (a, b) => a === x && b === y)[i]).toBe(Terrain.Water);
    // below the heights, so no rings of rock reach past the massif
    const all = covered(8);
    for (let k = 0; k < W * W; k += 97)
      if (massifAt(k % W, Math.floor(k / W), SEED) <= MASSIF_LINE)
        expect(all[k]).toBe(Terrain.Sand);
  });
});

describe('the mountains of generated worlds', () => {
  it('stays within the top and a step of 4', () => {
    for (const { map } of worlds()) {
      const { w, h, generatedLevel: g } = map;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const v = g![y * w + x];
          expect(v).toBeLessThanOrEqual(MAX_LEVEL);
          if (x < w - 1) expect(Math.abs(v - g![y * w + x + 1])).toBeLessThanOrEqual(4);
          if (y < h - 1) expect(Math.abs(v - g![(y + 1) * w + x])).toBeLessThanOrEqual(4);
        }
    }
  }, 120_000);

  it('holds settled levels: a tile reads the same alone as with the whole map', () => {
    for (const { map } of worlds().slice(0, 4)) {
      const settled = tileLevels(map);
      for (let y = 0; y < map.h; y++)
        for (let x = 0; x < map.w; x++)
          if (levelAt(map, x, y) !== settled[y * map.w + x])
            expect(levelAt(map, x, y), `${x},${y}`).toBe(settled[y * map.w + x]);
    }
  }, 120_000);

  it('reaches at least level 12 on 18 of 20 seeds of 160 x 160', () => {
    const tall = worlds().filter(({ map }) => map.generatedLevel!.some((v) => v >= 12));
    expect(tall.length).toBeGreaterThanOrEqual(18);
  }, 120_000);

  it('uses all three shapes over 40 seeds, hill the most', () => {
    // the shape is a noise over world tiles, so 40 seeds are cheap read directly, on a massif
    const seen: Record<MountainShape, number> = { hill: 0, ridge: 0, tower: 0 };
    for (let k = 0; k < 40; k++) {
      const seed = 11 + k * 977;
      for (let y = -240; y < 240; y += 8)
        for (let x = -240; x < 240; x += 8)
          if (massifAt(x, y, seed) > MASSIF_LINE) seen[shapeAt(x, y, seed)]++;
    }
    const total = seen.hill + seen.ridge + seen.tower;
    for (const shape of ['hill', 'ridge', 'tower'] as const)
      expect(Math.abs(seen[shape] / total - MOUNTAIN_SHAPES[shape]), shape).toBeLessThan(0.1);
    expect(seen.hill).toBeGreaterThan(seen.ridge);
    expect(seen.ridge).toBeGreaterThan(seen.tower);
    expect(seen.tower).toBeGreaterThan(0);
  });

  it('leaves water, the map border and the start chunk at their old levels', () => {
    for (const { map } of worlds()) {
      const { w, h, terrain, waterSurface } = map;
      const levels = tileLevels(map);
      const { rx, ry } = startRegion(map);
      const old = tileLevels({ ...map, generatedLevel: undefined });
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          if (terrain[i] === Terrain.Water)
            expect(map.generatedLevel![i], `water ${x},${y}`).toBe(waterSurface![i]);
          if (x === 0 || y === 0 || x === w - 1 || y === h - 1)
            expect(levels[i], `border ${x},${y}`).toBeLessThanOrEqual(1);
          const inStart = Math.floor(x / 32) === rx && Math.floor(y / 32) === ry;
          if (inStart) expect(levels[i], `start ${x},${y}`).toBe(old[i]);
        }
    }
  }, 120_000);

  it('a map grown by a ring has the same levels on the tiles both hold', () => {
    for (const seed of [SEEDS[0], SEEDS[1], SEEDS[2]]) {
      const small = generateMapPlanes(seed, { w: 96, h: 96 }).map;
      const big = generateMapPlanes(seed, { w: 160, h: 160, originX: -32, originY: -32 }).map;
      expect(small.generatedLevel!.some((v) => v > 4) || seed !== SEEDS[0]).toBe(true);
      for (let y = 0; y < 96; y++)
        for (let x = 0; x < 96; x++) {
          const i = y * 96 + x;
          const j = (y + 32) * 160 + x + 32;
          if (small.generatedLevel![i] !== big.generatedLevel![j])
            expect(small.generatedLevel![i], `${seed}: ${x},${y}`).toBe(big.generatedLevel![j]);
        }
    }
  }, 60_000);

  it('generates the same map twice', () => {
    const [seed] = SEEDS;
    const a = generateMapPlanes(seed, { w: 96, h: 96 }).map;
    const b = generateMapPlanes(seed, { w: 96, h: 96 }).map;
    expect(a.generatedLevel).toEqual(b.generatedLevel);
    expect(a.terrain).toEqual(b.terrain);
  });

  it('leaves no flat top: under 2% of raised tiles stand at 16', () => {
    let raised = 0;
    let top = 0;
    for (const planes of worlds()) {
      raised += raisedTiles(planes);
      top += planes.map.generatedLevel!.reduce((n, v) => n + (v === MAX_LEVEL ? 1 : 0), 0);
    }
    expect(raised).toBeGreaterThan(0);
    expect(top / raised).toBeLessThan(0.02);
  }, 120_000);

  /**
   * River tiles a river starts on: inside the map, with no water beside them but the tile they run
   * into, which leaves out where a river comes in over the map's edge, a lake's outlet, and the
   * second tile of a wide river.
   */
  const riverHeads = ({ map, river }: MapPlanes) => {
    const { w, h, terrain, flowDir } = map;
    const heads: { x: number; y: number }[] = [];
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (!river[i]) continue;
        const side = flowDir![i] - 1;
        const down = (y + DIR_DY[side]) * w + x + DIR_DX[side];
        if ([i - 1, i + 1, i - w, i + w].some((n) => n !== down && terrain[n] === Terrain.Water))
          continue;
        heads.push({ x, y });
      }
    return heads;
  };
  const nearMassif = (p: MapPlanes, x: number, y: number, reach: number) => {
    for (let dy = -reach; dy <= reach; dy++)
      for (let dx = -reach; dx <= reach; dx++) {
        const wx = x + dx + p.map.originX;
        const wy = y + dy + p.map.originY;
        if (massifAt(wx, wy, p.massifSeed) > MASSIF_LINE) return true;
      }
    return false;
  };

  it('starts most rivers in the mountains: over 20 seeds, 70% of river heads lie within 6 tiles of a massif', () => {
    let heads = 0;
    let near = 0;
    for (const planes of worlds())
      for (const { x, y } of riverHeads(planes)) {
        heads++;
        if (nearMassif(planes, x, y, 6)) near++;
      }
    expect(heads).toBeGreaterThan(200);
    expect(near / heads).toBeGreaterThanOrEqual(0.7);
  }, 120_000);

  it('keeps every river at water level 4 or under, flowing downhill', () => {
    for (const { map, river } of worlds()) {
      const { w, h, waterSurface, flowDir, terrain } = map;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          if (terrain[i] === Terrain.Water)
            expect(waterSurface![i]).toBeLessThanOrEqual(MAX_WATER_LEVEL);
          if (!river[i]) continue;
          const side = flowDir![i] - 1;
          const nx = x + DIR_DX[side];
          const ny = y + DIR_DY[side];
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const n = ny * w + nx;
          if (terrain[n] === Terrain.Water)
            expect(waterSurface![n], `${x},${y}`).toBeLessThanOrEqual(waterSurface![i]);
        }
    }
  }, 120_000);
});
