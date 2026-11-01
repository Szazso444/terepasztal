import { describe, expect, it } from 'vitest';
import { Container } from 'pixi.js';
import { cornerLevel, drawEdgeStrip, stripBlocks, stripFade } from './edgeStripView';
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
    const strip = stripOf(4, 4, (x) => ({ level: x >= 6 ? 8 : 0 }));
    expect(cornerLevel(strip, 5, -3)).toBe(0);
    expect(cornerLevel(strip, 6, -3)).toBe(4);
    expect(cornerLevel(strip, 7, -3)).toBe(8);
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

  it('draws the top of a wall, which no tile lies before', () => {
    const lines = tile(stripOf(4, 4), -1, 2).lines;
    expect(lines).toHaveLength(12);
  });
});

describe('drawing the strip', () => {
  it('puts each block in its layer and tells its region', () => {
    const back = new Container();
    const front = new Container();
    const shapes = drawEdgeStrip(stripOf(8, 8), quarters, back, front);
    expect(back.children.length).toBeGreaterThan(0);
    expect(front.children.length).toBeGreaterThan(0);
    expect(back.children.length + front.children.length).toBe(shapes.length);
    expect(new Set(shapes.map((s) => s.region))).toEqual(new Set([0, 1, 2, 3]));
  });
});
