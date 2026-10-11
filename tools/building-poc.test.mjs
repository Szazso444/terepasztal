import { describe, it, expect } from 'vitest';
import { Site } from '../scratchpad/building-poc/state.mjs';
describe('building placement POC', () => {
  it('preserves the selected library asset through save/load and rotation', () => {
    const s = new Site();
    s.place(2, 2, 2, 0, 'stations-farm');
    const restored = Site.restore(s.serialize());
    restored.rotate(2, 2);
    expect(restored.buildings[0].asset).toBe('stations-farm');
    expect(restored.buildings[0].rotation).toBe(1);
  });
  it('blocks the full footprint and rolls back failed rotation', () => {
    const s = new Site();
    expect(s.place(2, 2, 2, 0)).toBe(true);
    expect(s.place(3, 2, 1, 0)).toBe(false);
    s.track(2, 3);
    expect(s.rotate(3, 2)).toBe(false);
    expect(s.at(3, 2).rotation).toBe(0);
    s.remove(2, 3);
    expect(s.rotate(3, 2)).toBe(true);
    expect(s.at(3, 2)).toBeUndefined();
    expect(s.at(2, 3)).toBeDefined();
  });
  it('finds track access at either cell and removes the whole building from either cell', () => {
    const s = new Site();
    s.place(2, 2, 2, 0);
    s.track(4, 2);
    expect(s.served(s.buildings[0])).toBe(true);
    s.remove(4, 2);
    expect(s.served(s.buildings[0])).toBe(false);
    s.remove(3, 2);
    expect(s.buildings).toHaveLength(0);
  });
  it('roundtrips layouts and rejects overlapping saved content', () => {
    const s = new Site();
    s.place(2, 2, 2, 3);
    s.track(0, 0);
    expect(Site.restore(s.serialize()).serialize()).toEqual(s.serialize());
    const data = s.serialize();
    data.buildings.push({ x: 2, y: 3, tiles: 1, rotation: 0 });
    expect(() => Site.restore(data)).toThrow();
  });
});
