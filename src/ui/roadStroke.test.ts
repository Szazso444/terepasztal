import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Cost } from '../data/content';
import { Rng } from '../engine/rng';
import { Builder, type PlacementCheck } from '../sim/build';
import { Economy } from '../sim/economy';
import { roadCost } from '../sim/roads';
import { DEFAULT_RULES, rules } from '../sim/rules';
import { Stockpile, fmtCost } from '../sim/stockpile';
import { STR } from '../strings';
import { forAll } from '../testing/property';
import { emptyMap } from '../world/mapgen';
import { RegionState } from '../world/regions';
import { Terrain } from '../world/tiles';
import { TrackGraph, type TrackItem } from '../world/track';
import {
  builderJudge,
  hoverStatus,
  judgeStroke,
  strokeStatus,
  strokeTiles,
  type StrokeJudge,
} from './roadStroke';

type Tile = { x: number; y: number };

beforeEach(() => Object.assign(rules, DEFAULT_RULES));
afterEach(() => Object.assign(rules, DEFAULT_RULES));

describe('the tiles a road drag covers', () => {
  it('run straight from the start towards the end, a tile a step, along the longer way', () => {
    forAll(
      (rng) => ({
        start: { x: rng.int(-5, 40), y: rng.int(-5, 40) },
        end: { x: rng.int(-5, 40), y: rng.int(-5, 40) },
      }),
      ({ start, end }) => {
        const tiles = strokeTiles(start, end);
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const alongX = Math.abs(dx) >= Math.abs(dy);
        expect(tiles[0]).toEqual(start);
        expect(tiles).toHaveLength(Math.max(Math.abs(dx), Math.abs(dy)) + 1);
        // the last tile is the end, seen along the stroke's axis
        expect(tiles[tiles.length - 1]).toEqual(
          alongX ? { x: end.x, y: start.y } : { x: start.x, y: end.y },
        );
        for (let i = 1; i < tiles.length; i++) {
          const step = { x: tiles[i].x - tiles[i - 1].x, y: tiles[i].y - tiles[i - 1].y };
          expect(Math.abs(step.x) + Math.abs(step.y), `step ${i}`).toBe(1);
          if (alongX) expect(step).toEqual({ x: Math.sign(dx), y: 0 });
          else expect(step).toEqual({ x: 0, y: Math.sign(dy) });
        }
      },
    );
  });

  it('is the start alone when it ends where it began', () => {
    expect(strokeTiles({ x: 3, y: 4 }, { x: 3, y: 4 })).toEqual([{ x: 3, y: 4 }]);
  });
});

/**
 * A judge over tiles named by their x on one row: `roads` hold a road, `bad` are refused for the
 * reason they map to, a tile in `afterLaid` is refused once the tile before it was laid, and the
 * stock pays up to `stock` of a one-part cost a tile.
 */
function fakeJudge(o: {
  roads?: number[];
  bad?: Record<number, string>;
  afterLaid?: number[];
  stock?: number;
}): StrokeJudge & { laid: number[] } {
  const laid: number[] = [];
  return {
    laid,
    has: (t) => (o.roads ?? []).includes(t.x),
    check: (t): PlacementCheck => {
      const why = o.bad?.[t.x] ?? (o.afterLaid?.includes(t.x) && laid.includes(t.x - 1) && 'along');
      return why ? { ok: false, cost: {}, reason: why } : { ok: true, cost: { stone: 1 } };
    },
    lay: (t) => {
      laid.push(t.x);
    },
    canPay: (total) => (total.stone ?? 0) <= (o.stock ?? Infinity),
    short: (total) => `short of ${total.stone}`,
  };
}
const row = (n: number): Tile[] => Array.from({ length: n }, (_, x) => ({ x, y: 0 }));

