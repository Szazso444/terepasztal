import { describe, it, expect } from 'vitest';
import { TrackGraph } from '../world/track';
import { Traffic } from './traffic';
import type { Builder } from './build';

/** Traffic only reads `stations` off the builder, to find platform tiles. */
function trafficOn(
  track: TrackGraph,
  stations: { gateTiles(): { x: number; y: number }[] }[] = [],
) {
  const t = new Traffic(track, { stations } as unknown as Builder);
  t.rebuildSections();
  return t;
}

/** E–W straights along row `y`, x0 to x1 inclusive. */
function line(g: TrackGraph, y: number, x0: number, x1: number) {
  for (let x = x0; x <= x1; x++) g.place(x, y, 'straight', 1);
}

const key = (g: TrackGraph, x: number, y: number) => y * g.w + x;

describe('sections', () => {
  it('chains plain track between its dead ends', () => {
    const g = new TrackGraph(16, 16);
    line(g, 5, 1, 8);
    const t = trafficOn(g);

    // Both ends have a single connection, so they stand alone as nodes.
    expect(t.sectionOf(1, 5)).toBeLessThan(0);
    expect(t.sectionOf(8, 5)).toBeLessThan(0);

    const id = t.sectionOf(4, 5);
    expect(id).toBeGreaterThan(0);
    for (let x = 2; x <= 7; x++) expect(t.sectionOf(x, 5)).toBe(id);
    expect(t.tilesOfSection(id).sort((a, b) => a - b)).toEqual(
      [2, 3, 4, 5, 6, 7].map((x) => key(g, x, 5)),
    );
    expect(t.sectionLength(4, 5)).toBe(6);
    expect(t.sectionLength(1, 5)).toBe(1);
  });

  it('cuts the chain at a switch', () => {
    const g = new TrackGraph(16, 16);
    line(g, 5, 1, 8);
    // Rotation 1 puts the through road E–W, so the line stays joined across it.
    g.place(5, 5, 'switch', 1);
    const t = trafficOn(g);

    expect(t.sectionOf(5, 5)).toBeLessThan(0);
    const left = t.sectionOf(3, 5);
    const right = t.sectionOf(6, 5);
    expect(left).toBeGreaterThan(0);
    expect(right).toBeGreaterThan(0);
    expect(left).not.toBe(right);
    expect(t.tilesOfSection(left)).toHaveLength(3); // 2, 3, 4
    expect(t.tilesOfSection(right)).toHaveLength(2); // 6, 7
  });

  it('stands a platform tile on its own', () => {
    const g = new TrackGraph(16, 16);
    line(g, 5, 1, 8);
    const t = trafficOn(g, [{ gateTiles: () => [{ x: 4, y: 5 }] }]);

    expect(t.sectionOf(4, 5)).toBeLessThan(0);
    expect(t.sectionOf(3, 5)).not.toBe(t.sectionOf(5, 5));
    expect(t.sectionOf(3, 5)).toBeGreaterThan(0);
    expect(t.sectionOf(5, 5)).toBeGreaterThan(0);
  });

  it('ignores a station gate with no track under it', () => {
    const g = new TrackGraph(16, 16);
    line(g, 5, 1, 8);
    const t = trafficOn(g, [{ gateTiles: () => [{ x: 4, y: 9 }] }]);
    expect(t.sectionOf(4, 5)).toBe(t.sectionOf(3, 5));
  });

  it('keeps two lines that never touch apart', () => {
    const g = new TrackGraph(16, 16);
    line(g, 2, 1, 6);
    line(g, 9, 1, 6);
    const t = trafficOn(g);
    expect(t.sectionOf(3, 2)).not.toBe(t.sectionOf(3, 9));
  });

  it('gives every multi-tile member its own node id', () => {
    const g = new TrackGraph(16, 16);
    const tiles = g.place(6, 6, 'curve', 0, 'high_speed');
    const t = trafficOn(g);
    for (const tile of tiles) expect(t.sectionOf(tile.x, tile.y)).toBeLessThan(0);
  });

  it('answers for bare tiles that carry no track at all', () => {
    const g = new TrackGraph(16, 16);
    const t = trafficOn(g);
    expect(t.sectionOf(3, 3)).toBe(-(key(g, 3, 3) + 1));
    expect(t.sectionLength(3, 3)).toBe(1);
    expect(t.tilesOfSection(t.sectionOf(3, 3))).toEqual([]);
  });

  it('rebuilds after the track changes', () => {
    const g = new TrackGraph(16, 16);
    line(g, 5, 1, 8);
    const t = trafficOn(g);
    const before = t.tilesOfSection(t.sectionOf(4, 5)).length;

    g.removeAt(5, 5);
    t.rebuildSections();
    const after = t.tilesOfSection(t.sectionOf(3, 5)).length;
    expect(before).toBe(6);
    // 2 and 3 remain plain; 4 became a dead end.
    expect(after).toBe(2);
    expect(t.sectionOf(4, 5)).toBeLessThan(0);
  });
});

describe('claims', () => {
  it('reports a tile as claimed only for other trains', () => {
    const g = new TrackGraph(16, 16);
    line(g, 5, 1, 8);
    const t = trafficOn(g);

    expect(t.claimedBy(3, 5, 1)).toBeNull();
    t.claims.set(key(g, 3, 5), 1);
    expect(t.claimedBy(3, 5, 1)).toBeNull();
    expect(t.claimedBy(3, 5, 2)).toBe(1);
  });
});
