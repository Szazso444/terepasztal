import { describe, it, expect, vi, beforeEach } from 'vitest';
import { emptyMap } from '../world/mapgen';
import { Terrain } from '../world/tiles';
import { RegionState } from '../world/regions';
import { TrackGraph, pieceCost } from '../world/track';
import { Builder } from './build';
import { Economy } from './economy';
import { rules, DEFAULT_RULES } from './rules';
import { STR } from '../strings';
import { storeWith } from '../testing/storeFixtures';

/** An economy in the Electric Age: Main and Trunk Line are open. */
const electricAge = () => Object.assign(new Economy(), { tier: 2 });

vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));
beforeEach(() => Object.assign(rules, DEFAULT_RULES));

function world(ground = Terrain.Grass) {
  const map = emptyMap(4242, 48, 48, ground),
    track = new TrackGraph(48, 48),
    { stores, depot: stock } = storeWith({}, { x: 24, y: 24 }),
    economy = electricAge();
  const regions = new RegionState(map);
  for (let i = 0; i < regions.unlocked.length; i++) regions.own(i);
  const builder = new Builder(map, regions, track, economy, stores);
  for (const k of ['wood', 'stone', 'iron']) stock.amounts.set(k, 1000);
  // a dead-end run of four Branch Line straights
  for (let x = 5; x <= 8; x++) track.place(x, 10, 'straight', 1, 'branch');
  const run = [5, 6, 7, 8].map((x) => ({ x, y: 10 }));
  const held = () => ['wood', 'stone', 'iron'].map((k) => stock.get(k));
  return { map, track, builder, stock, run, held };
}

describe('upgrading and downgrading track', () => {
  it('charges the difference for an upgrade', () => {
    const { builder, track, run, held } = world();
    const branch = pieceCost('straight', 'branch'),
      main = pieceCost('straight', 'main');
    const each = (k: string) =>
      (main[k] - branch[k]) * builder.terrainMul(5, 10) * rules.buildCostMul;
    const check = builder.checkReclass(run, 'up');
    expect(check.ok).toBe(true);
    expect(check.changes).toHaveLength(4);
    expect(check.cost).toEqual({
      wood: 4 * each('wood'),
      stone: 4 * each('stone'),
      iron: 4 * each('iron'),
    });
    const before = held();
    expect(builder.reclassTrack(run, 'up')).toBe(true);
    expect(held()).toEqual([
      before[0] - check.cost.wood,
      before[1] - check.cost.stone,
      before[2] - check.cost.iron,
    ]);
    for (const t of run)
      expect(track.get(t.x, t.y)).toMatchObject({ kind: 'straight', cls: 'main' });
  });

  it('charges the difference of the list prices on any ground, stroke by stroke', () => {
    // sand and forest cost more than grass, and prices round up: rounding a difference instead
    // of each price must not add to the bill
    for (const ground of [Terrain.Sand, Terrain.Forest]) {
      const { builder, track, run, held } = world(ground);
      expect(builder.terrainMul(5, 10)).toBeGreaterThan(1);
      const list = (cls: 'branch' | 'main') =>
        builder.checkTrack(5, 14, { kind: 'straight', cls }, 1).cost;
      const branch = list('branch'),
        main = list('main');
      const before = held();
      let prev: { x: number; y: number } | undefined;
      for (const t of run) {
        expect(builder.reclassTrack([t], 'up', prev)).toBe(true);
        prev = t;
      }
      for (const t of run) expect(track.get(t.x, t.y)!.cls).toBe('main');
      const paid = held().map((v, i) => before[i] - v);
      expect(paid, `terrain ${ground}`).toEqual(
        ['wood', 'stone', 'iron'].map((k) => run.length * (main[k] - branch[k])),
      );
    }
  });

  it('downgrades for nothing and returns nothing', () => {
    const { builder, track, run, held } = world();
    builder.reclassTrack(run, 'up');
    const before = held();
    expect(builder.checkReclass(run, 'down')).toMatchObject({ ok: true, cost: {} });
    expect(builder.reclassTrack(run, 'down')).toBe(true);
    expect(held()).toEqual(before);
    for (const t of run) expect(track.get(t.x, t.y)!.cls).toBe('branch');
  });

  it('changes nothing when the upgrade cannot be paid for', () => {
    const { builder, track, stock, run, held } = world();
    stock.amounts.set('iron', 0);
    const check = builder.checkReclass(run, 'up');
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/iron/);
    const before = held();
    expect(builder.reclassTrack(run, 'up')).toBe(false);
    expect(held()).toEqual(before);
    for (const t of run) expect(track.get(t.x, t.y)!.cls).toBe('branch');
  });

  it('has nowhere to go below Branch or above Trunk', () => {
    const { builder, run } = world();
    expect(builder.checkReclass(run, 'down').reason).toBe(STR.build.reclass.noLine);
    builder.reclassTrack(run, 'up');
    builder.reclassTrack(run, 'up');
    expect(builder.checkReclass(run, 'up').reason).toBe(STR.build.reclass.noLine);
  });

  it('keeps what stands on the track', () => {
    const { builder, track, run } = world();
    const signal = builder.placeDecor(6, 10, 'signal', 0);
    expect(signal).not.toBeNull();
    track.get(7, 10)!.bridgeCapacity = 80;
    const refresh = vi.spyOn(builder, 'refreshBridgeCapacity');
    builder.reclassTrack(run, 'up');
    expect(builder.decorAt(6, 10)).toBe(signal);
    // a bridge's capacity is read again for every tile that was relaid
    expect(refresh.mock.calls.map(([x]) => x).sort()).toEqual([5, 6, 7, 8]);
  });
});

