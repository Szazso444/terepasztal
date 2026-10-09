import { describe, it, expect } from 'vitest';
import { pitchShear } from './slope';

/** Screen offset of a point `t` tiles along the heading and `h` pixels above the rail. */
function onScreen(cos: number, sin: number, t: number, h = 0) {
  return { x: (cos - sin) * 32 * t, y: (cos + sin) * 16 * t - h };
}
/** How far the pitch lifts a screen point: its new y less its old. */
function lift(s: { p: number; q: number }, at: { x: number; y: number }) {
  return s.p * at.x + s.q * at.y - at.y;
}
const AXES = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

describe('pitchShear', () => {
  it('leaves a body on level rail alone', () => {
    expect(pitchShear(0, 1, 0)).toEqual({ p: 0, q: 1 });
  });

  it('keeps the height of a body climbing along a tile axis', () => {
    for (const [cos, sin] of AXES)
      for (const along of [-9, -4, 4, 9]) {
        const s = pitchShear(along, cos, sin);
        expect(s.q).toBe(1);
        // the roof 30 px over a point 1.5 tiles along the body rises with that point
        const foot = lift(s, onScreen(cos, sin, 1.5)),
          roof = lift(s, onScreen(cos, sin, 1.5, 30));
        expect(foot).toBeCloseTo(along * 1.5, 9);
        expect(roof).toBeCloseTo(foot, 9);
      }
  });

  it('keeps the centre line on the rail at every heading', () => {
    for (let deg = 0; deg < 360; deg += 7.5) {
      const cos = Math.cos((deg * Math.PI) / 180),
        sin = Math.sin((deg * Math.PI) / 180);
      for (const t of [-1.2, 0.4, 2])
        expect(lift(pitchShear(-6, cos, sin), onScreen(cos, sin, t))).toBeCloseTo(-6 * t, 9);
    }
  });

  it('lays a body heading up the screen on the slope like a footprint', () => {
    const d = Math.SQRT1_2,
      s = pitchShear(-6, d, d);
    expect(s.p).toBeCloseTo(0, 9);
    expect(s.q).toBeCloseTo(1 - (6 * Math.SQRT2) / 32, 9);
  });
});
