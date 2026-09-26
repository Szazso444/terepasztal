import { describe, it, expect } from 'vitest';
import { smoothPixelArt } from './pixel-art.mjs';

const W = 32,
  H = 32,
  A = [60, 120, 40, 255],
  B = [200, 180, 90, 255];
function image(paint) {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) d.set(paint(x, y), (y * W + x) * 4);
  return d;
}
const at = (d, x, y) => [...d.slice((y * W + x) * 4, (y * W + x) * 4 + 4)];

describe('pixel-art smoothing', () => {
  it('never mixes two colour regions, so edges stay hard', () => {
    // A diagonal of 4-pixel stair steps, as the illustrated sources are drawn.
    const d = image((x, y) => (Math.floor(x / 4) > Math.floor(y / 4) ? A : B));
    const out = smoothPixelArt(d, W, H, 3);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) expect([A, B]).toContainEqual(at(out, x, y));
  });
  it('rounds stair steps: the edge moves off the pixel grid it was drawn on', () => {
    const d = image((x, y) => (Math.floor(x / 4) > Math.floor(y / 4) ? A : B));
    const out = smoothPixelArt(d, W, H, 3);
    let changed = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] !== out[i]) changed++;
    expect(changed).toBeGreaterThan(0);
  });
  it('removes a lone pixel and leaves flat regions and transparency alone', () => {
    const d = image((x, y) => (x === 10 && y === 10 ? B : x < 24 ? A : [0, 0, 0, 0]));
    const out = smoothPixelArt(d, W, H, 2);
    expect(at(out, 10, 10)).toEqual(A);
    expect(at(out, 4, 20)).toEqual(A);
    expect(at(out, 30, 20)).toEqual([0, 0, 0, 0]);
  });
});
