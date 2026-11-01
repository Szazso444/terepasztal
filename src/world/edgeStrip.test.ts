import { describe, expect, it } from 'vitest';
import { buildMap, encodeMap, type MapGenerator } from './chunks';
import {
  EDGE_STRIP_TILES,
  edgeStripOf,
  edgeStripRequest,
  edgeTile,
  inEdgeStrip,
  type EdgeStrip,
} from './edgeStrip';
import { NO_LEVEL, tileLevels } from './elevation';
import { DEFAULT_MAP_PARAMS, emptyMap, generateMap, type MapGenParams } from './mapgen';
import { Terrain, type GameMap } from './tiles';
import { expandSave } from '../sim/expand';
import type { SaveGame, WorldSpec } from '../sim/save';

const W = EDGE_STRIP_TILES;
const SIZE = 64;
const params: MapGenParams = { ...DEFAULT_MAP_PARAMS, w: SIZE, h: SIZE, originX: 0, originY: 0 };

const world = (chunks: Record<string, string>, p = params): WorldSpec => ({
  kind: 'generated',
  seed: 4242,
  params: p,
  chunks,
});

/** Every tile of the strip of a map of `w` x `h`, as map tiles. */
function stripTiles(w: number, h: number) {
  const out: { x: number; y: number }[] = [];
  for (let y = -W - 2; y < h + W + 2; y++)
    for (let x = -W - 2; x < w + W + 2; x++) if (inEdgeStrip(x, y, w, h)) out.push({ x, y });
  return out;
}

/**
 * A stand-in generator: a mountain at level 12 east of world tile 60, in the plane the way a real
 * mountain is, and a lake north of world tile 0.
 */
const ridge: MapGenerator = (seed, p) => {
  const map = emptyMap(seed, p.w!, p.h!, Terrain.Grass, p.originX, p.originY);
  map.generatedLevel = new Uint8Array(map.w * map.h).fill(NO_LEVEL);
  map.waterSurface = new Uint8Array(map.w * map.h);
  for (let y = 0; y < map.h; y++)
    for (let x = 0; x < map.w; x++) {
      const i = y * map.w + x;
      if (x + map.originX >= 60) {
        map.terrain[i] = Terrain.Mountain;
        map.generatedLevel[i] = 12;
      } else map.generatedLevel[i] = 0;
      if (y + map.originY < 0) {
        map.terrain[i] = Terrain.Water;
        map.waterSurface[i] = 2;
        map.generatedLevel[i] = 2;
      }
    }
  return map;
};

/** The grown map's tile under strip tile (x, y) of a map at the origin `d` tiles in. */
const grownAt = (grown: GameMap, levels: Uint8Array, d: number, x: number, y: number) => {
  const i = (y + d) * grown.w + x + d;
  return { terrain: grown.terrain[i], level: levels[i] };
};

const stripOf = (spec: WorldSpec, generate: MapGenerator): EdgeStrip => {
  const req = edgeStripRequest(spec);
  if (!req) throw new Error('no strip');
  return edgeStripOf(req, generate);
};

describe('the tiles of the edge strip', () => {
  it('runs twelve tiles past all four edges and takes in the corners', () => {
    expect(EDGE_STRIP_TILES).toBe(12);
    for (const [x, y] of [
      [-1, 5],
      [-12, 5],
      [5, -1],
      [5, -12],
      [10, 5],
      [21, 5],
      [5, 10],
      [5, 21],
      [-12, -12],
      [21, 21],
      [-12, 21],
    ])
      expect(inEdgeStrip(x, y, 10, 10), `${x},${y}`).toBe(true);
  });

  it('holds no map tile and nothing further out', () => {
    for (const [x, y] of [
      [0, 0],
      [9, 9],
      [5, 5],
      [-13, 5],
      [22, 5],
      [5, -13],
      [5, 22],
    ])
      expect(inEdgeStrip(x, y, 10, 10), `${x},${y}`).toBe(false);
  });

  it('counts every tile once, the ring around a map', () => {
    expect(stripTiles(10, 8)).toHaveLength((10 + 2 * W) * (8 + 2 * W) - 10 * 8);
  });
});

