import { describe, expect, it } from 'vitest';
import type { Rng } from '../engine/rng';
import { SEEDS, forAll, shrinkArray } from '../testing/property';
import { emptyMap } from '../world/mapgen';
import { Terrain } from '../world/tiles';
import { Material } from './landscapeModel';
import { paintedWater, surfaceBlend, surfaceColor, underPaintedWater } from './terrainMaterials';

// The waterline bridges cut what stands in the water to (underPaintedWater) is the landscape
// painter's own: the water's share of the blend it paints (paintedWater, which the painter weighs
// its colours by). Points are read on a 1/32 tile grid round a river with a town tile on its bank.

const W = 16;
/** A river two tiles wide along y at x = 6 and 7, a lake, and a paved tile on the river's bank. */
function fixture() {
  const m = emptyMap(4242, W, W);
  for (let y = 0; y < W; y++)
    for (let x = 0; x < W; x++)
      if (x === 6 || x === 7 || (x >= 10 && x <= 12 && y >= 9 && y <= 12))
        m.terrain[y * W + x] = Terrain.Water;
  return m;
}
const PAVED = 4 * W + 8;
const paved = (tile: number) => tile === PAVED;
const tileOf = (x: number, y: number) => Math.round(y) * W + Math.round(x);
/** Every point of the grid over the river and the lake. */
function* grid() {
  for (let y = 1; y < 14; y += 1 / 32) for (let x = 4; x < 13.5; x += 1 / 32) yield [x, y];
}
const share = (m: ReturnType<typeof fixture>, x: number, y: number) =>
  paintedWater(m, x, y, paved(tileOf(x, y)));
const isWaterTile = (m: ReturnType<typeof fixture>, x: number, y: number) =>
  m.terrain[tileOf(x, y)] === Terrain.Water;

describe('the painted waterline', () => {
  const m = fixture();

  it('is water where the painter paints water alone', () => {
    for (const [x, y] of [
      [6, 5],
      [7, 5],
      [6.5, 2.25],
      [11, 10.5],
    ]) {
      expect(share(m, x, y), `${x},${y}`).toBeGreaterThan(1 - 1e-9);
      expect(underPaintedWater(m, x, y, paved), `${x},${y}`).toBe(true);
    }
  });

  it('is bank where the painter paints bank inside a water tile', () => {
    let found = 0;
    for (const [x, y] of grid())
      if (isWaterTile(m, x, y) && share(m, x, y) === 0) {
        found++;
        expect(underPaintedWater(m, x, y, paved), `${x},${y}`).toBe(false);
      }
    // the warped shore reaches into the water's own tiles
    expect(found).toBeGreaterThan(50);
  });

  it("is bank on the soft shore's half-water pixels, and where the pixel below blends into bank", () => {
    let half = 0,
      above = 0;
    for (const [x, y] of grid()) {
      const s = share(m, x, y);
      if (s > 0 && s < 1 - 1e-6) {
        half++;
        expect(underPaintedWater(m, x, y, paved), `${x},${y}`).toBe(false);
      } else if (s >= 1 - 1e-6 && share(m, x + 1 / 64, y + 1 / 64) < 1 - 1e-6) {
        above++;
        expect(underPaintedWater(m, x, y, paved), `${x},${y}`).toBe(false);
      }
    }
    expect(half).toBeGreaterThan(50);
    expect(above).toBeGreaterThan(5);
  });

  it('is water in the foam and glints the water is painted with', () => {
    // A surface sheet whose water is teal with white foam spots: a colour test would call the
    // foam bank and leave holes in the water. The waterline reads the material, not the colour.
    const size = 64,
      sheet = new Uint8ClampedArray(size * size * 10 * 4);
    for (let cell = 0; cell < 10; cell++)
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
          const k = ((cell * size + y) * size + x) * 4,
            foam = cell === Material.Water && x % 8 < 2 && y % 8 < 2;
          sheet.set(
            foam
              ? [240, 240, 230, 255]
              : cell === Material.Water
                ? [65, 111, 116, 255]
                : [110, 125, 69, 255],
            k,
          );
        }
    const out = [0, 0, 0];
    let foam = 0;
    for (const [x, y] of grid()) {
      if (share(m, x, y) < 1 - 1e-6 || share(m, x + 1 / 64, y + 1 / 64) < 1 - 1e-6) continue;
      surfaceColor(sheet, Material.Water, x + m.originX, y + m.originY, out);
      // what a colour test calls water: blue well above red
      if (out[2] > out[0] + 20) continue;
      foam++;
      expect(underPaintedWater(m, x, y, paved), `${x},${y}`).toBe(true);
    }
    expect(foam).toBeGreaterThan(20);
  });

  it('is water exactly where the painter paints water alone at the point and half a pixel below', () => {
    // The painter's blend at every point, with no shortcut: the rule may skip the blend where it
    // can read only one kind of tile, and must still agree everywhere.
    const all = (x: number, y: number) =>
        x >= -0.5 && y >= -0.5 && x < W - 0.5 && y < W - 0.5 && share(m, x, y) >= 1 - 1e-6,
      wrong: string[] = [];
    let water = 0;
    for (const [x, y] of grid()) {
      const want = all(x, y) && all(x + 1 / 64, y + 1 / 64);
      if (want) water++;
      if (underPaintedWater(m, x, y, paved) !== want) wrong.push(`${x},${y}`);
    }
    expect(wrong).toEqual([]);
    expect(water).toBeGreaterThan(1000);
  });

  it('has no water on a paved tile, nor off the map', () => {
    let reached = 0;
    for (let y = 3.5; y < 4.5; y += 1 / 64)
      for (let x = 7.5; x < 8.5; x += 1 / 64) {
        // the river's shore reaches into the town's tile, and is paved over there
        if (paintedWater(m, x, y) > 0) reached++;
        expect(paintedWater(m, x, y, true)).toBe(0);
        expect(underPaintedWater(m, x, y, paved)).toBe(false);
      }
    expect(reached).toBeGreaterThan(0);
    // the river runs off the map at y = -0.5 and y = 15.5
    for (const [x, y] of [
      [6, -0.6],
      [6.5, W - 0.5],
      [-0.6, 6],
    ])
      expect(underPaintedWater(m, x, y, paved)).toBe(false);
  });
});

