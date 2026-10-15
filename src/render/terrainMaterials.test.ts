import { describe, expect, it } from 'vitest';
import { emptyMap } from '../world/mapgen';
import { Terrain } from '../world/tiles';
import { Material } from './landscapeModel';
import { paintedWater, surfaceColor, underPaintedWater } from './terrainMaterials';

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