describe('curves and switches of another size', () => {
  it('leaves them as they are, red, and converts the straights beside them', () => {
    const { builder, track } = world();
    track.place(9, 10, 'curve', 0, 'branch');
    const curve = builder.checkReclass([{ x: 9, y: 10 }], 'up');
    expect(curve.ok).toBe(false);
    expect(curve.reason).toBe(STR.build.reclassSize('Main Line', 3, 2));
    // the whole curve is left, by its anchor, whichever of its tiles was pointed at
    const anchor = track.anchorOf(9, 10);
    for (const t of track.unitTiles(9, 10))
      expect(builder.checkReclass([t], 'up').left).toEqual([anchor]);
    const stroke = [
      { x: 8, y: 10 },
      { x: 9, y: 10 },
    ];
    const both = builder.checkReclass(stroke, 'up');
    expect(both.ok).toBe(true);
    expect(both.changes.map(({ x, y }) => ({ x, y }))).toEqual([{ x: 8, y: 10 }]);
    expect(both.left).toEqual([anchor]);
    expect(builder.reclassTrack(stroke, 'up')).toBe(true);
    expect(track.get(8, 10)!.cls).toBe('main');
    expect(track.get(9, 10)).toMatchObject({ kind: 'curve', cls: 'branch' });
  });

  it('converts a curve whose next line has curves of its size', () => {
    const { builder, track } = world();
    track.place(20, 20, 'curve', 0, 'main');
    const check = builder.checkReclass([{ x: 20, y: 20 }], 'up');
    expect(check.reason).toBe(STR.build.reclassSize('Trunk Line', 4, 3));
    expect(builder.checkReclass([{ x: 20, y: 20 }], 'down').left).toEqual([track.anchorOf(20, 20)]);
  });
});

describe('pieces a stroke must leave', () => {
  it('lists every piece of a line not open yet', () => {
    const { builder, track, run } = world();
    Object.assign(builder.economy, { tier: 0 });
    const check = builder.checkReclass(run, 'up');
    expect(check.ok).toBe(false);
    expect(check.left).toEqual(run);
    for (const t of run) expect(track.get(t.x, t.y)!.cls).toBe('branch');
  });

  it('lists the pieces it cannot pay for, with the bill', () => {
    const { builder, stock, run } = world();
    stock.amounts.set('iron', 0);
    const check = builder.checkReclass(run, 'up');
    expect(check.ok).toBe(false);
    expect(check.left).toEqual(run);
    expect(Object.keys(check.cost).length).toBeGreaterThan(0);
  });

  it('lists nothing for track already converted or off the standard network', () => {
    const { builder, track, run } = world();
    track.place(5, 20, 'straight', 1, 'narrow');
    expect(builder.checkReclass([{ x: 5, y: 20 }], 'up').left).toEqual([]);
    builder.reclassTrack(run, 'up');
    builder.reclassTrack(run, 'up');
    expect(builder.checkReclass(run, 'up').left).toEqual([]);
  });
});
