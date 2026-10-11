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
import { levelAt } from './elevation';
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
    const none = () => undefined,
      curve = (x: number, y: number, rot: number) => [{ x, y, links: pieceLinks('curve', rot) }];
    // Ring corner (4, 4), east and south: both neighbours at level 1, like the tile. Deck 1.
    expect(supportedDeck(m, curve(4, 4, 1), none)).toBe(1);
    // (4, 6) north and east: rails at levels 1 and 2 disagree.
    expect(supportedDeck(m, curve(4, 6, 0), none)).toBeNull();
    // (5, 5) north and west meet level 1, below the level-2 tile: refused.
    expect(supportedDeck(m, curve(5, 5, 3), none)).toBeNull();
    // Neighbours on platforms adapt: the deck is the piece's own highest tile.
    expect(supportedDeck(m, curve(4, 6, 0), () => ({}))).toBe(1);
  });
});

describe('bridge decks set by hand', () => {
  const W = 32,
    ROW = 8,
    X0 = 4;
  /**
   * Flat land with a straight line along one row. `decks` gives each tile of the line: a number
   * is a platform whose deck the player set, null an automatic platform, undefined plain ground.
   */
  function line(decks: (number | null | undefined)[], m = emptyMap(9, W, W)) {
    const track = new TrackGraph(W, W);
    decks.forEach((_, i) => track.place(X0 + i, ROW, 'straight', 1, 'regular'));
    const platformAt = (x: number, y: number) => {
      const d = y === ROW ? decks[x - X0] : undefined;
      return d === undefined ? undefined : d === null ? {} : { deck: d };
    };
    const beds = railProfile(m, track, platformAt),
      bedAt = (i: number) => beds.get(ROW * W + X0 + i)!;
    return {
      beds,
      bedAt,
      levels: decks.map((_, i) => bedAt(i).level),
      /** Rail level at `t` tiles along the line (0 is the first tile's centre). */
      rail: (t: number) =>
        railLevel(bedAt(Math.max(0, Math.min(decks.length - 1, Math.round(t)))), X0 + t),
    };
  }

  it('leaves the profile as it was while no deck is set', () => {
    // A river bed between two hills: banks at level 1, the automatic deck carries level 1 across.
    const m = emptyMap(9, W, W);
    for (const x of [X0, X0 + 1, X0 + 2, X0 + 6, X0 + 7, X0 + 8])
      for (let y = ROW - 3; y <= ROW + 3; y++) m.terrain[y * W + x] = Terrain.Hill;
    const decks = [
        undefined,
        undefined,
        undefined,
        null,
        null,
        null,
        undefined,
        undefined,
        undefined,
      ],
      track = new TrackGraph(W, W);
    decks.forEach((_, i) => track.place(X0 + i, ROW, 'straight', 1, 'regular'));
    const today = railProfile(m, track, (x, y) =>
        y === ROW && decks[x - X0] === null ? {} : undefined,
      ),
      now = line(decks, m);
    expect([...now.beds]).toEqual([...today]);
    expect(now.levels.slice(3, 6)).toEqual([
      levelAt(m, X0 + 2, ROW),
      levelAt(m, X0 + 2, ROW),
      levelAt(m, X0 + 2, ROW),
    ]);
    expect(now.bedAt(4).bridge).toBe(true);
  });

  it('gives the same rail when a run is fixed at the levels it already has', () => {
    const auto = line([undefined, undefined, null, null, null, undefined, undefined]),
      fixed = line([undefined, undefined, ...auto.levels.slice(2, 5), undefined, undefined]);
    expect(fixed.levels).toEqual(auto.levels);
    for (let i = 0; i < 7; i++) expect(fixed.bedAt(i).spans).toEqual(auto.bedAt(i).spans);
  });

  it('carries a bridge one level above flat land: the climb is shared by the bank and the end span', () => {
    const p = line([undefined, undefined, undefined, 1, 1, 1, undefined, undefined, undefined]);
    expect(p.levels).toEqual([0, 0, 0, 1, 1, 1, 0, 0, 0]);
    expect(p.rail(1.5)).toBeCloseTo(0);
    expect(p.rail(2.5)).toBeCloseTo(0.5);
    expect(p.rail(3.5)).toBeCloseTo(1);
    // The ground tile is ordinary track that climbs; the span is a bridge that climbs.
    expect(p.bedAt(2)).toMatchObject({ flat: false, level: 0 });
    expect(p.bedAt(2).bridge).toBeUndefined();
    expect(p.bedAt(3)).toMatchObject({ flat: false, bridge: true, level: 1 });
    expect(p.bedAt(4)).toMatchObject({ bridge: true, level: 1 });
    expect(p.rail(4.5)).toBeCloseTo(1);
  });

  it('climbs a ramp of decks one level apart to the top and down again, never steeper than a level per tile', () => {
    const ramp = [1, 2, 3, 4, 4, 4, 3, 2, 1],
      p = line([undefined, undefined, ...ramp, undefined, undefined]);
    expect(p.levels).toEqual([0, 0, 1, 2, 3, 4, 4, 4, 3, 2, 1, 0, 0]);
    expect(p.rail(6)).toBeCloseTo(4);
    let last = p.rail(-0.5);
    for (let t = -0.5; t <= 12.5 + 1e-9; t += 1 / 64) {
      const h = p.rail(t);
      // Continuous across every tile joint, and at most one level per tile.
      expect(Math.abs(h - last)).toBeLessThanOrEqual(1.0001 / 64);
      last = h;
    }
  });

  it('lets an automatic deck follow the set deck beside it', () => {
    // Only the middle span is set: the automatic ones take it as their higher abutment.
    expect(line([undefined, undefined, null, 1, null, undefined, undefined]).levels).toEqual([
      0, 0, 1, 1, 1, 0, 0,
    ]);
    // Set all three and a click moves one tile only.
    expect(line([undefined, undefined, 0, 1, 0, undefined, undefined]).levels).toEqual([
      0, 0, 0, 1, 0, 0, 0,
    ]);
  });

  it('never seats a deck below the ground under it', () => {
    const m = emptyMap(9, W, W);
    for (let y = ROW - 4; y <= ROW + 4; y++)
      for (let x = X0 - 2; x <= X0 + 6; x++) m.terrain[y * W + x] = Terrain.Hill;
    expect(levelAt(m, X0 + 2, ROW)).toBe(2);
    // A deck stored at 0 on a level-2 hill (the terrain changed under it): the ground wins.
    expect(line([undefined, undefined, 0, undefined, undefined], m).levels[2]).toBe(2);
  });

  it('seats a supported curve on the deck set under it, and against set decks beside it', () => {
    const m = emptyMap(6, 16, 16),
      curve = (x: number, y: number, rot: number) => [{ x, y, links: pieceLinks('curve', rot) }],
      decks = (table: Record<string, number | null>) => (x: number, y: number) => {
        const d = table[`${x},${y}`];
        return d === undefined ? undefined : d === null ? {} : { deck: d };
      };
    // (8, 8) north and east on flat land. Its own platform set at 2 seats it at 2, but the rails
    // it meets on the ground are at 0: refused. With set decks at 2 beside it, it fits.
    expect(supportedDeck(m, curve(8, 8, 0), decks({ '8,8': 2 }))).toBeNull();
    expect(supportedDeck(m, curve(8, 8, 0), decks({ '8,8': 2, '8,7': 2, '9,8': 2 }))).toBe(2);
    // Automatic neighbours adapt to it, set ones do not.
    expect(supportedDeck(m, curve(8, 8, 0), decks({ '8,8': 2, '8,7': null, '9,8': null }))).toBe(2);
    expect(supportedDeck(m, curve(8, 8, 0), decks({ '8,8': 2, '8,7': 2, '9,8': 1 }))).toBeNull();
    // An automatic platform under the curve takes the height of the set decks it meets.
    expect(supportedDeck(m, curve(8, 8, 0), decks({ '8,8': null, '8,7': 3, '9,8': 3 }))).toBe(3);
    expect(supportedDeck(m, curve(8, 8, 0), decks({ '8,8': null, '8,7': 3 }))).toBeNull();
  });

  it('gives a curve on platforms a level bed at its deck', () => {
    const m = emptyMap(6, 16, 16),
      track = new TrackGraph(16, 16);
    track.place(8, 8, 'curve', 0, 'narrow');
    const beds = railProfile(m, track, (x, y) => (x === 8 && y === 8 ? { deck: 3 } : undefined));
    expect(beds.get(8 * 16 + 8)).toMatchObject({ flat: true, bridge: true, level: 3 });
  });
});
