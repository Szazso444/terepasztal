// Experiment for player-set bridge deck heights (no src changes): what the EXISTING rail profile
// code does when a bridge tile carries a stored level. A stored deck needs no change to lineSpans:
// the tile's level is replaced by the stored one and the tile stops being an "automatic" bridge
// tile, so it acts as an abutment for the automatic tiles around it.
//   npx vitest run -c scratchpad/bridges/heights.vitest.config.ts
import { describe, expect, it } from 'vitest';
import { lineSpans, railLevel, railProfile, type RailBed } from '../../src/world/railProfile';
import { TrackGraph } from '../../src/world/track';
import { emptyMap } from '../../src/world/mapgen';
import { Terrain } from '../../src/world/tiles';
import { levelAt } from '../../src/world/elevation';

type Deck = number | undefined;
/** What lineProfile would feed lineSpans once bridge tiles can store a level. */
function withDecks(terrain: number[], bridge: boolean[], deck: Deck[]) {
  return lineSpans(
    terrain.map((t, i) => deck[i] ?? t),
    bridge.map((b, i) => b && deck[i] === undefined),
  );
}
const bed = (spans: RailBed['spans']): RailBed => ({ axis: 'x', spans, flat: false });
/** Steepest grade in levels per tile, and the largest jump between samples 1/64 tile apart. */
function measure(spans: RailBed['spans'], n: number) {
  const b = bed(spans);
  let grade = 0,
    jump = 0,
    last = railLevel(b, -0.5);
  for (let t = -0.5; t <= n - 0.5 + 1e-9; t += 1 / 64) {
    const h = railLevel(b, t);
    jump = Math.max(jump, Math.abs(h - last));
    grade = Math.max(grade, Math.abs(h - last) * 64);
    last = h;
  }
  return { grade: Math.round(grade * 100) / 100, jump };
}
const flat = (n: number) => Array.from({ length: n }, () => 0);
const span = (n: number, from: number, to: number) =>
  Array.from({ length: n }, (_, i) => i >= from && i <= to);
const decks = (n: number, from: number, values: number[]): Deck[] =>
  Array.from({ length: n }, (_, i) => values[i - from]);

