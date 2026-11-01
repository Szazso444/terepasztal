import { describe, expect, it } from 'vitest';
import { emptyMap, generateMap } from '../world/mapgen';
import { Biome, Terrain, type GameMap } from '../world/tiles';
import { Headwater, withHeadwater } from '../world/waterfalls';
import { Material, materialAt } from './landscapeModel';
import { paintedWater, surfaceBlend, underPaintedWater } from './terrainMaterials';
import {
  bankMaterial,
  channelsOf,
  iceAt,
  isRiver,
  moraineAt,
  riverAt,
  riverWater,
  type RiverPoint,
} from './waterPaint';

/** A map of grass with a river along row 8, flowing east from column 2 to column 13. */
function straight(): GameMap {
  const m = emptyMap(5, 16, 16);
  m.waterSurface = new Uint8Array(256);
  m.flowDir = new Uint8Array(256);
  m.flow = new Uint16Array(256);
  m.feature = new Uint8Array(256);
  for (let x = 2; x <= 13; x++) {
    const i = 8 * 16 + x;
    m.terrain[i] = Terrain.Water;
    m.biome[i] = Biome.River;
    m.flowDir[i] = 2;
    m.flow[i] = 100;
  }
  return m;
}
const tile = (x: number, y: number) => y * 16 + x;
const point: RiverPoint = { water: 0, still: 0, bank: 0 };

describe('a river in its tile', () => {
  it('is water down its middle and land at the tile edges beside it', () => {
    const m = straight();
    const c = channelsOf(m, 10);
    for (let x = 4; x <= 11; x++) {
      expect(riverWater(c, m, tile(x, 8), x, 8)).toBe(1);
      expect(riverWater(c, m, tile(x, 8), x + 0.5, 8)).toBe(1);
      expect(riverWater(c, m, tile(x, 8), x, 8.5)).toBe(0);
      expect(riverWater(c, m, tile(x, 8), x, 7.5)).toBe(0);
    }
  });

  it('joins the next tile with no seam: both read the same along their shared edge', () => {
    const m = straight();
    const c = channelsOf(m, 10);
    for (let across = -0.5; across <= 0.5; across += 0.05) {
      const a = riverWater(c, m, tile(6, 8), 6.5, 8 + across);
      const b = riverWater(c, m, tile(7, 8), 6.5, 8 + across);
      expect(a).toBeCloseTo(b, 6);
    }
  });

  it('turns a bend round the corner its two legs share', () => {
    const m = straight();
    // the river turns south at column 8
    for (let x = 9; x <= 13; x++) {
      m.terrain[tile(x, 8)] = Terrain.Grass;
      m.flowDir![tile(x, 8)] = 0;
    }
    m.flowDir![tile(8, 8)] = 3;
    m.terrain[tile(8, 9)] = Terrain.Water;
    m.flowDir![tile(8, 9)] = 3;
    const c = channelsOf(m, 10);
    // on the arc about the corner (7.5, 8.5), and away from it at the far corner
    expect(riverWater(c, m, tile(8, 8), 7.5 + Math.SQRT1_2 / 2, 8.5 - Math.SQRT1_2 / 2)).toBe(1);
    expect(riverWater(c, m, tile(8, 8), 8.45, 7.55)).toBe(0);
  });

  it('opens onto still water with no bank across its mouth', () => {
    const m = straight();
    m.flowDir![tile(13, 8)] = 0;
    m.biome[tile(13, 8)] = Biome.Lake;
    const c = channelsOf(m, 10);
    riverAt(c, m, tile(12, 8), 12.46, 8.42, point);
    expect(point.water).toBe(1);
    expect(point.still).toBeGreaterThan(0.5);
    riverAt(c, m, tile(10, 8), 10, 8, point);
    expect(point.still).toBe(0);
  });

  it('keeps off an edge toward land at another level', () => {
    const m = straight();
    // a hill to the north of the river: its side is a bank the water may not climb
    for (let x = 0; x < 16; x++) for (let y = 0; y < 8; y++) m.terrain[tile(x, y)] = Terrain.Hill;
    const c = channelsOf(m, 10);
    const near = riverWater(c, m, tile(7, 8), 7, 7.72);
    const far = riverWater(c, m, tile(7, 8), 7, 8.22);
    expect(near).toBe(0);
    expect(far).toBe(1);
  });

  it('leaves the ground beside it to its neighbours', () => {
    const m = straight();
    m.terrain[tile(7, 7)] = Terrain.Forest;
    expect(bankMaterial(m, tile(7, 8), 7, 7.6)).toBe(materialAt(m, 7, 7));
    expect(bankMaterial(m, tile(7, 8), 7, 8.4)).toBe(materialAt(m, 7, 9));
  });
});

