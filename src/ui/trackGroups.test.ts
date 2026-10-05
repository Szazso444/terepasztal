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
    expect(TRACK_GROUPS).toEqual(['narrow', 'regular', 'high_speed', 'bridges']);
  });

  it('gives every piece a type and a slot of its own in it', () => {
    const seen = new Set<string>();
    for (const it of TRACK_ITEMS) {
      const key = `${trackGroupOf(it)}:${trackSlot(it)}`;
      expect(seen.has(key), key).toBe(false);
      seen.add(key);
    }
    // each of the three track types fills keys 1 to 5
    for (const g of ['narrow', 'regular', 'high_speed'])
      for (let slot = 0; slot < 5; slot++)
        expect(seen.has(`${g}:${slot}`), `${g}:${slot}`).toBe(true);
  });

  it('puts a piece of two classes with the rarer one', () => {
    expect(trackGroupOf(item('crossing', 'regular', 'high_speed'))).toBe('high_speed');
    expect(trackGroupOf(item('crossing', 'narrow', 'regular'))).toBe('narrow');
    expect(trackGroupOf(item('transition', 'regular'))).toBe('regular');
    expect(trackGroupOf(item('curve', 'high_speed'))).toBe('high_speed');
  });

  it('keeps one key for one shape across the types', () => {
    for (const cls of ['narrow', 'regular', 'high_speed'] as const) {
      expect(trackSlot(item('straight', cls))).toBe(0);
      expect(trackSlot(item('curve', cls))).toBe(1);
      expect(trackSlot(item('switch', cls))).toBe(2);
      expect(trackSlot(item('crossing', cls, cls))).toBe(3);
    }
    // key 5 is the piece that joins the type to wide track
    expect(trackSlot(item('transition', 'regular'))).toBe(4);
    expect(trackSlot(item('crossing', 'regular', 'high_speed'))).toBe(4);
    expect(trackSlot(item('crossing', 'narrow', 'regular'))).toBe(4);
  });

  it('names a piece shortly inside its type', () => {
    expect(shortName(item('straight', 'narrow'), 'Straight')).toBe('Straight');
    expect(shortName(item('crossing', 'high_speed', 'high_speed'), 'Crossing')).toBe('Crossing');
    expect(shortName(item('crossing', 'regular', 'high_speed'), 'Crossing')).toBe(
      'Crossing × Wide',
    );
    expect(shortName(item('crossing', 'narrow', 'regular'), 'Crossing')).toBe('Crossing × Wide');
    expect(shortName(item('transition', 'regular'), 'Transition')).toBe('Transition');
  });
});

describe('stepping between types', () => {
  const all = () => true;

  it('steps to the next type that has pieces, both ways, wrapping', () => {
    expect(stepGroup(TRACK_GROUPS, 'narrow', 1, all)).toBe('regular');
    expect(stepGroup(TRACK_GROUPS, 'bridges', 1, all)).toBe('narrow');
    expect(stepGroup(TRACK_GROUPS, 'narrow', -1, all)).toBe('bridges');
    // a type with nothing to offer is passed over
    const noHighSpeed = (g: string) => g !== 'high_speed';
    expect(stepGroup(TRACK_GROUPS, 'regular', 1, noHighSpeed)).toBe('bridges');
    expect(stepGroup(TRACK_GROUPS, 'bridges', -1, noHighSpeed)).toBe('regular');
    // nowhere else to go: stay
    expect(stepGroup(TRACK_GROUPS, 'regular', 1, (g) => g === 'regular')).toBe('regular');
    // an unknown current type starts from the first
    expect(stepGroup(TRACK_GROUPS, 'nowhere', 1, all)).toBe('narrow');
  });

  it('keeps the slot when the next type has it', () => {
    const wide = [
      { slot: 0, n: 'straight' },
      { slot: 1, n: 'curve' },
      { slot: 4, n: 'transition' },
    ];
    expect(slotMate(wide, 1)?.n).toBe('curve');
    expect(slotMate(wide, 4)?.n).toBe('transition');
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
