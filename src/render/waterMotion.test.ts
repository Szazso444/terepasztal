import { describe, expect, it } from 'vitest';
import { Dir } from '../engine/iso';
import { emptyMap } from '../world/mapgen';
import { Terrain, type GameMap } from '../world/tiles';
import { WaterMotion, channelPoint, inflow, slowness, travelTimes } from './waterMotion';

/** A river along row 3, flowing east, with a thinner one joining it from the north at column 4. */
function river(): GameMap {
  const m = emptyMap(1, 8, 8);
  m.flowDir = new Uint8Array(64);
  m.flow = new Uint16Array(64);
  for (let x = 1; x < 7; x++) {
    m.terrain[3 * 8 + x] = Terrain.Water;
    m.flowDir[3 * 8 + x] = 2;
    m.flow[3 * 8 + x] = 100;
  }
  m.terrain[2 * 8 + 4] = Terrain.Water;
  m.flowDir[2 * 8 + 4] = 3;
  m.flow[2 * 8 + 4] = 30;
  return m;
}

describe('the waves on a shore', () => {
  /** The sea to the west of column 12, land to the east of it. */
  function coast(): GameMap {
    const m = emptyMap(1, 24, 24);
    for (let y = 0; y < 24; y++) for (let x = 0; x < 12; x++) m.terrain[y * 24 + x] = Terrain.Water;
    return m;
  }
  const motionOn = (m: GameMap, tile: { x: number; y: number }) => {
    const motion = new WaterMotion(
      m,
      () => 0,
      () => true,
    ) as unknown as {
      shore: { n: number; x: Float32Array; energy: Float32Array };
      update: WaterMotion['update'];
    };
    const rows = () => ({ y0: 0, y1: 23, x0: () => 0, x1: () => 23 });
    motion.update(1, 3, { x: -600, y: 0, w: 1200, h: 800 }, rows, 1, { strength: 0.7, tile });
    return motion.shore;
  };

  it('finds the waterline along the shore', () => {
    const s = motionOn(coast(), { x: 1, y: 0 });
    expect(s.n).toBeGreaterThan(0);
    for (const x of s.x) {
      expect(x).toBeGreaterThan(11);
      expect(x).toBeLessThan(12);
    }
  });

  it('reach a shore the wind blows toward, over open water, and no other', () => {
    expect(Math.max(...motionOn(coast(), { x: 1, y: 0 }).energy)).toBeGreaterThan(0.5);
    expect(Math.max(...motionOn(coast(), { x: -1, y: 0 }).energy)).toBe(0);
  });
});

describe('swells in the shallows', () => {
  it('slow as the water shallows', () => {
    expect(slowness(6)).toBeLessThan(1.02);
    expect(slowness(1)).toBeGreaterThan(slowness(3));
  });

  it('run as a plain train over deep water', () => {
    const w = 24;
    const t = travelTimes(new Uint8Array(w * w).fill(6), w, w, 1, 0);
    expect(t[5 * w + 7]).toBeCloseTo(7, 5);
    expect(t[9 * w + 7]).toBeCloseTo(7, 5);
  });

  it('fall behind in the shallows beside a shore, so their fronts bend', () => {
    const w = 40;
    const depth = new Uint8Array(w * w).fill(6);
    // a shore along the north of the map, shallowing over five tiles
    for (let y = 0; y < 5; y++) for (let x = 0; x < w; x++) depth[y * w + x] = y;
    const t = travelTimes(depth, w, w, 1, 0);
    // at one x the swell reaches the shallows later than the deep water beside them
    expect(t[1 * w + 20]).toBeGreaterThan(t[20 * w + 20]);
    for (const v of t) expect(Number.isFinite(v)).toBe(true);
  });
});

describe('a river in motion', () => {
  it('comes into a tile from its fullest inflow', () => {
    const m = river();
    expect(inflow(m, 4, 3)).toBe(Dir.E);
    expect(inflow(m, 1, 3)).toBe(-1);
    m.flow![2 * 8 + 4] = 400;
    expect(inflow(m, 4, 3)).toBe(Dir.S);
  });

  it('runs from the edge it enters by to the edge it leaves by, through the middle', () => {
    const p = [0, 0];
    channelPoint(Dir.E, Dir.E, 0, p);
    expect(p.map((v) => v + 0)).toEqual([-0.5, 0]);
    channelPoint(Dir.E, Dir.E, 1, p);
    expect(p.map((v) => v + 0)).toEqual([0.5, 0]);
    // a bend: in heading south, out heading east
    channelPoint(Dir.S, Dir.E, 0, p);
    expect(p.map((v) => v + 0)).toEqual([0, -0.5]);
    channelPoint(Dir.S, Dir.E, 0.5, p);
    expect(p).toEqual([0.125, -0.125]);
    channelPoint(Dir.S, Dir.E, 1, p);
    expect(p.map((v) => v + 0)).toEqual([0.5, 0]);
  });

  it('draws in view and hides when the water stands still', () => {
    const m = river();
    const motion = new WaterMotion(
      m,
      () => 0,
      () => true,
    );
    const rows = () => ({ y0: 0, y1: 7, x0: () => 0, x1: () => 7 });
    motion.update(1, 3, { x: -300, y: -100, w: 800, h: 500 }, rows, 1);
    expect(motion.root.visible).toBe(true);
    motion.update(1, 3, null, rows, 1);
    expect(motion.root.visible).toBe(false);
  });
});
