import { describe, expect, it } from 'vitest';
import { Builder } from '../sim/build';
import { Economy } from '../sim/economy';
import { NO_LEVEL } from '../world/elevation';
import { emptyMap } from '../world/mapgen';
import { RegionState } from '../world/regions';
import { Terrain } from '../world/tiles';
import { TrackGraph } from '../world/track';
import type { LevelData } from '../world/level';
import { Editor } from './editor';
import { storeWith } from '../testing/storeFixtures';

const W = 32;

/** An editor over a real builder in free mode on a grass map; the renderer is faked. */
function harness() {
  const map = emptyMap(7, W, W, Terrain.Grass);
  const regions = new RegionState(map);
  regions.load([true, false, false, false]);
  const builder = new Builder(
    map,
    regions,
    new TrackGraph(W, W),
    new Economy(),
    storeWith({}).stores,
  );
  builder.free = true;
  const world = { retile: () => {}, setFlattened: () => {} };
  const editor = new Editor(map, builder, world as never, {} as LevelData);
  return { map, builder, editor };
}

describe('the editor over what the tools changed', () => {
  it('painting a tile in the editor clears its stored level and dug state', () => {
    const { map, builder, editor } = harness();
    map.groundLevel = new Uint8Array(W * W).fill(NO_LEVEL);
    map.groundLevel[4 * W + 4] = 3;
    map.groundLevel[4 * W + 5] = 3;
    builder.underground.dig(4, 4, 0);
    builder.underground.addPortal({ x: 4, y: 4, face: 'E', floor: 0 });
    builder.terrainEdits.set(4 * W + 4, Terrain.Rock);
    editor.paint(4, 4, Terrain.Sand);
    expect(map.groundLevel[4 * W + 4]).toBe(NO_LEVEL);
    expect(map.groundLevel[4 * W + 5]).toBe(3);
    expect(builder.underground.isDug(4, 4)).toBe(false);
    expect(builder.underground.portals()).toEqual([]);
    expect(builder.terrainEdits.has(4 * W + 4)).toBe(false);
  });

  it('clears them on a tile that has the terrain already', () => {
    const { map, builder, editor } = harness();
    map.groundLevel = new Uint8Array(W * W).fill(NO_LEVEL);
    map.groundLevel[4 * W + 4] = 3;
    builder.underground.dig(5, 5, 0);
    editor.paint(4, 4, Terrain.Grass);
    editor.paint(5, 5, Terrain.Grass);
    expect(map.groundLevel[4 * W + 4]).toBe(NO_LEVEL);
    expect(builder.underground.empty).toBe(true);
  });

  it('a filled map keeps none of them', () => {
    const { map, builder, editor } = harness();
    map.groundLevel = new Uint8Array(W * W).fill(NO_LEVEL);
    builder.underground.dig(5, 5, 0);
    builder.underground.cut(6, 5);
    editor.fillAll(Terrain.Sand);
    expect(map.groundLevel).toBeUndefined();
    expect(builder.underground.empty).toBe(true);
  });
});

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
