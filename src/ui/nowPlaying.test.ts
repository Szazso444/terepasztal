import { describe, expect, it } from 'vitest';
import { titleRoll } from './nowPlaying';

describe('the rolling title', () => {
  it('stands still when it fits, to the pixel', () => {
    expect(titleRoll(100, 120)).toBeNull();
    expect(titleRoll(120, 120)).toBeNull();
  });

  it('rolls just far enough to show its end', () => {
    expect(titleRoll(121, 120)?.distance).toBe(1);
    expect(titleRoll(200, 120)?.distance).toBe(80);
  });

  it('stands still when its box is not laid out: the title is dropped below 1280', () => {
    expect(titleRoll(150, 0)).toBeNull();
    expect(titleRoll(0, 0)).toBeNull();
  });

  it('rolls slowly however little or much there is to show', () => {
    for (const text of [121, 140, 200, 400, 1000]) {
      const roll = titleRoll(text, 120)!;
      // the speed while it moves, over the part of the time it moves (@keyframes np-roll)
      expect(roll.distance / (roll.seconds * 0.6), String(text)).toBeLessThanOrEqual(16);
      expect(roll.seconds, String(text)).toBeGreaterThanOrEqual(7);
    }
  });

  it('takes longer for a longer title once past the shortest roll', () => {
    expect(titleRoll(1000, 120)!.seconds).toBeGreaterThan(titleRoll(400, 120)!.seconds);
  });
});
