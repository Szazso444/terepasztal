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
  poseVehicle,
} from './body';
import { referencePath, measure } from './compat';
import { forAll } from '../testing/property';

const ALL = Array.from({ length: FACINGS }, (_, f) => f);
/** Measured worst-case sprite lean: the 7.5 degree facing step projects to at most 7.469 degrees
 *  of screen angle, and ROTATION_SHARE applies half of it. */
const WORST_LEAN = (4 * Math.PI) / 180;

describe('independent bogies', () => {
  it('keeps the full rigid frame and puts each drawn bogie on its own rail point', () => {
    const spec = vehicleSpec({ size: 'large', bogies: 3, bogieAxles: 3 });
    const path = referencePath('high_speed');
    const pose = poseVehicle(path, 6.7, spec);
    expect(pose.segments).toHaveLength(1);
    expect(pose.segments[0].L).toBe(3);
    let swivel = 0;
    for (const b of pose.segments[0].bogies) {
      expect(b.drawX).toBe(b.x);
      expect(b.drawY).toBe(b.y);
      swivel = Math.max(swivel, Math.abs(b.angle - pose.segments[0].angle));
    }
    expect(swivel).toBeGreaterThan(0.2);
    expect(pose.segments[0].bogies[1].lateral).toBeGreaterThan(0.05);
  });

  it('changes wheel count without changing pivots or curve compatibility', () => {
    for (const size of ['medium', 'large'] as const) {
      const four = vehicleSpec({ size, bogieAxles: 2 });
      const six = vehicleSpec({ size, bogieAxles: 3 });
      expect(four.segments[0].bogie).toBe('bogie');
      expect(six.segments[0].bogie).toBe('bogie3');
      expect(vehicleSpec({ size, bogieAxles: 4 }).segments[0].bogie).toBe('bogie4');
      for (const cls of ['regular', 'high_speed'] as const)
        expect(measure(four, cls)).toEqual(measure(six, cls));
    }
  });
});

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
    expect(vehicleSpec({ size: 'tiny' }).drawBogies).toBe(false);
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

  /**
   * The nearest point the slow way: each segment from the one the window's near end falls in to
   * the one its far end falls in (an end off the line falls in the segment at that end), P's
   * projection onto it, and the first of the closest.
   */
  function slowNearest(line: Polyline, P: { x: number; y: number }, guess: number, window: number) {
    const { pts, cum } = line;
    if (pts.length === 1) return { p: pts[0], arc: 0 };
    const last = pts.length - 1;
    const fallsIn = (arc: number) => {
      if (arc <= cum[0]) return 1;
      if (arc >= cum[last]) return last;
      let i = 1;
      while (cum[i] < arc) i++;
      return i;
    };
    let best = { p: pts[0], arc: 0 };
    let bd = Infinity;
    for (let i = fallsIn(guess - window); i <= fallsIn(guess + window); i++) {
      const [a, b] = [pts[i - 1], pts[i]];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const l2 = dx * dx + dy * dy;
      const along = l2 > 1e-12 ? ((P.x - a.x) * dx + (P.y - a.y) * dy) / l2 : 0;
      const t = Math.max(0, Math.min(1, along));
      const q = { x: a.x + dx * t, y: a.y + dy * t };
      const d = (q.x - P.x) ** 2 + (q.y - P.y) ** 2;
      if (d < bd) {
        bd = d;
        best = { p: q, arc: cum[i - 1] + Math.sqrt(l2) * t };
      }
    }
    return best;
  }

  it('finds the first closest point of the segments its window reaches, at its arc', () => {
    forAll(
      (rng) => {
        // on a whole-tile grid half the time, where points repeat and distances tie
        const grid = rng.chance(0.5);
        const step = () => (grid ? rng.int(-2, 2) : rng.range(-1.5, 1.5));
        const pts = [{ x: 0, y: 0 }];
        for (let n = rng.int(0, 10); n > 0; n--) {
          const { x, y } = pts[pts.length - 1];
          pts.push({ x: x + step(), y: y + step() });
        }
        const P = grid
          ? { x: rng.int(-6, 6), y: rng.int(-6, 6) }
          : { x: rng.range(-6, 6), y: rng.range(-6, 6) };
        return { pts, P, guess: rng.range(-2, 20), window: rng.pick([0.3, 1.5, 4, 100]) };
      },
      ({ pts, P, guess, window }) => {
        const line = new Polyline(pts);
        const got = line.nearest(P, guess, window);
        expect(got).toEqual(slowNearest(line, P, guess, window));
        const at = line.at(got.arc);
        expect(Math.hypot(at.x - got.p.x, at.y - got.p.y)).toBeLessThan(1e-9);
      },
      { seeds: Array.from({ length: 2000 }, (_, i) => i + 1) },
    );
  });
});
