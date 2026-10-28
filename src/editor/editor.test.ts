import { describe, expect, it } from 'vitest';
import { Builder } from '../sim/build';
import { Economy } from '../sim/economy';
import { Stockpile } from '../sim/stockpile';
import { emptyMap } from '../world/mapgen';
import { RegionState } from '../world/regions';
import { Terrain } from '../world/tiles';
import { TrackGraph } from '../world/track';
import type { LevelData } from '../world/level';
import { Editor } from './editor';

const W = 32;

/** An editor over a real builder in free mode on a grass map; the renderer is faked. */
function harness() {
  const map = emptyMap(7, W, W, Terrain.Grass);
  const regions = new RegionState(map);
  regions.load([true, false, false, false]);
  const builder = new Builder(map, regions, new TrackGraph(W, W), new Economy(), new Stockpile());
  builder.free = true;
  const world = { retile: () => {}, setFlattened: () => {} };
  const editor = new Editor(map, builder, world as never, {} as LevelData);
  return { map, builder, editor };
}

describe('the editor over a bridge platform', () => {
  it('paints terrain over a platform with a road, leaving neither road nor platform', () => {
    const { map, builder, editor } = harness();
    map.terrain[4 * W + 4] = Terrain.Water;
    expect(builder.placeBuilding(4, 4, 'bridge_wood')).not.toBeNull();
    expect(builder.placeRoad(4, 4)).toBe(true);
    editor.paint(4, 4, Terrain.Sand);
    expect(builder.roads.has(4, 4)).toBe(false);
    expect(builder.buildingAt(4, 4)).toBeUndefined();
    expect(map.terrain[4 * W + 4]).toBe(Terrain.Sand);
  });

  it('paints terrain over a platform with rail, leaving neither track nor platform', () => {
    const { map, builder, editor } = harness();
    map.terrain[4 * W + 4] = Terrain.Water;
    expect(builder.placeBuilding(4, 4, 'bridge_wood')).not.toBeNull();
    expect(builder.placeTrack(4, 4, { kind: 'straight', cls: 'branch' }, 1)).toBe(true);
    editor.paint(4, 4, Terrain.Sand);
    expect(builder.track.has(4, 4)).toBe(false);
    expect(builder.buildingAt(4, 4)).toBeUndefined();
  });

  it('clears every road and platform when the whole map is filled', () => {
    const { map, builder, editor } = harness();
    map.terrain[4 * W + 4] = Terrain.Water;
    expect(builder.placeBuilding(4, 4, 'bridge_wood')).not.toBeNull();
    expect(builder.placeRoad(4, 4)).toBe(true);
    expect(builder.placeRoad(8, 8)).toBe(true);
    editor.fillAll(Terrain.Grass);
    expect(builder.roads.size).toBe(0);
    expect(builder.buildings.size).toBe(0);
  });
});
