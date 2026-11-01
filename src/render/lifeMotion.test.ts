import { describe, expect, it } from 'vitest';
import {
  PLUME_PUFFS,
  TREE_SWAY,
  cranePhase,
  ease,
  gustAt,
  lot,
  millGust,
  millPhase,
  millRev,
  millSpeed,
  pinnedAlpha,
  plumeLife,
  plumePuff,
  treeLean,
} from './lifeMotion';

const EAST = { x: 1, y: 0 };

describe('the gust at a point', () => {
  it('is nothing in a calm', () => {
    expect(gustAt(0, EAST, 100, 40, 12)).toBe(0);
  });

  it('stays in 0..1, differs from place to place, and travels', () => {
    const seen = new Set<number>();
    for (let t = 0; t < 40; t += 0.37) {
      const g = gustAt(0.7, EAST, 200, 80, t);
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThanOrEqual(1);
      seen.add(Math.round(g * 10));
    }
    expect(seen.size).toBeGreaterThan(4);
    expect(gustAt(0.7, EAST, 200, 80, 3)).not.toBeCloseTo(gustAt(0.7, EAST, 900, 300, 3), 2);
  });

  it('averages about a half, the gust the table of mean speeds stands for', () => {
    let sum = 0;
    let n = 0;
    for (let t = 0; t < 400; t += 0.13, n++) sum += gustAt(0.5, EAST, 300, 120, t);
    expect(sum / n).toBeGreaterThan(0.42);
    expect(sum / n).toBeLessThan(0.58);
  });
});

describe('the sails', () => {
  it('stand still in a calm and speed up with the wind', () => {
    expect(millRev(0, 0.8)).toBe(0);
    let last = -1;
    for (let s = 0; s <= 1.0001; s += 0.05) {
      const now = millSpeed(s);
      expect(now).toBeGreaterThanOrEqual(last);
      last = now;
    }
  });

  it('turn at the table in a mean gust', () => {
    expect(millRev(0.35, 0.5)).toBeCloseTo(0.1, 9);
    expect(millRev(0.7, 0.5)).toBeCloseTo(0.17, 9);
    expect(millRev(1, 0.5)).toBeCloseTo(0.24, 9);
    expect(millSpeed(0.175)).toBeCloseTo(0.05, 9);
  });

  it('take a lull down to 0.65 and a gust up to 1.35', () => {
    expect(millGust(0)).toBeCloseTo(0.65, 9);
    expect(millGust(1)).toBeCloseTo(1.35, 9);
  });

  it('advance by 2 pi rev dt and wrap', () => {
    expect(millPhase(0.5, 0.1, 2)).toBeCloseTo(0.5 + 2 * Math.PI * 0.2, 9);
    const full = millPhase(1, 0.25, 4);
    expect(full).toBeCloseTo(1, 9);
    expect(millPhase(0, 0, 3)).toBe(0);
    expect(millPhase(6.2, 0.2, 1)).toBeLessThan(2 * Math.PI);
  });

  it('coast toward what the wind asks for', () => {
    const half = ease(0, 1, Math.LN2 * 1.8, 1.8);
    expect(half).toBeCloseTo(0.5, 9);
    expect(ease(0.4, 0.4, 1, 1.8)).toBeCloseTo(0.4, 12);
  });
});

describe('a plume', () => {
  it('climbs without a step back, at every wind', () => {
    for (const s of [0, 0.35, 0.7, 1]) {
      let last = -1;
      for (let a = 0; a <= 1.0001; a += 0.02) {
        const { rise } = plumePuff(a, s, 0.5);
        expect(rise).toBeGreaterThan(last);
        last = rise;
      }
    }
  });

  it('is gone at both ends of a puff, and nothing downwind in a calm', () => {
    for (const s of [0, 0.5, 1]) {
      expect(plumePuff(0, s, 0.5).alpha).toBe(0);
      expect(plumePuff(1, s, 0.5).alpha).toBe(0);
    }
    for (let a = 0; a <= 1; a += 0.1) {
      expect(plumePuff(a, 0, 0).drift).toBe(0);
      expect(plumePuff(a, 0, 0).stretch).toBe(1);
    }
  });

  it('rises about 2.7 storeys in a calm, a works chimney higher, and lies down in a storm', () => {
    expect(plumePuff(1, 0, 0).rise).toBeCloseTo(42, 9);
    expect(plumePuff(1, 0, 0, true).rise).toBeCloseTo(48, 9);
    expect(plumePuff(1, 1, 0).rise).toBeCloseTo(42 * 0.3, 9);
  });

  it('bends further downwind the harder it blows, and more in a gust', () => {
    expect(plumePuff(1, 0.7, 0.5).drift).toBeGreaterThan(plumePuff(1, 0.35, 0.5).drift);
    expect(plumePuff(1, 0.7, 1).drift).toBeGreaterThan(plumePuff(1, 0.7, 0).drift);
    expect(plumePuff(0.5, 0.7, 0.5).drift).toBeLessThan(plumePuff(1, 0.7, 0.5).drift / 2);
  });

  it('has a thicker puff from a works chimney, and a short life in a storm', () => {
    expect(plumePuff(0.5, 0.2, 0.5, true).radius).toBeGreaterThan(plumePuff(0.5, 0.2, 0.5).radius);
    expect(plumePuff(0.5, 0.2, 0.5, true).alpha).toBeGreaterThan(plumePuff(0.5, 0.2, 0.5).alpha);
    expect(plumeLife(1, false)).toBeCloseTo(9.5 * 0.7, 9);
    expect(plumeLife(0, true, 0.85)).toBeCloseTo(10, 9);
  });

  it('is closed at the mouth by a pinned puff, and no puff is out of step with it', () => {
    expect(pinnedAlpha(0, false)).toBeGreaterThan(plumePuff(1 / PLUME_PUFFS, 0, 0).alpha * 0.9);
  });
});