describe('judging a road drag', () => {
  it('prices the tiles it lays, and only those', () => {
    const c = judgeStroke(row(6), fakeJudge({ roads: [0], bad: { 3: 'water' } }));
    expect(c.steps.map((s) => s.state)).toEqual(['have', 'lay', 'lay', 'refused', 'lay', 'lay']);
    expect(c.laid).toBe(4);
    expect(c.cost).toEqual({ stone: 4 });
    for (const s of c.steps)
      expect(s.cost, `${s.x}`).toEqual(s.state === 'lay' ? { stone: 1 } : {});
    expect(c.refused).toBe(1);
    expect(c.steps[3].reason).toBe('water');
  });

  it('names each reason once, in the order of the tiles', () => {
    const c = judgeStroke(row(5), fakeJudge({ bad: { 1: 'rock', 2: 'water', 4: 'rock' } }));
    expect(c.refused).toBe(3);
    expect(c.reasons).toEqual(['rock', 'water']);
  });

  it('judges each tile with the tiles laid before it standing, not those refused', () => {
    // 2 follows a laid tile and is refused; 4 follows a refused one and is laid
    const judge = fakeJudge({ bad: { 3: 'rock' }, afterLaid: [2, 4] });
    const c = judgeStroke(row(5), judge);
    expect(c.steps.map((s) => s.state)).toEqual(['lay', 'lay', 'refused', 'refused', 'lay']);
    expect(judge.laid).toEqual([0, 1, 4]);
  });

  it('refuses what the stock no longer pays for, short of the whole stroke', () => {
    const c = judgeStroke(row(6), fakeJudge({ stock: 3, bad: { 1: 'rock' } }));
    expect(c.steps.map((s) => s.state)).toEqual([
      'lay',
      'refused',
      'lay',
      'lay',
      'refused',
      'refused',
    ]);
    expect(c.cost).toEqual({ stone: 3 });
    // the five tiles it could lay, were the stock to pay
    expect(c.reasons).toEqual(['rock', 'short of 5']);
  });
});

describe('what a road drag says', () => {
  const some = judgeStroke(row(4), fakeJudge({ bad: { 2: 'rock' } }));
  const none = judgeStroke(row(2), fakeJudge({ bad: { 0: 'rock', 1: 'water' } }));
  const kept = judgeStroke(row(2), fakeJudge({ roads: [0, 1] }));

  it('gives the total of what it lays, and every reason a tile is left out', () => {
    expect(strokeStatus(some)).toContain(fmtCost(some.cost));
    expect(strokeStatus(some)).toContain(STR.build.roadNotLaid(1, ['rock']));
    expect(strokeStatus(none)).toBe(STR.build.roadNotLaid(2, ['rock', 'water']));
    expect(strokeStatus(kept)).toBe(STR.build.roadLine(0, fmtCost({})));
  });

  it('prices one tile before a drag, or says why it takes no road', () => {
    expect(hoverStatus(some.steps[0])).toContain(STR.build.cost(fmtCost({ stone: 1 })));
    expect(hoverStatus(some.steps[2])).toContain('rock');
    expect(hoverStatus(kept.steps[0])).toContain(STR.build.roadHere);
    for (const s of [some.steps[0], some.steps[2], kept.steps[0]])
      expect(hoverStatus(s)).toContain(STR.build.dragHint);
  });
});

// ------------------------------------------------------------------ against the builder

const W = 64;
const STRAIGHT: Record<string, TrackItem> = {
  regular: { kind: 'straight', cls: 'regular' },
  narrow: { kind: 'straight', cls: 'narrow' },
  high_speed: { kind: 'straight', cls: 'high_speed' },
};

/**
 * A grass map with water, rock and track strewn over it, roads on some tiles, the north-west
 * quarter owned, some stone in stock, and a stroke from `start` to `end`: some of the track runs
 * along the stroke's line, some across it. It has no station, works or house, so no door asks for a
 * spur: what a release lays is the stroke alone.
 */
function world(rng: Rng) {
  const map = emptyMap(rng.int(1, 1000), W, W, Terrain.Grass);
  for (let i = 0; i < 30; i++)
    map.terrain[rng.int(0, W * W - 1)] = rng.pick([Terrain.Water, Terrain.Rock, Terrain.Mountain]);
  const regions = new RegionState(map);
  regions.load([true, false, false, false]);
  const track = new TrackGraph(W, W);
  const stock = new Stockpile();
  const builder = new Builder(map, regions, track, new Economy(), stock);
  const start = { x: rng.int(0, 40), y: rng.int(0, 40) };
  const end = { x: rng.int(0, W - 1), y: rng.int(0, W - 1) };
  const line = strokeTiles(start, end);
  builder.free = true;
  for (let i = 0; i < 40; i++) {
    const item = rng.pick(Object.values(STRAIGHT));
    // a straight's turn: 0 runs north to south, 1 east to west
    const rot = rng.int(0, 1);
    // a run of straights or a single one, anywhere or from a tile of the stroke
    const at = rng.chance(0.3) ? rng.pick(line) : { x: rng.int(0, W - 1), y: rng.int(0, W - 1) };
    const n = rng.chance(0.5) ? rng.int(2, 6) : 1;
    for (let k = 0; k < n; k++)
      builder.placeTrack(at.x + (rot === 1 ? k : 0), at.y + (rot === 0 ? k : 0), item, rot);
  }
  for (let i = 0; i < 25; i++) builder.placeRoad(rng.int(0, W - 1), rng.int(0, W - 1));
  builder.free = false;
  stock.add('stone', rng.int(0, 30));
  rules.buildCostMul = rng.pick([1, 1, 2]);
  return { builder, stock, start, end };
}

