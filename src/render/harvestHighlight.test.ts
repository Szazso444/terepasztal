import { describe, expect, it, vi } from 'vitest';
import { HALF_H, HALF_W, tileToWorld } from '../engine/iso';
import { HarvestCells, HARVEST_RADIUS, harvestBreakdown } from '../sim/stations';
import { emptyMap } from '../world/mapgen';
import { Terrain, type GameMap } from '../world/tiles';
import {
  HarvestHighlight,
  LIT_COLOR,
  OUTLINE,
  litTiles,
  type HarvestFocus,
  type LitTile,
} from './harvestHighlight';

/** One counted tile at each distance 1 to 4, east of a station at (10, 10). */
function fixture() {
  const cells = new HarvestCells();
  for (let d = 1; d <= 4; d++) {
    const i = cells.count++;
    cells.x[i] = 10 + d;
    cells.y[i] = 10;
    cells.d[i] = d;
    cells.weight[i] = 1 / (1 + d);
  }
  return { cells };
}

const key = (t: { x: number; y: number }) => `${t.x},${t.y}`;
const NONE: HarvestFocus = { tool: { kind: 'none' }, rot: 0, selected: null };
const farmTool = (rot = 0): HarvestFocus => ({
  tool: { kind: 'station', defId: 'farm' },
  rot,
  selected: null,
});
const selecting = (x: number, y: number, id = 'farm'): HarvestFocus => ({
  tool: { kind: 'none' },
  rot: 0,
  selected: { x, y, def: { id } },
});

/** A layer over `map` whose surface lifts every third column, recording each tile it is asked. */
function layer(map: GameMap = emptyMap(1, 24, 24, Terrain.Grass)) {
  const asked: { x: number; y: number }[] = [];
  const surface = (x: number, y: number) => {
    asked.push({ x, y });
    const p = tileToWorld(x, y);
    return { x: p.x, y: p.y - (x % 3 === 0 ? 10 : 0) };
  };
  const h = new HarvestHighlight(map, surface);
  const clears = vi.spyOn(h.layer, 'clear');
  return { h, map, asked, surface, draws: () => clears.mock.calls.length };
}

describe('litTiles', () => {
  it('lights the four distances at 0.48, 0.38, 0.33 and 0.30, in the cells order', () => {
    const lit = litTiles(fixture());
    expect(lit.map((t) => [t.x, t.y])).toEqual([
      [11, 10],
      [12, 10],
      [13, 10],
      [14, 10],
    ]);
    const want = [0.48, 0.38, 0.33, 0.3];
    lit.forEach((t, i) => expect(t.alpha, `d ${i + 1}`).toBeCloseTo(want[i], 12));
  });

  it('lights nothing for a station that harvests nothing', () => {
    expect(litTiles(null)).toEqual([]);
    const cells = new HarvestCells();
    expect(litTiles(harvestBreakdown(emptyMap(1, 9, 9), 4, 4, 'depot', 1, 'spring'))).toEqual([]);
    expect(litTiles({ cells })).toEqual([]);
  });

  it('lights each counted tile once, never the station, nearer ones brighter', () => {
    // a ragged patch, so some distances count fewer tiles than others
    const map = emptyMap(3, 20, 20, Terrain.Grass);
    for (let i = 0; i < map.terrain.length; i += 3) map.terrain[i] = Terrain.Forest;
    const sites = [
      { x: 9, y: 9 },
      { x: 0, y: 0 },
      { x: 19, y: 4 },
    ];
    for (const s of sites) {
      const b = harvestBreakdown(map, s.x, s.y, 'farm', 1, 'spring')!;
      const lit = litTiles(b);
      expect(lit.length).toBe(b.cells.count);
      expect(new Set(lit.map(key)).size).toBe(lit.length);
      expect(lit.map(key)).not.toContain(key(s));
      const at = (t: LitTile) => Math.max(Math.abs(t.x - s.x), Math.abs(t.y - s.y));
      for (const t of lit) {
        expect(at(t)).toBeGreaterThanOrEqual(1);
        expect(at(t)).toBeLessThanOrEqual(HARVEST_RADIUS);
        expect(map.terrain[t.y * map.w + t.x]).toBe(Terrain.Grass);
        expect(t.alpha).toBeCloseTo(0.18 + 0.6 / (1 + at(t)), 12);
      }
      for (const a of lit)
        for (const b2 of lit) if (at(a) < at(b2)) expect(a.alpha).toBeGreaterThan(b2.alpha);
    }
  });
});

