import { describe, expect, it } from 'vitest';
import { ZOOM_STEPS } from '../engine/camera';
import { TIE_BREAK, wholePixel } from './pixelGrid';

/** The pixel ratios the renderer meets (it takes at most 2): the usual display scalings. */
const RATIOS = [1, 1.25, 1.5, 1.75, 2];
const frac = (v: number) => v - Math.floor(v);

/**
 * How near to a rounding tie (half way between two device pixels) the nearest vertex lies, of every
 * corner on a 32nd of a pixel (the atlas frames are packed four times their size in the world, and
 * their anchors lie on half texels) of a picture standing on any whole world pixel, when the world
 * root's position is `place(n)` for each whole pixel n the camera may stand on, at every zoom step
 * and display scaling. 0 is a vertex on a tie.
 */
function nearestTie(place: (n: number) => number) {
  let nearest = 0.5;
  for (const zoom of ZOOM_STEPS)
    for (const ratio of RATIOS)
      for (let n = 0; n < 16; n++)
        for (let at = 0; at < 16; at++)
          for (let corner = 0; corner < 64; corner++) {
            const device = (place(n) + (at + corner / 32) * zoom) * ratio;
            nearest = Math.min(nearest, Math.abs(frac(device) - 0.5));
          }
  return nearest;
}

describe('the world root on the pixel grid', () => {
  it('keeps every vertex of the pictures off a rounding tie', () => {
    // the problem: on whole pixels, vertices of small pictures lie exactly on a tie, and which way
    // one rounds changes with the frame's rounding error (a flicker while the camera moves)
    expect(nearestTie((n) => n)).toBe(0);
    // a binary fraction is no cure: a corner 1/32 short of a tie is put on it
    expect(nearestTie((n) => n + 1 / 32)).toBe(0);
    // the fix: every vertex stays clear of a tie by several times a frame's rounding error
    expect(nearestTie((n) => wholePixel(n))).toBeGreaterThan(0.0004);
  });

  it('is a whole pixel and a hair, so it moves nothing the eye can see', () => {
    for (const v of [-3.4, -0.5, 0, 0.49, 640, 641.5, 1279.7]) {
      const placed = wholePixel(v);
      expect(placed - Math.round(v)).toBeCloseTo(TIE_BREAK, 9);
      expect(Math.abs(placed - v)).toBeLessThanOrEqual(0.5 + TIE_BREAK);
    }
    expect(TIE_BREAK).toBeGreaterThan(0);
    expect(TIE_BREAK).toBeLessThan(0.05);
  });
});
