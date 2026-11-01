import { describe, it, expect } from 'vitest';
import { pitchShear, pitchTilt } from './slope';

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

describe('pitchTilt', () => {
  const UP = (32 * Math.SQRT2 * Math.sqrt(3)) / 2;
  /** Screen picture of a world vector: tiles along x and y, tile sides up. */
  const picture = (x: number, y: number, z: number) => ({
    x: 32 * (x - y),
    y: 16 * (x + y) - UP * z,
  });
  const apply = (
    m: { a: number; b: number; c: number; d: number },
    p: { x: number; y: number },
  ) => ({
    x: m.a * p.x + m.c * p.y,
    y: m.b * p.x + m.d * p.y,
  });

  it('leaves a body on level rail alone', () => {
    const m = pitchTilt(0, 1, 0);
    expect([m.a, m.b, m.c, m.d].map((v) => v + 0)).toEqual([1, 0, 0, 1]);
  });

  it('turns forward and up together along a tile axis, like a real pitch', () => {
    for (const [cos, sin] of AXES)
      for (const along of [-9.8, -4, 4, 9.8]) {
        const m = pitchTilt(along, cos, sin),
          t = -along / UP;
        const fwd = apply(m, picture(cos, sin, 0)),
          up = apply(m, picture(0, 0, 1));
        // forward gains the grade in height, up leans back by the same grade
        expect(fwd.x).toBeCloseTo(picture(cos, sin, t).x, 9);
        expect(fwd.y).toBeCloseTo(picture(cos, sin, t).y, 9);
        expect(up.x).toBeCloseTo(picture(-t * cos, -t * sin, 1).x, 9);
        expect(up.y).toBeCloseTo(picture(-t * cos, -t * sin, 1).y, 9);
      }
  });

  it('keeps the centre line on the rail at every heading', () => {
    for (let deg = 0; deg < 360; deg += 7.5) {
      const cos = Math.cos((deg * Math.PI) / 180),
        sin = Math.sin((deg * Math.PI) / 180);
      for (const k of [-1.2, 0.4, 2]) {
        const p = onScreen(cos, sin, k),
          q = apply(pitchTilt(-6, cos, sin), p);
        expect(q.y - p.y).toBeCloseTo(-6 * k, 9);
      }
    }
  });
});
