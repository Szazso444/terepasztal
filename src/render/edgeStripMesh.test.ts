import { describe, expect, it } from 'vitest';
import {
  blockOfTile,
  cornerLevel,
  meshBuffers,
  stripBlocks,
  stripFade,
  stripMesh,
  stripMeshes,
} from './edgeStripMesh';
import { EDGE_STRIP_TILES, frameIndex, inEdgeStrip, type EdgeStrip } from '../world/edgeStrip';
import { Terrain } from '../world/tiles';

const W = EDGE_STRIP_TILES;

/** A strip round a map of `w` x `h`, flat ground but for what `at` says of a tile. */
function stripOf(
  w: number,
  h: number,
  at: (x: number, y: number) => { terrain?: number; level?: number } = () => ({}),
): EdgeStrip {
  const n = (w + 2 * W) * (h + 2 * W);
  const strip = { w, h, terrain: new Uint8Array(n), levels: new Uint8Array(n) };
  for (let y = -W; y < h + W; y++)
    for (let x = -W; x < w + W; x++) {
      const t = at(x, y);
      strip.terrain[frameIndex(strip, x, y)] = t.terrain ?? Terrain.Grass;
      strip.levels[frameIndex(strip, x, y)] = t.level ?? 0;
    }
  return strip;
}

const oneRegion = () => 0;
/** Quarters of a map of 8 x 8: four regions, as a RegionState numbers them. */
const quarters = (x: number, y: number) => (y >> 2) * 2 + (x >> 2);

describe('the corners of the strip', () => {
  it('stands at the mean of the tiles round it', () => {
    const strip = stripOf(4, 4, (x) => ({ level: x >= 6 ? 2 : 0 }));
    expect(cornerLevel(strip, 5, -3)).toBe(0);
    expect(cornerLevel(strip, 6, -3)).toBe(1);
    expect(cornerLevel(strip, 7, -3)).toBe(2);
  });

  it('keeps a lone peak within a level of its true height', () => {
    const strip = stripOf(4, 4, (x, y) => ({ level: x === 6 && y === -3 ? 8 : 0 }));
    for (const [cx, cy] of [
      [6, -3],
      [7, -3],
      [6, -2],
      [7, -2],
    ])
      expect(cornerLevel(strip, cx, cy)).toBe(7);
    expect(cornerLevel(strip, 8, -3)).toBe(0);
  });

  it('lies at the level of water it touches, so water is flat', () => {
    const strip = stripOf(4, 4, (x) =>
      x >= 6 ? { level: 8 } : { terrain: Terrain.Water, level: 2 },
    );
    expect(cornerLevel(strip, 6, -3)).toBe(2);
  });

  it('counts only the tiles there are at the frame edge', () => {
    const strip = stripOf(4, 4, () => ({ level: 6 }));
    expect(cornerLevel(strip, -W, -W)).toBe(6);
    expect(cornerLevel(strip, 4 + W, 4 + W)).toBe(6);
  });
});

