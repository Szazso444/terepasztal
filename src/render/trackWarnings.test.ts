import { describe, expect, it } from 'vitest';
import { Container } from 'pixi.js';
import { TrackWarnings } from './trackWarnings';

const flat = (x: number, y: number) => ({ x: (x - y) * 32, y: (x + y) * 16 });

describe('track warnings', () => {
  it('put one mark at each place, over its ground', () => {
    const layer = new Container();
    new TrackWarnings(layer, flat).sync([
      { x: 4, y: 2 },
      { x: 6.5, y: 2.5 },
    ]);
    expect(layer.children).toHaveLength(2);
    const [a, b] = layer.children;
    expect(a.x).toBe(flat(4, 2).x);
    expect(a.y).toBeLessThan(flat(4, 2).y);
    // a multi-tile piece's centre may fall between tiles
    expect(b.x).toBe(flat(6.5, 2.5).x);
  });

  it('keep the marks already made, add the new and remove the mended', () => {
    const layer = new Container();
    const warnings = new TrackWarnings(layer, flat);
    warnings.sync([
      { x: 1, y: 1 },
      { x: 3, y: 1 },
    ]);
    const [first, second] = [...layer.children];
    warnings.sync([
      { x: 3, y: 1 },
      { x: 5, y: 1 },
    ]);
    expect(warnings.count).toBe(2);
    expect(layer.children).toHaveLength(2);
    expect(layer.children).toContain(second);
    expect(layer.children).not.toContain(first);
    // an unchanged call makes and removes nothing
    const now = [...layer.children];
    warnings.sync([
      { x: 3, y: 1 },
      { x: 5, y: 1 },
    ]);
    expect([...layer.children]).toEqual(now);
    warnings.sync([]);
    expect(layer.children).toHaveLength(0);
    expect(warnings.count).toBe(0);
  });
});
