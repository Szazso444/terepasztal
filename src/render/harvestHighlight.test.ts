import { describe, expect, it, vi } from 'vitest';
import type { FillInstruction, Graphics } from 'pixi.js';
import { HALF_H, HALF_W, tileToWorld } from '../engine/iso';
import { hash2, hashString, type Rng } from '../engine/rng';
import {
  HarvestCells,
  HARVEST_CELLS_MAX,
  HARVEST_RADIUS,
  STATION_DEFS,
  harvestBreakdown,
  stationDef,
  stationFootprint,
} from '../sim/stations';
import { rules } from '../sim/rules';
import { SEASONS, type Season } from '../sim/weather';
import { forAll, shrinkArray, shrinkInt } from '../testing/property';
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
const selecting = (x: number, y: number, id = 'farm', rot = 0): HarvestFocus => ({
  tool: { kind: 'none' },
  rot: 0,
  selected: { x, y, def: { id }, rot },
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
      // the farm halt takes two tiles (1 x 2): its corner and the one below it
      const at = (t: LitTile) =>
        Math.max(Math.abs(t.x - s.x), Math.max(0, s.y - t.y, t.y - (s.y + 1)));
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
    // the farm halt takes two tiles: a quarter turn changes what it counts, so it is drawn again
    for (let f = 0; f < 30; f++) h.follow({ x: 7, y: 6 }, farmTool(1), 'spring');
    expect(draws()).toBe(3);
    // a half turn covers the same tiles, and moves nothing that is lit
    h.follow({ x: 7, y: 6 }, farmTool(3), 'spring');
    expect(draws()).toBe(3);
    for (let f = 0; f < 30; f++) h.follow(null, selecting(3, 3), 'spring');
    expect(draws()).toBe(4);
    // a selected halt is lit as it is turned
    for (let f = 0; f < 30; f++) h.follow(null, selecting(3, 3, 'farm', 1), 'spring');
    expect(draws()).toBe(5);
    for (let f = 0; f < 30; f++)
      h.follow({ x: f % 24, y: 2 }, selecting(3, 3, 'farm', 1), 'spring');
    expect(draws()).toBe(5);
    for (let f = 0; f < 30; f++) h.follow({ x: 1, y: 1 }, NONE, 'spring');
    expect(draws()).toBe(6);
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
    const want = litTiles(
      harvestBreakdown(emptyMap(1, 24, 24), 8, 8, 'farm', 1, 'summer', rules, undefined, 3),
    );
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

// ---------------------------------------------------------------- properties
// What the layer lights for any map, tool, selection and pointer, checked against an obvious
// oracle and read back from the Graphics it drew rather than from what it says it drew.

/** The issue's colours: the fill, and the hover outline with no tool, where a station fits and not. */
const CYAN = 0x66ccd6;
const CREAM = 0xe4d5b5;
const AMBER = 0xe8aa48;
const RED = 0xe0675b;

/** Every station kind, the ones that harvest nothing among them, and the ones that harvest. */
const STATION_IDS = STATION_DEFS.map((d) => d.id);
const HARVESTERS = STATION_DEFS.filter((d) => d.terrain).map((d) => d.id);

/** The ground each harvest terrain counts; rock counts hills as well. */
const COUNTS: Record<string, readonly number[]> = {
  grass: [Terrain.Grass],
  forest: [Terrain.Forest],
  rock: [Terrain.Rock, Terrain.Hill],
  sand: [Terrain.Sand],
  water: [Terrain.Water],
};

/**
 * The obvious picture: every tile of the map within HARVEST_RADIUS of the footprint of a `defId`
 * with its corner on (x, y) turned to `rot`, but the footprint's own, whose ground the kind
 * counts, lit at 0.18 + 0.6 / (1 + d), d being the distance to the footprint's nearest tile;
 * nothing for a kind that harvests nothing.
 */
function oracle(map: GameMap, x: number, y: number, defId: string, rot = 0): LitTile[] {
  const want = stationDef(defId).terrain;
  const out: LitTile[] = [];
  if (!want) return out;
  const feet = stationFootprint(defId, x, y, rot);
  for (let ty = 0; ty < map.h; ty++)
    for (let tx = 0; tx < map.w; tx++) {
      const d = Math.min(...feet.map((t) => Math.max(Math.abs(tx - t.x), Math.abs(ty - t.y))));
      if (d === 0 || d > HARVEST_RADIUS || !COUNTS[want].includes(map.terrain[ty * map.w + tx]))
        continue;
      out.push({ x: tx, y: ty, alpha: 0.18 + 0.6 / (1 + d) });
    }
  return out;
}

/** A small map: each tile's terrain, and how far its top face is lifted, in px. */
interface Ground {
  w: number;
  h: number;
  terrain: number[];
  lift: number[];
}

function ground(rng: Rng, side = 14): Ground {
  const w = rng.int(1, side);
  const h = rng.int(1, side);
  // one terrain is common, so a site may be dense or sparse; Mountain (6) counts for nothing
  const common = rng.int(0, 6);
  const terrain = Array.from({ length: w * h }, () => (rng.chance(0.5) ? common : rng.int(0, 6)));
  // top faces a step or two up or a little down, whatever the terrain; lifts differ by less than
  // a tile's height, so no two tiles' diamonds share a centre
  const lift = Array.from({ length: w * h }, () => rng.pick([0, 0, -10, -20, 4]));
  return { w, h, terrain, lift };
}

function mapOf(g: Ground): GameMap {
  const map = emptyMap(1, g.w, g.h);
  map.terrain.set(g.terrain);
  return map;
}

/** Each tile's top face: its iso point lifted by `lift`, read at the time it is asked. */
function surfaceOf(g: { w: number; h: number; lift: readonly number[] }) {
  return (x: number, y: number) => {
    const p = tileToWorld(x, y);
    const on = x >= 0 && y >= 0 && x < g.w && y < g.h;
    return { x: p.x, y: p.y + (on ? g.lift[y * g.w + x] : 0) };
  };
}

/** A polygon's corners as text, the same from any starting corner and in either winding. */
function ring(points: readonly number[]): string {
  const pts: string[] = [];
  for (let i = 0; i < points.length; i += 2) pts.push(`${points[i]},${points[i + 1]}`);
  const forms: string[] = [];
  for (const seq of [pts, [...pts].reverse()])
    for (let i = 0; i < seq.length; i++)
      forms.push([...seq.slice(i), ...seq.slice(0, i)].join(' '));
  return forms.sort()[0];
}

/** One line per shape the layer holds, sorted: its corners in the world, colour and alpha. */
function drawn(layer: Graphics): string[] {
  const out: string[] = [];
  for (const ins of layer.context.instructions) {
    if (ins.action !== 'fill') {
      out.push(`a ${ins.action}`);
      continue;
    }
    const { style, path } = (ins as FillInstruction).data;
    for (const { shape, transform: m } of path.shapePath.shapePrimitives) {
      const pts = (shape as { points?: number[] }).points;
      if (shape.type !== 'polygon' || !pts) {
        out.push(`a ${shape.type}`);
        continue;
      }
      const world: number[] = [];
      for (let i = 0; i < pts.length; i += 2) {
        const [x, y] = [pts[i], pts[i + 1]];
        world.push(m ? m.a * x + m.c * y + m.tx : x, m ? m.b * x + m.d * y + m.ty : y);
      }
      out.push(`${ring(world)} #${style.color.toString(16)} ${style.alpha.toFixed(9)}`);
    }
  }
  return out.sort();
}

/** What `drawn` reads for flat cyan diamonds on `tiles`, each on its own top face. */
function diamonds(tiles: readonly LitTile[], surface: (x: number, y: number) => Tile): string[] {
  return tiles
    .map((t) => {
      const p = surface(t.x, t.y);
      const corners = [p.x, p.y - HALF_H, p.x + HALF_W, p.y, p.x, p.y + HALF_H, p.x - HALF_W, p.y];
      return `${ring(corners)} #${CYAN.toString(16)} ${t.alpha.toFixed(9)}`;
    })
    .sort();
}

/** The terrain with runs of tiles turned to Mountain, which counts for nothing; longest first. */
function* barer(terrain: readonly number[]): Iterable<number[]> {
  for (let size = terrain.length; size > 0; size = Math.floor(size / 2))
    for (let at = 0; at + size <= terrain.length; at += size)
      if (terrain.slice(at, at + size).some((t) => t !== Terrain.Mountain))
        yield terrain.map((t, i) => (i >= at && i < at + size ? Terrain.Mountain : t));
}

type Tile = { x: number; y: number };

/** One frame as the game hands it over. */
interface Frame {
  hover: Tile | null;
  tool: HarvestFocus['tool'];
  rot: number;
  /** the selected station; only with no tool in hand, as BuildController keeps it */
  sel: { x: number; y: number; id: string; rot: number } | null;
  season: Season;
  /** a placing root something holds (#336); absent, the hovered tile is the one placed on */
  placing?: Tile | null;
}

interface Scene extends Ground {
  /** picks which tiles each kind may stand on at each turn */
  salt: number;
  frames: Frame[];
}

/** Tools that place no station; decor and buildings carry ids that are no station's. */
const OTHER_TOOLS: HarvestFocus['tool'][] = [
  { kind: 'remove' },
  { kind: 'track' },
  { kind: 'decor', defId: 'signal' },
  { kind: 'building', defId: 'sawmill' },
];

/** A station kind: mostly one that harvests, now and then any. */
const pickKind = (rng: Rng) => rng.pick(rng.chance(0.75) ? HARVESTERS : STATION_IDS);

/** No tool a third of the time, another tool now and then, a station tool otherwise. */
function pickTool(rng: Rng): HarvestFocus['tool'] {
  const r = rng.next();
  if (r < 0.35) return { kind: 'none' };
  if (r < 0.5) return rng.pick(OTHER_TOOLS);
  return { kind: 'station', defId: pickKind(rng) };
}

/** Whether a station may stand: a fixed, arbitrary answer per tile, kind and turn. */
function stands(salt: number) {
  return (x: number, y: number, id: string, rot: number) =>
    hash2(x * 4 + rot, y, (salt ^ hashString(id)) & 0xffff) < 0.6;
}

/** A map and up to 40 frames of pointer moves, tool changes, turns, selections and seasons. */
function scene(rng: Rng): Scene {
  const g = ground(rng);
  // now and then a little off the map: the game's hover tile is not kept within it
  const tile = (): Tile =>
    rng.chance(0.15)
      ? { x: rng.int(-2, g.w + 1), y: rng.int(-2, g.h + 1) }
      : { x: rng.int(0, g.w - 1), y: rng.int(0, g.h - 1) };
  let f: Frame = {
    hover: tile(),
    tool: pickTool(rng),
    rot: 0,
    sel: null,
    season: rng.pick(SEASONS),
  };
  const frames: Frame[] = [];
  for (let n = rng.int(1, 40); n > 0; n--) {
    f = { ...f };
    if (rng.chance(0.4)) f.hover = rng.chance(0.1) ? null : tile();
    if (rng.chance(0.12)) {
      // a new tool starts unturned and drops the selection, as BuildController.setTool does
      f.tool = pickTool(rng);
      f.rot = 0;
      if (f.tool.kind !== 'none') f.sel = null;
    }
    if (rng.chance(0.15)) f.rot = (f.rot + 1) % 4;
    // a station is selected with no tool in hand, or right after it is placed, which drops the tool
    if (f.tool.kind === 'none' && rng.chance(0.2))
      f.sel = rng.chance(0.3)
        ? null
        : { x: rng.int(0, g.w - 1), y: rng.int(0, g.h - 1), id: pickKind(rng), rot: rng.int(0, 3) };
    if (rng.chance(0.05)) f.season = rng.pick(SEASONS);
    if (rng.chance(0.15)) {
      if ('placing' in f) delete f.placing;
      else f.placing = rng.chance(0.2) ? null : tile();
    }
    frames.push(f);
  }
  return { ...g, salt: rng.int(0, 0xffff), frames };
}

/** Fewer frames first, then fewer counted tiles. */
function* simpler(s: Scene): Iterable<Scene> {
  for (const frames of shrinkArray(s.frames)) yield { ...s, frames };
  for (const terrain of barer(s.terrain)) yield { ...s, terrain };
}

/**
 * Plays a scene's frames into one layer. After each: the outline is the issue's colour for the
 * tool and the hovered tile; the layer shows exactly the oracle's diamonds for what should be lit
 * (the station tool's kind on its placing tile where it may stand there, else the selection) and
 * is hidden when that is nothing; it drew at most once, and not at all unless the kind, tile or
 * season it lights changed.
 */
function plays(s: Scene) {
  const map = mapOf(s);
  const surface = surfaceOf(s);
  const can = stands(s.salt);
  const h = new HarvestHighlight(map, surface);
  h.canStand = can;
  const clears = vi.spyOn(h.layer, 'clear');
  let before: string | null = null;
  s.frames.forEach((f, i) => {
    const focus: HarvestFocus = {
      tool: f.tool,
      rot: f.rot,
      selected: f.sel && { x: f.sel.x, y: f.sel.y, def: { id: f.sel.id }, rot: f.sel.rot },
    };
    const n = clears.mock.calls.length;
    if ('placing' in f) h.follow(f.hover, focus, f.season, f.placing);
    else h.follow(f.hover, focus, f.season);
    const draws = clears.mock.calls.length - n;

    let lit: { id: string; x: number; y: number; rot: number } | null = null;
    let outline = CREAM;
    if (f.tool.kind === 'station' && f.tool.defId) {
      const id = f.tool.defId;
      const root = 'placing' in f ? f.placing : f.hover;
      outline = f.hover && can(f.hover.x, f.hover.y, id, f.rot) ? AMBER : RED;
      if (root && can(root.x, root.y, id, f.rot)) lit = { id, x: root.x, y: root.y, rot: f.rot };
    } else if (f.sel) lit = { ...f.sel };
    const want = lit ? oracle(map, lit.x, lit.y, lit.id, lit.rot) : [];
    const now = lit && `${lit.id} at ${lit.x},${lit.y} turned ${lit.rot} in ${f.season}`;

    const at = `frame ${i}`;
    expect(h.outline, `${at}: the outline`).toBe(outline);
    expect(draws, `${at}: drew more than once`).toBeLessThanOrEqual(1);
    if (now === before) expect(draws, `${at}: drew though what it lights is the same`).toBe(0);
    expect(h.layer.visible, `${at}: shown`).toBe(want.length > 0);
    if (want.length) expect(drawn(h.layer), `${at}: the diamonds`).toEqual(diamonds(want, surface));
    before = now;
  });
}

/** 300 seeds where a case is cheap and the kinds to cover are many. */
const SEEDS_300 = Array.from({ length: 300 }, (_, i) => i + 1);

describe('the harvest highlight, for any map, tool, selection and pointer', () => {
  it('lights what the tool or the selection counts, and draws only when that changes', () => {
    forAll(scene, plays, { shrink: simpler });
  });

  it('lights, for any kind on any tile, exactly the tiles it counts, never under the station', () => {
    forAll(
      (rng) => {
        const g = ground(rng, 16);
        return {
          ...g,
          x: rng.int(0, g.w - 1),
          y: rng.int(0, g.h - 1),
          id: rng.pick(STATION_IDS),
          rot: rng.int(0, 3),
        };
      },
      (c) => {
        const map = mapOf(c);
        const surface = surfaceOf(c);
        const h = new HarvestHighlight(map, surface);
        h.follow(null, selecting(c.x, c.y, c.id, c.rot), 'spring');
        const want = oracle(map, c.x, c.y, c.id, c.rot);
        expect(h.layer.visible).toBe(want.length > 0);
        expect(h.layer.visible ? drawn(h.layer) : []).toEqual(diamonds(want, surface));
        const lit = new Set(want.map(key));
        // none of the footprint, turned as the station is, counts as ground round it
        for (const t of stationFootprint(c.id, c.x, c.y, c.rot))
          expect(lit.has(key(t)), `${key(t)} under it, turned ${c.rot}`).toBe(false);
      },
      {
        seeds: SEEDS_300,
        shrink: function* (c) {
          for (const terrain of barer(c.terrain)) yield { ...c, terrain };
        },
      },
    );
  });

  it('reads only the counted cells of a reused buffer, in order, at 0.18 + 0.6 x weight', () => {
    forAll(
      (rng) => ({
        count: rng.int(0, HARVEST_CELLS_MAX),
        // what an earlier, larger breakdown left behind the count
        cells: Array.from({ length: HARVEST_CELLS_MAX }, () => ({
          x: rng.int(-50, 50),
          y: rng.int(-50, 50),
          weight: rng.next(),
        })),
      }),
      (c) => {
        const cells = new HarvestCells();
        c.cells.forEach((v, i) => {
          cells.x[i] = v.x;
          cells.y[i] = v.y;
          cells.weight[i] = v.weight;
        });
        cells.count = c.count;
        const lit = litTiles({ cells });
        expect(lit).toHaveLength(c.count);
        lit.forEach((t, i) => {
          expect(key(t), `cell ${i}`).toBe(key(c.cells[i]));
          expect(t.alpha, `cell ${i}`).toBeCloseTo(0.18 + 0.6 * c.cells[i].weight, 12);
        });
      },
      {
        shrink: function* (c) {
          for (const count of shrinkInt(c.count)) yield { ...c, count };
        },
      },
    );
  });

  it('moves every lit diamond onto its ground as it lies now on refresh, and draws nothing unlit', () => {
    forAll(
      (rng) => {
        const g = ground(rng, 12);
        return {
          ...g,
          moved: g.lift.map(() => rng.pick([0, 0, -10, -20, 4])),
          x: rng.int(0, g.w - 1),
          y: rng.int(0, g.h - 1),
          id: rng.pick(HARVESTERS),
        };
      },
      (c) => {
        const map = mapOf(c);
        const lift = [...c.lift];
        const surface = surfaceOf({ w: c.w, h: c.h, lift });
        const h = new HarvestHighlight(map, surface);
        const clears = vi.spyOn(h.layer, 'clear');
        h.refresh();
        expect(clears).not.toHaveBeenCalled();
        h.follow(null, selecting(c.x, c.y, c.id), 'spring');
        // the relief moves under the lit tiles
        lift.splice(0, lift.length, ...c.moved);
        h.refresh();
        const want = oracle(map, c.x, c.y, c.id);
        expect(h.layer.visible ? drawn(h.layer) : []).toEqual(diamonds(want, surface));
        h.follow(null, NONE, 'spring');
        const n = clears.mock.calls.length;
        h.refresh();
        expect(clears.mock.calls.length).toBe(n);
      },
      {
        shrink: function* (c) {
          for (const terrain of barer(c.terrain)) yield { ...c, terrain };
        },
      },
    );
  });
});
