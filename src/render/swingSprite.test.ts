import { describe, expect, it } from 'vitest';
import { Texture } from 'pixi.js';
import { SwingSprite } from './swingSprite';
import type { FrameInfo } from '../engine/atlas';

describe('intact vehicle images', () => {
  it('covers the frame once and mirrors around its fractional ground anchor', () => {
    const frame = {
      texture: Texture.EMPTY,
      w: 37.5,
      h: 21.25,
      anchorX: 0.3,
      anchorY: 0.8,
    } as FrameInfo;
    const sprite = new SwingSprite();
    for (const flip of [false, true]) {
      sprite.show(frame, flip);
      const p = sprite.geometry.positions;
      const uv = sprite.geometry.uvs;
      const indices = sprite.geometry.indices;
      let area = 0;
      for (let i = 0; i < indices.length; i += 3) {
        const [a, b, c] = Array.from(indices.slice(i, i + 3), (n) => n * 2);
        area +=
          Math.abs((p[b] - p[a]) * (p[c + 1] - p[a + 1]) - (p[c] - p[a]) * (p[b + 1] - p[a + 1])) /
          2;
      }
      expect(area).toBeCloseTo(frame.w * frame.h);
      // The source ground anchor must always land at local (0, 0), even mirrored.
      const u = flip ? 1 - frame.anchorX : frame.anchorX;
      expect(p[0] + u * frame.w).toBeCloseTo(0);
      expect(p[1] + frame.anchorY * frame.h).toBeCloseTo(0);
      expect(Math.abs(uv[2] - uv[0])).toBe(1);
      expect(Math.abs(uv[5] - uv[1])).toBe(1);
    }
    sprite.destroy();
  });
});
