import { describe, it, expect, beforeEach, vi } from 'vitest';
import { emptyMap, generateMap } from '../world/mapgen';
import { TERRAIN_NAMES, Terrain, startRegion, type GameMap } from '../world/tiles';
import { RegionState } from '../world/regions';
import { TrackGraph, type TrackItem } from '../world/track';
import { DIRS, DIR_DX, DIR_DY } from '../engine/iso';
import { buildRelief, groundAllows } from '../render/terrainRelief';
import { repairBuiltTiles } from '../engine/loadRepair';
import { DEFAULT_CONTENT, validateContent, type ContentBundle } from '../data/content';
import { Builder } from './build';
import { BIOME_DEFS } from './biomes';
import { Economy } from './economy';
import { Stockpile } from './stockpile';
import { HARVEST_FLOOR, STATION_DEFS, Station, stationDef, terrainFactorAt } from './stations';
import { SAVE_MIN_VERSION, SAVE_VERSION, parseSave, type SaveGame } from './save';
import { pruneUnknownContent } from './saveContent';
import { DEFAULT_RULES, rules, weekSeconds } from './rules';
import { mapParams } from '../testing/simWorld';
import { STR } from '../strings';

// the build rules play a sound when a piece goes down
vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));
beforeEach(() => Object.assign(rules, DEFAULT_RULES));

const SIZE = 24;
const X = 10;
const Y = 10;
/** the refusals the approved demo gives, word for word */
const GROUND = 'A water pump goes only on grass or forest.';
const WATER = 'A water pump needs water right beside it.';
const STRAIGHT: TrackItem = { kind: 'straight', cls: 'regular', cls2: 'regular' };

/** A builder in editor mode (no cost, no age or chunk lock) on level grass, every chunk owned. */
function grassWorld() {
  const map = emptyMap(7, SIZE, SIZE, Terrain.Grass);
  const regions = new RegionState(map);
  for (let i = 0; i < regions.unlocked.length; i++) regions.own(i);
  const builder = new Builder(
    map,
    regions,
    new TrackGraph(SIZE, SIZE),
    new Economy(),
    new Stockpile(),
  );
  builder.free = true;
  return { map, builder };
}
function paint(map: GameMap, x: number, y: number, t: Terrain) {
  map.terrain[y * map.w + x] = t;
}
/**
 * A pump site at (X, Y) on `ground`: water on the side `water` (a `DIRS` entry) or on none, and
 * the platform track on the side opposite it.
 */
function site(ground: Terrain, water: number | null) {
  const w = grassWorld();
  paint(w.map, X, Y, ground);
  const side = water ?? DIRS[0];
  if (water !== null) paint(w.map, X + DIR_DX[water], Y + DIR_DY[water], Terrain.Water);
  w.builder.track.place(X - DIR_DX[side], Y - DIR_DY[side], 'straight', DIR_DX[side] ? 1 : 0);
  return w;
}