describe('the water line bridges cut to', () => {
  it('follows the river, not its tile', () => {
    const m = straight();
    expect(paintedWater(m, 7, 8)).toBe(1);
    expect(paintedWater(m, 7, 8.5)).toBe(0);
    expect(underPaintedWater(m, 7, 8)).toBe(true);
    expect(underPaintedWater(m, 7, 8.46)).toBe(false);
  });

  it('reads a map with no river planes as before: water to the edge of its tile', () => {
    const m = straight();
    const old = { ...m, flowDir: undefined, feature: undefined, flow: undefined };
    const blend = new Array<number>(12);
    expect(paintedWater(old, 7, 8.3)).toBe(1);
    surfaceBlend(old, 7, 8.3, blend);
    expect(isRiver(old, tile(7, 8))).toBe(false);
  });
});

describe('a glacier in its tile', () => {
  function ice(): GameMap {
    const m = emptyMap(5, 16, 16, Terrain.Mountain);
    m.feature = new Uint8Array(256);
    m.flowDir = new Uint8Array(256);
    m.waterSurface = new Uint8Array(256);
    for (let y = 3; y < 8; y++) m.terrain[tile(7, y)] = Terrain.Ice;
    m.terrain[tile(7, 8)] = Terrain.Water;
    m.flowDir[tile(7, 8)] = 3;
    m.feature[tile(7, 8)] = withHeadwater(0, Headwater.Melt);
    return m;
  }

  it('is ice down its middle and moraine at its edges', () => {
    const m = ice();
    const c = channelsOf(m, 10);
    expect(iceAt(c, m, tile(7, 5), 7, 5)).toBe(1);
    expect(iceAt(c, m, tile(7, 5), 7.49, 5)).toBe(0);
    expect(materialAt(m, 7, 5)).toBe(Material.Moraine);
  });

  it('has an ice front where its melt starts, facing the way the melt runs', () => {
    const m = ice();
    const c = channelsOf(m, 10);
    const [front] = c.fronts.get(tile(7, 7))!;
    expect([front.dx, front.dy, front.near]).toEqual([0, 1, true]);
    expect(c.fronts.get(tile(7, 8))).toHaveLength(1);
  });

  it('spills rubble on the land beside it, and none far from it', () => {
    const m = ice();
    const c = channelsOf(m, 10);
    expect(c.iced[tile(6, 5)]).toBe(1);
    expect(moraineAt(m, tile(6, 5), 6.45, 5)).toBe(1);
    expect(moraineAt(m, tile(6, 5), 5.6, 5)).toBe(0);
  });
});

describe('the falls of a world', () => {
  it('reach both tiles of each waterfall and lie along the river', () => {
    const m = generateMap(19, { w: 160, h: 160 });
    const c = channelsOf(m, 13.9);
    let falls = 0;
    for (let i = 0; i < m.w * m.h; i++) {
      if (!(m.feature![i] & 7)) continue;
      falls++;
      const list = c.falls.get(i)!;
      expect(list.length).toBeGreaterThan(0);
      const side = m.flowDir![i] - 1;
      const f = list.find((q) => Math.hypot(q.mx - (i % m.w), q.my - Math.floor(i / m.w)) === 0.5)!;
      expect([f.dx, f.dy]).toEqual(
        [
          [0, -1],
          [1, 0],
          [0, 1],
          [-1, 0],
        ][side],
      );
      expect(f.zHi).toBeGreaterThan(f.zLo);
    }
    expect(falls).toBeGreaterThan(0);
  });
});
