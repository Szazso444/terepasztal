import { describe, it, expect, vi, beforeEach } from 'vitest';
import { emptyMap } from '../world/mapgen';
import { Terrain } from '../world/tiles';
import { RegionState } from '../world/regions';
import { TrackGraph } from '../world/track';
import { Builder } from './build';
import { Stockpile } from './stockpile';
import { Economy } from './economy';
import { Fleet } from './fleet';
import { Inventory } from '../gacha/inventory';
import { stationFootprint } from './stations';
import { locoDef } from '../gacha/items';
import { rules, DEFAULT_RULES } from './rules';

vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));
beforeEach(() => Object.assign(rules, DEFAULT_RULES));
function world() {
  const map = emptyMap(4242, 64, 64, Terrain.Grass),
    track = new TrackGraph(64, 64),
    stock = new Stockpile(),
    economy = new Economy();
  const regions = new RegionState(map);
  for (let i = 0; i < regions.unlocked.length; i++) regions.own(i);
  const builder = new Builder(map, regions, track, economy, stock);
  builder.free = true;
  const inventory = new Inventory();
  const fleet = new Fleet(track, builder, map, inventory, economy, stock);
  return { map, track, builder, fleet, inventory };
}

describe('narrow depot', () => {
  it('stands on two tiles along its axis with a gate at each end', () => {
    const { builder } = world();
    const d = builder.placeStation(20, 20, 'narrow_depot', 0)!;
    expect(d.footprint()).toEqual([
      { x: 20, y: 20 },
      { x: 21, y: 20 },
    ]);
    expect(d.gateTiles()).toEqual([
      { x: 19, y: 20 },
      { x: 22, y: 20 },
    ]);
    expect(d.platforms).toBe(1);
    expect(d.covers(21, 20)).toBe(true);
    expect(d.covers(20, 21)).toBe(false);
  });

  it("puts a turned narrow depot's gates at its ends", () => {
    const { builder } = world();
    const d = builder.placeStation(30, 30, 'narrow_depot', 1)!;
    expect(d.footprint()).toEqual([
      { x: 30, y: 30 },
      { x: 30, y: 31 },
    ]);
    expect(d.gateTiles()).toEqual([
      { x: 30, y: 29 },
      { x: 30, y: 32 },
    ]);
    expect(stationFootprint('narrow_depot', 30, 30, 1)).toEqual(d.footprint());
  });

  it('has its own cap beside the regular depots', () => {
    const { builder } = world();
    expect(builder.placeStation(10, 10, 'depot', 0)).not.toBeNull();
    builder.free = false;
    expect(builder.checkStation(20, 10, 'depot', 0).reason).toMatch(/depot/i);
    expect(builder.checkStation(30, 10, 'narrow_depot', 0).reason).toBeUndefined();
    expect(builder.depotsOf('narrow')).toHaveLength(0);
    expect(builder.depotsOf('regular')).toHaveLength(1);
  });

  it('rolls narrow trains out of a narrow depot only', () => {
    const { builder, fleet, inventory } = world();
    const reg = builder.placeStation(10, 10, 'depot', 0)!;
    const nar = builder.placeStation(10, 30, 'narrow_depot', 0)!;
    const mk48 = inventory.add('mk48', 0);
    const f7 = inventory.add('f7', 0);
    expect(fleet.modelDeployReason(locoDef('mk48'), reg)).toMatch(/gauge/i);
    expect(fleet.modelDeployReason(locoDef('f7'), nar)).toMatch(/gauge/i);
    expect(fleet.create([mk48.uid], [], [], undefined, 'schedule', reg.id)).toMatch(/gauge/i);
    expect(fleet.create([f7.uid], [], [], undefined, 'schedule', nar.id)).toMatch(/gauge/i);
  });

  it('picks a narrow depot by itself for a narrow train', () => {
    const { builder, fleet, inventory } = world();
    builder.placeStation(10, 10, 'depot', 0);
    const nar = builder.placeStation(10, 30, 'narrow_depot', 0)!;
    const mk48 = inventory.add('mk48', 0);
    expect(fleet.previewSpawn([mk48.uid], [], null).depot?.id).toBe(nar.id);
  });

  it('refuses a mixed-gauge consist', () => {
    const { builder, fleet, inventory } = world();
    builder.placeStation(10, 30, 'narrow_depot', 0);
    const mk48 = inventory.add('mk48', 0);
    const box = inventory.add('boxcar', 0);
    expect(fleet.create([mk48.uid], [box.uid], [])).toMatch(/mix/i);
  });
});

describe('rollout preview without a chosen engine', () => {
  it('probes a depot with an engine of its own gauge', () => {
    const { fleet, inventory } = world();
    inventory.add('mk48', 0);
    inventory.add('f7', 0);
    expect(fleet.probeLoco('regular').def.gauge ?? 'regular').toBe('regular');
    expect(fleet.probeLoco('narrow').def.gauge).toBe('narrow');
    // nothing of that gauge owned: a starter of that gauge stands in
    const empty = world();
    expect(empty.fleet.probeLoco('narrow').def.gauge).toBe('narrow');
    expect(empty.fleet.probeLoco('regular').def.gauge ?? 'regular').toBe('regular');
  });
});
