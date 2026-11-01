import { describe, expect, it } from 'vitest';
import { Terrain, type GameMap } from '../world/tiles';
import { depthAt, mistDepths, mistDrift } from './valleyMist';

const W = 16;
const at = (x: number, y: number) => y * W + x;

function map(paint: (x: number, y: number) => number): GameMap {
  const terrain = new Uint8Array(W * W);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) terrain[at(x, y)] = paint(x, y);
  return { w: W, h: W, terrain } as unknown as GameMap;
}
const flat = () => new Uint8Array(W * W);

describe('how deep mist lies', () => {
  it('lies deepest on the water and thins away from it', () => {
    const m = map((x) => (x < 5 ? Terrain.Water : Terrain.Grass)),
      d = mistDepths(m, flat());
    expect(d[at(2, 8)]).toBeCloseTo(0.8, 6);
    expect(d[at(5, 8)]).toBeGreaterThan(d[at(7, 8)]);
    expect(d[at(7, 8)]).toBeGreaterThan(d[at(12, 8)]);
    expect(d[at(12, 8)]).toBe(0);
  });

  it('gathers in a valley: low ground among high', () => {
    const levels = flat().fill(2);
    levels[at(8, 8)] = 0;
    const d = mistDepths(
      map(() => Terrain.Grass),
      levels,
    );
    expect(d[at(8, 8)]).toBeGreaterThan(0.5);
    expect(d[at(2, 2)]).toBe(0);
  });

  it('leaves the heights clear, however near the water', () => {
    const levels = flat().fill(4);
    const d = mistDepths(
      map(() => Terrain.Water),
      levels,
    );
    for (const v of d) expect(v).toBe(0);
  });

  it('stays in 0..1', () => {
    const d = mistDepths(
      map((x, y) => ((x + y) % 3 ? Terrain.Grass : Terrain.Water)),
      flat(),
    );
    for (const v of d) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('reading the depth at a point', () => {
  const depth = new Float32Array(W * W);
  depth[at(4, 4)] = 1;

  it('is the tile at its centre, between the two half way, and nothing off the map', () => {
    expect(depthAt(depth, W, W, 4, 4)).toBeCloseTo(1, 6);
    expect(depthAt(depth, W, W, 4.5, 4)).toBeCloseTo(0.5, 6);
    expect(depthAt(depth, W, W, 5, 5)).toBeCloseTo(0, 6);
    expect(depthAt(depth, W, W, -1, 4)).toBe(0);
    expect(depthAt(depth, W, W, 4, W)).toBe(0);
  });
});

it('drifts slowly, faster in a harder wind', () => {
  expect(mistDrift(0)).toBe(3);
  expect(mistDrift(1)).toBe(12);
});
