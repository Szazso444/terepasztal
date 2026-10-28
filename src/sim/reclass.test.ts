import { describe, it, expect, vi, beforeEach } from 'vitest';
import { emptyMap } from '../world/mapgen';
import { Terrain } from '../world/tiles';
import { RegionState } from '../world/regions';
import { TrackGraph } from '../world/track';
import { Builder } from './build';
import { Stockpile } from './stockpile';
import { Economy } from './economy';
import { rules, DEFAULT_RULES } from './rules';
import { STR } from '../strings';

vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));
beforeEach(() => Object.assign(rules, DEFAULT_RULES));

function world(ground = Terrain.Grass) {
  const map = emptyMap(4242, 48, 48, ground),
    track = new TrackGraph(48, 48),
    stock = new Stockpile(),
    economy = new Economy();
  const regions = new RegionState(map);
  for (let i = 0; i < regions.unlocked.length; i++) regions.own(i);
  const builder = new Builder(map, regions, track, economy, stock);
  for (const k of ['wood', 'stone', 'iron']) stock.amounts.set(k, 1000);
  // a dead-end run of four Branch Line straights
  for (let x = 5; x <= 8; x++) track.place(x, 10, 'straight', 1, 'branch');
  const run = [5, 6, 7, 8].map((x) => ({ x, y: 10 }));
  const held = () => ['wood', 'stone', 'iron'].map((k) => stock.get(k));
  return { map, track, builder, stock, run, held };
}

describe('upgrading and downgrading track', () => {
  it('converts nothing and charges nothing while Branch is the only standard line', () => {
    const { builder, track, run, held } = world();
    const before = held();
    for (const dir of ['up', 'down'] as const) {
      const check = builder.checkReclass(run, dir);
      expect(check.ok).toBe(false);
      expect(check.changes).toEqual([]);
      expect(check.reason).toBe(STR.build.reclass.noLine);
      expect(builder.reclassTrack(run, dir)).toBe(false);
    }
    expect(held()).toEqual(before);
    for (const t of run) expect(track.get(t.x, t.y)!.cls).toBe('branch');
  });
});
