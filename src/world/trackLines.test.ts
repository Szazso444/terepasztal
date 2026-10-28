import { describe, it, expect } from 'vitest';
import { Dir } from '../engine/iso';
import {
  BUILDABLE_CLASSES,
  CLASS_N,
  LINES,
  TRACK_CLASSES,
  TRACK_ITEMS,
  TrackGraph,
  classesJoin,
  legacyClass,
  liftLegacyTrack,
  type TrackTuple,
} from './track';
import { nextLine, planReclass } from './reclass';

describe('the six track lines', () => {
  it('sizes curves by line: 1x1 to 5x5, Hyperloop straight only', () => {
    expect(CLASS_N).toMatchObject({ narrow: 1, branch: 2, main: 3, trunk: 4, maglev: 5 });
    expect(LINES.hyperloop.curves).toBe(false);
  });
  it('joins Branch, Main and Trunk directly and keeps every other network apart', () => {
    for (const a of TRACK_CLASSES)
      for (const b of TRACK_CLASSES)
        expect(classesJoin(a, b), `${a} x ${b}`).toBe(
          a === b || (LINES[a].network === 'standard' && LINES[b].network === 'standard'),
        );
  });
  it('raises cost with the tier', () => {
    const mul = ['narrow', 'branch', 'main', 'trunk', 'maglev', 'hyperloop'].map(
      (c) => LINES[c as keyof typeof LINES].costMul,
    );
    expect(mul).toEqual([0.6, 1, 1.5, 2.5, 4, 4]);
  });
  it('has only Narrow Gauge and Branch Line to build for now', () => {
    expect(BUILDABLE_CLASSES).toEqual(['narrow', 'branch']);
    expect(TRACK_ITEMS.some((i) => (i.kind as string) === 'transition')).toBe(false);
  });
});

describe('track saved before the six lines', () => {
  it('turns wide and high-speed track into Branch Line', () => {
    expect(legacyClass('regular')).toBe('branch');
    expect(legacyClass('high_speed')).toBe('branch');
    expect(legacyClass(undefined)).toBe('branch');
    expect(legacyClass('narrow')).toBe('narrow');
  });
  it('lays a transition again as the Branch Line straight on its axis', () => {
    const old = [
      [3, 4, 'transition', 3, 'regular'],
      // an old save stores no second line as null
      [5, 4, 'curve', 2, 'high_speed', null],
      [6, 6, 'crossing', 1, 'narrow', 'regular'],
      [7, 7, 'straight', 0],
    ] as unknown as TrackTuple[];
    expect(liftLegacyTrack(old)).toEqual([
      [3, 4, 'straight', 1, 'branch'],
      [5, 4, 'curve', 2, 'branch'],
      [6, 6, 'crossing', 1, 'narrow', 'branch'],
      [7, 7, 'straight', 0, 'branch'],
    ]);
  });
  it('leaves track already in lines as it is', () => {
    const now: TrackTuple[] = [
      [1, 1, 'straight', 0, 'branch'],
      [2, 2, 'crossing', 0, 'narrow', 'narrow'],
    ];
    expect(liftLegacyTrack(now)).toEqual(now);
  });
});

describe('Upgrade and Downgrade', () => {
  it('has no line to move to while Branch is the only standard line', () => {
    expect(nextLine('branch', 'up')).toBeNull();
    expect(nextLine('branch', 'down')).toBeNull();
    expect(nextLine('narrow', 'up')).toBeNull();
    const track = new TrackGraph(8, 8);
    track.place(2, 2, 'straight', 0, 'branch');
    expect(planReclass(track, [{ x: 2, y: 2 }], 'up')).toEqual({ changes: [], reason: 'noLine' });
  });
  it('leaves Narrow Gauge alone and says why', () => {
    const track = new TrackGraph(8, 8);
    track.place(2, 2, 'straight', 0, 'narrow');
    expect(planReclass(track, [{ x: 2, y: 2 }], 'up').reason).toBe('separate');
  });
  it('finds nothing on an empty tile', () => {
    const track = new TrackGraph(8, 8);
    expect(planReclass(track, [{ x: 2, y: 2 }], 'down').reason).toBe('nothing');
  });
  it('reads a crossing by the line the stroke runs along', () => {
    const track = new TrackGraph(8, 8);
    track.place(3, 3, 'crossing', 0, 'narrow', 'branch');
    // from the north: the N-S line, which is Narrow Gauge
    const plan = planReclass(track, [{ x: 3, y: 3 }], 'up', { x: 3, y: 2 });
    expect(plan.reason).toBe('separate');
    expect(track.get(3, 3)!.links[0]).toContain(Dir.N);
  });
});
