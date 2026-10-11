import { describe, expect, it } from 'vitest';
import { triangleTransform } from './bridgePicture';

describe('bridge picture', () => {
  it('maps the three texture points of a triangle onto its three canvas points', () => {
    const uv = [10, 20, 138, 20, 138, 44],
      xy = [300, 96, 428, 160, 428, 200],
      m = triangleTransform(uv, xy)!;
    // setTransform(a, b, c, d, e, f): x' = a u + c v + e, y' = b u + d v + f.
    for (let i = 0; i < 3; i++) {
      const u = uv[i * 2],
        v = uv[i * 2 + 1];
      expect(m[0] * u + m[2] * v + m[4]).toBeCloseTo(xy[i * 2], 9);
      expect(m[1] * u + m[3] * v + m[5]).toBeCloseTo(xy[i * 2 + 1], 9);
    }
    // A face along a tile edge is sheared two to one: 128 texels along become 64 down.
    expect(m[1] / m[0]).toBeCloseTo(0.5, 9);
  });

  it('has no map for a triangle without area in the texture', () => {
    expect(triangleTransform([0, 0, 4, 4, 8, 8], [0, 0, 10, 0, 10, 10])).toBeNull();
  });
});