describe('where a water pump stands', () => {
  it('carries its two placement fields, apart from the terrain it draws from', () => {
    const def = stationDef('pump');
    expect(def.standOn).toEqual(['grass', 'forest']);
    expect(def.needsWater).toBe(true);
    expect(def.terrain).toBe('water');
    // the strings are the demo's, and its flavour says where it stands
    expect(STR.build.standOn.pump).toBe(GROUND);
    expect(STR.build.besideWater.pump).toBe(WATER);
    expect(def.flavor).toMatch(/grass or forest/);
    expect(def.flavor).toMatch(/water right beside it/);
  });

  it('stands on level grass or forest with water on any one of its four sides', () => {
    for (const ground of [Terrain.Grass, Terrain.Forest])
      for (const d of DIRS) {
        const { builder } = site(ground, d);
        const c = builder.checkStation(X, Y, 'pump');
        expect(c, `${TERRAIN_NAMES[ground]}, water toward ${d}`).toMatchObject({ ok: true });
        expect(c.reason).toBeUndefined();
      }
  });

  it('is refused with the water reason when the water lies only on a diagonal', () => {
    for (const ground of [Terrain.Grass, Terrain.Forest]) {
      const { map, builder } = site(ground, null);
      for (const [dx, dy] of [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ])
        paint(map, X + dx, Y + dy, Terrain.Water);
      expect(builder.checkStation(X, Y, 'pump')).toMatchObject({ ok: false, reason: WATER });
    }
  });

  it('is refused with the water reason when the water is a tile further out', () => {
    const { map, builder } = site(Terrain.Grass, null);
    paint(map, X + 2, Y, Terrain.Water);
    paint(map, X, Y + 2, Terrain.Water);
    expect(builder.checkStation(X, Y, 'pump')).toMatchObject({ ok: false, reason: WATER });
  });

  it('is refused on sand or a hill with the ground reason, water beside it or not', () => {
    for (const ground of [Terrain.Sand, Terrain.Hill])
      for (const water of [...DIRS, null]) {
        const { builder } = site(ground, water);
        expect(
          builder.checkStation(X, Y, 'pump'),
          `${TERRAIN_NAMES[ground]}, water toward ${water}`,
        ).toMatchObject({ ok: false, reason: GROUND });
      }
  });

  it('counts the water of any biome: lake, river, sea, swamp and the rest', () => {
    let tried = 0;
    for (let b = 0; b < BIOME_DEFS.length; b++) {
      const { map, builder } = site(Terrain.Grass, DIRS[1]);
      map.biome[(Y + DIR_DY[DIRS[1]]) * map.w + X + DIR_DX[DIRS[1]]] = b;
      expect(builder.checkStation(X, Y, 'pump').ok, BIOME_DEFS[b].id).toBe(true);
      tried++;
    }
    expect(tried).toBeGreaterThanOrEqual(6);
  });

  it('asks its own rules after the ones every station keeps, ground first, then water', () => {
    // no track beside it: the rule every station keeps speaks first
    const bare = grassWorld();
    paint(bare.map, X, Y, Terrain.Sand);
    expect(bare.builder.checkStation(X, Y, 'pump').reason).toBe(STR.build.needTrack);
    // ground that is not level, and an occupied tile, the same
    const slope = site(Terrain.Sand, null);
    slope.builder.groundCheck = (x, y, need) => need !== 'level' || x !== X || y !== Y;
    expect(slope.builder.checkStation(X, Y, 'pump').reason).toBe(STR.build.notLevel);
    const taken = site(Terrain.Sand, null);
    taken.builder.track.place(X, Y, 'straight', 0, 'regular');
    expect(taken.builder.checkStation(X, Y, 'pump').reason).toBe(STR.build.occupied);
    // where nothing can be built, that says so, water beside it or not
    for (const ground of [Terrain.Rock, Terrain.Mountain, Terrain.Water]) {
      const { builder } = site(ground, DIRS[2]);
      expect(builder.checkStation(X, Y, 'pump').reason).toBe(
        STR.build.nothingOn[TERRAIN_NAMES[ground] as 'rock'],
      );
    }
    // then the ground, before the water
    expect(site(Terrain.Sand, null).builder.checkStation(X, Y, 'pump').reason).toBe(GROUND);
  });

  it('asks them before the price', () => {
    for (const [ground, water, want] of [
      [Terrain.Sand, DIRS[0], GROUND],
      [Terrain.Grass, null, WATER],
    ] as const) {
      const { builder } = site(ground, water);
      // a game, not the editor, with nothing in the stock
      builder.free = false;
      expect(builder.checkStation(X, Y, 'pump').reason).toBe(want);
    }
    // where both are met, the price is what is asked next
    const { builder } = site(Terrain.Grass, DIRS[0]);
    builder.free = false;
    const c = builder.checkStation(X, Y, 'pump');
    expect(c.ok).toBe(false);
    expect(c.reason?.startsWith(STR.build.needResources(''))).toBe(true);
  });

  it('places as checked, with the ground factor its harvest gives it', () => {
    const { builder, map } = site(Terrain.Forest, DIRS[3]);
    const s = builder.placeStation(X, Y, 'pump');
    expect(s).not.toBeNull();
    expect(s!.terrainFactor).toBe(terrainFactorAt(map, X, Y, 'pump'));
    const refused = site(Terrain.Sand, DIRS[3]);
    expect(refused.builder.placeStation(X, Y, 'pump')).toBeNull();
    expect(refused.builder.stations).toEqual([]);
  });

  it('is the only station with ground rules of its own', () => {
    expect(STATION_DEFS.filter((d) => d.standOn || d.needsWater).map((d) => d.id)).toEqual([
      'pump',
    ]);
  });
});

describe('the placement fields in the content', () => {
  /** The shipped bundle with the pump's entry changed by `edit`. */
  function withPump(edit: (pump: Record<string, unknown>) => void): ContentBundle {
    const b = JSON.parse(JSON.stringify(DEFAULT_CONTENT)) as ContentBundle;
    edit(b.stations.defs.find((d) => d.id === 'pump') as unknown as Record<string, unknown>);
    return b;
  }

  it('ships valid, and takes any ground something can be built on', () => {
    expect(validateContent(DEFAULT_CONTENT)).toEqual([]);
    expect(validateContent(withPump((p) => (p.standOn = ['hill', 'sand'])))).toEqual([]);
    expect(validateContent(withPump((p) => delete p.standOn))).toEqual([]);
    expect(validateContent(withPump((p) => (p.needsWater = false)))).toEqual([]);
  });

  it('reports a standOn that lists no such ground, and a needsWater that is no flag', () => {
    for (const bad of [[], ['water'], ['rock'], ['grass', 'lava'], 'grass', 3, null])
      expect(validateContent(withPump((p) => (p.standOn = bad))), JSON.stringify(bad)).toEqual([
        expect.stringContaining('station pump: standOn'),
      ]);
    for (const bad of ['yes', 1, null])
      expect(validateContent(withPump((p) => (p.needsWater = bad))), JSON.stringify(bad)).toEqual([
        expect.stringContaining('station pump: needsWater'),
      ]);
  });
});

