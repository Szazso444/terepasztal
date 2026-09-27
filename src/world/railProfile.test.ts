import { describe, expect, it } from 'vitest';
import {
  lineSpans,
  railLevel,
  railGrade,
  CLIMB_SPEED,
  DESCENT_SPEED,
  type RailBed,
} from './railProfile';
import { Dir } from '../engine/iso';

const bed = (spans: RailBed['spans']): RailBed => ({ axis: 'x', spans, flat: false });
/** The worked example from the incline rules: a climb, a bridged dip and a descent. */
const EXAMPLE = [0, 0, 0, 0, 0, 0, 1, 1, 1, 2, 2, 2, 1, 2, 2, 1, 0, 0];
const BRIDGED = EXAMPLE.map((_, i) => i >= 11 && i <= 13);

describe('rail inclines', () => {
  it('classifies the worked example: transitions at level changes, an incline between them', () => {
    const { moving, levels } = lineSpans(EXAMPLE, BRIDGED);
    expect(moving.map((m, i) => (m ? i : -1)).filter((i) => i >= 0)).toEqual([
      5, 6, 7, 8, 9, 14, 15, 16,
    ]);
    // The bridge carries level 2 across the dip.
    expect(levels.slice(11, 14)).toEqual([2, 2, 2]);
  });

  it('is continuous, stays level on flat track, and never climbs faster than a level per tile', () => {
    for (const [terrain, bridge] of [
      [EXAMPLE, BRIDGED],
      [[0, 0, 1, 0, 0], []],
      [[1, 1, 0, 1, 1], []],
      [[0, 1, 2, 3, 4, 4], []],
      [[0, 0, 1, 1, 1, 1, 0, 0], []],
    ] as [number[], boolean[]][]) {
      const { spans, levels, moving } = lineSpans(terrain, bridge);
      const b = bed(spans);
      let last = railLevel(b, -0.5);
      for (let t = -0.5; t <= terrain.length - 0.5 + 1e-9; t += 1 / 64) {
        const h = railLevel(b, t);
        expect(Math.abs(h - last)).toBeLessThanOrEqual(1.4 / 64);
        last = h;
      }
      levels.forEach((level, i) => {
        if (!moving[i]) expect(railLevel(b, i)).toBeCloseTo(level);
      });
    }
    // Monotonic climbs keep to one level per tile.
    const b = bed(lineSpans([0, 1, 2, 3, 4, 4]).spans);
    for (let t = -0.5; t < 5.5; t += 1 / 32)
      expect(Math.abs(railLevel(b, t + 1 / 32) - railLevel(b, t)) * 32).toBeLessThanOrEqual(1.0001);
  });

  it('eases into a climb: level at the foot, bending on the transition tiles', () => {
    const b = bed(lineSpans([0, 0, 1, 1]).spans);
    expect(railLevel(b, 0.5)).toBeCloseTo(0);
    expect(railLevel(b, 1.5)).toBeCloseTo(0.5);
    expect(railLevel(b, 2.5)).toBeCloseTo(1);
    // A vertical curve, not a kink: the grade is zero where the climb starts.
    expect(railLevel(b, 0.55) - railLevel(b, 0.5)).toBeLessThan(0.01);
  });

  it('slows climbing trains and speeds descending ones', () => {
    const b = bed(lineSpans([0, 0, 1, 1]).spans),
      beds = new Map([[1, b]]);
    expect(railGrade(beds, 10, 1, 0, Dir.W, Dir.E)).toBe(CLIMB_SPEED);
    expect(railGrade(beds, 10, 1, 0, Dir.E, Dir.W)).toBe(DESCENT_SPEED);
    expect(railGrade(new Map(), 10, 1, 0, Dir.W, Dir.E)).toBe(1);
  });
});
