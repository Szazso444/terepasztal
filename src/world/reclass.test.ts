import { describe, it, expect } from 'vitest';
import { stepTiles } from './reclass';

describe('a stroke across tiles', () => {
  it('visits every tile on the way, one step at a time', () => {
    for (const [a, b] of [
      [
        { x: 5, y: 5 },
        { x: 9, y: 5 },
      ],
      [
        { x: 5, y: 5 },
        { x: 8, y: 7 },
      ],
      [
        { x: 5, y: 5 },
        { x: 3, y: 11 },
      ],
      [
        { x: 5, y: 5 },
        { x: 5, y: 5 },
      ],
    ]) {
      const path = stepTiles(a, b);
      expect(path).toHaveLength(Math.abs(b.x - a.x) + Math.abs(b.y - a.y));
      let at = a;
      for (const p of path) {
        expect(Math.abs(p.x - at.x) + Math.abs(p.y - at.y)).toBe(1);
        at = p;
      }
      expect(at).toEqual(b);
    }
  });
});
