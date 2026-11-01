import { describe, expect, it } from 'vitest';
import { Dir } from '../engine/iso';
import { emptyMap } from '../world/mapgen';
import { Terrain, type GameMap } from '../world/tiles';
import { WaterMotion, channelPoint, inflow } from './waterMotion';

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
