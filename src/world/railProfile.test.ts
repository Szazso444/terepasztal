import { describe, expect, it } from 'vitest';
import {
  climbAxes,
  lineSpans,
  railLevel,
  railGrade,
  railProfile,
  supportedDeck,
  CLIMB_SPEED,
  DESCENT_SPEED,
  type RailBed,
} from './railProfile';
import { TrackGraph, pieceLinks } from './track';
import { emptyMap } from './mapgen';
import { Terrain } from './tiles';
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

  it('lets straights, crossings and class transitions climb, never curves or switches', () => {
    expect(climbAxes(pieceLinks('straight', 0))).toEqual(['y']);
    expect(climbAxes(pieceLinks('transition', 0))).toEqual(['y']);
    expect(climbAxes(pieceLinks('crossing', 0)).sort()).toEqual(['x', 'y']);
    for (let r = 0; r < 4; r++) {
      expect(climbAxes(pieceLinks('curve', r))).toEqual([]);
      expect(climbAxes(pieceLinks('switch', r))).toEqual([]);
    }
  });

  it('holds a crossing level at its centre so both rails meet', () => {
    const b = bed(
      lineSpans([0, 0, 0, 1, 1, 1], [], 0, [false, false, true, false, false, false]).spans,
    );
    expect(railLevel(b, 2)).toBeCloseTo(0);
    expect(railLevel(b, 2.05) - railLevel(b, 1.95)).toBeCloseTo(0, 2);
    expect(railLevel(b, 5)).toBeCloseTo(1);
  });

  it('profiles a line through a crossing and gives the crossing both lines', () => {
    const m = emptyMap(5, 24, 24);
    // A hill east of x = 10: row 12 climbs 0 -> 1 -> 2 eastwards.
    for (let y = 6; y < 18; y++) for (let x = 10; x < 20; x++) m.terrain[y * 24 + x] = Terrain.Hill;
    const track = new TrackGraph(24, 24);
    for (let x = 4; x < 16; x++)
      track.place(x, 12, x === 10 ? 'crossing' : 'straight', 1, 'regular');
    for (let y = 9; y < 16; y++) if (y !== 12) track.place(10, y, 'straight', 0, 'regular');
    const beds = railProfile(m, track),
      crossing = beds.get(12 * 24 + 10)!;
    expect(crossing.cross).toBeDefined();
    expect([crossing.axis, crossing.cross!.axis].sort()).toEqual(['x', 'y']);
    // Consecutive tiles of the climbing line meet on their shared edge.
    for (let x = 4; x < 15; x++) {
      const here = beds.get(12 * 24 + x)!,
        next = beds.get(12 * 24 + x + 1)!,
        pick = (b: RailBed) => (b.axis === 'x' ? b : b.cross!);
      expect(railLevel(pick(here), x + 0.5)).toBeCloseTo(railLevel(pick(next), x + 0.5));
    }
  });

  it('seats a supported curve at the level of the rails it meets, or refuses it', () => {
    const m = emptyMap(6, 16, 16);
    // A level-2 hill over x 4..11, y 4..11; its edge ring is level 1.
    for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) m.terrain[y * 16 + x] = Terrain.Hill;
    const none = () => false,
      curve = (x: number, y: number, rot: number) => [{ x, y, links: pieceLinks('curve', rot) }];
    // Ring corner (4, 4), east and south: both neighbours at level 1, like the tile. Deck 1.
    expect(supportedDeck(m, curve(4, 4, 1), none)).toBe(1);
    // (4, 6) north and east: rails at levels 1 and 2 disagree.
    expect(supportedDeck(m, curve(4, 6, 0), none)).toBeNull();
    // (5, 5) north and west meet level 1, below the level-2 tile: refused.
    expect(supportedDeck(m, curve(5, 5, 3), none)).toBeNull();
    // Neighbours on platforms adapt: the deck is the piece's own highest tile.
    expect(supportedDeck(m, curve(4, 6, 0), () => true)).toBe(1);
  });
});