// Properties of the waterline over seeded small maps (docs/process/verification.md): scattered
// water, lone water tiles three apart (the ground round them is not coastal, so the painter's warp
// reaches farthest there), and lakes with lone islets; towns paving tiles at random; the map's
// origin anywhere, since the warp follows world coordinates; points off the map too.

/** A small map, its water and paving by tile index, and the map points read on it. */
interface Shore {
  w: number;
  h: number;
  originX: number;
  originY: number;
  water: number[];
  paved: number[];
  points: [number, number][];
}
/** The land between the water: none of it is painted as water, whatever it is. */
const LAND = [Terrain.Grass, Terrain.Forest, Terrain.Sand, Terrain.Hill];
function shoreMap(c: Shore) {
  const m = emptyMap(1, c.w, c.h, Terrain.Grass, c.originX, c.originY);
  for (let i = 0; i < c.w * c.h; i++) m.terrain[i] = LAND[(i * 7) % LAND.length];
  for (const i of c.water) m.terrain[i] = Terrain.Water;
  return m;
}
function shore(rng: Rng, points = 300): Shore {
  const w = rng.int(2, 12),
    h = rng.int(2, 12),
    originX = rng.int(-4000, 4000),
    originY = rng.int(-4000, 4000),
    style = rng.int(0, 2),
    density = rng.range(0.1, 0.9),
    a = rng.int(0, 2),
    b = rng.int(0, 2),
    water: number[] = [],
    paved: number[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const lake =
        style === 0
          ? rng.chance(density)
          : style === 1
            ? x % 3 === a && y % 3 === b
            : rng.chance(0.9);
      if (lake) water.push(y * w + x);
      if (rng.chance(0.15)) paved.push(y * w + x);
    }
  return {
    w,
    h,
    originX,
    originY,
    water,
    paved,
    points: Array.from({ length: points }, () => [rng.range(-1, w + 0.5), rng.range(-1, h + 0.5)]),
  };
}
/** Fewer points first (down to the one that fails), then fewer water tiles, then less paving. */
function* shrinkShore(c: Shore): Iterable<Shore> {
  for (const points of shrinkArray(c.points)) yield { ...c, points };
  for (const water of shrinkArray(c.water)) yield { ...c, water };
  for (const paved of shrinkArray(c.paved)) yield { ...c, paved };
}
/** The water's share of the painter's blend at a point, read straight off surfaceBlend. */
function blendShare(m: ReturnType<typeof shoreMap>, x: number, y: number) {
  const blend = new Array<number>(8);
  surfaceBlend(m, x, y, blend);
  let share = 0;
  for (let k = 0; k < 4; k++) if (blend[k] === Material.Water) share += blend[k + 4];
  return share;
}
/**
 * The waterline with nothing skipped: on the map, on a tile no town paves, the blend water alone
 * (to its float error) at the point and half a world pixel lower on screen.
 */
