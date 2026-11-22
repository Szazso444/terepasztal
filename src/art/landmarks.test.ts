import { describe, expect, it } from 'vitest';
import { LANDMARK_FOOTPRINTS, landmarkPlaceholder } from './landmarks';

const IDS = Object.keys(LANDMARK_FOOTPRINTS);

describe('landmark placeholders', () => {
  it('covers the twelve landmarks', () => {
    expect(IDS).toHaveLength(12);
  });

  it.each(IDS)('%s stands on its footprint, anchored at the centre', (id) => {
    const [W, D] = LANDMARK_FOOTPRINTS[id];
    const { buf, ax, ay } = landmarkPlaceholder(id);
    const near = { x: ax + (W - D) * 16, y: ay + (W + D) * 8 };
    const left = { x: ax - (W + D) * 16, y: ay + (D - W) * 8 };
    const right = { x: ax + (W + D) * 16, y: ay + (W - D) * 8 };
    // ink just inside the diamond's corners, none beyond them
    expect(buf.alpha(near.x, near.y - 2)).toBe(255);
    expect(buf.alpha(left.x + 3, left.y)).toBe(255);
    expect(buf.alpha(right.x - 3, right.y)).toBe(255);
    expect(buf.alpha(near.x, near.y + 2)).toBe(0);
    expect(buf.alpha(left.x - 2, left.y)).toBe(0);
    expect(buf.alpha(right.x + 2, right.y)).toBe(0);
  });

  it('draws the same every time', () => {
    for (const id of IDS)
      expect(landmarkPlaceholder(id).buf.data).toEqual(landmarkPlaceholder(id).buf.data);
  });

  it('refuses an unknown landmark', () => {
    expect(() => landmarkPlaceholder('no_such_landmark')).toThrow('no_such_landmark');
  });
});
