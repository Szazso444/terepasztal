import { describe, expect, it, vi } from 'vitest';
import { levelAt, NO_LEVEL, tileLevels } from '../world/elevation';
import { Terrain, type GameMap } from '../world/tiles';
import { CHUNK_TILES, expandSave } from './expand';
import { generatorOf, groundOf, type GeneratedWorld } from './ground';
import { builtNearEdge, growHolding } from './holdGround';
import { touchesWater, restoreGround, Underground } from './underground';
import { Builder } from './build';
import { Economy } from './economy';
import { RegionState } from '../world/regions';
import { TrackGraph } from '../world/track';
import { storeWith } from '../testing/storeFixtures';
import type { SaveGame } from './save';

// the build rules play a sound when something is dug
vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));

/** A save of a generated world with nothing on it, and the map it builds. */
function worldSave(seed: number, size: number) {
  const world: GeneratedWorld = {
    kind: 'generated',
    seed,
    params: { w: size, h: size, originX: 0, originY: 0 } as GeneratedWorld['params'],
  };
  const save = {
    seed,
    world,
    track: [],
    stations: [],
    trains: [],
    decor: [],
    buildings: [],
    roads: [],
    wires: [],
    regions: [],
    camera: { x: 0, y: 0, zoomIndex: 0 },
    underground: { dug: [], cuts: [], portals: [] },
    groundLevel: [],
  } as unknown as SaveGame;
  return { save, map: groundOf(world, generatorOf('simple')).map };
}

/** The map a save holds, read back as a load reads it. */
function loaded(save: SaveGame): GameMap {
  const { map } = groundOf(save.world as GeneratedWorld, generatorOf('simple'));
  restoreGround(map, save);
  return map;
}

