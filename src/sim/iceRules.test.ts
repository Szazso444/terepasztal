import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyMap } from '../world/mapgen';
import { RegionState } from '../world/regions';
import { TrackGraph, type TrackItem } from '../world/track';
import { Biome, Terrain } from '../world/tiles';
import { fallFeature } from '../world/waterfalls';
import { Dir } from '../engine/iso';
import { STR } from '../strings';
import { storeWith } from '../testing/storeFixtures';
import { Builder, DECOR_DEFS, unbuildable } from './build';
import { BUILDING_DEFS } from './buildings';
import { Economy } from './economy';
import { DEFAULT_RULES, rules } from './rules';
import { walkable } from './people';
import { cityTiles } from './city';
import type { House } from './houses';
import { STATION_DEFS, harvestBreakdown, stationFootprint } from './stations';

// the build rules play a sound when a piece goes down
vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));
beforeEach(() => Object.assign(rules, DEFAULT_RULES));

const SIZE = 24;
const X = 10;
const Y = 10;

function world(fill = Terrain.Grass) {
  const map = emptyMap(7, SIZE, SIZE, fill);
  const regions = new RegionState(map);
  for (let i = 0; i < regions.unlocked.length; i++) regions.own(i);
  const builder = new Builder(
    map,
    regions,
    new TrackGraph(SIZE, SIZE),
    new Economy(),
    storeWith({}).stores,
  );
  builder.free = true;
  builder.groundCheck = () => true;
  return { map, builder };
}
const ICE = STR.build.nothingOn.ice;
const STRAIGHT: TrackItem = { kind: 'straight', cls: 'branch' };
const BRIDGE: TrackItem = { kind: 'bridge', cls: 'branch' };

describe('glacier ice takes nothing', () => {
  it('names the ground in the refusal', () => {
    expect(unbuildable(Terrain.Ice)).toBe('Nothing can be built on ice.');
  });

  it('refuses track and a bridge piece', () => {
    const { builder } = world(Terrain.Ice);
    expect(builder.checkTrack(X, Y, STRAIGHT, 0).reason).toBe(ICE);
    expect(builder.checkTrack(X, Y, BRIDGE, 0).reason).toBe(ICE);
  });

  it('refuses a bridge platform, works and decor', () => {
    const { builder } = world(Terrain.Ice);
    const bridge = BUILDING_DEFS.find((d) => d.bridge)!;
    expect(builder.checkBuilding(X, Y, bridge.id).reason).toBe(ICE);
    const works = BUILDING_DEFS.find((d) => !d.bridge)!;
    expect(builder.checkBuilding(X, Y, works.id).reason).toBe(ICE);
    const decor = DECOR_DEFS.find((d) => !d.onTrack)!;
    expect(builder.checkDecor(X, Y, decor.id).reason).toBe(ICE);
  });

  it('refuses every station, and on every tile of its footprint', () => {
    for (const def of STATION_DEFS) {
      const { map, builder } = world();
      for (const t of stationFootprint(def.id, X, Y, 0).slice(-1))
        map.terrain[t.y * SIZE + t.x] = Terrain.Ice;
      expect(builder.checkStation(X, Y, def.id, 0).ok, def.id).toBe(false);
    }
  });

  it('is no water to a pump: ice on all four sides is refused for the water', () => {
    const { map, builder } = world();
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ])
      map.terrain[(Y + dy) * SIZE + X + dx] = Terrain.Ice;
    builder.track.place(X, Y + 1, 'straight', 0);
    const check = builder.checkStation(X, Y, 'pump', 0);
    expect(check.ok).toBe(false);
    expect(check.reason).toBe(STR.build.besideWater.pump ?? STR.build.needWaterside);
  });

  it('matches no station that counts its ground', () => {
    const { map } = world(Terrain.Ice);
    for (const def of STATION_DEFS.filter((d) => d.terrain)) {
      const b = harvestBreakdown(map, X, Y, def.id, 1, 'spring');
      expect(b?.sum ?? 0, def.id).toBe(0);
    }
  });

  it('keeps walkers off it, and towns too', () => {
    const { map } = world();
    map.terrain[Y * SIZE + X] = Terrain.Ice;
    expect(walkable(map, X, Y)).toBe(false);
    expect(walkable(map, X + 1, Y)).toBe(true);
    const house = { x: X, y: Y, residents: 300, progress: 1 } as House;
    const town = world();
    town.map.terrain[Y * SIZE + X] = Terrain.Ice;
    const paved = cityTiles(town.map, [house]);
    expect(paved.has(Y * SIZE + X)).toBe(false);
    expect(paved.has(Y * SIZE + X + 1)).toBe(true);
  });
});

describe('a waterfall is water', () => {
  function fall() {
    const w = world();
    const i = Y * SIZE + X;
    w.map.terrain[i] = Terrain.Water;
    w.map.biome[i] = Biome.River;
    w.map.waterSurface = new Uint8Array(SIZE * SIZE);
    w.map.flowDir = new Uint8Array(SIZE * SIZE);
    w.map.feature = new Uint8Array(SIZE * SIZE);
    w.map.waterSurface[i] = 2;
    w.map.flowDir[i] = 2;
    w.map.feature[i] = fallFeature(1, Dir.E);
    return w;
  }

  it('refuses everything a tile of water refuses', () => {
    const { builder } = fall();
    expect(builder.checkTrack(X, Y, STRAIGHT, 0).reason).toBe(STR.build.needBridge);
    const works = BUILDING_DEFS.find((d) => !d.bridge)!;
    expect(builder.checkBuilding(X, Y, works.id).reason).toBe(STR.build.nothingOn.water);
    const decor = DECOR_DEFS.find((d) => !d.onTrack)!;
    expect(builder.checkDecor(X, Y, decor.id).reason).toBe(STR.build.nothingOn.water);
  });

  it('takes a bridge platform', () => {
    const { builder } = fall();
    const bridge = BUILDING_DEFS.find((d) => d.bridge)!;
    expect(builder.checkBuilding(X, Y, bridge.id).reason).not.toBe(STR.build.nothingOn.water);
  });
});
