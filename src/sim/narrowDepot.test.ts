import { describe, it, expect, vi, beforeEach } from 'vitest';
import { emptyMap } from '../world/mapgen';
import { Terrain } from '../world/tiles';
import { RegionState } from '../world/regions';
import { TrackGraph, makePiece } from '../world/track';
import { Dir } from '../engine/iso';
import { Builder } from './build';
import { Stockpile } from './stockpile';
import { Economy } from './economy';
import { Fleet } from './fleet';
import { Inventory } from '../gacha/inventory';
import { Station, stationFootprint } from './stations';
import { locoDef } from '../gacha/items';
import { rules, DEFAULT_RULES } from './rules';
import { STR } from '../strings';

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

  it('keeps its turn through a level file', () => {
    const { builder } = world();
    const d = builder.placeStation(30, 30, 'narrow_depot', 1)!;
    d.level = 3;
    const back = Station.fromLevel(JSON.parse(JSON.stringify(d.toLevel())));
    expect(back.footprint()).toEqual(d.footprint());
    expect(back.gateTiles()).toEqual(d.gateTiles());
    expect(back.level).toBe(3);
    // an older level has no turn: the station stands the default way
    expect(Station.fromLevel({ defId: 'narrow_depot', x: 5, y: 5, level: 1, name: '' }).rot).toBe(
      0,
    );
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
    // the depot screen may still have the other gauge's depot selected: the consist's gauge wins
    expect(fleet.previewSpawn([mk48.uid], [], reg.id).depot?.id).toBe(nar.id);
    expect(fleet.previewSpawn([f7.uid], [], nar.id).depot?.id).toBe(reg.id);
  });

  it('says to build a narrow depot when there is none, whichever depot is selected', () => {
    const { builder, fleet, inventory } = world();
    const reg = builder.placeStation(10, 10, 'depot', 0)!;
    const mk48 = inventory.add('mk48', 0);
    expect(fleet.create([mk48.uid], [], [], undefined, 'schedule', reg.id)).toBe(
      STR.fleet.noNarrowDepot,
    );
    expect(fleet.previewSpawn([mk48.uid], [], reg.id).reason).toBe(STR.fleet.noNarrowDepot);
  });

  it('previews a selected narrow depot with a narrow engine when none is chosen', () => {
    const { builder, fleet } = world();
    builder.placeStation(10, 10, 'depot', 0);
    const nar = builder.placeStation(10, 30, 'narrow_depot', 0)!;
    const pv = fleet.previewSpawn([], [], nar.id);
    expect(pv.depot?.id).toBe(nar.id);
    expect(pv.reason ?? '').not.toMatch(/gauge/i);
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

describe('the narrow unlock hook', () => {
  it('bars narrow track and the narrow depot while narrow gauge is locked', () => {
    const { builder } = world();
    rules.narrowUnlocked = 0;
    const narrow = { kind: 'straight', cls: 'narrow' } as const;
    expect(builder.checkTrack(5, 5, narrow, 0).reason).toBe(STR.build.narrowLocked);
    expect(
      builder.checkTrack(5, 5, { kind: 'crossing', cls: 'narrow', cls2: 'regular' }, 0).reason,
    ).toBe(STR.build.narrowLocked);
    expect(builder.checkStation(20, 20, 'narrow_depot', 0).reason).toBe(STR.build.narrowLocked);
    expect(builder.checkTrack(5, 5, { kind: 'straight', cls: 'regular' }, 0).ok).toBe(true);
    rules.narrowUnlocked = 1;
    expect(builder.checkTrack(5, 5, narrow, 0).ok).toBe(true);
    expect(builder.checkStation(20, 20, 'narrow_depot', 0).ok).toBe(true);
  });
});

describe('laying narrow track against regular track', () => {
  it('says the gauges do not join instead of pointing at a transition', () => {
    const { builder, track } = world();
    track.place(10, 10, 'straight', 1, 'regular');
    const r = builder.checkTrack(11, 10, { kind: 'straight', cls: 'narrow' }, 1);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe(STR.build.gaugeBreak);
    // regular against high speed still asks for the transition
    const h = builder.checkTrack(11, 10, { kind: 'straight', cls: 'high_speed' }, 1);
    expect(h.reason).toBe(STR.build.needTransition);
  });
});

describe('a narrow line crossing a regular one', () => {
  it('serves only the stops on its own rails', () => {
    const { builder, fleet, track } = world();
    const ew = (cls: 'narrow' | 'regular') =>
      [0, 1].find((r) => makePiece('straight', r, cls).links[0].includes(Dir.E))!;
    const nar = builder.placeStation(20, 20, 'narrow_depot', 0)!;
    for (let x = 19; x <= 30; x++)
      if (x !== 26) track.place(x, 20, 'straight', ew('narrow'), 'narrow');
    // rotation 1: the narrow line runs east-west through the crossing, the regular one north-south
    track.place(26, 20, 'crossing', 1, 'narrow', 'regular');
    for (let y = 15; y <= 25; y++)
      if (y !== 20) track.place(26, y, 'straight', 1 - ew('regular'), 'regular');
    expect(track.connected(26, 20, Dir.E)).toBe(true);
    expect(track.connected(26, 20, Dir.N)).toBe(true);
    const quarry = builder.placeStation(29, 21, 'quarry', 0)!;
    const warehouse = builder.placeStation(27, 16, 'warehouse', 0)!;
    expect(builder.platformTiles(quarry).length).toBeGreaterThan(0);
    expect(builder.platformTiles(warehouse).length).toBeGreaterThan(0);
    const served = fleet.stationsServedBy(nar).map((s) => s.id);
    expect(served).toContain(quarry.id);
    expect(served).not.toContain(warehouse.id);
    expect(fleet.autoSchedule(nar).map((s) => s.stationId)).not.toContain(warehouse.id);
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