describe('stored deck levels through the existing profile code', () => {
  it('changes nothing while no tile stores a level', () => {
    const terrain = [0, 0, 0, 0, 0, 0, 1, 1, 1, 2, 2, 2, 1, 2, 2, 1, 0, 0],
      bridge = span(18, 11, 13);
    expect(withDecks(terrain, bridge, [])).toEqual(lineSpans(terrain, bridge));
  });

  it('carries a bridge one level above flat land: half the climb on the ground tile, half on the end span', () => {
    const { spans, levels, moving } = withDecks(flat(9), span(9, 3, 5), decks(9, 3, [1, 1, 1]));
    expect(levels).toEqual([0, 0, 0, 1, 1, 1, 0, 0, 0]);
    // Transitions: the ground tile before the bridge and the first span; same at the far end.
    expect(moving).toEqual([false, false, true, true, false, true, true, false, false]);
    const b = bed(spans);
    expect(railLevel(b, 1.5)).toBeCloseTo(0); // foot of the climb, on the ground
    expect(railLevel(b, 2.5)).toBeCloseTo(0.5); // the bank/bridge joint: half a level up
    expect(railLevel(b, 3.5)).toBeCloseTo(1); // level from the far edge of the first span
    expect(railLevel(b, 4)).toBeCloseTo(1);
    const m = measure(spans, 9);
    expect(m.jump).toBeLessThanOrEqual(1.4 / 64);
    expect(m.grade).toBeLessThanOrEqual(1.0001);
  });

  it('climbs a ramp of spans one level apart up to level 4 and down again', () => {
    const ramp = [1, 2, 3, 4, 4, 4, 3, 2, 1],
      { spans, levels, moving } = withDecks(flat(13), span(13, 2, 10), decks(13, 2, ramp));
    expect(levels).toEqual([0, 0, 1, 2, 3, 4, 4, 4, 3, 2, 1, 0, 0]);
    // Only the first and last ground tile and the middle of the summit are level track.
    expect(moving.map((m, i) => (m ? -1 : i)).filter((i) => i >= 0)).toEqual([0, 6, 12]);
    const b = bed(spans),
      m = measure(spans, 13);
    expect(railLevel(b, 6)).toBeCloseTo(4);
    expect(m.jump).toBeLessThanOrEqual(1.4 / 64);
    // The same bound the shipped test holds monotonic climbs to: one level per tile.
    expect(m.grade).toBeLessThanOrEqual(1.0001);
    console.log(
      'ramp rail level at tile edges 0.5..5.5:',
      [0.5, 1.5, 2.5, 3.5, 4.5, 5.5].map((t) => +railLevel(b, t).toFixed(3)),
      'at centres 1..5:',
      [1, 2, 3, 4, 5].map((t) => +railLevel(b, t).toFixed(3)),
    );
  });

  it('measures the steepest grade of each shape (levels per tile)', () => {
    const grade = (levels: number[]) => measure(lineSpans(levels).spans, levels.length).grade;
    const table = {
      'step up 0 0 1 1': grade([0, 0, 1, 1]),
      'staircase 0 1 2 3 4 4': grade([0, 1, 2, 3, 4, 4]),
      'one-tile hump 0 0 1 0 0': grade([0, 0, 1, 0, 0]),
      'two-tile hump 0 0 1 1 0 0': grade([0, 0, 1, 1, 0, 0]),
      'peak 0 0 1 2 1 0 0': grade([0, 0, 1, 2, 1, 0, 0]),
      'two-level step 0 0 2 2': grade([0, 0, 2, 2]),
      'two-level hump 0 0 2 0 0': grade([0, 0, 2, 0, 0]),
      'three-level step 0 0 3 3': grade([0, 0, 3, 3]),
    };
    console.log(table);
    expect(table['step up 0 0 1 1']).toBeLessThanOrEqual(1.0001);
    expect(table['staircase 0 1 2 3 4 4']).toBeLessThanOrEqual(1.0001);
    // A step of two levels between neighbours at least doubles the steepest grade.
    expect(table['two-level step 0 0 2 2']).toBeGreaterThan(1.9);
    expect(table['two-level hump 0 0 2 0 0']).toBeGreaterThan(1.9);
  });

  it('TODAY: an automatic deck already meets low ground two levels down at one end', () => {
    // Bank at level 2, platforms over the slope (levels 1 and 0), then ground at 0.
    const { levels, spans } = lineSpans([2, 2, 1, 0, 0, 0], [false, false, true, true]);
    expect(levels).toEqual([2, 2, 2, 2, 0, 0]);
    expect(measure(spans, 6).grade).toBeGreaterThan(1.9);
  });

  it('automatic neighbours follow a stored tile, so ramps need the run pinned first', () => {
    const land = flat(7),
      bridge = span(7, 2, 4);
    // Only the middle span stores a level: the automatic ones take it as their higher abutment.
    expect(withDecks(land, bridge, decks(7, 3, [1])).levels).toEqual([0, 0, 1, 1, 1, 0, 0]);
    const second = withDecks(land, bridge, decks(7, 3, [2]));
    expect(second.levels).toEqual([0, 0, 2, 2, 2, 0, 0]);
    expect(measure(second.spans, 7).grade).toBeGreaterThan(1.9);
    // With every span of the run pinned at its level first, a click moves one tile only.
    expect(withDecks(land, bridge, decks(7, 2, [0, 1, 0])).levels).toEqual([0, 0, 0, 1, 0, 0, 0]);
    expect(withDecks(land, bridge, decks(7, 2, [1, 2, 1])).levels).toEqual([0, 0, 1, 2, 1, 0, 0]);
  });

  it('TODAY: a bridge run at the start of a line ignores what stands behind it', () => {
    // First two tiles are platforms (a ground curve at level 0 would feed them), far bank at 1.
    const { levels } = lineSpans([0, 0, 1, 1], [true, true]);
    expect(levels).toEqual([1, 1, 1, 1]);
  });

  it('TODAY: a crossing on a platform can get two deck levels, one per line', () => {
    const m = emptyMap(7, 24, 24),
      at = (x: number, y: number) => y * 24 + x;
    // Hill tiles west and east of (10, 10) on row 10 only: level 1 each; north and south stay 0.
    for (const x of [7, 8, 9, 11, 12, 13]) m.terrain[at(x, 10)] = Terrain.Hill;
    expect([9, 11].map((x) => levelAt(m, x, 10))).toEqual([1, 1]);
    expect([9, 11].map((y) => levelAt(m, 10, y))).toEqual([0, 0]);
    const track = new TrackGraph(24, 24);
    for (let x = 5; x < 16; x++)
      track.place(x, 10, x === 10 ? 'crossing' : 'straight', 1, 'regular');
    for (let y = 6; y < 15; y++) if (y !== 10) track.place(10, y, 'straight', 0, 'regular');
    const beds = railProfile(m, track, (x, y) => x === 10 && y === 10),
      crossing = beds.get(at(10, 10))!,
      lineX = crossing.axis === 'x' ? crossing : crossing.cross!,
      lineY = crossing.axis === 'y' ? crossing : crossing.cross!;
    // The east-west rail crosses at level 1, the north-south one at level 0: they do not meet.
    expect(railLevel(lineX, 10)).toBeCloseTo(1);
    expect(railLevel(lineY, 10)).toBeCloseTo(0);
  });
});
