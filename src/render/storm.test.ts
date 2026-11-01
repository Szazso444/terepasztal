import { describe, expect, it, vi } from 'vitest';
import { Storm, boltPoints, flashColour, flashLevel, flashTime, overcastColour } from './storm';

describe('the lightning', () => {
  it('comes at most once in several seconds, the same on every run', () => {
    for (let k = 0; k < 40; k++) {
      const gap = flashTime(k + 1) - flashTime(k);
      expect(gap).toBeGreaterThanOrEqual(6.5);
      expect(gap).toBeLessThanOrEqual(14.5);
    }
    expect(flashTime(7)).toBe(flashTime(7));
  });

  it('brightens once, with no flicker', () => {
    let peak = 0;
    let falling = false;
    let last = 0;
    for (let u = 0; u < 0.5; u += 0.01) {
      const l = flashLevel(u);
      if (l < last) falling = true;
      if (falling) expect(l).toBeLessThanOrEqual(last);
      peak = Math.max(peak, l);
      last = l;
    }
    expect(peak).toBeGreaterThan(0.9);
    expect(flashLevel(-0.1)).toBe(0);
    expect(flashLevel(0.4)).toBe(0);
  });

  it('stays in the view, its foot below its top', () => {
    for (let k = 0; k < 30; k++) {
      const points = boltPoints(k, 1280, 800);
      expect(points).toHaveLength(10);
      expect(points[9][1]).toBeGreaterThan(points[0][1]);
      for (const [x] of points) {
        expect(x).toBeGreaterThan(0);
        expect(x).toBeLessThan(1280);
      }
    }
  });
});

describe('the light of a storm', () => {
  it('leaves the picture as it is at no storm, and darkens and cools it at a full one', () => {
    expect(overcastColour(0)).toBe(0xffffff);
    const full = overcastColour(1),
      [r, g, b] = [full >> 16, (full >> 8) & 255, full & 255];
    expect(r).toBeLessThan(g);
    expect(g).toBeLessThan(b);
    expect(b).toBeLessThan(255);
    expect(flashColour(0)).toBe(0);
  });
});

describe('a storm', () => {
  const run = (storm: Storm, seconds: number, on = true) => {
    let flashes = 0;
    let was = false;
    for (let t = 0; t < seconds; t += 1 / 30) {
      storm.update(1 / 30, on, 1280, 800);
      if (storm.flash.visible && !was) flashes++;
      was = storm.flash.visible;
    }
    return flashes;
  };

  it('comes on, flashes now and then, and goes', () => {
    const storm = new Storm();
    expect(run(storm, 60)).toBeGreaterThan(3);
    expect(storm.shade.visible).toBe(true);
    run(storm, 20, false);
    expect(storm.shade.visible).toBe(false);
    expect(storm.flash.visible).toBe(false);
  });

  it('draws nothing on a day without one', () => {
    const storm = new Storm();
    expect(run(storm, 30, false)).toBe(0);
    expect(storm.shade.visible).toBe(false);
  });

  it('never flashes for a player who asked for less motion', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    try {
      const storm = new Storm();
      expect(run(storm, 60)).toBe(0);
      expect(storm.shade.visible).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does not move on while the game is paused', () => {
    const storm = new Storm();
    storm.update(0, true, 1280, 800);
    expect(storm.flash.visible).toBe(false);
  });
});
