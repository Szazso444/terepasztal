import { describe, it, expect } from 'vitest';
import { Dir, DIR_DX, DIR_DY } from '../engine/iso';
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
  it('has Narrow Gauge and the three standard lines to build', () => {
    expect(BUILDABLE_CLASSES).toEqual(['narrow', 'branch', 'main', 'trunk']);
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
  it('moves one standard line up or down, and no further', () => {
    expect(nextLine('branch', 'up')).toBe('main');
    expect(nextLine('main', 'up')).toBe('trunk');
    expect(nextLine('trunk', 'down')).toBe('main');
    expect(nextLine('branch', 'down')).toBeNull();
    expect(nextLine('trunk', 'up')).toBeNull();
    expect(nextLine('narrow', 'up')).toBeNull();
    const track = new TrackGraph(8, 8);
    track.place(2, 2, 'straight', 0, 'trunk');
    expect(planReclass(track, [{ x: 2, y: 2 }], 'up')).toEqual({
      changes: [],
      left: [],
      reason: 'noLine',
    });
  });
  it('changes a straight in place', () => {
    const track = new TrackGraph(8, 8);
    track.place(2, 2, 'straight', 1, 'branch');
    expect(planReclass(track, [{ x: 2, y: 2 }], 'up').changes).toEqual([
      { x: 2, y: 2, kind: 'straight', rot: 1, cls: 'main' },
    ]);
  });
  it('leaves a curve or switch of the other size as it is and says why', () => {
    const track = new TrackGraph(12, 12);
    track.place(2, 2, 'curve', 0, 'branch');
    track.place(6, 6, 'switch', 3, 'main');
    const curve = track.anchorOf(3, 3),
      sw = track.anchorOf(7, 7);
    expect(planReclass(track, [{ x: 3, y: 3 }], 'up')).toEqual({
      changes: [],
      left: [{ ...curve, to: 'main', n: 2, need: 3 }],
      reason: 'size',
    });
    expect(planReclass(track, [{ x: 7, y: 7 }], 'down')).toEqual({
      changes: [],
      left: [{ ...sw, to: 'branch', n: 3, need: 2 }],
      reason: 'size',
    });
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

describe('Main and Trunk Line switches', () => {
  for (const cls of ['main', 'trunk'] as const)
    it(`${cls}: bends its branch into a parallel track beside a straight, else turns`, () => {
      const g = new TrackGraph(32, 32);
      g.place(10, 10, 'switch', 0, cls);
      expect(g.unitTiles(10, 10)).toHaveLength(CLASS_N[cls] ** 2);
      g.refreshSwitchForms();
      expect(g.get(10, 10)!.form ?? 'turn').toBe('turn');
      const s = g.switchExit(10, 10, 0, cls, 'parallel');
      g.place(s.x, s.y, 'straight', s.out === Dir.N || s.out === Dir.S ? 0 : 1, cls);
      g.refreshSwitchForms();
      expect(g.get(10, 10)!.form).toBe('parallel');
      // the parallel lane leaves the block onto that straight
      expect(g.connected(s.x - DIR_DX[s.out], s.y - DIR_DY[s.out], s.out)).toBe(true);
    });
});