describe('the crane load', () => {
  it('hangs still in a calm', () => {
    for (let t = 0; t < 10; t += 0.7) expect(cranePhase(t, 0, 0)).toBe(0);
  });

  it('never swings past its bound, and more in a gust', () => {
    let most = 0;
    for (let t = 0; t < 20; t += 0.05)
      for (const s of [0.35, 1])
        for (const g of [0, 0.5, 1]) {
          const a = cranePhase(t, s, g);
          expect(Math.abs(a)).toBeLessThanOrEqual(0.17 + 1e-9);
          most = Math.max(most, Math.abs(a));
        }
    expect(most).toBeGreaterThan(0.15);
    expect(cranePhase(0, 0.7, 1)).toBeGreaterThan(cranePhase(0, 0.7, 0));
  });

  it('leans downwind whichever way that is', () => {
    const lean = (windX: number) => {
      let sum = 0;
      for (let t = 0; t < 26; t += 0.1) sum += cranePhase(t, 0.7, 0.5, windX);
      return sum;
    };
    expect(lean(1)).toBeGreaterThan(0);
    expect(lean(-1)).toBeLessThan(0);
  });
});

describe('a tree', () => {
  const TREE = { amp: 0.9, om: 3, ph: 1.2 };

  it('stands in a calm', () => {
    for (let t = 0; t < 20; t += 0.7) expect(treeLean(TREE, 0, 0, t)).toBe(0);
  });

  it('leans further the harder it blows, and more in a gust', () => {
    const mean = (s: number, gust: number) => {
      let sum = 0;
      for (let t = 0; t < 200; t += 0.05) sum += treeLean(TREE, s, gust, t);
      return sum / 4000;
    };
    expect(mean(0.7, 0.5)).toBeGreaterThan(mean(0.35, 0.5));
    expect(mean(0.7, 1)).toBeGreaterThan(mean(0.7, 0));
    expect(mean(0.35, 0.5)).toBeGreaterThan(0);
  });

  it('never leans past about a sixth of its height, the loosest kind in the worst gust', () => {
    const loosest = { amp: 1.15 * 1.15, om: 3, ph: 0 };
    for (let t = 0; t < 60; t += 0.03)
      expect(Math.abs(treeLean(loosest, 1, 1, t))).toBeLessThan(0.17);
  });

  it('swings about its lean, back and forth', () => {
    const seen: number[] = [];
    for (let t = 0; t < 20; t += 0.1) seen.push(treeLean(TREE, 0.35, 0.5, t));
    expect(Math.max(...seen)).toBeGreaterThan(Math.min(...seen) + 0.01);
  });

  it('keeps the demo table: conifers stiffer and quicker than broadleaves, dead trees least', () => {
    expect(TREE_SWAY.spruce[0]).toBeLessThan(TREE_SWAY.oak[0]);
    expect(TREE_SWAY.spruce[1]).toBeGreaterThan(TREE_SWAY.oak[1]);
    expect(TREE_SWAY.deadtree[0]).toBe(0.25);
    expect(TREE_SWAY.rock).toBeUndefined();
  });
});

describe('a lot', () => {
  it('is the same for the same numbers, in 0..1, and about evenly spread', () => {
    expect(lot(3, 4, 5)).toBe(lot(3, 4, 5));
    let below = 0;
    for (let i = 0; i < 2000; i++) {
      const v = lot(i * 13, i * 7 + 1, 470);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      if (v < 1 / 3) below++;
    }
    expect(below).toBeGreaterThan(560);
    expect(below).toBeLessThan(780);
  });
});