describe('the blocks of the strip', () => {
  const tiles = (strip: EdgeStrip, regionOf = oneRegion as typeof quarters) =>
    stripBlocks(strip, regionOf).flatMap((b) => b.tiles);

  it('holds every strip tile once', () => {
    const strip = stripOf(8, 6);
    const seen = new Set(tiles(strip).map((t) => `${t.x},${t.y}`));
    expect(tiles(strip)).toHaveLength((8 + 2 * W) * (6 + 2 * W) - 8 * 6);
    expect(seen.size).toBe(tiles(strip).length);
    for (const t of tiles(strip)) expect(inEdgeStrip(t.x, t.y, 8, 6)).toBe(true);
  });

  it('has what lies past a lower edge before the map, the rest behind it', () => {
    const byTile = new Map(tiles(stripOf(4, 4)).map((t) => [`${t.x},${t.y}`, t.front]));
    expect(byTile.get('-1,2')).toBe(false);
    expect(byTile.get('2,-1')).toBe(false);
    expect(byTile.get('-1,5')).toBe(false);
    expect(byTile.get('5,-1')).toBe(false);
    expect(byTile.get('4,2')).toBe(true);
    expect(byTile.get('2,4')).toBe(true);
    expect(byTile.get('4,4')).toBe(true);
  });

  it('draws from the back to the front in each layer, across its blocks too', () => {
    for (const front of [false, true]) {
      const list = tiles(stripOf(8, 8), quarters).filter((t) => t.front === front);
      for (let i = 0; i < list.length; i++)
        for (let j = i + 1; j < list.length; j++)
          if (list[i].x - list[i].y === list[j].x - list[j].y)
            expect(list[i].x + list[i].y).toBeLessThan(list[j].x + list[j].y);
    }
  });

  it('files each tile under the region it lies past, the nearest one', () => {
    const blocks = stripBlocks(stripOf(8, 8), quarters);
    const of = (x: number, y: number) =>
      blocks.find((b) => b.tiles.some((t) => t.x === x && t.y === y))!.region;
    expect(of(-1, 1)).toBe(0);
    expect(of(6, -3)).toBe(1);
    expect(of(-5, 7)).toBe(2);
    expect(of(9, 9)).toBe(3);
    expect(of(-W, -W)).toBe(0);
  });

  it('stands a wall on the sides of the back layer that face the map', () => {
    const list = tiles(stripOf(4, 4));
    const at = (x: number, y: number) => list.find((t) => t.x === x && t.y === y)!;
    expect(at(-1, 2)).toMatchObject({ wallX: true, wallY: false });
    expect(at(2, -1)).toMatchObject({ wallX: false, wallY: true });
    expect(at(-2, 2)).toMatchObject({ wallX: false, wallY: false });
    expect(at(4, 2)).toMatchObject({ wallX: false, wallY: false });
  });

  it('fades out with distance, and has nothing left past its last tile', () => {
    expect(stripFade(1)).toBe(1);
    expect(stripFade(W)).toBeGreaterThan(0);
    expect(stripFade(W)).toBeLessThan(stripFade(W - 1));
    expect(stripFade(W + 1)).toBe(0);
  });
});

describe('the block of a tile', () => {
  it('is the nearest region, and the layer the tile is drawn in', () => {
    expect(blockOfTile(-3, 6, 8, 8, quarters)).toEqual({ region: 2, front: false });
    expect(blockOfTile(6, -3, 8, 8, quarters)).toEqual({ region: 1, front: false });
    expect(blockOfTile(9, 6, 8, 8, quarters)).toEqual({ region: 3, front: true });
    expect(blockOfTile(-3, 11, 8, 8, quarters)).toEqual({ region: 2, front: false });
  });

  it('is the one stripBlocks files it under', () => {
    for (const b of stripBlocks(stripOf(8, 8), quarters))
      for (const t of b.tiles)
        expect(blockOfTile(t.x, t.y, 8, 8, quarters)).toEqual({ region: b.region, front: b.front });
  });
});

describe('the lines of the strip', () => {
  const tile = (strip: EdgeStrip, x: number, y: number) =>
    stripBlocks(strip, oneRegion)
      .flatMap((b) => b.tiles)
      .find((t) => t.x === x && t.y === y)!;

  it('shows all of a side on flat ground', () => {
    const lines = tile(stripOf(4, 4), 6, -3).lines;
    // both back sides, a tile side wide each way on screen
    expect(lines).toHaveLength(8);
    expect(Math.abs(lines[2] - lines[0])).toBe(32);
    expect(Math.abs(lines[6] - lines[4])).toBe(32);
  });

  it('hides what lies behind a ridge', () => {
    // a ridge across the strip past the upper edge; tile (5, -3) lies behind it on screen
    const strip = stripOf(4, 4, (x) => ({ level: x === 7 || x === 8 ? 16 : 0 }));
    expect(tile(stripOf(4, 4), 5, -3).lines.length).toBeGreaterThan(0);
    expect(tile(strip, 5, -3).lines).toEqual([]);
    expect(tile(strip, 8, -3).lines.length).toBeGreaterThan(0);
  });

  it('works out what is hidden block by block: a block that does not show hides nothing', () => {
    // a ridge in region 1 stands before tile (3, -6) of region 0, on one column of the screen
    const strip = stripOf(8, 8, (x) => ({ level: x === 6 || x === 7 ? 16 : 0 }));
    const of = (regionOf: typeof quarters) =>
      stripBlocks(strip, regionOf)
        .flatMap((b) => b.tiles)
        .find((t) => t.x === 3 && t.y === -6)!;
    expect(of(oneRegion).lines).toEqual([]);
    expect(of(quarters).lines).toHaveLength(8);
  });

  it('gives a block the same lines whatever stands in the blocks before it', () => {
    const tall = stripBlocks(
      stripOf(8, 8, (x) => ({ level: x === 6 || x === 7 ? 16 : 0 })),
      quarters,
    );
    const flat = stripBlocks(stripOf(8, 8), quarters);
    const region0 = (blocks: typeof tall) =>
      blocks
        .filter((b) => b.region === 0 && !b.front)
        .flatMap((b) => b.tiles.filter((t) => t.x < 4))
        .map((t) => t.lines.length);
    expect(region0(tall)).toEqual(region0(flat));
  });

  it('draws the top of a wall, which no tile lies before', () => {
    const lines = tile(stripOf(4, 4), -1, 2).lines;
    expect(lines).toHaveLength(12);
  });
});