describe('what the edge strip shows', () => {
  it('is what the map holds when it grows, seam and all', () => {
    const generate: MapGenerator = (s, p) => generateMap(s, p, 'simple');
    const base = buildMap(4242, params, {}, generate);
    const spec = world(base.chunks);
    const strip = stripOf(spec, generate);
    // growing as the game does: expandSave's frame, then the build of its next load
    const save = { world: spec, track: [], stations: [], trains: [], camera: { x: 0, y: 0 } };
    const after = expandSave(save as unknown as SaveGame, 1).world;
    if (after?.kind !== 'generated') throw new Error('not grown');
    const grown = buildMap(4242, after.params, base.chunks, generate).map;
    const levels = tileLevels(grown);
    const d = -grown.originX;
    let water = 0;
    for (const { x, y } of stripTiles(SIZE, SIZE)) {
      const t = edgeTile(strip, x, y);
      const want = grownAt(grown, levels, d, x, y);
      if (t.terrain !== want.terrain || t.level !== want.level)
        expect([x, y, t]).toEqual([x, y, want]);
      if (t.terrain === Terrain.Water) water++;
    }
    expect(water).toBeGreaterThan(0);
  });

  it('holds the same for a store a later generator grows on, fitted at the seam', () => {
    // the map's chunks came from one generator and the ring comes from another
    const base = buildMap(4242, params, {}, (s, p) => generateMap(s + 1, p, 'simple'));
    const generate: MapGenerator = (s, p) => generateMap(s, p, 'simple');
    const spec = world(base.chunks);
    const strip = stripOf(spec, generate);
    const req = edgeStripRequest(spec)!;
    const grown = buildMap(4242, req.grown, base.chunks, generate).map;
    const levels = tileLevels(grown);
    for (const { x, y } of stripTiles(SIZE, SIZE)) {
      const t = edgeTile(strip, x, y);
      const want = grownAt(grown, levels, -grown.originX, x, y);
      if (t.terrain !== want.terrain || t.level !== want.level)
        expect([x, y, t]).toEqual([x, y, want]);
    }
  });

  it('leaves the store as it was', () => {
    const base = buildMap(4242, params, {}, ridge);
    const spec = world(base.chunks);
    const keys = Object.keys(base.chunks);
    stripOf(spec, ridge);
    expect(spec.kind === 'generated' && Object.keys(spec.chunks ?? {})).toEqual(keys);
  });

  it('keeps a stored chunk past the map, which the growth will read', () => {
    const base = buildMap(4242, params, {}, ridge);
    // a chunk east of the map that is already stored: flat ground, not the ridge
    const east = buildMap(4242, { ...params, originX: 64, w: 32, h: 32, originY: 0 }, {}, (s, p) =>
      emptyMap(s, p.w!, p.h!, Terrain.Sand, p.originX, p.originY),
    );
    const chunks = { ...base.chunks, ...encodeMap(east.map) };
    const strip = stripOf(world(chunks), ridge);
    expect(edgeTile(strip, 64, 5).terrain).toBe(Terrain.Sand);
    expect(edgeTile(strip, 64, 40).terrain).toBe(Terrain.Mountain);
  });

  it('reads true at the seam, where the map itself is held down by its border', () => {
    const base = buildMap(4242, params, {}, ridge);
    const shown = tileLevels(base.map);
    const strip = stripOf(world(base.chunks), ridge);
    // the map's last column stands at the border's level and each column in rises by a step
    expect(shown[20 * SIZE + SIZE - 1]).toBeLessThanOrEqual(1);
    expect(shown[20 * SIZE + SIZE - 2]).toBeLessThanOrEqual(5);
    // the strip beside it, and the tile of the map's last column as the grown map will read it
    expect(edgeTile(strip, SIZE, 20).level).toBe(12);
    expect(edgeTile(strip, SIZE - 1, 20).level).toBe(12);
    expect(edgeTile(strip, SIZE + W - 1, 20).level).toBe(12);
  });

  it('has water at the level of its surface', () => {
    const base = buildMap(4242, params, {}, ridge);
    const strip = stripOf(world(base.chunks), ridge);
    expect(edgeTile(strip, 20, -5)).toEqual({ terrain: Terrain.Water, level: 2 });
    expect(edgeTile(strip, 20, SIZE + 3)).toEqual({ terrain: Terrain.Grass, level: 0 });
  });
});

describe('which worlds have an edge strip', () => {
  it('is none for a hand-made level', () => {
    const level = { kind: 'level', seed: 1, level: {} } as unknown as WorldSpec;
    expect(edgeStripRequest(level)).toBeNull();
  });

  it('is none for a world at its bound, which has no more ring to show', () => {
    // 32 x 32 chunks is MAX_WORLD_CHUNKS: no ring can be added
    const big = { ...params, w: 32 * 32, h: 32 * 32 };
    expect(edgeStripRequest(world({}, big))).toBeNull();
  });

  it('asks for the frame of the next ring, in the chain the save names', () => {
    const req = edgeStripRequest(world({}), 'full')!;
    expect(req.chain).toBe('full');
    expect(req.grown).toMatchObject({ w: 128, h: 128, originX: -32, originY: -32 });
    expect(edgeStripRequest(world({}))!.chain).toBe('simple');
  });
});