describe('a pump a save holds where it may no longer be placed', () => {
  /** A save of `version` holding one pump at (X, Y), as an older build wrote it. */
  function saveText(version: number): string {
    const save: SaveGame = {
      version,
      savedAt: 1700000000000,
      seed: 12345,
      clock: { time: 0, speedIndex: 1 },
      economy: { money: 1000, tickets: 0, tier: 0, granted: [] },
      track: [[X - 1, Y, 'straight', 1, 'regular', 'regular']],
      stations: [
        { id: 1, defId: 'pump', name: 'Water Pump', x: X, y: Y, level: 2, storage: { water: 5 } },
      ],
      trains: [],
      contracts: { contracts: [] },
      inventory: { items: [] },
      gacha: {},
      camera: { x: 0, y: 0, zoomIndex: 2 },
      lastDay: 0,
    };
    return JSON.stringify(save);
  }

  it('loads on sand far from water, and makes water on the ground factor it had', () => {
    for (const version of [SAVE_MIN_VERSION, SAVE_VERSION]) {
      // sand everywhere, no water within reach: what an older build placed it on
      const { map, builder } = grassWorld();
      map.terrain.fill(Terrain.Sand);
      const placed = terrainFactorAt(map, X, Y, 'pump');
      expect(placed).toBe(HARVEST_FLOOR);

      // the load as Game.applySave runs it: content pruned, built ground repaired, stations
      // restored, the harvest refreshed
      const save = parseSave(saveText(version));
      expect(save, `v${version}`).not.toBeNull();
      expect(pruneUnknownContent(save!).dropped).toEqual([]);
      expect(repairBuiltTiles(map, save!), `v${version}: the sand stays`).toEqual([]);
      for (const sj of save!.stations) builder.stations.push(Station.fromJSON(sj));
      builder.refreshHarvest();

      const pump = builder.stations[0];
      expect(pump.def.id).toBe('pump');
      expect(pump.level).toBe(2);
      expect(pump.terrainFactor, `v${version}`).toBe(placed);
      const before = pump.stored('water');
      pump.tick(weekSeconds());
      expect(pump.stored('water')).toBeGreaterThan(before);
      // a new pump is refused there, the one standing is not touched
      builder.track.place(X + 2, Y, 'straight', 1, 'regular');
      expect(builder.checkStation(X + 3, Y, 'pump').reason).toBe(GROUND);
      expect(builder.stations).toEqual([pump]);
    }
  });
});

/**
 * Whether a pump may stand somewhere in the start chunk of a new game's map: on a tile of the
 * chunk, with track laid beside it on a tile of the chunk, the builder's own check accepts it.
 * The ground counts as level where the renderer's relief says so, as in the game.
 */
function startChunkPumpTile(map: GameMap): { x: number; y: number } | null {
  const regions = new RegionState(map);
  const builder = new Builder(
    map,
    regions,
    new TrackGraph(map.w, map.h),
    new Economy(),
    new Stockpile(),
  );
  // the editor's leave: no cost, so only the ground decides; the chunk is kept to by hand
  builder.free = true;
  const relief = buildRelief(map, new Set());
  builder.groundCheck = (x, y, need) => groundAllows(map, relief, x, y, need);
  const rs = map.regionSize;
  const { rx, ry } = startRegion(map);
  const inChunk = (x: number, y: number) =>
    x >= rx * rs && y >= ry * rs && x < (rx + 1) * rs && y < (ry + 1) * rs;
  const water = (x: number, y: number) =>
    DIRS.some((d) => map.terrain[(y + DIR_DY[d]) * map.w + x + DIR_DX[d]] === Terrain.Water);
  for (let y = ry * rs; y < (ry + 1) * rs; y++)
    for (let x = rx * rs; x < (rx + 1) * rs; x++) {
      // only a tile with water beside it can take one: the builder judges those
      if (!water(x, y)) continue;
      for (const d of DIRS) {
        const tx = x + DIR_DX[d],
          ty = y + DIR_DY[d];
        if (!inChunk(tx, ty)) continue;
        const rot = DIR_DX[d] ? 1 : 0;
        if (!builder.checkTrack(tx, ty, STRAIGHT, rot).ok) continue;
        builder.track.place(tx, ty, 'straight', rot, 'regular');
        const ok = builder.checkStation(x, y, 'pump').ok;
        builder.track.removeAt(tx, ty);
        if (ok) return { x, y };
      }
    }
  return null;
}

/**
 * The seeds of 1 to 50 whose start chunk, at the default size, sliders and chain, has no tile a
 * pump may stand on when the pump rule came in (#320): their start lakes are ringed by sand. The
 * start guarantee is map generation's (#310), so it is not made here; once it lands this list is
 * emptied, and it never grows.
 */
const NO_PUMP_TILE_YET = [10, 29, 39];

describe('the start chunk of a new game', () => {
  it('has a tile where a pump may stand, over 50 seeds at the default size', () => {
    const size = DEFAULT_RULES.mapSize;
    const missing: number[] = [];
    for (let seed = 1; seed <= 50; seed++) {
      const map = generateMap(seed, mapParams(size));
      if (!startChunkPumpTile(map)) missing.push(seed);
    }
    expect(missing.filter((s) => !NO_PUMP_TILE_YET.includes(s))).toEqual([]);
  }, 120_000);
});
