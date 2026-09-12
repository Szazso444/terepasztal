import { describe, it, expect } from 'vitest';
import {
  TILE_W,
  TILE_H,
  HALF_W,
  HALF_H,
  tileToWorld,
  worldToTile,
  worldToTileInt,
  mapWorldBounds,
  depthKey,
  Dir,
  DIRS,
  DIR_DX,
  DIR_DY,
  opposite,
  rotateDir,
  angleToFacing8,
} from './iso';

describe('projection', () => {
  it('is 2:1 on a 64 x 32 tile', () => {
    expect(TILE_W).toBe(2 * TILE_H);
    // One step along +tx moves half a tile right and a quarter tile down: the ratio every
    // external sprite source (Blender included) has to match.
    expect(tileToWorld(1, 0)).toEqual({ x: HALF_W, y: HALF_H });
    expect(tileToWorld(0, 1)).toEqual({ x: -HALF_W, y: HALF_H });
  });

  it('round-trips tile and world space', () => {
    for (const [tx, ty] of [
      [0, 0],
      [3, 7],
      [-4, 12],
      [2.5, -1.25],
    ]) {
      const w = tileToWorld(tx, ty);
      const t = worldToTile(w.x, w.y);
      expect(t.x).toBeCloseTo(tx, 10);
      expect(t.y).toBeCloseTo(ty, 10);
    }
  });

  it('snaps a world point to the tile it sits in', () => {
    const w = tileToWorld(5, 9);
    expect(worldToTileInt(w.x, w.y)).toEqual({ x: 5, y: 9 });
    // Anywhere inside the diamond still lands on the same tile.
    expect(worldToTileInt(w.x + HALF_W - 1, w.y)).toEqual({ x: 5, y: 9 });
    expect(worldToTileInt(w.x, w.y + HALF_H - 1)).toEqual({ x: 5, y: 9 });
  });

  it('bounds a map around every tile it contains', () => {
    const b = mapWorldBounds(8, 8);
    for (const [tx, ty] of [
      [0, 0],
      [7, 0],
      [0, 7],
      [7, 7],
    ]) {
      const w = tileToWorld(tx, ty);
      expect(w.x).toBeGreaterThanOrEqual(b.minX);
      expect(w.x).toBeLessThanOrEqual(b.maxX);
      expect(w.y).toBeGreaterThanOrEqual(b.minY);
      expect(w.y).toBeLessThanOrEqual(b.maxY);
    }
  });

  it('orders depth back to front, layer breaking ties', () => {
    expect(depthKey(0, 0)).toBeLessThan(depthKey(1, 0));
    expect(depthKey(1, 0)).toBe(depthKey(0, 1));
    expect(depthKey(2, 2, 0)).toBeLessThan(depthKey(2, 2, 1));
    // A layer must never reach into the next tile row.
    expect(depthKey(2, 2, 99)).toBeLessThan(depthKey(3, 2, 0));
  });
});

describe('directions', () => {
  it('steps N, E, S, W the way the tile grid is laid out', () => {
    expect(DIRS).toEqual([Dir.N, Dir.E, Dir.S, Dir.W]);
    expect([DIR_DX[Dir.N], DIR_DY[Dir.N]]).toEqual([0, -1]);
    expect([DIR_DX[Dir.E], DIR_DY[Dir.E]]).toEqual([1, 0]);
    expect([DIR_DX[Dir.S], DIR_DY[Dir.S]]).toEqual([0, 1]);
    expect([DIR_DX[Dir.W], DIR_DY[Dir.W]]).toEqual([-1, 0]);
  });

  it('opposes and rotates', () => {
    for (const d of DIRS) {
      expect(opposite(opposite(d))).toBe(d);
      expect(DIR_DX[d] + DIR_DX[opposite(d)]).toBe(0);
      expect(DIR_DY[d] + DIR_DY[opposite(d)]).toBe(0);
      expect(rotateDir(d, 4)).toBe(d);
      expect(rotateDir(d, -4)).toBe(d);
      expect(rotateDir(d, 2)).toBe(opposite(d));
    }
  });
});

describe('angleToFacing8', () => {
  it('puts facing 0 on +x and wraps', () => {
    expect(angleToFacing8(0)).toBe(0);
    expect(angleToFacing8(Math.PI / 2)).toBe(2);
    expect(angleToFacing8(Math.PI)).toBe(4);
    expect(angleToFacing8(-Math.PI / 2)).toBe(6);
    expect(angleToFacing8(Math.PI * 2)).toBe(0);
    expect(angleToFacing8(-Math.PI * 4)).toBe(0);
  });
});
