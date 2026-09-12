import { describe, it, expect } from 'vitest';
import {
  FACINGS,
  DRAWN_FACINGS,
  facingOf,
  facingAngle,
  mirrorFacing,
  screenAngle,
  residualRotation,
  ROTATION_SHARE,
  vehicleSpec,
  vehicleFronts,
  consistLength,
  COUPLER_GAP,
  SIZE_LEN,
  Polyline,
} from './body';

const ALL = Array.from({ length: FACINGS }, (_, f) => f);
/** Measured worst-case sprite lean: the 7.5 degree facing step projects to at most 7.469 degrees
 *  of screen angle, and ROTATION_SHARE applies half of it. */
const WORST_LEAN = (4 * Math.PI) / 180;

describe('facings', () => {
  it('round-trips a facing through its angle', () => {
    for (const f of ALL) expect(facingOf(facingAngle(f))).toBe(f);
  });

  it('wraps any heading into range', () => {
    for (const a of [-7, -Math.PI, 0, 0.001, Math.PI * 2, 100]) {
      const f = facingOf(a);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(FACINGS);
    }
    expect(facingOf(Math.PI * 2)).toBe(0);
    expect(facingOf(-facingAngle(1))).toBe(FACINGS - 1);
  });

  it('mirrors as an involution', () => {
    for (const f of ALL) expect(mirrorFacing(mirrorFacing(f))).toBe(f);
  });

  it('draws one facing of every mirror pair', () => {
    // The renderer flips a drawn sprite to cover the other half; if this breaks, half the
    // rolling stock has no frame to draw.
    for (const f of ALL)
      expect(DRAWN_FACINGS.has(f) || DRAWN_FACINGS.has(mirrorFacing(f))).toBe(true);
    // 48 facings, two of them their own mirror (f = 6 and f = 30), so 23 pairs plus 2.
    expect(DRAWN_FACINGS.size).toBe(25);
    expect([...DRAWN_FACINGS].filter((f) => mirrorFacing(f) === f)).toEqual([6, 30]);
  });
});

describe('screenAngle', () => {
  it('flattens a tile heading onto the 2:1 projection', () => {
    // +tx goes down-right at 2:1, so the screen angle is atan(0.5).
    expect(screenAngle(0)).toBeCloseTo(Math.atan2(0.5, 1), 12);
    // +ty goes down-left, the mirror of it.
    expect(screenAngle(Math.PI / 2)).toBeCloseTo(Math.PI - Math.atan2(0.5, 1), 12);
    // The mirror pair maps to mirrored screen angles.
    for (const f of ALL) {
      const a = screenAngle(facingAngle(f));
      const b = screenAngle(facingAngle(mirrorFacing(f)));
      expect(Math.cos(a)).toBeCloseTo(-Math.cos(b), 10);
      expect(Math.sin(a)).toBeCloseTo(Math.sin(b), 10);
    }
  });
});

describe('residualRotation', () => {
  it('is zero on an exact facing and small between them', () => {
    for (const f of ALL) expect(residualRotation(facingAngle(f), f)).toBeCloseTo(0, 12);
    // Worst case is half a step; the sprite lean stays a few degrees once ROTATION_SHARE
    // takes its cut.
    const step = (Math.PI * 2) / FACINGS;
    let worst = 0;
    for (const f of ALL)
      for (const d of [-0.5, -0.25, 0.25, 0.5])
        worst = Math.max(worst, Math.abs(residualRotation(facingAngle(f) + d * step, f)));
    expect(worst * ROTATION_SHARE).toBeLessThan(WORST_LEAN);
  });

  it('never returns a wrapped-around angle', () => {
    for (const f of ALL) {
      const d = residualRotation(facingAngle(f) + Math.PI * 4, f);
      expect(d).toBeGreaterThan(-Math.PI);
      expect(d).toBeLessThanOrEqual(Math.PI);
    }
  });
});

