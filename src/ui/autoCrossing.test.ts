import { describe, it, expect, beforeEach, vi } from 'vitest';
import { emptyMap } from '../world/mapgen';
import { Terrain } from '../world/tiles';
import { RegionState } from '../world/regions';
import {
  TrackGraph,
  TRACK_CLASSES,
  TRACK_ITEMS,
  makePiece,
  pieceCost,
  portClass,
  type TrackClass,
  type TrackItem,
} from '../world/track';
import { Dir } from '../engine/iso';
import { Builder } from '../sim/build';
import { storeWith } from '../testing/storeFixtures';
import { Economy } from '../sim/economy';
import { rules, DEFAULT_RULES } from '../sim/rules';
import { STR } from '../strings';
import { bridgeCrossing, crossingFor, crossingRefusal, layRun, planRun } from './autoCrossing';

vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));
beforeEach(() => Object.assign(rules, DEFAULT_RULES));

const RES = ['wood', 'stone', 'iron'];
function world(size = 24) {
  const map = emptyMap(4242, size, size, Terrain.Grass),
    track = new TrackGraph(size, size);
  // one depot in the middle reaches every tile
  const regions = new RegionState(map);
  for (let i = 0; i < regions.unlocked.length; i++) regions.own(i);
  const { stores, depot: stock } = storeWith(Object.fromEntries(RES.map((k) => [k, 1000])), {
    x: size >> 1,
    y: size >> 1,
  });
  // the Electric Age: every line is open
  const economy = Object.assign(new Economy(), { tier: 2 });
  const builder = new Builder(map, regions, track, economy, stores);
  return { track, builder, stock };
}
const straight = (cls: TrackClass): TrackItem => ({ kind: 'straight', cls });
/** A north-south run at column x from row y0 to y1, as the track tool's drag gives it. */
const nsRun = (x: number, y0: number, y1: number) =>
  Array.from({ length: y1 - y0 + 1 }, (_, i) => ({ x, y: y0 + i, rot: 0 }));
/** An east-west line of `cls` straights on row y. */
function ewLine(b: Builder, y: number, x0: number, x1: number, cls: TrackClass = 'branch') {
  for (let x = x0; x <= x1; x++) expect(b.placeTrack(x, y, straight(cls), 1)).toBe(true);
}
const crossable = (a: TrackClass, b: TrackClass) =>
  TRACK_ITEMS.some(
    (i) =>
      i.kind === 'crossing' &&
      ((i.cls === a && (i.cls2 ?? i.cls) === b) || (i.cls === b && (i.cls2 ?? i.cls) === a)),
  );
/** The class a piece presents along the axis a straight at `rot` runs. */
const along = (p: ReturnType<typeof makePiece>, rot: number) =>
  portClass(p, rot % 2 === 0 ? Dir.N : Dir.E);