describe('a map grown past what stands near its old edge', () => {
  it('keeps rail along an old edge on the levels it had (seed 42 on 96)', () => {
    const { save, map } = worldSave(42, 96);
    const before = tileLevels(map);
    const rail = [21, 22, 23, 24].map((y) => ({ y, level: before[y * 96] }));
    expect(rail.slice(0, 2).map((r) => r.level)).toEqual([1, 1]);
    save.track = rail.map(({ y }) => [0, y, 'straight', 0, 'branch', undefined]);

    growHolding(save, () => before);
    const d = CHUNK_TILES,
      grown = loaded(save),
      levels = tileLevels(grown);
    for (const { y, level } of rail) {
      expect(levels[(y + d) * grown.w + d], `tile 0,${y}`).toBe(level);
      expect(levelAt(grown, d, y + d)).toBe(level);
    }
  });

  it('without the hold the same rail stands on a step', () => {
    const { save } = worldSave(42, 96);
    expandSave(save, 1);
    const grown = tileLevels(loaded(save));
    const at = (y: number) => grown[(y + CHUNK_TILES) * (96 + 2 * CHUNK_TILES) + CHUNK_TILES];
    expect(Math.abs(at(21) - at(22))).toBeGreaterThan(1);
  });

  it('moves the neighbours, so every tile reads the settled level', () => {
    const { save, map } = worldSave(42, 96);
    const before = tileLevels(map);
    save.track = [20, 21, 22, 23, 24, 25].map((y) => [0, y, 'straight', 0, 'branch', undefined]);
    growHolding(save, () => before);
    const grown = loaded(save),
      levels = tileLevels(grown);
    for (let y = 0; y < grown.h; y++)
      for (let x = 0; x < grown.w; x++)
        expect(levelAt(grown, x, y), `${x},${y}`).toBe(levels[y * grown.w + x]);
    // something beside the rail would have stood more than a cliff over it
    expect(save.groundLevel!.length).toBeGreaterThan(0);
  });

  it('holds cuts and what a portal looks out at, and leaves far tiles out of the plane', () => {
    const under = new Underground(96, 96);
    under.dig(2, 40, 0);
    under.addPortal({ x: 2, y: 40, face: 'E', floor: 0 });
    under.cut(3, 41);
    const near = builtNearEdge(
      {
        track: [[48, 48, 'straight', 0, 'branch', undefined]],
        stations: [],
        underground: under.toJSON(),
      },
      96,
      96,
    );
    expect(new Set(near)).toEqual(new Set([40 * 96 + 3, 41 * 96 + 3]));
  });

  it('moves the terrain the tools changed with the tiles', () => {
    const { save } = worldSave(42, 96);
    save.groundTerrain = [[40, 41, Terrain.Rock]];
    expandSave(save, 1);
    expect(save.groundTerrain).toEqual([[40 + CHUNK_TILES, 41 + CHUNK_TILES, Terrain.Rock]]);
  });

  it('reads as a map generated at the larger size, past what the player changed', () => {
    const { save, map } = worldSave(42, 96);
    const size = 96 + 2 * CHUNK_TILES;
    save.track = [[48, 48, 'straight', 0, 'branch', undefined]];
    // raised ground in the middle of the old map, and a dug tile there
    const levels = tileLevels(map);
    save.groundLevel = [[48, 48, levels[48 * 96 + 48] + 1]];
    growHolding(save, () => levels);
    const at = tileLevels(loaded(save));
    const fresh: GeneratedWorld = {
      kind: 'generated',
      seed: 42,
      params: { ...(save.world as GeneratedWorld).params },
    };
    const same = tileLevels(groundOf(fresh, generatorOf('simple')).map);
    let differ = 0;
    for (let i = 0; i < at.length; i++) if (at[i] !== same[i]) differ++;
    // the one raised tile, and no more than the slope round it
    expect(differ).toBeLessThanOrEqual(9);
    expect(at[(48 + CHUNK_TILES) * size + 48 + CHUNK_TILES]).toBe(levels[48 * 96 + 48] + 1);
  });

  it('asks for no map when nothing stands near the edge', () => {
    const { save } = worldSave(42, 96);
    save.track = [[48, 48, 'straight', 0, 'branch', undefined]];
    const levels = vi.fn(() => new Uint8Array(96 * 96));
    growHolding(save, levels);
    expect(levels).not.toHaveBeenCalled();
    expect(save.groundLevel).toEqual([]);
  });

  it('leaves a level the player set as it was', () => {
    const { save, map } = worldSave(42, 96);
    save.groundLevel = [[0, 21, 0]];
    save.track = [[0, 21, 'straight', 0, 'branch', undefined]];
    map.groundLevel = new Uint8Array(96 * 96).fill(NO_LEVEL);
    growHolding(save, () => tileLevels(map));
    expect(save.groundLevel).toEqual([[CHUNK_TILES, 21 + CHUNK_TILES, 0]]);
  });
});

describe('a dug tile and the water of a new ring', () => {
  it('refuses the last row of the map, so no ring can bring water beside a dug tile', () => {
    const w = 64,
      map: GameMap = {
        ...(groundOf(
          {
            kind: 'generated',
            seed: 7,
            params: { w, h: w, originX: 0, originY: 0 } as GeneratedWorld['params'],
          },
          generatorOf('simple'),
        ).map as GameMap),
      };
    map.generatedLevel = new Uint8Array(w * w).fill(6);
    map.groundLevel = new Uint8Array(w * w).fill(6);
    map.terrain.fill(Terrain.Rock);
    const regions = new RegionState(map);
    regions.load(regions.unlocked.map(() => true));
    const { stores } = storeWith({}, { x: 8, y: 8 });
    const economy = new Economy();
    economy.money = 1e7;
    const b = new Builder(map, regions, new TrackGraph(w, w), economy, stores);
    for (const line of [
      [{ x: 0, y: 8 }],
      [{ x: 8, y: 0 }],
      [{ x: w - 1, y: 8 }],
      [{ x: 8, y: w - 1 }],
    ]) {
      const c = b.checkDig(line);
      expect(c.ok).toBe(false);
      expect(c.dig).toEqual([]);
    }
    expect(b.checkDig([{ x: 1, y: 8 }]).ok).toBe(true);
    // a dug tile one in from the edge has a whole row between it and any ring
    for (let y = 1; y < w - 1; y++) expect(touchesWater(map, 1, y)).toBe(false);
  });
});
