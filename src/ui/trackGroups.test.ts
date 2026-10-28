import { describe, it, expect } from 'vitest';
import { TRACK_ITEMS, type TrackItem } from '../world/track';
import {
  TRACK_GROUPS,
  trackGroupOf,
  trackSlot,
  shortName,
  stepGroup,
  slotMate,
} from './trackGroups';

const item = (kind: TrackItem['kind'], cls: TrackItem['cls'], cls2?: TrackItem['cls']) =>
  ({ kind, cls, cls2 }) as TrackItem;

describe('track types', () => {
  it('lists the types narrow first, bridges last', () => {
    expect(TRACK_GROUPS).toEqual(['narrow', 'branch', 'main', 'trunk', 'bridges']);
  });

  it('gives every piece a type and a slot of its own in it', () => {
    const seen = new Set<string>();
    for (const it of TRACK_ITEMS) {
      const key = `${trackGroupOf(it)}:${trackSlot(it)}`;
      expect(seen.has(key), key).toBe(false);
      seen.add(key);
    }
    // Narrow Gauge fills keys 1 to 5, Branch Line 1 to 4: its crossing with narrow track is
    // listed under Narrow Gauge
    for (const [g, slots] of [
      ['narrow', 5],
      ['branch', 4],
    ] as const)
      for (let slot = 0; slot < slots; slot++)
        expect(seen.has(`${g}:${slot}`), `${g}:${slot}`).toBe(true);
    expect(seen.has('branch:4')).toBe(false);
  });

  it('puts a piece of two lines with the bigger or separate one', () => {
    expect(trackGroupOf(item('crossing', 'branch', 'branch'))).toBe('branch');
    expect(trackGroupOf(item('crossing', 'narrow', 'branch'))).toBe('narrow');
    expect(trackGroupOf(item('crossing', 'branch', 'narrow'))).toBe('narrow');
    expect(trackGroupOf(item('crossing', 'branch', 'main'))).toBe('main');
    expect(trackGroupOf(item('crossing', 'trunk', 'main'))).toBe('trunk');
    expect(trackGroupOf(item('curve', 'branch'))).toBe('branch');
  });

  it('keeps one key for one shape across the types', () => {
    for (const cls of ['narrow', 'branch'] as const) {
      expect(trackSlot(item('straight', cls))).toBe(0);
      expect(trackSlot(item('curve', cls))).toBe(1);
      expect(trackSlot(item('switch', cls))).toBe(2);
      expect(trackSlot(item('crossing', cls, cls))).toBe(3);
    }
    // key 5 is the crossing with another line
    expect(trackSlot(item('crossing', 'narrow', 'branch'))).toBe(4);
    expect(trackSlot(item('crossing', 'branch', 'main'))).toBe(4);
  });

  it('names a piece shortly inside its type', () => {
    expect(shortName(item('straight', 'narrow'), 'Straight')).toBe('Straight');
    expect(shortName(item('crossing', 'branch', 'branch'), 'Crossing')).toBe('Crossing');
    expect(shortName(item('crossing', 'narrow', 'branch'), 'Crossing')).toBe(
      'Crossing × Branch Line',
    );
    expect(shortName(item('crossing', 'branch', 'main'), 'Crossing')).toBe(
      'Crossing × Branch Line',
    );
  });
});

describe('stepping between types', () => {
  const all = () => true;

  it('steps to the next type that has pieces, both ways, wrapping', () => {
    expect(stepGroup(TRACK_GROUPS, 'narrow', 1, all)).toBe('branch');
    expect(stepGroup(TRACK_GROUPS, 'bridges', 1, all)).toBe('narrow');
    expect(stepGroup(TRACK_GROUPS, 'narrow', -1, all)).toBe('bridges');
    // a type with nothing to offer is passed over
    const noBranch = (g: string) => g !== 'branch';
    expect(stepGroup(TRACK_GROUPS, 'narrow', 1, noBranch)).toBe('main');
    expect(stepGroup(TRACK_GROUPS, 'main', -1, noBranch)).toBe('narrow');
    // nowhere else to go: stay
    expect(stepGroup(TRACK_GROUPS, 'branch', 1, (g) => g === 'branch')).toBe('branch');
    // an unknown current type starts from the first
    expect(stepGroup(TRACK_GROUPS, 'nowhere', 1, all)).toBe('narrow');
  });

  it('keeps the slot when the next type has it', () => {
    const wide = [
      { slot: 0, n: 'straight' },
      { slot: 1, n: 'curve' },
      { slot: 4, n: 'crossing' },
    ];
    expect(slotMate(wide, 1)?.n).toBe('curve');
    expect(slotMate(wide, 4)?.n).toBe('crossing');
  });

  it('falls back to the first piece when the slot is missing', () => {
    const bridges = [
      { slot: 0, n: 'wood' },
      { slot: 1, n: 'stone' },
    ];
    expect(slotMate(bridges, 3)?.n).toBe('wood');
    expect(slotMate([], 0)).toBeUndefined();
  });
});
