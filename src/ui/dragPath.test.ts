import { describe, it, expect, beforeEach, vi } from 'vitest';
import { emptyMap } from '../world/mapgen';
import { Terrain } from '../world/tiles';
import { RegionState } from '../world/regions';
import {
  CLASS_N,
  TrackGraph,
  TRACK_CLASSES,
  footprintOf,
  pieceCost,
  type TrackClass,
} from '../world/track';
import { DIRS, DIR_DX, DIR_DY, Dir, opposite } from '../engine/iso';
import { Builder } from '../sim/build';
import { Stockpile } from '../sim/stockpile';
import { Economy } from '../sim/economy';
import { rules, DEFAULT_RULES } from '../sim/rules';
import { STR } from '../strings';
import { layRun, planRun } from './autoCrossing';
import { TURN_AFTER, lineTiles, turnPath, type RunTile } from './dragPath';

vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));
beforeEach(() => Object.assign(rules, DEFAULT_RULES));

const W = 40;
/** The path laid on an empty graph, refusing overlaps. */
function laid(path: RunTile[], cls: TrackClass) {
  const g = new TrackGraph(W, W);
  let tiles = 0;
  for (const p of path) {
    const kind = p.item?.kind ?? 'straight';
    tiles += footprintOf(p.x, p.y, kind, p.rot, cls).length;
    g.place(p.x, p.y, kind, p.rot, cls);
  }
  expect(g.pieces.size).toBe(tiles);
  return g;
}
/** Every edge a piece opens by that no piece meets: the ends of the laid path. */
function looseEnds(g: TrackGraph) {
  const out: string[] = [];
  for (const k of g.pieces.keys()) {
    const x = k % W,
      y = Math.floor(k / W);
    for (const d of DIRS)
      if (g.opensTo(x, y, d) && !g.opensTo(x + DIR_DX[d], y + DIR_DY[d], opposite(d)))
        out.push(`${x},${y},${d}`);
  }
  return out.sort();
}
const at = (x: number, y: number, d: Dir) => `${x},${y},${d}`;

describe('a drag that turns', () => {
  it('runs from the start to the cursor through one curve, for every class and turn', () => {
    const a = { x: 20, y: 20 };
    for (const cls of TRACK_CLASSES)
      for (const first of ['x', 'y'] as const)
        for (const sx of [1, -1])
          for (const sy of [1, -1]) {
            const b = { x: a.x + 7 * sx, y: a.y + 5 * sy };
            const path = turnPath(a, b, first, cls);
            expect(path.filter((p) => p.item?.kind === 'curve')).toHaveLength(1);
            const go1 = first === 'x' ? (sx > 0 ? Dir.E : Dir.W) : sy > 0 ? Dir.S : Dir.N;
            const go2 = first === 'x' ? (sy > 0 ? Dir.S : Dir.N) : sx > 0 ? Dir.E : Dir.W;
            // one line, open only behind the start and beyond the cursor
            expect(looseEnds(laid(path, cls))).toEqual(
              [at(a.x, a.y, opposite(go1)), at(b.x, b.y, go2)].sort(),
            );
          }
  });

  it('gives the curve its footprint out of both legs', () => {
    // east, then south: a 2×2 curve at the corner of (20..26, 20) and (26, 20..25)
    const path = turnPath({ x: 20, y: 20 }, { x: 26, y: 25 }, 'x', 'regular');
    const curve = path.find((p) => p.item)!;
    expect(footprintOf(curve.x, curve.y, 'curve', curve.rot, 'regular')).toEqual(
      expect.arrayContaining([
        { x: 25, y: 20 },
        { x: 26, y: 21 },
      ]),
    );
    const straights = path.filter((p) => !p.item);
    expect(straights).toHaveLength(5 + 4);
    expect(straights.slice(0, 5).every((p) => p.y === 20 && p.rot === 1)).toBe(true);
    expect(straights.slice(5).every((p) => p.x === 26 && p.rot === 0)).toBe(true);
    // a narrow curve takes the corner tile alone
    const narrow = turnPath({ x: 20, y: 20 }, { x: 26, y: 25 }, 'x', 'narrow');
    expect(narrow.find((p) => p.item)).toMatchObject({ x: 26, y: 20 });
    expect(narrow).toHaveLength(7 + 5);
    expect(CLASS_N.narrow).toBe(1);
  });

  it('turns the other way round when the drag set off along the other axis', () => {
    const a = { x: 20, y: 20 },
      b = { x: 26, y: 25 };
    const down = turnPath(a, b, 'y', 'regular');
    expect(down[0]).toMatchObject({ x: 20, y: 20, rot: 0 });
    expect(down[down.length - 1]).toMatchObject({ x: 26, y: 25, rot: 1 });
  });

  it('lays the straight line while the cursor stays near the first leg', () => {
    const a = { x: 20, y: 20 };
    for (let off = 0; off < TURN_AFTER; off++) {
      const b = { x: 28, y: 20 + off };
      expect(turnPath(a, b, 'x', 'regular')).toEqual(lineTiles(a, b));
    }
    // no first leg at all: straight on along the cursor's axis
    expect(turnPath(a, { x: 20, y: 28 }, 'x', 'regular')).toEqual(lineTiles(a, { x: 20, y: 28 }));
  });
});