describe('vehicleSpec', () => {
  it('gives every size its tile length', () => {
    expect(vehicleSpec({ size: 'small' }).L).toBe(SIZE_LEN.small);
    expect(vehicleSpec({ size: 'medium' }).L).toBe(SIZE_LEN.medium);
    expect(vehicleSpec({ size: 'large' }).L).toBe(SIZE_LEN.large);
    expect(vehicleSpec({}).size).toBe('small');
  });

  it('refuses plans a size cannot carry', () => {
    expect(vehicleSpec({ size: 'small', plan: 'garratt' }).plan).toBe('rigid');
    expect(vehicleSpec({ size: 'medium', plan: 'garratt' }).plan).toBe('rigid');
    expect(vehicleSpec({ size: 'medium', plan: 'tender' }).plan).toBe('tender');
    expect(vehicleSpec({ size: 'large', plan: 'tender' }).plan).toBe('rigid');
    expect(vehicleSpec({ size: 'large', plan: 'garratt' }).plan).toBe('garratt');
    expect(vehicleSpec({ size: 'large', plan: 'meyer' }).plan).toBe('meyer');
  });

  it('lays segments end to end inside the body length', () => {
    for (const plan of ['rigid', 'tender', 'garratt', 'meyer'] as const)
      for (const size of ['small', 'medium', 'large'] as const) {
        const spec = vehicleSpec({ size, plan });
        let front = 0;
        for (const s of spec.segments) {
          expect(s.front).toBeCloseTo(front, 10);
          expect(s.L).toBeGreaterThan(0);
          expect(s.nb).toBeGreaterThanOrEqual(2);
          front += s.L;
        }
        expect(front).toBeCloseTo(spec.L, 10);
      }
  });

  it('draws bogies on anything longer than one tile', () => {
    expect(vehicleSpec({ size: 'small' }).drawBogies).toBe(false);
    expect(vehicleSpec({ size: 'medium' }).drawBogies).toBe(true);
    expect(vehicleSpec({ size: 'large' }).drawBogies).toBe(true);
  });
});

describe('consists', () => {
  it('spaces vehicles by one coupler gap', () => {
    const fronts = vehicleFronts([1, 2, 3]);
    expect(fronts).toHaveLength(3);
    expect(fronts[0]).toBe(0);
    expect(fronts[1]).toBeCloseTo(1 + COUPLER_GAP, 10);
    expect(fronts[2]).toBeCloseTo(3 + 2 * COUPLER_GAP, 10);
    expect(vehicleFronts([])).toEqual([]);
  });

  it('measures a consist as bodies plus the gaps between them', () => {
    expect(consistLength([])).toBe(0);
    expect(consistLength([2])).toBe(2);
    expect(consistLength([1, 2, 3])).toBeCloseTo(6 + 2 * COUPLER_GAP, 10);
  });

  it('puts the tail of the last vehicle at the consist length', () => {
    const lengths = [1, 3, 2];
    const fronts = vehicleFronts(lengths);
    const last = fronts.length - 1;
    expect(fronts[last] + lengths[last]).toBeCloseTo(consistLength(lengths), 10);
  });
});

describe('Polyline', () => {
  const straight = new Polyline([
    { x: 0, y: 0 },
    { x: 3, y: 0 },
    { x: 3, y: 4 },
  ]);

  it('measures arc length along its points', () => {
    expect(straight.length).toBe(7);
    expect(new Polyline([{ x: 1, y: 1 }]).length).toBe(0);
    expect(new Polyline([]).length).toBe(0);
  });

  it('samples by arc and clamps past either end', () => {
    expect(straight.at(0)).toEqual({ x: 0, y: 0 });
    expect(straight.at(3)).toEqual({ x: 3, y: 0 });
    expect(straight.at(5)).toEqual({ x: 3, y: 2 });
    expect(straight.at(-10)).toEqual({ x: 0, y: 0 });
    expect(straight.at(99)).toEqual({ x: 3, y: 4 });
  });

  it('returns unit tangents', () => {
    const t = straight.tangent(1);
    expect(Math.hypot(t.x, t.y)).toBeCloseTo(1, 10);
    expect(t.x).toBeCloseTo(1, 10);
    expect(t.y).toBeCloseTo(0, 10);
    const u = straight.tangent(6);
    expect(Math.hypot(u.x, u.y)).toBeCloseTo(1, 10);
    expect(u.y).toBeCloseTo(1, 10);
  });

  it('still returns a direction for a single-point path', () => {
    const dot = new Polyline([{ x: 2, y: 2 }]);
    expect(dot.at(5)).toEqual({ x: 2, y: 2 });
    expect(dot.tangent(0)).toEqual({ x: 1, y: 0 });
    expect(dot.nearest({ x: 9, y: 9 }, 0)).toEqual({ p: { x: 2, y: 2 }, arc: 0 });
  });

  it('finds the nearest point within the search window', () => {
    const n = straight.nearest({ x: 1.5, y: 2 }, 1.5);
    expect(n.arc).toBeCloseTo(1.5, 6);
    expect(n.p.x).toBeCloseTo(1.5, 6);
    expect(n.p.y).toBeCloseTo(0, 6);
    const far = straight.nearest({ x: 3, y: 3 }, 6);
    expect(far.arc).toBeCloseTo(6, 6);
  });
});
