import { describe, it, expect, vi, beforeEach } from 'vitest';
import { emptyMap } from '../world/mapgen';
import { Terrain } from '../world/tiles';
import { RegionState } from '../world/regions';
import { TrackGraph, pieceCost } from '../world/track';
import { Builder } from './build';
import { Stockpile } from './stockpile';
import { Economy } from './economy';
import { rules, DEFAULT_RULES } from './rules';
import { STR } from '../strings';

vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));
beforeEach(() => Object.assign(rules, DEFAULT_RULES));

function world() {
  const map = emptyMap(4242, 48, 48, Terrain.Grass),
    track = new TrackGraph(48, 48),
    stock = new Stockpile(),
    economy = new Economy();
  const regions = new RegionState(map);
  for (let i = 0; i < regions.unlocked.length; i++) regions.own(i);
  const builder = new Builder(map, regions, track, economy, stock);
  for (const k of ['wood', 'stone', 'iron']) stock.amounts.set(k, 1000);
  // a dead-end run of four wide straights
  for (let x = 5; x <= 8; x++) track.place(x, 10, 'straight', 1, 'regular');
  const run = [5, 6, 7, 8].map((x) => ({ x, y: 10 }));
  const held = () => ['wood', 'stone', 'iron'].map((k) => stock.get(k));
  return { map, track, builder, stock, run, held };
}

describe('upgrading and downgrading track', () => {
  it('charges the difference for an upgrade', () => {
    const { builder, track, run, held } = world();
    const wide = pieceCost('straight', 'regular'),
      fast = pieceCost('straight', 'high_speed');
    const each = (k: string) =>
      (fast[k] - wide[k]) * builder.terrainMul(5, 10) * rules.buildCostMul;
    const check = builder.checkReclass(run, 'high_speed');
    expect(check.ok).toBe(true);
    expect(check.changes).toHaveLength(4);
    expect(check.cost).toEqual({
      wood: 4 * each('wood'),
      stone: 4 * each('stone'),
      iron: 4 * each('iron'),
    });
    const before = held();
    expect(builder.reclassTrack(run, 'high_speed')).toBe(true);
    expect(held()).toEqual([
      before[0] - check.cost.wood,
      before[1] - check.cost.stone,
      before[2] - check.cost.iron,
    ]);
    for (const t of run)
      expect(track.get(t.x, t.y)).toMatchObject({ kind: 'straight', cls: 'high_speed' });
  });

  it('charges a transition as the piece it is', () => {
    const { builder, run } = world();
    // the first two of the run: one high-speed straight, one transition at the frontier
    const check = builder.checkReclass(run.slice(0, 2), 'high_speed');
    const wide = pieceCost('straight', 'regular'),
      fast = pieceCost('straight', 'high_speed'),
      joint = pieceCost('transition', 'regular');
    const k = builder.terrainMul(5, 10) * rules.buildCostMul;
    for (const res of ['wood', 'stone', 'iron'])
      expect(check.cost[res] ?? 0).toBe(
        (fast[res] - wide[res] + Math.max(0, joint[res] - wide[res])) * k,
      );
  });

  it('downgrades for nothing and returns nothing', () => {
    const { builder, track, run, held } = world();
    builder.reclassTrack(run, 'high_speed');
    const before = held();
    expect(builder.checkReclass(run, 'regular')).toMatchObject({ ok: true, cost: {} });
    expect(builder.reclassTrack(run, 'regular')).toBe(true);
    expect(held()).toEqual(before);
    for (const t of run)
      expect(track.get(t.x, t.y)).toMatchObject({ kind: 'straight', cls: 'regular' });
  });

  it('changes nothing when the upgrade cannot be paid for', () => {
    const { builder, track, stock, run, held } = world();
    stock.amounts.set('iron', 3);
    const check = builder.checkReclass(run, 'high_speed');
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/iron/);
    const before = held();
    expect(builder.reclassTrack(run, 'high_speed')).toBe(false);
    expect(held()).toEqual(before);
    for (const t of run) expect(track.get(t.x, t.y)!.cls).toBe('regular');
  });

  it('costs nothing where building is free', () => {
    const { builder, run, held } = world();
    builder.free = true;
    const before = held();
    expect(builder.checkReclass(run, 'high_speed').cost).toEqual({});
    expect(builder.reclassTrack(run, 'high_speed')).toBe(true);
    expect(held()).toEqual(before);
  });

  it('keeps what stands on the track', () => {
    const { builder, track, run } = world();
    const signal = builder.placeDecor(6, 10, 'signal', 0);
    expect(signal).not.toBeNull();
    track.get(7, 10)!.bridgeCapacity = 80;
    const refresh = vi.spyOn(builder, 'refreshBridgeCapacity');
    builder.reclassTrack(run, 'high_speed');
    expect(builder.decorAt(6, 10)).toBe(signal);
    // a bridge's capacity is read again for every tile that was relaid
    expect(refresh.mock.calls.map(([x]) => x).sort()).toEqual([5, 6, 7, 8]);
  });

  it('tells the renderer about every tile that changed', () => {
    const { builder, track } = world();
    const tiles = track.place(20, 20, 'curve', 0, 'regular');
    const seen: string[] = [];
    builder.onTrackChanged = (x, y) => seen.push(`${x},${y}`);
    builder.reclassTrack([{ x: 20, y: 20 }], 'high_speed');
    for (const t of tiles) expect(seen).toContain(`${t.x},${t.y}`);
    expect(track.get(20, 20)!.cls).toBe('high_speed');
  });

  it('says why nothing can be converted', () => {
    const { builder, track } = world();
    track.place(5, 20, 'straight', 1, 'narrow');
    expect(builder.checkReclass([{ x: 5, y: 20 }], 'high_speed')).toMatchObject({
      ok: false,
      reason: STR.build.reclass.narrow,
    });
    expect(builder.checkReclass([{ x: 30, y: 30 }], 'high_speed').reason).toBe(
      STR.build.reclass.nothing,
    );
    expect(builder.reclassTrack([{ x: 5, y: 20 }], 'high_speed')).toBe(false);
  });
});