describe('the harvest highlight layer', () => {
  it('draws only when the tile it lights changes, not every frame', () => {
    const { h, draws } = layer();
    h.canStand = () => true;
    const a = { x: 6, y: 6 };
    for (let f = 0; f < 30; f++) h.follow({ ...a }, farmTool(), 'spring');
    expect(draws()).toBe(1);
    for (let f = 0; f < 30; f++) h.follow({ x: 7, y: 6 }, farmTool(), 'spring');
    expect(draws()).toBe(2);
    // a turn of the tool alone moves nothing that is lit
    h.follow({ x: 7, y: 6 }, farmTool(1), 'spring');
    expect(draws()).toBe(2);
    for (let f = 0; f < 30; f++) h.follow(null, selecting(3, 3), 'spring');
    expect(draws()).toBe(3);
    for (let f = 0; f < 30; f++) h.follow({ x: f % 24, y: 2 }, selecting(3, 3), 'spring');
    expect(draws()).toBe(3);
    for (let f = 0; f < 30; f++) h.follow({ x: 1, y: 1 }, NONE, 'spring');
    expect(draws()).toBe(4);
    expect(h.layer.visible).toBe(false);
  });

  it('lights the hovered tile where a harvest station tool fits, and nothing where it does not', () => {
    const { h, asked } = layer();
    let fits = false;
    const calls: unknown[][] = [];
    h.canStand = (...args) => {
      calls.push(args);
      return fits;
    };
    h.follow({ x: 8, y: 8 }, farmTool(3), 'summer');
    expect(calls).toEqual([[8, 8, 'farm', 3]]);
    expect(h.layer.visible).toBe(false);
    expect(asked).toEqual([]);
    expect(h.outline).toBe(OUTLINE.refused);
    fits = true;
    h.follow({ x: 8, y: 8 }, farmTool(3), 'summer');
    expect(h.layer.visible).toBe(true);
    expect(h.outline).toBe(OUTLINE.fits);
    const want = litTiles(harvestBreakdown(emptyMap(1, 24, 24), 8, 8, 'farm', 1, 'summer'));
    expect(asked.map(key).sort()).toEqual(want.map(key).sort());
    // off the field the tool lights nothing
    h.follow(null, farmTool(3), 'summer');
    expect(h.layer.visible).toBe(false);
  });

  it('lights nothing for a station tool that harvests nothing', () => {
    const { h, asked } = layer();
    h.canStand = () => true;
    h.follow(
      { x: 8, y: 8 },
      { tool: { kind: 'station', defId: 'depot' }, rot: 0, selected: null },
      'spring',
    );
    expect(h.layer.visible).toBe(false);
    expect(asked).toEqual([]);
    expect(h.outline).toBe(OUTLINE.fits);
  });

  it('lights a selected station until it is deselected, whatever the pointer does', () => {
    const { h, asked } = layer();
    h.follow(null, selecting(12, 5, 'lumber'), 'autumn');
    expect(h.layer.visible).toBe(false); // a grass map has no forest to count
    const map = emptyMap(2, 24, 24, Terrain.Forest);
    const lit = layer(map);
    lit.h.follow({ x: 0, y: 0 }, selecting(12, 5, 'lumber'), 'autumn');
    expect(lit.h.layer.visible).toBe(true);
    expect(lit.asked.length).toBe(80);
    expect(lit.asked.map(key)).not.toContain('12,5');
    expect(lit.h.outline).toBe(OUTLINE.plain);
    // Escape or a right click with no tool deselects
    lit.h.follow({ x: 0, y: 0 }, NONE, 'autumn');
    expect(lit.h.layer.visible).toBe(false);
    expect(asked).toEqual([]);
  });

  it('keeps the lit tiles on a held placing tile while the outline follows the pointer', () => {
    const { h, asked, draws } = layer();
    h.canStand = (x) => x < 10;
    const held = { x: 5, y: 5 };
    h.follow({ x: 5, y: 5 }, farmTool(), 'spring', held);
    expect(h.outline).toBe(OUTLINE.fits);
    const first = asked.map(key);
    for (let x = 6; x < 16; x++) {
      h.follow({ x, y: 7 }, farmTool(), 'spring', held);
      expect(h.outline).toBe(x < 10 ? OUTLINE.fits : OUTLINE.refused);
    }
    expect(draws()).toBe(1);
    expect(asked.map(key)).toEqual(first);
    expect(h.layer.visible).toBe(true);
  });

  it('draws each lit tile as a flat diamond on its own top face', () => {
    const { h, surface } = layer(emptyMap(1, 9, 9, Terrain.Grass));
    h.follow(null, selecting(4, 4), 'spring');
    const pts = litTiles(harvestBreakdown(emptyMap(1, 9, 9), 4, 4, 'farm', 1, 'spring')).map((t) =>
      surface(t.x, t.y),
    );
    const b = h.layer.getLocalBounds();
    expect(b.minX).toBeCloseTo(Math.min(...pts.map((p) => p.x)) - HALF_W, 6);
    expect(b.maxX).toBeCloseTo(Math.max(...pts.map((p) => p.x)) + HALF_W, 6);
    expect(b.minY).toBeCloseTo(Math.min(...pts.map((p) => p.y)) - HALF_H, 6);
    expect(b.maxY).toBeCloseTo(Math.max(...pts.map((p) => p.y)) + HALF_H, 6);
    expect(LIT_COLOR).toBe(0x66ccd6);
  });

  it('draws again on refresh only while something is lit', () => {
    const { h, draws } = layer();
    h.refresh();
    expect(draws()).toBe(0);
    h.follow(null, selecting(4, 4), 'spring');
    h.refresh();
    expect(draws()).toBe(2);
    expect(h.layer.visible).toBe(true);
  });
});
