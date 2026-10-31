import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { hardenAlpha, narrowFit, toneTimber } from './bridge-kit.mjs';

const pixels = (...rgba) => {
  const p = new PNG({ width: rgba.length, height: 1 });
  rgba.forEach((c, i) => p.data.set(c, i * 4));
  return p;
};

describe('the narrow case of the bridge kit', () => {
  it('sets alpha from half up, so a surface is solid and the background clear', () => {
    const p = hardenAlpha(pixels([9, 9, 9, 251], [9, 9, 9, 128], [9, 9, 9, 127], [9, 9, 9, 0]));
    expect([...p.data].filter((_, i) => i % 4 === 3)).toEqual([255, 255, 0, 0]);
  });

  it('scales a return of another size with its guide, by one factor', () => {
    const box = { left: 128, right: 896, top: 245, bottom: 779 };
    expect(narrowFit(box, box, 1024, 15, [512, 512])).toEqual({ s: 15, ax: 512, ay: 512 });
    const larger = { left: 165, right: 1088, top: 310, bottom: 992 };
    const f = narrowFit(larger, box, 1254, 15, [512, 512]);
    expect(f.s).toBeCloseTo((15 * 1254) / 1024);
    expect(f.ax).toBeCloseTo(627, -1);
  });

  it('moves the anchor by the painting box, never its size', () => {
    const guide = { left: 100, right: 300, top: 100, bottom: 200 },
      moved = { left: 110, right: 310, top: 90, bottom: 190 },
      f = narrowFit(moved, guide, 1024, 8, [200, 150]);
    expect([f.ax, f.ay]).toEqual([210, 140]);
  });

  it('tones timber towards the sleepers and keeps its light and shade', () => {
    const lit = [235, 165, 130, 255],
      shade = [150, 100, 75, 255],
      p = toneTimber(pixels(lit, shade));
    const blue = (i) => p.data[i * 4 + 2],
      red = (i) => p.data[i * 4];
    expect(blue(0) / red(0)).toBeLessThan(lit[2] / lit[0]);
    expect(red(0)).toBeGreaterThan(red(1));
    expect(p.data[3]).toBe(255);
  });
});
