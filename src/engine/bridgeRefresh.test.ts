import { describe, expect, it } from 'vitest';
import { bridgeTilesTouched } from './bridgeRefresh';

const at =
  (...cells: [number, number][]) =>
  (x: number, y: number) =>
    cells.some(([cx, cy]) => cx === x && cy === y);

describe('bridgeTilesTouched', () => {
  it('is true for a platform under the change and for one beside it on either axis', () => {
    for (const [dx, dy] of [
      [0, 0],
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ])
      expect(bridgeTilesTouched(at([5 + dx, 7 + dy]), 5, 7)).toBe(true);
  });

  it('is false for a change with no platform on it or beside it', () => {
    expect(bridgeTilesTouched(at(), 5, 7)).toBe(false);
    // diagonals and two tiles away are not neighbours along an axis
    expect(bridgeTilesTouched(at([6, 8], [4, 6], [7, 7], [5, 9]), 5, 7)).toBe(false);
  });
});
