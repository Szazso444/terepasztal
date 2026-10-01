import { describe, expect, it } from 'vitest';
import { landscapeHeights, heightAt, landscapeColor, type LandscapeMap } from './landscapeModel';
import { Terrain } from '../world/tiles';

function map(): LandscapeMap {
  return {
    w: 24,
    h: 24,
    seed: 71,
    originX: 0,
    originY: 0,
    terrain: new Uint8Array(576),
    biome: new Uint8Array(576),
  };
}
describe('continuous landscape invariants', () => {
  it('makes dense hills higher than isolated hills without changing the map', () => {
    const isolated = map();
    isolated.terrain[12 * 24 + 12] = Terrain.Hill;
    const dense = map();
    for (let y = 5; y < 20; y++)
      for (let x = 5; x < 20; x++) dense.terrain[y * 24 + x] = Terrain.Hill;
    const before = dense.terrain.slice();
    expect(landscapeHeights(dense, new Set())[300]).toBeGreaterThan(
      landscapeHeights(isolated, new Set())[300] * 2,
    );
    expect(dense.terrain).toEqual(before);
  });
  it('keeps excavation flat and bounds every slope so projected surfaces cannot fold', () => {
    const m = map();
    m.terrain.fill(Terrain.Mountain);
    const heights = landscapeHeights(m, new Set([300]));
    expect(heightAt(m, heights, 12, 12)).toBe(0);
    for (let y = 0; y < m.h; y++)
      for (let x = 0; x < m.w; x++) {
        const k = y * m.w + x;
        if (x) expect(Math.abs(heights[k] - heights[k - 1])).toBeLessThanOrEqual(9.001);
        if (y) expect(Math.abs(heights[k] - heights[k - m.w])).toBeLessThanOrEqual(9.001);
      }
  });
  it('anchors texture to world coordinates across map expansion and avoids tile repetition', () => {
    const m = map(),
      expanded = { ...map(), originX: -5, originY: -7 };
    const before = landscapeColor(m, 8.25, 9.1),
      after = landscapeColor(expanded, 13.25, 16.1);
    before.forEach((channel, i) => expect(channel).toBeCloseTo(after[i], 10));
    const samples = Array.from({ length: 12 }, (_, x) =>
      landscapeColor(m, x + 0.25, 7.2)
        .map(Math.round)
        .join(','),
    );
    expect(new Set(samples).size).toBeGreaterThan(8);
  });
});
