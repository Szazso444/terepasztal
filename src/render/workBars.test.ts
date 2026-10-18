import { describe, expect, it } from 'vitest';
import { Container } from 'pixi.js';
import { WorkBars } from './workBars';

const flat = (x: number, y: number) => ({ x: (x - y) * 32, y: (x + y) * 16 });
const work = (x: number, progress: number) => ({ x, y: 0, w: 1, h: 1, progress });

describe('work bars', () => {
  it('keep one bar per work, reuse them between calls and hide the ones not needed', () => {
    const layer = new Container();
    const bars = new WorkBars(layer, flat);
    bars.sync([work(0, 0.2), work(4, 0.5), work(8, 0.9)]);
    const first = [...layer.children];
    expect(first.length).toBe(3);
    const same = () =>
      layer.children.length === first.length && layer.children.every((c, i) => c === first[i]);
    bars.sync([work(4, 0.6)]);
    expect(same()).toBe(true);
    expect(first.map((g) => g.visible)).toEqual([true, false, false]);
    bars.sync([work(0, 0.3), work(4, 0.7)]);
    expect(same()).toBe(true);
    expect(first.map((g) => g.visible)).toEqual([true, true, false]);
    bars.sync([]);
    expect(same()).toBe(true);
    expect(first.some((g) => g.visible)).toBe(false);
  });

  it('stand each bar over its building, centred on the footprint', () => {
    const layer = new Container();
    const bars = new WorkBars(layer, flat);
    bars.sync([work(4, 0.5), { x: 6, y: 2, w: 2, h: 2, progress: 1.5 }]);
    const [small, big] = layer.children;
    const ground = flat(4, 0);
    expect(small.x).toBe(ground.x);
    expect(small.y).toBeLessThan(ground.y - 40);
    const centre = flat(6.5, 2.5);
    expect(big.x).toBe(centre.x);
    // a bigger footprint is taken to be a taller building
    expect(centre.y - big.y).toBeGreaterThan(ground.y - small.y);
  });

  it('stand over the middle of a footprint of several tiles, turned either way', () => {
    const layer = new Container();
    const bars = new WorkBars(layer, flat);
    bars.sync([
      { x: 10, y: 10, w: 3, h: 2, progress: 0.5 },
      { x: 20, y: 10, w: 2, h: 3, progress: 0.5 },
    ]);
    const [wide, deep] = layer.children;
    expect(wide.x).toBe(flat(11, 10.5).x);
    expect(deep.x).toBe(flat(20.5, 11).x);
    // the bar is as high above the middle of the footprint's ground for either turn
    expect(flat(11, 10.5).y - wide.y).toBe(flat(20.5, 11).y - deep.y);
  });
});