function slowWaterline(m: ReturnType<typeof shoreMap>, paved: Set<number>, x: number, y: number) {
  const alone = (u: number, v: number) =>
    u >= -0.5 &&
    v >= -0.5 &&
    u < m.w - 0.5 &&
    v < m.h - 0.5 &&
    !paved.has(Math.round(v) * m.w + Math.round(u)) &&
    blendShare(m, u, v) >= 1 - 1e-6;
  return alone(x, y) && alone(x + 1 / 64, y + 1 / 64);
}
/** Every point of a case reads as the slow waterline does. */
function agrees(c: Shore) {
  const m = shoreMap(c),
    paved = new Set(c.paved);
  for (const [x, y] of c.points)
    expect(
      underPaintedWater(m, x, y, (k) => paved.has(k)),
      `at ${x},${y}`,
    ).toBe(slowWaterline(m, paved, x, y));
}

describe('the painted waterline, on any shore', () => {
  // slow because the painted waterline is read against the blend at every point of each seeded
  // shore: 0.33 s alone, so a limit of 30 s
  it('agrees with the blend read at every point, however the rule skips it', () => {
    forAll((rng) => shore(rng), agrees, { shrink: shrinkShore });
  }, 30_000);

  // 1500 points on each of 50 maps, read twice each: about a second alone
  it('agrees with the blend read as far from a lone water tile as its water is painted', () => {
    // Away from the coast the painter's warp moves a point up to 0.4 tile, so the water of a lone
    // tile is painted alone up to some 0.8 tile from its centre, where the ground round it is not
    // coastal. Points in the ring 0.7 to 0.85 tile out are where the rule's reach must hold.
    forAll(
      (rng) => {
        const w = rng.int(4, 12),
          h = rng.int(4, 12),
          a = rng.int(0, 2),
          b = rng.int(0, 2),
          c: Shore = {
            w,
            h,
            originX: rng.int(-4000, 4000),
            originY: rng.int(-4000, 4000),
            water: [],
            paved: [],
            points: [],
          };
        for (let y = b; y < h; y += 3) for (let x = a; x < w; x += 3) c.water.push(y * w + x);
        for (let n = 0; n < 1500; n++) {
          const k = rng.pick(c.water),
            out = rng.range(0.7, 0.85) * (rng.chance(0.5) ? 1 : -1),
            across = rng.range(-0.85, 0.85),
            [dx, dy] = rng.chance(0.5) ? [out, across] : [across, out];
          c.points.push([(k % w) + dx, Math.floor(k / w) + dy]);
        }
        return c;
      },
      agrees,
      { seeds: SEEDS.slice(0, 50), shrink: shrinkShore },
    );
  }, 20_000);

  // slow because 50 points of each seeded shore are read paved and unpaved: 0.41 s alone, so a
  // limit of 30 s
  it('is the water part of the very blend it leaves for the painter, and none where paved', () => {
    // The painter weighs its colours by the blend paintedWater leaves, so the share must be read
    // off that blend, paved or not.
    forAll(
      (rng) => shore(rng, 50),
      (c) => {
        const m = shoreMap(c);
        for (const [x, y] of c.points)
          for (const paved of [false, true]) {
            const left = new Array<number>(8).fill(NaN),
              own = new Array<number>(8),
              share = paintedWater(m, x, y, paved, left);
            surfaceBlend(m, x, y, own);
            expect(left, `blend at ${x},${y}`).toEqual(own);
            let water = 0;
            for (let k = 0; k < 4; k++) if (left[k] === Material.Water) water += left[k + 4];
            expect(share, `share at ${x},${y}, paved ${paved}`).toBe(paved ? 0 : water);
            expect(share).toBeGreaterThanOrEqual(0);
            expect(share).toBeLessThanOrEqual(1 + 1e-12);
          }
      },
      { shrink: shrinkShore },
    );
  }, 30_000);
});
