import { describe, expect, it } from 'vitest';
import { DIR_DX, DIR_DY } from '../engine/iso';
import { tileLevels, levelAt, MAX_LEVEL } from './elevation';
import { DEFAULT_MAP_PARAMS, generateMapPlanes, type MapPlanes } from './mapgen';
import {
  MASSIF_LINE,
  MOUNTAIN_SHAPES,
  SCULPT_REACH,
  coverMountains,
  massifAt,
  sculptMountains,
  shapeAt,
  type CoverField,
  type CoverSliders,
  type MountainShape,
} from './mountains';
import { Biome, Terrain, startRegion, type GameMap } from './tiles';
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
const flat = (w: number, water: (x: number, y: number) => boolean = () => false): CoverField => {
  const terrain = new Uint8Array(w * w);
  for (let y = 0; y < w; y++)
    for (let x = 0; x < w; x++) if (water(x, y)) terrain[y * w + x] = Terrain.Water;
  return { w, h: w, originX: 0, originY: 0, terrain, biome: new Uint8Array(w * w) };
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
  const covered = (
    level: number,
    keep = NOWHERE,
    water = (_x: number, _y: number) => false,
    sliders: CoverSliders = DEFAULT_MAP_PARAMS,
    climate = Biome.Plains,
  ) => {
    const f = flat(W, water);
    f.terrain.fill(Terrain.Sand);
    f.biome.fill(climate);
    for (let i = 0; i < W * W; i++)
      if (water(i % W, Math.floor(i / W))) f.terrain[i] = Terrain.Water;
    coverMountains(f, new Uint8Array(W * W).fill(level), span, keep, SEED, sliders);
    return f.terrain;
  };
  const onMassif = (terrain: Uint8Array, ...t: Terrain[]) =>
    massif.filter((i) => t.includes(terrain[i] as Terrain)).length;
  const dry = () => false;

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

  it('holds no stone below level 5 at the default sliders', () => {
    expect(onMassif(covered(4), Terrain.Rock, Terrain.Mountain)).toBe(0);
  });

  it('makes what the climate makes of the low ground, and the same stone', () => {
    const under = (b: Biome, level: number) => covered(level, NOWHERE, dry, undefined, b);
    expect(onMassif(under(Biome.Desert, 0), Terrain.Sand)).toBe(massif.length);
    expect(onMassif(under(Biome.Desert, 1), Terrain.Sand)).toBe(massif.length);
    expect(onMassif(under(Biome.Swamp, 1), Terrain.Forest)).toBe(0);
    expect(onMassif(under(Biome.Ocean, 1), Terrain.Forest)).toBe(0);
    expect(under(Biome.Forest, 1)).toEqual(covered(1));
    expect(under(Biome.Taiga, 1)).toEqual(covered(1));
    expect(under(Biome.Desert, 8)).toEqual(covered(8));
    expect(under(Biome.Desert, 16)).toEqual(covered(16));
  });

  it('moves the forest with the forestDensity slider, lower for more', () => {
    const forest = (forestDensity: number) =>
      onMassif(covered(1, NOWHERE, dry, { ...DEFAULT_MAP_PARAMS, forestDensity }), Terrain.Forest);
    expect(forest(0.4)).toBeGreaterThan(forest(DEFAULT_MAP_PARAMS.forestDensity));
    expect(forest(DEFAULT_MAP_PARAMS.forestDensity)).toBeGreaterThan(forest(0.7));
  });

  it('moves the rock and mountain lines with the rockLevel slider, lower for more', () => {
    const at = (level: number, rockLevel: number, t: Terrain) =>
      onMassif(covered(level, NOWHERE, dry, { ...DEFAULT_MAP_PARAMS, rockLevel }), t);
    const usual = DEFAULT_MAP_PARAMS.rockLevel;
    expect(at(5, 0.6, Terrain.Rock)).toBeGreaterThan(at(5, usual, Terrain.Rock));
    expect(at(5, usual, Terrain.Rock)).toBeGreaterThan(at(5, 0.9, Terrain.Rock));
    expect(at(9, 0.6, Terrain.Mountain)).toBeGreaterThan(at(9, usual, Terrain.Mountain));
    expect(at(9, usual, Terrain.Mountain)).toBeGreaterThan(at(9, 0.9, Terrain.Mountain));
  });

  it('puts rock on a cliff at any height', () => {
    const f = flat(W);
    const levels = new Uint8Array(W * W).fill(1);
    const i = massif[0];
    levels[i + 1] = 4;
    coverMountains(f, levels, span, NOWHERE, SEED, DEFAULT_MAP_PARAMS);
    expect(f.terrain[i]).toBe(Terrain.Rock);
  });

  it('gives a Mountain tile two rings of Rock, on the ground outside the massif too', () => {
    const f = flat(W);
    f.terrain.fill(Terrain.Sand);
    coverMountains(f, new Uint8Array(W * W).fill(16), span, NOWHERE, SEED, DEFAULT_MAP_PARAMS);
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
    coverMountains(f, new Uint8Array(W * W), span, NOWHERE, SEED, DEFAULT_MAP_PARAMS);
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

  /** Whether each tile of the map is on a massif. */
  const massifTiles = ({ map, massifSeed }: MapPlanes) =>
    Uint8Array.from({ length: map.w * map.h }, (_, i) => {
      const wx = (i % map.w) + map.originX;
      const wy = Math.floor(i / map.w) + map.originY;
      return massifAt(wx, wy, massifSeed) > MASSIF_LINE ? 1 : 0;
    });

  it('grows no forest on a desert massif, whose low ground is sand', () => {
    let desert = 0;
    let sand = 0;
    for (const planes of worlds()) {
      const { seed, terrain, climate } = planes.map;
      massifTiles(planes).forEach((on, i) => {
        if (!on || climate![i] !== Biome.Desert) return;
        desert++;
        if (terrain[i] === Terrain.Sand) sand++;
        if (terrain[i] === Terrain.Forest) expect.fail(`forest at ${i} of seed ${seed}`);
      });
    }
    expect(desert).toBeGreaterThan(1000);
    expect(sand / desert).toBeGreaterThan(0.6);
  }, 120_000);

  it('moves the ground of generated massifs with the sliders', () => {
    const world = (p: Partial<CoverSliders>) => generateMapPlanes(SEEDS[0], { w: 96, h: 96, ...p });
    const forest = (planes: MapPlanes) =>
      massifTiles(planes).reduce(
        (n, on, i) => n + (on && planes.map.terrain[i] === Terrain.Forest ? 1 : 0),
        0,
      );
    const stone = (planes: MapPlanes) =>
      massifTiles(planes).reduce((n, on, i) => {
        const t = planes.map.terrain[i];
        return n + (on && (t === Terrain.Rock || t === Terrain.Mountain) ? 1 : 0);
      }, 0);
    const usual = world({});
    expect(forest(world({ forestDensity: 0.4 }))).toBeGreaterThan(forest(usual));
    expect(forest(world({ forestDensity: 0.7 }))).toBeLessThan(forest(usual));
    expect(stone(world({ rockLevel: 0.68 }))).toBeGreaterThan(stone(usual));
    expect(stone(world({ rockLevel: 0.9 }))).toBeLessThan(stone(usual));
  }, 30_000);

  // The rain above the hill line keeps one step whatever the slider says: read on the slider's own
  // scale, a rock level under the hill level gave a massif 80 steps of rain, and the rivers ate it.
  it('keeps the water and the tops of a world across the whole rock slider', () => {
    const water = ({ terrain }: GameMap) => terrain.filter((t) => t === Terrain.Water).length;
    const top = ({ generatedLevel: g }: GameMap) => Math.max(...g!);
    for (const seed of [101, 7053]) {
      const usual = generateMapPlanes(seed, { w: 96, h: 96 }).map;
      for (const rockLevel of [0.5, 0.6, 0.7, 0.9, 1]) {
        const { map } = generateMapPlanes(seed, { w: 96, h: 96, rockLevel });
        const near = `seed ${seed} at ${rockLevel}`;
        expect(Math.abs(water(map) / water(usual) - 1), near).toBeLessThan(0.05);
        expect(Math.abs(top(map) - top(usual)), near).toBeLessThanOrEqual(1);
      }
    }
  }, 60_000);

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
      expect(Math.abs(seen[shape] / total - MOUNTAIN_SHAPES[shape]), shape).toBeLessThan(0.04);
    expect(seen.hill).toBeGreaterThan(seen.ridge);
    expect(seen.ridge).toBeGreaterThan(seen.tower);
    expect(seen.tower).toBeGreaterThan(0);
  });

  it('makes each shape stand as its own kind of ground', () => {
    // what the ground of each shape's tiles does: a tower is steep and short, a ridge long and even
    const made = { hill: [0, 0, 0], ridge: [0, 0, 0], tower: [0, 0, 0] };
    for (const planes of worlds()) {
      const { w, h, terrain, generatedLevel: g, originX, originY } = planes.map;
      for (let y = 1; y < h - 1; y++)
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          if (terrain[i] === Terrain.Water) continue;
          const wx = x + originX;
          const wy = y + originY;
          if (massifAt(wx, wy, planes.massifSeed) <= MASSIF_LINE) continue;
          const v = g![i];
          const step = Math.max(...[i - 1, i + 1, i - w, i + w].map((n) => Math.abs(v - g![n])));
          const seen = made[shapeAt(wx, wy, planes.massifSeed)];
          seen[0]++;
          if (step >= 3) seen[1]++;
          if (v >= 12) seen[2]++;
        }
    }
    const steep = (s: MountainShape) => made[s][1] / made[s][0];
    const tall = (s: MountainShape) => made[s][2] / made[s][0];
    expect(steep('tower')).toBeGreaterThan(2 * steep('hill'));
    expect(steep('hill')).toBeGreaterThan(1.5 * steep('ridge'));
    expect(tall('hill')).toBeGreaterThan(2 * tall('tower'));
    expect(tall('ridge')).toBeGreaterThan(2 * tall('tower'));
  }, 120_000);

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
  /** The map's tiles within `reach` tiles of a massif along either axis, as 1s on a plane. */
  const nearMassifs = ({ map, massifSeed }: MapPlanes, reach: number) => {
    const { w, h, originX, originY } = map;
    const near = new Uint8Array(w * h);
    for (let y = -reach; y < h + reach; y++)
      for (let x = -reach; x < w + reach; x++) {
        if (massifAt(x + originX, y + originY, massifSeed) <= MASSIF_LINE) continue;
        for (let ny = Math.max(0, y - reach); ny <= Math.min(h - 1, y + reach); ny++)
          near.fill(1, ny * w + Math.max(0, x - reach), ny * w + Math.min(w, x + reach + 1));
      }
    return near;
  };

  // A massif and the tiles around it hold more than half of the land, so most heads would lie near
  // one by chance alone. What the lift adds is the gap between the two shares, so this reads both,
  // over 60 worlds: three ranges of seeds fixed ahead of the result, as one range of 20 can read
  // several points apart from the next. Do not pick seeds by the result. Over these seeds 64.9% of
  // the heads and 54.6% of the land lie near a massif, and rivers take 7.2% of all tiles.
  it('starts rivers near the massifs: over 60 seeds, 60% of river heads lie within 6 tiles of one, 10 points over the land', () => {
    const seeds = [
      ...Array.from({ length: 20 }, (_, i) => 7000 + i * 53),
      ...Array.from({ length: 20 }, (_, i) => 40000 + i * 211),
      ...Array.from({ length: 20 }, (_, i) => 900000 + i * 1009),
    ];
    let heads = 0;
    let headsNear = 0;
    let land = 0;
    let landNear = 0;
    for (const seed of seeds) {
      const planes = generateMapPlanes(seed, { w: SIZE, h: SIZE });
      const { w, terrain } = planes.map;
      const near = nearMassifs(planes, 6);
      for (const { x, y } of riverHeads(planes)) {
        heads++;
        headsNear += near[y * w + x];
      }
      terrain.forEach((t, i) => {
        if (t === Terrain.Water) return;
        land++;
        landNear += near[i];
      });
    }
    expect(heads).toBeGreaterThan(1000);
    expect(headsNear / heads).toBeGreaterThanOrEqual(0.6);
    expect(headsNear / heads - landNear / land).toBeGreaterThanOrEqual(0.1);
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