function world(size = 30) {
  const map = emptyMap(4242, size, size, Terrain.Grass),
    track = new TrackGraph(size, size),
    stock = new Stockpile();
  const regions = new RegionState(map);
  for (let i = 0; i < regions.unlocked.length; i++) regions.own(i);
  const builder = new Builder(map, regions, track, new Economy(), stock);
  for (const k of ['wood', 'stone', 'iron']) stock.amounts.set(k, 1000);
  return { track, builder };
}

describe('a turning run laid', () => {
  it('prices the straights and the curve, and lays one joined line', () => {
    const { track, builder } = world();
    const path = turnPath({ x: 5, y: 5 }, { x: 12, y: 11 }, 'x', 'regular');
    const plan = planRun(builder, path, { kind: 'straight', cls: 'regular' });
    expect(plan.end).toBe(path.length);
    expect(plan.curves).toBe(1);
    const one = pieceCost('straight', 'regular'),
      curve = pieceCost('curve', 'regular'),
      straights = path.length - 1;
    for (const k of new Set([...Object.keys(one), ...Object.keys(curve)]))
      expect(plan.cost[k]).toBe((one[k] ?? 0) * straights + (curve[k] ?? 0));
    layRun(builder, plan);
    expect(track.get(11, 5)?.kind).toBe('curve');
    expect(track.opensTo(10, 5, Dir.E) && track.opensTo(11, 5, Dir.W)).toBe(true);
    expect(track.opensTo(12, 6, Dir.S) && track.opensTo(12, 7, Dir.N)).toBe(true);
    // dragged again, it all stands
    const again = planRun(builder, path, { kind: 'straight', cls: 'regular' });
    expect(again.steps.every((s) => s.stands)).toBe(true);
    expect(again.cost).toEqual({});
  });

  it('stops at a curve with track in its way, and never cuts that track', () => {
    for (const cls of ['regular', 'narrow'] as const) {
      const { track, builder } = world();
      // a north-south line down the corner column
      for (let y = 2; y <= 14; y++)
        expect(builder.placeTrack(12, y, { kind: 'straight', cls }, 0)).toBe(true);
      const path = turnPath({ x: 5, y: 5 }, { x: 12, y: 11 }, 'x', cls);
      const plan = planRun(builder, path, { kind: 'straight', cls });
      const at = path.findIndex((p) => p.item);
      expect(plan.end).toBe(at);
      expect(plan.reason).toBe(STR.build.trackInWay);
      expect(plan.curves).toBe(0);
      layRun(builder, plan);
      for (let y = 2; y <= 14; y++) expect(track.get(12, y)).toMatchObject({ kind: 'straight' });
    }
  });
});