describe('the flat form of a block', () => {
  const strip = () =>
    stripOf(8, 8, (x, y) =>
      y === -2 ? { terrain: Terrain.Water, level: 1 } : { level: (x + W) % 3 },
    );
  const blocks = () => stripBlocks(strip(), quarters);

  it('holds a shape for each tile and wall, in the order they are drawn', () => {
    for (const b of blocks()) {
      const m = stripMesh(b);
      const walls = b.tiles.reduce((n, t) => n + (t.wallX ? 1 : 0) + (t.wallY ? 1 : 0), 0);
      expect(m.colors).toHaveLength(b.tiles.length + walls);
      expect(m.quads).toHaveLength(m.colors.length * 8);
      expect([m.region, m.front]).toEqual([b.region, b.front]);
      // the last shape is the surface of the block's last tile, top corner first
      const [top, right, bottom, left] = b.tiles.at(-1)!.corners;
      expect(m.quads.subarray(-8)).toEqual(
        Float32Array.from([...top, ...right, ...bottom, ...left]),
      );
    }
  });

  it('fades its fills and tells water from ground', () => {
    const b = blocks().find((k) => !k.front && k.region === 0)!;
    const tiles = b.tiles.filter((t) => !t.wallX && !t.wallY);
    const m = stripMesh({ ...b, tiles });
    const colorOf = (past: number, water: boolean) =>
      m.colors[tiles.findIndex((t) => t.past === past && t.water === water)];
    const blue = (c: number) => c & 0xff;
    expect(blue(colorOf(2, true))).toBeGreaterThan(blue(colorOf(2, false)));
    expect(blue(colorOf(2, false))).toBeGreaterThan(blue(colorOf(W, false)));
  });

  it('holds every line of its tiles, in runs of one colour and alpha that fade outwards', () => {
    for (const b of blocks()) {
      const m = stripMesh(b);
      let from = 0,
        r = 0;
      for (const water of [false, true])
        for (let past = 1; past <= W; past++) {
          const want = b.tiles
            .filter((t) => t.water === water && t.past === past)
            .flatMap((t) => t.lines);
          if (!want.length) continue;
          const to = from + want.length;
          expect(m.runs[r]).toBe(to);
          expect(m.runs[r + 1]).toBe(water ? 0x6fb4e6 : 0xffffff);
          expect(m.runs[r + 2]).toBeCloseTo(0.5 * stripFade(past));
          expect(m.lines.subarray(from, to)).toEqual(Float32Array.from(want));
          from = to;
          r += 3;
        }
      expect(m.lines).toHaveLength(from);
      expect(m.runs).toHaveLength(r);
    }
  });

  it('crosses to another thread whole, its buffers handed over', () => {
    const meshes = stripMeshes(strip(), quarters);
    const want = meshes.map((m) => ({ ...m, quads: m.quads.slice(), lines: m.lines.slice() }));
    const buffers = meshBuffers(meshes);
    expect(buffers).toHaveLength(meshes.length * 4);
    const moved = structuredClone(meshes, { transfer: buffers });
    expect(moved.map((m) => m.region)).toEqual(want.map((m) => m.region));
    expect(moved[0].quads).toEqual(want[0].quads);
    expect(moved[0].lines).toEqual(want[0].lines);
    expect(meshes[0].quads.length).toBe(0);
  });
});