describe('the crossing a run lays by itself', () => {
  it('puts the run class on the run axis and the line class on the other, for every pair', () => {
    for (const run of TRACK_CLASSES)
      for (const line of TRACK_CLASSES)
        for (const rot of [0, 1]) {
          const pick = crossingFor(run, rot, makePiece('straight', 1 - rot, line));
          if (!crossable(run, line)) {
            expect(pick).toEqual({ ok: false, why: 'apart', other: line });
            continue;
          }
          if (!pick?.ok) throw new Error(`${run} x ${line} refused`);
          // a piece the toolbar offers, never one made up for the pair
          expect(TRACK_ITEMS).toContainEqual(pick.item);
          const laid = makePiece('crossing', pick.rot, pick.item.cls, pick.item.cls2);
          expect(along(laid, rot)).toBe(run);
          expect(along(laid, 1 - rot)).toBe(line);
        }
  });

  it('picks the mixed piece in either turn: a Branch Line under a Main Line run and the reverse', () => {
    expect(crossingFor('main', 1, makePiece('straight', 0, 'branch'))).toEqual({
      ok: true,
      item: { kind: 'crossing', cls: 'branch', cls2: 'main' },
      rot: 0,
    });
    expect(crossingFor('branch', 1, makePiece('straight', 0, 'main'))).toEqual({
      ok: true,
      item: { kind: 'crossing', cls: 'branch', cls2: 'main' },
      rot: 1,
    });
    expect(crossingFor('narrow', 0, makePiece('straight', 1, 'branch'))).toEqual({
      ok: true,
      item: { kind: 'crossing', cls: 'narrow', cls2: 'branch' },
      rot: 0,
    });
  });

  it('leaves alone what is not a line across the run', () => {
    expect(crossingFor('branch', 0, undefined)).toBeNull();
    // along the run: a junction, not a crossing
    expect(crossingFor('branch', 0, makePiece('straight', 0, 'branch'))).toBeNull();
    expect(crossingFor('branch', 1, makePiece('straight', 1, 'main'))).toBeNull();
    expect(crossingFor('branch', 0, makePiece('bridge', 0))).toBeNull();
  });

  it('refuses a bridge across the run, and a bridge run across any line', () => {
    expect(crossingFor('branch', 0, makePiece('bridge', 1))).toEqual({
      ok: false,
      why: 'bridge',
      other: 'branch',
    });
    for (const [kind, rot] of [
      ['straight', 1],
      ['bridge', 1],
      ['crossing', 0],
    ] as const)
      expect(bridgeCrossing(0, makePiece(kind, rot)), `${kind} ${rot}`).toMatchObject({
        ok: false,
        why: 'bridge',
      });
    expect(bridgeCrossing(0, makePiece('curve', 0))).toMatchObject({ ok: false, why: 'angle' });
    expect(bridgeCrossing(0, makePiece('bridge', 0))).toBeNull();
    expect(bridgeCrossing(1, undefined)).toBeNull();
    expect(crossingRefusal('branch', { ok: false, why: 'bridge', other: 'branch' })).toBe(
      STR.build.crossBridge,
    );
  });

  it('refuses curves and switches: lines cross only at right angles', () => {
    for (const kind of ['curve', 'switch'] as const)
      for (const rot of [0, 1])
        expect(crossingFor('branch', rot, makePiece(kind, 0, 'narrow'))).toEqual({
          ok: false,
          why: 'angle',
          other: 'narrow',
        });
    expect(crossingRefusal('branch', { ok: false, why: 'angle', other: 'branch' })).toBe(
      STR.build.crossAngle,
    );
  });

  it('passes through a crossing that carries its class along the run, keeping its turn', () => {
    const mixed = makePiece('crossing', 1, 'branch', 'main');
    // at rotation 1 the Branch Line runs east-west and the Main Line north-south
    expect(crossingFor('main', 0, mixed)).toEqual({
      ok: true,
      item: { kind: 'crossing', cls: 'branch', cls2: 'main' },
      rot: 1,
    });
    const plain = makePiece('crossing', 1, 'branch', 'branch');
    expect(crossingFor('branch', 0, plain)).toMatchObject({ ok: true, rot: 1 });
    // a Main Line run across the Branch crossing makes it the mixed one, turned to the run
    expect(crossingFor('main', 0, plain)).toEqual({
      ok: true,
      item: { kind: 'crossing', cls: 'branch', cls2: 'main' },
      rot: 1,
    });
  });
});

