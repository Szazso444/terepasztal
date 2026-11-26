import { describe, expect, it } from 'vitest';
import {
  climbAxes,
  lineSpans,
  railLevel,
  railGrade,
  railProfile,
  rampReach,
  supportedDeck,
  CLIMB_SPEED,
  DESCENT_SPEED,
  type RailBed,
} from './railProfile';
import { TrackGraph, pieceLinks } from './track';
import { emptyMap } from './mapgen';
import { Terrain } from './tiles';
import { Dir } from '../engine/iso';
import { forAll } from '../testing/property';

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

  it('lets straights and crossings climb, never curves or switches', () => {
    expect(climbAxes(pieceLinks('straight', 0))).toEqual(['y']);
    expect(climbAxes(pieceLinks('straight', 1))).toEqual(['x']);
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
      track.place(x, 12, x === 10 ? 'crossing' : 'straight', 1, 'branch');
    for (let y = 9; y < 16; y++) if (y !== 12) track.place(10, y, 'straight', 0, 'branch');
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

  it('stands a deck over raised water at the water level, never below it', () => {
    // abutments at level 0, the water under the bridge at level 1
    const bridged = [false, false, true, false, false];
    expect(lineSpans([0, 0, 1, 0, 0], bridged, 0, [], [0, 0, 1, 0, 0]).levels[2]).toBe(1);
    // with no water under it the deck carries the abutments' level, as over a dip
    expect(lineSpans([0, 0, 1, 0, 0], bridged).levels[2]).toBe(0);
    // on a map: a river at level 1 between grass banks, bridged by a straight line along x
    const m = emptyMap(5, 16, 16);
    m.waterSurface = new Uint8Array(16 * 16);
    for (let y = 0; y < 16; y++) {
      m.terrain[y * 16 + 8] = Terrain.Water;
      m.waterSurface[y * 16 + 8] = 1;
    }
    const track = new TrackGraph(16, 16);
    for (let x = 4; x < 13; x++) track.place(x, 8, 'straight', 1, 'branch');
    const beds = railProfile(m, track, (x, y) => x === 8 && y === 8);
    const deck = beds.get(8 * 16 + 8)!;
    expect(deck.bridge).toBe(true);
    expect(railLevel(deck, 8)).toBeCloseTo(1);
    // the rail climbs onto it from the banks at level 0
    expect(railLevel(beds.get(8 * 16 + 4)!, 4)).toBeCloseTo(0);
    // the same water at level 0 leaves the deck at the banks' level
    m.waterSurface.fill(0);
    expect(
      railLevel(railProfile(m, track, (x, y) => x === 8 && y === 8).get(8 * 16 + 8)!, 8),
    ).toBeCloseTo(0);
  });

  it('raises a deck to the water under it and changes nothing else, on any line', () => {
    // Lines up to 16 tiles, levels a step apart at most, any bridge runs, any water levels under
    // them. Water at level 0 everywhere is the line with no water given; a tile off a bridge keeps
    // its level; a deck is level across its run and stands at the higher of what it stood at
    // without the water and the highest water under it.
    let raised = 0;
    forAll(
      (rng) => {
        const n = rng.int(1, 16);
        const terrain = [rng.int(0, 4)];
        for (let i = 1; i < n; i++)
          terrain.push(Math.max(0, Math.min(4, terrain[i - 1] + rng.int(-1, 1))));
        const bridge = terrain.map(() => rng.chance(0.5));
        const under = terrain.map(() => (rng.chance(0.5) ? 0 : rng.int(0, 4)));
        return { terrain, bridge, under, start: rng.int(-3, 3) };
      },
      ({ terrain, bridge, under, start }) => {
        const dry = lineSpans(terrain, bridge, start);
        expect(
          lineSpans(
            terrain,
            bridge,
            start,
            [],
            terrain.map(() => 0),
          ),
        ).toEqual(dry);
        const { levels } = lineSpans(terrain, bridge, start, [], under);
        for (let i = 0; i < terrain.length;) {
          if (!bridge[i]) {
            expect(levels[i], `tile ${i}`).toBe(terrain[i]);
            i++;
            continue;
          }
          let j = i;
          while (j + 1 < terrain.length && bridge[j + 1]) j++;
          const deck = Math.max(dry.levels[i], ...under.slice(i, j + 1));
          if (deck > dry.levels[i]) raised++;
          for (let k = i; k <= j; k++) expect(levels[k], `deck tile ${k}`).toBe(deck);
          i = j + 1;
        }
      },
    );
    expect(raised).toBeGreaterThan(0);
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

describe('stored deck heights', () => {
  /** A line of `n` tiles with a bridge on tiles `from`..`to` stored at `h`. */
  const raised = (n: number, from: number, to: number, h: number, ground = 0) => {
    const terrain = new Array<number>(n).fill(ground),
      bridge = terrain.map((_, i) => i >= from && i <= to),
      decks = bridge.map((b) => (b ? h : undefined));
    return lineSpans(terrain, bridge, 0, [], [], decks);
  };

  it('changes nothing without a stored height', () => {
    forAll(
      (rng) => {
        const n = rng.int(3, 14);
        return {
          terrain: Array.from({ length: n }, () => rng.int(0, 2)),
          bridge: Array.from({ length: n }, () => rng.int(0, 2) === 0),
        };
      },
      ({ terrain, bridge }) => {
        const none = terrain.map(() => undefined);
        expect(lineSpans(terrain, bridge, 0, [], [], none)).toEqual(lineSpans(terrain, bridge));
      },
    );
  });

  it('stands a deck at its height and ramps the approach one level per tile', () => {
    const { levels, spans } = raised(13, 5, 7, 4);
    expect(levels).toEqual([0, 0, 1, 2, 3, 4, 4, 4, 3, 2, 1, 0, 0]);
    const b = bed(spans);
    for (let t = -0.5; t < 12.5; t += 1 / 32)
      expect(Math.abs(railLevel(b, t + 1 / 32) - railLevel(b, t)) * 32).toBeLessThanOrEqual(1.0001);
  });

  it('keeps a deck above the ground and the water under it', () => {
    expect(raised(5, 2, 2, 1, 3).levels[2]).toBe(3);
    const over = lineSpans([2, 2, 2], [false, true, false], 0, [], [2, 2, 2], [undefined, 1]);
    expect(over.levels[1]).toBe(2);
    expect(raised(7, 3, 3, 3, 2).levels).toEqual([2, 2, 2, 3, 2, 2, 2]);
  });

  it('ramps up to a stored deck just past an end of the line', () => {
    const { levels, spans } = lineSpans([0, 0, 0, 0, 0], [], 0, [], [], [], [undefined, 3]);
    expect(levels).toEqual([0, 0, 0, 1, 2]);
    expect(railLevel(bed(spans), 4.5)).toBeCloseTo(3);
  });

  it('seats a curve on a platform at the stored height', () => {
    const map = emptyMap(5, 8, 8),
      links = [[Dir.E, Dir.S]] as const,
      one = { x: 3, y: 3, links };
    expect(
      supportedDeck(
        map,
        [one],
        () => true,
        () => 3,
      ),
    ).toBe(3);
    expect(
      supportedDeck(
        map,
        [one, { x: 4, y: 3, links }],
        () => true,
        (x) => (x === 3 ? 3 : 2),
      ),
    ).toBeNull();
  });

  it('honours the height through the whole profile, and the ramp stays on its ground', () => {
    const map = emptyMap(5, 16, 8),
      track = new TrackGraph(16, 8);
    for (let x = 1; x <= 12; x++) track.place(x, 3, 'straight', 1, 'branch');
    const platform = (x: number, y: number) => y === 3 && x >= 6 && x <= 7,
      beds = railProfile(map, track, platform, (x, y) => (platform(x, y) ? 2 : undefined)),
      at = (x: number) => railLevel(beds.get(3 * 16 + x)!, x);
    expect(at(6)).toBeCloseTo(2);
    expect(at(7)).toBeCloseTo(2);
    expect(at(5)).toBeGreaterThan(0.5);
    expect(beds.get(3 * 16 + 6)!.bridge).toBe(true);
    expect(beds.get(3 * 16 + 5)!.bridge).toBeUndefined();
    expect(at(1)).toBeCloseTo(0);
    expect(at(12)).toBeCloseTo(0);
  });

  it('reports the pieces a ramp would have to rise under', () => {
    const map = emptyMap(5, 16, 8),
      track = new TrackGraph(16, 8);
    for (let x = 3; x <= 9; x++) track.place(x, 3, 'straight', 1, 'narrow');
    const pieceAt = (x: number, y: number) =>
        x === 2 && y === 3 ? { links: pieceLinks('curve', 0) } : track.get(x, y),
      deck = (h: number) => [{ x: 6, y: 3, deck: h }];
    // A height of 1 is met by the next tile's ground.
    expect(rampReach(map, pieceAt, deck(1)).climbs).toEqual([]);
    expect(rampReach(map, pieceAt, deck(3)).climbs).toEqual(
      expect.arrayContaining([
        { x: 5, y: 3 },
        { x: 4, y: 3 },
        { x: 7, y: 3 },
        { x: 8, y: 3 },
      ]),
    );
    expect(rampReach(map, pieceAt, deck(2), (x) => x === 5).blocked).toEqual([{ x: 5, y: 3 }]);
    const clear = rampReach(
      map,
      pieceAt,
      deck(2),
      () => false,
      (x) => x === 5,
    );
    expect(clear.climbs).toEqual([{ x: 7, y: 3 }]);
  });
});