describe("a road drag's preview against its release", () => {
  it('shows the tiles the release lays and what it pays, tile for tile', () => {
    forAll(
      (rng) => rng.int(1, 1e9),
      (seed) => {
        const { builder, stock, start, end } = world(new Rng(seed));
        const tiles = strokeTiles(start, end);
        const preview = judgeStroke(tiles, builderJudge(builder));
        const before = new Set(builder.roads.list().map((t) => `${t.x},${t.y}`));
        const stone = stock.get('stone');
        // the release: every tile of the stroke in order, the builder deciding each
        const placed = tiles.map((t) => builder.placeRoad(t.x, t.y));
        preview.steps.forEach((s, i) => {
          const where = `${s.x},${s.y}`;
          expect(placed[i], `${where}: ${s.state} ${s.reason ?? ''}`).toBe(s.state === 'lay');
          expect(builder.roads.has(s.x, s.y), where).toBe(s.state !== 'refused');
          if (s.state === 'have') expect(before.has(where), where).toBe(true);
          if (s.state === 'refused') expect(s.reason, where).toBeTruthy();
        });
        const paid: Cost = { stone: stone - stock.get('stone') };
        expect(paid.stone).toBe(preview.cost.stone ?? 0);
        expect(preview.laid).toBe(placed.filter(Boolean).length);
      },
    );
  });

  it('refuses tiles of a line of track it runs along, which alone would take a road', () => {
    const map = emptyMap(7, W, W, Terrain.Grass);
    const regions = new RegionState(map);
    regions.load([true, false, false, false]);
    const builder = new Builder(map, regions, new TrackGraph(W, W), new Economy(), new Stockpile());
    builder.free = true;
    for (let x = 8; x <= 12; x++) builder.placeTrack(x, 10, STRAIGHT.regular, 1);
    const tiles = strokeTiles({ x: 6, y: 10 }, { x: 14, y: 10 });
    for (const t of tiles) expect(builder.checkRoad(t.x, t.y).ok, `${t.x}`).toBe(true);
    const c = judgeStroke(tiles, builderJudge(builder));
    expect(c.refused).toBeGreaterThan(0);
    expect(c.reasons).toEqual([STR.build.crossingAlong]);
    const placed = tiles.map((t) => builder.placeRoad(t.x, t.y));
    expect(placed).toEqual(c.steps.map((s) => s.state === 'lay'));
  });

  it('names what the whole drag is short of, when the stock pays for none of it', () => {
    const map = emptyMap(7, W, W, Terrain.Grass);
    const regions = new RegionState(map);
    regions.load([true, false, false, false]);
    const stock = new Stockpile();
    const builder = new Builder(map, regions, new TrackGraph(W, W), new Economy(), stock);
    const tiles = strokeTiles({ x: 2, y: 2 }, { x: 7, y: 2 });
    // each tile alone is refused for its price
    for (const t of tiles) expect(builder.checkRoad(t.x, t.y).ok).toBe(false);
    const c = judgeStroke(tiles, builderJudge(builder));
    expect(c.laid).toBe(0);
    expect(c.refused).toBe(tiles.length);
    const whole: Cost = {};
    for (const [k, v] of Object.entries(roadCost())) whole[k] = v * tiles.length;
    expect(c.reasons).toEqual([STR.build.needResources(fmtCost(stock.missing(whole)))]);
    expect(tiles.map((t) => builder.placeRoad(t.x, t.y))).toEqual(tiles.map(() => false));
  });

  it('costs what a road costs a tile, times the tiles', () => {
    const map = emptyMap(7, W, W, Terrain.Grass);
    const regions = new RegionState(map);
    regions.load([true, false, false, false]);
    const stock = new Stockpile();
    stock.add('stone', 1000);
    const builder = new Builder(map, regions, new TrackGraph(W, W), new Economy(), stock);
    const c = judgeStroke(strokeTiles({ x: 2, y: 2 }, { x: 2, y: 11 }), builderJudge(builder));
    expect(c.laid).toBe(10);
    expect(c.cost).toEqual({ stone: 10 * roadCost().stone });
  });
});