describe('a run laid across lines', () => {
  it('lays the crossing for the pair, keeps the line it crosses whole, and prices it', () => {
    const { track, builder } = world();
    ewLine(builder, 10, 4, 14);
    const line = nsRun(9, 5, 15);
    const plan = planRun(builder, line, straight('main'));
    expect(plan.end).toBe(line.length);
    expect(plan.crossings).toBe(1);
    // the status counts the crossing once, apart from the straights
    expect(plan.straights).toBe(10);
    // ten straights and the crossing in place of the eleventh
    const crossing = pieceCost('crossing', 'branch', 'main'),
      one = pieceCost('straight', 'main');
    for (const [k, v] of Object.entries(one))
      expect(plan.cost[k]).toBe(v * 10 + (crossing[k] ?? 0));
    layRun(builder, plan);
    const p = track.get(9, 10)!;
    expect(p.kind).toBe('crossing');
    expect(portClass(p, Dir.N)).toBe('main');
    expect(portClass(p, Dir.E)).toBe('branch');
    // the east-west line still runs through
    expect(track.opensTo(8, 10, Dir.E) && track.opensTo(9, 10, Dir.W)).toBe(true);
    expect(track.opensTo(10, 10, Dir.W) && track.opensTo(9, 10, Dir.E)).toBe(true);
    // a second drag over the same tiles stands already: nothing to lay or pay
    const again = planRun(builder, line, straight('main'));
    expect(again.steps.every((s) => s.stands)).toBe(true);
    expect(again.cost).toEqual({});
  });

  it('stops before a line of another world, and never cuts it', () => {
    const { track, builder } = world();
    ewLine(builder, 10, 4, 14, 'main');
    const line = nsRun(9, 5, 15);
    const plan = planRun(builder, line, straight('narrow'));
    expect(plan.end).toBe(5);
    expect(plan.reason).toBe(STR.build.crossApart(STR.toolbar.trackClass.narrow, 'main line'));
    expect(plan.crossings).toBe(0);
    layRun(builder, plan);
    for (let y = 5; y < 10; y++) expect(track.get(9, y)?.cls).toBe('narrow');
    expect(track.get(9, 10)).toMatchObject({ kind: 'straight', cls: 'main', rot: 1 });
    for (let y = 11; y <= 15; y++) expect(track.get(9, y)).toBeUndefined();
  });

  it('stops laying at the first piece the stock can no longer pay, leaving no loose track', () => {
    const { track, builder, stock } = world();
    const line = nsRun(9, 5, 14);
    const plan = planRun(builder, line, straight('branch'));
    const one = plan.steps[0].cost;
    // enough for four straights, judged one by one every piece looks affordable
    for (const k of Object.keys(stock.amounts)) stock.amounts.set(k, 0);
    for (const [k, v] of Object.entries(one)) stock.amounts.set(k, v * 4);
    const judged = planRun(builder, line, straight('branch'));
    expect(judged.steps.every((s) => s.ok)).toBe(true);
    expect(layRun(builder, judged)).toBe(4);
    for (let y = 5; y < 9; y++) expect(track.get(9, y)?.kind).toBe('straight');
    expect(track.get(9, 9)).toBeUndefined();
  });

  it('stops a bridge run before a bridge across it, and never cuts that bridge', () => {
    const { track, builder } = world();
    const map = builder.map;
    for (let y = 6; y <= 14; y++)
      for (let x = 5; x <= 13; x++) map.terrain[y * map.w + x] = Terrain.Water;
    for (let x = 6; x <= 12; x++)
      expect(builder.placeTrack(x, 10, { kind: 'bridge', cls: 'branch' }, 1)).toBe(true);
    const plan = planRun(builder, nsRun(9, 7, 13), { kind: 'bridge', cls: 'branch' });
    expect(plan.end).toBe(3);
    expect(plan.reason).toBe(STR.build.crossBridge);
    layRun(builder, plan);
    expect(track.get(9, 10)).toMatchObject({ kind: 'bridge', rot: 1 });
    expect(track.get(9, 11)).toBeUndefined();
  });

  it('joins a curve where the run starts or ends, and leaves it as it is', () => {
    const { track, builder } = world();
    expect(builder.placeTrack(9, 10, { kind: 'curve', cls: 'narrow' }, 2)).toBe(true);
    for (const line of [nsRun(9, 10, 14), nsRun(9, 6, 10)]) {
      const plan = planRun(builder, line, straight('narrow'));
      expect(plan.end).toBe(line.length);
      expect(plan.reason).toBeUndefined();
      expect(plan.straights).toBe(4);
      const at = line.findIndex((l) => l.y === 10);
      expect(plan.steps[at]).toMatchObject({ joins: true, stands: true });
      layRun(builder, plan);
      expect(track.get(9, 10)).toMatchObject({ kind: 'curve', rot: 2 });
    }
    for (let y = 6; y <= 14; y++) if (y !== 10) expect(track.get(9, y)?.kind).toBe('straight');
  });

  it('climbs a mountain from its foot: each piece judged with the ones before it down', () => {
    const { track, builder } = world();
    const map = builder.map;
    for (let y = 6; y <= 12; y++) map.terrain[y * map.w + 9] = Terrain.Rock;
    for (let y = 3; y <= 5; y++) expect(builder.placeTrack(9, y, straight('branch'), 0)).toBe(true);
    const line = nsRun(9, 6, 12);
    // alone, a rock tile beyond the foot does not continue a line yet
    expect(builder.checkTrack(9, 8, straight('branch'), 0).reason).toBe(STR.build.mountainLine);
    const plan = planRun(builder, line, straight('branch'));
    expect(plan.steps.every((s) => s.ok)).toBe(true);
    expect(plan.straights).toBe(line.length);
    // judging changed nothing
    expect(track.get(9, 6)).toBeUndefined();
    expect(layRun(builder, plan)).toBe(line.length);
    for (let y = 6; y <= 12; y++) expect(track.get(9, y)?.kind).toBe('straight');
  });

  it('stops at a curve it would meet at an angle', () => {
    const { track, builder } = world();
    expect(builder.placeTrack(9, 10, { kind: 'curve', cls: 'narrow' }, 0)).toBe(true);
    const plan = planRun(builder, nsRun(9, 7, 12), straight('narrow'));
    expect(plan.end).toBe(3);
    expect(plan.reason).toBe(STR.build.crossAngle);
    layRun(builder, plan);
    expect(track.get(9, 10)?.kind).toBe('curve');
    expect(track.get(9, 11)).toBeUndefined();
  });

  it('a crossing its tile refuses stops the run as well', () => {
    const { track, builder } = world();
    ewLine(builder, 10, 4, 14);
    ewLine(builder, 12, 4, 14, 'narrow');
    rules.narrowUnlocked = 0;
    // a wide run reaches the wide line, then the narrow line it may cross only once narrow is open
    const plan = planRun(builder, nsRun(9, 8, 14), straight('branch'));
    expect(plan.end).toBe(4);
    expect(plan.reason).toBe(STR.build.narrowLocked);
    expect(plan.crossings).toBe(1);
    layRun(builder, plan);
    expect(track.get(9, 10)?.kind).toBe('crossing');
    expect(track.get(9, 12)).toMatchObject({ kind: 'straight', cls: 'narrow' });
  });
});
