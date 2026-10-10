import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  SAVE_VERSION,
  SAVE_MIN_VERSION,
  SAVE_KEY,
  SETTINGS_KEY,
  SLOTS_KEY,
  MIGRATIONS,
  KNOWN_SAVE_KEYS,
  DEFAULT_SETTINGS,
  migrate,
  buildSave,
  readSaveText,
  parseSave,
  readSave,
  writeSave,
  importSave,
  listSlots,
  writeSlot,
  readSlot,
  hasSlot,
  continueMeta,
  migrateSettings,
  readSettings,
  writeSettings,
  contractPolicyFor,
  uniformContractPolicy,
  CONTRACT_POLICY_VERSION,
  convertOneTileRegular,
  CONTRACT_RARITIES,
  type SaveGame,
  type SaveParts,
  type SaveRefusal,
  type Settings,
  type WorldSpec,
} from './save';
import {
  BRIDGE_MAX_LEVEL,
  buildingFromJSON,
  buildingToJSON,
  type Building,
  type BuildingJSON,
} from './buildings';
import { MAX_LEVEL } from './levels';
import type { Work } from './upgrade';
import type { HousesJSON } from './houses';
import { simWorld } from '../testing/simWorld';
import { TradeDesk } from './trade';
import { Train, DYNAMIC_MODES, resetTrainIds, type RouteMode } from './trains';
import { Station, resetStationIds, type StationJSON } from './stations';
import { Economy } from './economy';
import { rules, DEFAULT_RULES } from './rules';
import { locoDef, wagonDef } from '../gacha/items';
import { DEFAULT_MAP_PARAMS, emptyMap, generateMap } from '../world/mapgen';
import { levelFromMap, mapFromLevel } from '../world/level';
import { RegionState } from '../world/regions';
import { TrackGraph } from '../world/track';
import type { GameMap } from '../world/tiles';
import type { Rng } from '../engine/rng';
import { forAll, shrinkArray, shrinkInt } from '../testing/property';

// trains.ts plays sounds; the load-code oracles below build trains under Node
vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));

/** The oldest shape the chain still accepts, with nothing optional filled in. */
function oldestSave(): SaveGame {
  return {
    version: SAVE_MIN_VERSION,
    savedAt: 1700000000000,
    seed: 12345,
    clock: { time: 0, speedIndex: 1 },
    economy: { money: 1000, tickets: 0, tier: 0, granted: [] },
    track: [],
    stations: [],
    trains: [],
    contracts: { contracts: [] },
    inventory: { items: [] },
    gacha: {},
    camera: { x: 0, y: 0, zoomIndex: 2 },
    lastDay: 0,
  };
}

/**
 * Every part a save of the current build is written from, each one set. Typed as `SaveParts`, so
 * a new part fails the typecheck here until the fixture carries it too.
 */
function fullParts(): SaveParts {
  return {
    seed: 777,
    clock: { time: 1234.5, speedIndex: 2 },
    economy: { money: 12345, tickets: 3, tier: 2, granted: [0, 1, 2], earned: 9000 },
    track: [
      [4, 8, 'straight', 1, 'regular', 'regular'],
      [12, 8, 'crossing', 0, 'narrow', 'high_speed'],
    ],
    stations: [{ id: 1, defId: 'town', name: 'Alder', x: 3, y: 3, level: 1, storage: {}, rot: 0 }],
    trains: [{ id: 1 }],
    contracts: { contracts: [], rng: 42 },
    inventory: { items: [], nextUid: 1 },
    gacha: { pity: 0 },
    camera: { x: 10, y: 20, zoomIndex: 3 },
    lastDay: 42,
    decor: [[5, 6, 'signal', 1]],
    wires: [[4, 8, 'electric']],
    weather: { kind: 'clear', intensity: 0, nextChangeAt: 5, rng: 9 },
    world: { kind: 'generated', seed: 777, params: { ...DEFAULT_MAP_PARAMS } },
    rules: { contractOfferCount: 1 },
    stockpile: { amounts: { food: 600 }, famine: false },
    buildings: [[7, 7, 'sawmill', 0.5, 2]],
    regions: [true, false],
    seasonOffset: 1,
    towns: [{ id: 1, name: 'Alder', stationId: 1, custom: false, color: 0 }],
    trade: { nextAt: 0, driftDay: 0 },
    crafting: { recipes: [], stats: { unlocks: 0, crafts: 0, failures: 0 } },
    houses: { list: [], arrivals: [], visited: [] },
    supply: 'simple',
    people: { rng: 31337 },
  };
}

describe('the migration registry', () => {
  it('has a step for every version the chain has to cross', () => {
    // Adding a save format version means adding a step here; without one, `migrate` skips the
    // version with a "defaults apply" note and the save quietly loses whatever it held.
    const froms = MIGRATIONS.map((m) => m.from);
    const wanted = Array.from(
      { length: SAVE_VERSION - SAVE_MIN_VERSION },
      (_, i) => SAVE_MIN_VERSION + i,
    );
    expect(froms).toEqual(wanted);
  });

  it('describes what each step fills in', () => {
    for (const m of MIGRATIONS) expect(m.note.trim().length).toBeGreaterThan(0);
  });

  it('has no step that leaves the file as it found it', () => {
    // An empty step tells the player a default was filled in and leaves the load code to keep
    // the promise. Each step meets a file of its own version with nothing optional in it, the
    // old offer defaults the step to v11 rewrites, a train with nothing but its id for the
    // steps that fill a train's fields, a station with no turn and no work for the steps that
    // fill a station's, and past the step that starts the works list, a works with no level, no
    // work and no rotation for the steps that fill a works'.
    for (const m of MIGRATIONS) {
      const file: SaveGame = {
        ...oldestSave(),
        version: m.from,
        rules: { contractRefreshDays: 1.5, contractOfferCount: 3 },
        trains: [{ id: 1 }],
        stations: [stationOf('farm', undefined)],
        ...(m.from > 3 ? { buildings: [[7, 7, 'kiln', 0] as BuildingJSON] } : {}),
      };
      const before = asStored(file);
      m.run(file);
      expect.soft(asStored(file), `the step from v${m.from}`).not.toEqual(before);
    }
  });

  it('fills every field a step promises, from whichever version the file starts at', () => {
    const list = (v: unknown) => Array.isArray(v);
    const block = (v: unknown) => isObject(v);
    /** The step that fills each field a file may lack, and what the field holds after it. */
    const filled: [from: number, key: keyof SaveParts, holds: (v: unknown) => boolean][] = [
      [1, 'decor', list],
      [2, 'world', block],
      [3, 'buildings', list],
      [4, 'regions', (v) => list(v) && (v as unknown[]).every((o) => typeof o === 'boolean')],
      [5, 'seasonOffset', (v) => typeof v === 'number'],
      [6, 'towns', list],
      [7, 'trade', block],
      [8, 'houses', block],
      [8, 'supply', (v) => typeof v === 'string'],
      [9, 'crafting', block],
    ];
    for (let version = SAVE_MIN_VERSION; version < SAVE_VERSION; version++) {
      const j = migrate({ ...oldestSave(), version });
      for (const [from, key, holds] of filled)
        if (from >= version) expect(holds(j[key]), `from v${version}: ${key}`).toBe(true);
    }
  });

  it('says which defaults are applied on load, where the world they need is built', () => {
    const note = (from: number) => MIGRATIONS.find((m) => m.from === from)!.note;
    expect(note(6)).toMatch(/depot placed at the start \(applied on load\)/);
    expect(note(8)).toMatch(/catenary strung over rails the poles powered \(applied on load\)/);
    expect(note(9)).toMatch(/locomotive modes set by the default rule \([^)]*applied on load\)/);
  });

  it('knows every field a save is written with, and every field the migration leaves', () => {
    // A field written but not known is copied into the extras on load and written back twice.
    for (const key of Object.keys(buildSave(fullParts())))
      expect(KNOWN_SAVE_KEYS.has(key), key).toBe(true);
    for (const key of Object.keys(migrate(oldestSave())))
      expect(KNOWN_SAVE_KEYS.has(key), key).toBe(true);
  });

  it('knows exactly the fields SaveGame declares', () => {
    // A field read on load but missing from KNOWN_SAVE_KEYS is also copied into the extras and
    // written back twice; a known key nobody declares hides an unknown field from the extras.
    expect([...KNOWN_SAVE_KEYS].sort()).toEqual(Object.keys(DECLARED).sort());
  });
});

/** SaveGame's declared fields, without the index signature that carries unknown ones. */
type Declared<T> = {
  [K in keyof T as string extends K ? never : number extends K ? never : K]: T[K];
};
/**
 * Every field SaveGame declares, once. Declaring a field without listing it here, or listing one
 * SaveGame does not declare, fails the typecheck; the test above holds KNOWN_SAVE_KEYS to it.
 */
const DECLARED: Record<keyof Declared<SaveGame>, true> = {
  version: true,
  savedAt: true,
  seed: true,
  clock: true,
  economy: true,
  track: true,
  stations: true,
  trains: true,
  contracts: true,
  inventory: true,
  gacha: true,
  camera: true,
  lastDay: true,
  decor: true,
  wires: true,
  weather: true,
  world: true,
  rules: true,
  stockpile: true,
  buildings: true,
  regions: true,
  seasonOffset: true,
  towns: true,
  settings: true,
  trade: true,
  crafting: true,
  houses: true,
  supply: true,
  people: true,
  loadedFrom: true,
  migrationNotes: true,
};

describe("the walkers' stream", () => {
  it('comes through the migration from every version, and is never made up', () => {
    // absent means "seed it from the map": no step may fill in a stream of its own
    forAll(
      (rng) => ({
        version: rng.int(SAVE_MIN_VERSION, SAVE_VERSION),
        rng: rng.chance(0.75) ? rng.int(0, 0xffffffff) : null,
      }),
      ({ version, rng }) => {
        const save: SaveGame = { ...oldestSave(), version };
        if (rng !== null) save.people = { rng };
        const j = parseSave(JSON.stringify(save));
        expect(j?.version).toBe(SAVE_VERSION);
        if (rng === null) expect(j && 'people' in j).toBe(false);
        else expect(j?.people).toEqual({ rng });
      },
    );
  });
});

describe("the contract board's stream", () => {
  it('comes through the migration from every version, and is never made up', () => {
    // absent means "the board's reseeded stream": no step may drop the saved one or make one up
    forAll(
      (rng) => ({
        version: rng.int(SAVE_MIN_VERSION, SAVE_VERSION),
        rng: rng.chance(0.75) ? rng.int(0, 0xffffffff) : null,
        // the steps that rewrite the board's contracts have something to rewrite
        contracts: Array.from({ length: rng.int(0, 4) }, (_, i) => ({
          id: i + 1,
          cargo: rng.pick(['passengers', 'wood', 'grain']),
          status: rng.pick(['offer', 'active', 'done', 'expired']),
        })),
      }),
      ({ version, rng, contracts }) => {
        const board: Record<string, unknown> = { contracts, nextRefresh: 0 };
        if (rng !== null) board.rng = rng;
        const j = parseSave(JSON.stringify({ ...oldestSave(), version, contracts: board }));
        expect(j?.version).toBe(SAVE_VERSION);
        const after = j?.contracts as Record<string, unknown> | undefined;
        expect((after?.contracts as unknown[] | undefined)?.length).toBe(contracts.length);
        if (rng === null) expect(after && 'rng' in after).toBe(false);
        else expect(after?.rng).toBe(rng);
      },
      {
        // fewer contracts, then a newer version: fewer steps to cross
        shrink: function* (c) {
          for (const contracts of shrinkArray(c.contracts)) yield { ...c, contracts };
          for (const version of shrinkInt(c.version, SAVE_VERSION)) yield { ...c, version };
        },
      },
    );
  });
});

describe('migrate', () => {
  it('walks the oldest save all the way to the current version', () => {
    const j = migrate(oldestSave());
    expect(j.version).toBe(SAVE_VERSION);
    expect(j.loadedFrom).toBe(SAVE_MIN_VERSION);
    expect(j.migrationNotes).toHaveLength(SAVE_VERSION - SAVE_MIN_VERSION);
    expect(j.migrationNotes?.[0]).toContain('v1→v2');
    // Nothing may be left undone by the steps that promise a default.
    expect(j.decor).toEqual([]);
    expect(j.buildings).toEqual([]);
    expect(j.world).toEqual({ kind: 'generated', seed: 12345, params: expect.any(Object) });
    expect(j.regions).toEqual(expect.any(Array));
    expect(j.regions!.filter((owned) => owned === true)).toHaveLength(1);
    expect(j.seasonOffset).toBe(0);
    expect(j.towns).toEqual([]);
    expect(j.trade).toEqual(expect.any(Object));
    expect(j.supply).toBe('simple');
  });

  it('leaves a current save alone', () => {
    const j = migrate({ ...oldestSave(), version: SAVE_VERSION });
    expect(j.version).toBe(SAVE_VERSION);
    expect(j.loadedFrom).toBeUndefined();
    expect(j.migrationNotes).toBeUndefined();
  });

  it('is idempotent once it has run', () => {
    const once = migrate(oldestSave());
    const notes = once.migrationNotes;
    const twice = migrate(once);
    expect(twice.version).toBe(SAVE_VERSION);
    expect(twice.migrationNotes).toBe(notes);
  });

  it('loads a newer save as it stands and records where it came from', () => {
    const j = migrate({ ...oldestSave(), version: SAVE_VERSION + 3 });
    expect(j.version).toBe(SAVE_VERSION + 3);
    expect(j.loadedFrom).toBe(SAVE_VERSION + 3);
    expect(j.migrationNotes).toEqual([]);
  });

  it('carries fields it does not know through untouched', () => {
    const j = migrate({ ...oldestSave(), somethingNewer: { a: 1, b: [2, 3] } });
    expect(j.somethingNewer).toEqual({ a: 1, b: [2, 3] });
    expect(KNOWN_SAVE_KEYS.has('somethingNewer')).toBe(false);
  });
});

/** The step from `from` alone, run on `file`. */
function runStep(from: number, file: SaveGame): SaveGame {
  MIGRATIONS.find((m) => m.from === from)!.run(file);
  return file;
}

describe('v4 to v5', () => {
  /** A level of `w` by `h` tiles, as the editor saves one. */
  const levelWorld = (w: number, h: number): WorldSpec => ({
    kind: 'level',
    seed: 5,
    level: levelFromMap(emptyMap(5, w, h), 'Test', 'test'),
  });
  const generatedWorld = (w: number, h: number): WorldSpec => ({
    kind: 'generated',
    seed: 77,
    params: { ...DEFAULT_MAP_PARAMS, w, h },
  });
  /** The map `generatedWorld(w, h)` builds. */
  const generatedMap = (w: number, h: number) => generateMap(77, { ...DEFAULT_MAP_PARAMS, w, h });

  /** A v4 file of `world` whose economy stored `tier`, or no tier at all. */
  const v4 = (world: WorldSpec, tier?: unknown): SaveGame => {
    const economy: Record<string, unknown> = { money: 1000, tickets: 0, granted: [] };
    if (tier !== undefined) economy.tier = tier;
    return { ...oldestSave(), version: 4, world, economy: economy as SaveGame['economy'] };
  };
  /**
   * The chunks the load code owned in a file without `regions`, on the map the world builds: the
   * start chunk (`new RegionState(map, 0)`), then `applyTier` with the tier reached.
   */
  const ownedOnLoad = (map: GameMap, tier: number) => {
    const regions = new RegionState(map, 0);
    regions.applyTier(tier);
    return regions.unlocked;
  };

  it('owns what the load code gave the tier, on the default map', () => {
    const world = generatedWorld(DEFAULT_MAP_PARAMS.w, DEFAULT_MAP_PARAMS.h);
    const map = generatedMap(DEFAULT_MAP_PARAMS.w, DEFAULT_MAP_PARAMS.h);
    const one = migrate(v4(world, 1)).regions!;
    expect(one).toEqual(ownedOnLoad(map, 1));
    expect(one.filter((owned) => owned)).toHaveLength(9);
    const zero = migrate(v4(world, 0)).regions!;
    expect(zero).toEqual(ownedOnLoad(map, 0));
    expect(zero).toEqual([false, false, false, false, true, false, false, false, false]);
  });

  it('owns the rings of the tier the file stored, before the step from v8 caps it', () => {
    // On a grid with a middle chunk, regionTierMap's rings are whole chunks from the start, so
    // the load code's result holds for every tier, the ones past the Electric Age included.
    for (const [w, h] of [
      [96, 96],
      [160, 160],
      [224, 96],
      [32, 224],
    ]) {
      const world = generatedWorld(w, h);
      const map = generatedMap(w, h);
      for (const tier of [0, 1, 2, 3, 4])
        expect(migrate(v4(world, tier)).regions, `${w}×${h} tier ${tier}`).toEqual(
          ownedOnLoad(map, tier),
        );
    }
  });

  it('reads a missing or unusable tier as 0', () => {
    const world = generatedWorld(160, 160);
    const startOnly = ownedOnLoad(generatedMap(160, 160), 0);
    for (const tier of [undefined, -2, Number.NaN, '3', null])
      expect(migrate(v4(world, tier)).regions, String(tier)).toEqual(startOnly);
    const noEconomy = { ...v4(world), economy: undefined } as unknown as SaveGame;
    expect(runStep(4, noEconomy).regions).toEqual(startOnly);
  });

  it('owns only the chunk map generation starts in at tier 0, on the grid the world builds', () => {
    for (const world of [
      generatedWorld(96, 96),
      generatedWorld(160, 64),
      generatedWorld(20, 300),
      levelWorld(100, 70),
      levelWorld(20, 20),
    ]) {
      const j = migrate({ ...oldestSave(), version: 4, world });
      const map =
        world.kind === 'level' ? mapFromLevel(world.level) : generateMap(77, world.params);
      const label = `${map.w}×${map.h}`;
      // the game builds this map and loads the chunks into it: a list of another length is ignored
      const regions = new RegionState(map);
      regions.load(j.regions!);
      expect(regions.unlocked, label).toEqual(j.regions);
      expect(regions.ownedCount(), label).toBe(1);
      const startX = (Math.floor((map.regionsX - 1) / 2) + 0.5) * map.regionSize;
      const startY = (Math.floor((map.regionsY - 1) / 2) + 0.5) * map.regionSize;
      expect(regions.isTileUnlocked(startX, startY), label).toBe(true);
    }
  });

  it('keeps the chunks a save already owns', () => {
    const regions = [false, true, true, false];
    expect(runStep(4, { ...oldestSave(), version: 4, regions }).regions).toBe(regions);
  });
});

describe('v5 to v6', () => {
  it('starts day 1 in spring, unless the save says otherwise', () => {
    expect(runStep(5, { ...oldestSave(), version: 5 }).seasonOffset).toBe(0);
    expect(runStep(5, { ...oldestSave(), version: 5, seasonOffset: 2 }).seasonOffset).toBe(2);
  });
});

describe('v6 to v7', () => {
  const station = (id: number, rot?: number) => ({
    id,
    defId: 'farm',
    name: `Farm ${id}`,
    x: id,
    y: id,
    level: 1,
    storage: {},
    ...(rot === undefined ? {} : { rot }),
  });

  it('maps route modes to their new names the way a train loads them', () => {
    const j = migrate({
      ...oldestSave(),
      version: 6,
      trains: [
        { id: 1, mode: 'fixed' },
        { id: 2, mode: 'collect' },
        { id: 3, dynamic: true },
        { id: 4, mode: 'dynamic' },
        { id: 5 },
        { id: 6, dynamic: false },
        // the mode wins over the flag, as it does on load
        { id: 7, mode: 'fixed', dynamic: true },
        // a mode under its new name stays
        { id: 8, mode: 'transport' },
      ],
    });
    expect((j.trains as { mode: unknown }[]).map((t) => t.mode)).toEqual([
      'schedule',
      'collection',
      'production',
      'production',
      'schedule',
      'schedule',
      'schedule',
      'transport',
    ]);
  });

  it('turns stations to orientation 0 where they have none, and starts towns empty', () => {
    const j = migrate({ ...oldestSave(), version: 6, stations: [station(1), station(2, 1)] });
    expect(j.stations.map((s) => s.rot)).toEqual([0, 1]);
    expect(j.towns).toEqual([]);
    const towns = [{ id: 1, name: 'Alder', stationId: 1, custom: false, color: 0 }];
    expect(runStep(6, { ...oldestSave(), version: 6, towns }).towns).toBe(towns);
  });
});

describe('v7 to v8', () => {
  it('opens the trade desk a fresh game saves, the one a file without a desk loads as', () => {
    const j = runStep(7, { ...oldestSave(), version: 7 });
    expect(j.trade).toEqual(new TradeDesk().toJSON());
    const filled = new TradeDesk();
    filled.load(j.trade as Parameters<TradeDesk['load']>[0]);
    const missing = new TradeDesk();
    missing.load(undefined);
    expect(filled.toJSON()).toEqual(missing.toJSON());
  });

  it('maps every old route-mode name a v7 file can hold, so its train loads with the mode', () => {
    // The modes were renamed while saves were v7: a file written before the renaming holds the
    // old names, and never met the step from v6 that maps them.
    const track = new TrackGraph(8, 8);
    expect([...OLD_MODE_TO_NEW.keys()]).toEqual(['fixed', 'dynamic', 'collect']);
    for (const [old, now] of OLD_MODE_TO_NEW) {
      const file = { ...oldestSave(), version: 7, trains: [withOld(savedTrain(), { mode: old })] };
      expect((runStep(7, asStored(file) as SaveGame).trains[0] as OldTrain).mode, old).toBe(now);
      const train = migrate(file).trains[0];
      expect(Train.fromJSON(asStored(train) as TrainJSON, track).mode, old).toBe(now);
    }
    // a v7 file written after the renaming keeps its modes
    const kept = runStep(7, {
      ...oldestSave(),
      version: 7,
      trains: ROUTE_MODES.map((mode, id) => ({ id, mode })),
    });
    expect(kept.trains.map((t) => (t as OldTrain).mode)).toEqual(ROUTE_MODES);
  });

  it('keeps a desk the save already has, and no longer speaks of settings', () => {
    const trade = { deals: { coal: 5 }, nextAt: 10, fuelMul: 1.2, driftDay: 3 };
    expect(runStep(7, { ...oldestSave(), version: 7, trade }).trade).toBe(trade);
    expect(MIGRATIONS.find((m) => m.from === 7)!.note).not.toMatch(/setting/i);
  });
});

describe('v8 to v9', () => {
  function v8(extra: Partial<SaveGame> = {}): SaveGame {
    return {
      ...oldestSave(),
      version: 8,
      economy: { money: 5, tickets: 0, tier: 7, granted: [], reputation: 300 },
      contracts: { contracts: [{ id: 'c1', reputation: 12 }] },
      decor: [
        [3, 4, 'townhouse', 0],
        [5, 6, 'signal', 1],
        [7, 8, 'townhouse', 2],
      ],
      ...extra,
    };
  }

  it('rates old contracts common, unassigns them and drops reputation', () => {
    const j = migrate(v8());
    const book = j.contracts as { contracts: Record<string, unknown>[] };
    expect(book.contracts[0]).toEqual({ id: 'c1', rarity: 'common', trainId: null });
  });

  it('caps the age at the Electric Age and starts lifetime income at zero', () => {
    const j = migrate(v8());
    expect(j.economy.tier).toBe(2);
    expect(j.economy.earned).toBe(0);
    expect(j.economy.reputation).toBeUndefined();
    expect(
      migrate(v8({ economy: { money: 0, tickets: 0, tier: 1, granted: [] } })).economy.tier,
    ).toBe(1);
  });

  it('turns every townhouse in the decor into a level 1 house', () => {
    const j = migrate(v8());
    // the step to v15 then says no house is being upgraded
    expect(j.houses?.list).toEqual([
      { x: 3, y: 4, level: 1, residents: 6, progress: 1, work: null },
      { x: 7, y: 8, level: 1, residents: 6, progress: 1, work: null },
    ]);
    expect(j.houses?.arrivals).toEqual([]);
    expect(j.houses?.visited).toEqual([]);
  });

  it('keeps houses a save already carries', () => {
    const houses = {
      list: [{ x: 1, y: 1, level: 3, residents: 50, progress: 1 }],
      arrivals: [],
      visited: [],
    };
    const j = migrate(v8({ houses }));
    expect(j.houses).toBe(houses);
    // The rest of the step still ran before the early return.
    expect(j.supply).toBe('simple');
    expect(j.economy.tier).toBe(2);
  });
});

describe('v9 to v10', () => {
  it('grants a recipe for every model already owned, once each', () => {
    const j = migrate({
      ...oldestSave(),
      version: 9,
      inventory: {
        items: [{ defId: 'rocket' }, { defId: 'rocket' }, { defId: 'flying_scotsman' }, {}],
      },
    });
    const crafting = j.crafting as { recipes: string[]; stats: Record<string, number> };
    // version 13 adds its new starter models and their recipes on top
    const later = ['john_bull', 'mine_tub', 'narrow_tank', 'narrow_box', 'narrow_coach'];
    expect(crafting.recipes.filter((r) => !later.includes(r)).sort()).toEqual([
      'flying_scotsman',
      'rocket',
    ]);
    expect(crafting.stats).toEqual({ unlocks: 0, crafts: 0, failures: 0 });
  });

  it('keeps crafting a save already carries', () => {
    const crafting = { recipes: ['mallard'], stats: { unlocks: 4, crafts: 9, failures: 2 } };
    const j = migrate({ ...oldestSave(), version: 9, crafting });
    expect(j.crafting).toBe(crafting);
  });

  it('starts battery carts empty, and makes up no tanks for a train without them', () => {
    const trains = () => [
      { id: 1, tanks: { coal: 5, oil: 0, water: 3 } },
      { id: 2, tanks: { coal: 0, oil: 0, water: 0, battery: 4 } },
      { id: 3 },
    ];
    const crafting = { recipes: [], stats: { unlocks: 0, crafts: 0, failures: 0 } };
    // with crafting in the file as well, which the rest of the step leaves alone
    for (const extra of [{}, { crafting }]) {
      const j = runStep(9, { ...oldestSave(), version: 9, trains: trains(), ...extra });
      expect(j.trains).toEqual([
        { id: 1, tanks: { coal: 5, oil: 0, water: 3, battery: 0 } },
        { id: 2, tanks: { coal: 0, oil: 0, water: 0, battery: 4 } },
        { id: 3 },
      ]);
    }
  });
});

describe('v10 to v11', () => {
  it('slows contract offers down only where the old defaults were still in place', () => {
    const tuned = migrate({
      ...oldestSave(),
      version: 10,
      rules: { contractRefreshDays: 1.5, contractOfferCount: 3 },
    });
    expect(tuned.rules).toEqual({
      contractRefreshDays: 21,
      contractOfferCount: 1,
      tradeCycleDays: 7,
    });

    const byHand = migrate({
      ...oldestSave(),
      version: 10,
      rules: { contractRefreshDays: 4, contractOfferCount: 5 },
    });
    expect(byHand.rules).toEqual({
      contractRefreshDays: 4,
      contractOfferCount: 5,
      tradeCycleDays: 7,
    });
  });

  it('copes with a save that has no rules block', () => {
    expect(() => migrate({ ...oldestSave(), version: 10 })).not.toThrow();
  });
});

describe('v11 to v12', () => {
  it('keeps the civic town identity, retires old passenger contracts without a fine, and converts bridge platforms', () => {
    const j = migrate({
      ...oldestSave(),
      version: 11,
      stations: [
        {
          id: 45,
          defId: 'town',
          name: 'My Town',
          x: 12,
          y: 20,
          level: 3,
          storage: { passengers: 30, wheat: 12 },
        },
      ],
      towns: [{ id: 7, stationId: 45, name: 'My Town', custom: true, color: 2 }],
      track: [[4, 8, 'bridge', 1, 'high_speed']],
      contracts: {
        contracts: [
          { cargo: 'passengers', status: 'active' },
          { cargo: 'stone', status: 'active' },
        ],
      },
      stockpile: { amounts: { wheat: 200, coal: 50 }, famine: false },
    });
    expect(j.stations[0]).toMatchObject({
      id: 45,
      defId: 'town',
      name: 'My Town',
      level: 3,
      storage: { wheat: 12 },
    });
    expect(j.stations[0].storage.passengers).toBeUndefined();
    expect(j.towns?.[0]).toMatchObject({ stationId: 45, name: 'My Town' });
    expect(j.contracts).toEqual({
      contracts: [
        { cargo: 'passengers', status: 'expired' },
        { cargo: 'stone', status: 'active' },
      ],
    });
    expect(j.track[0]).toEqual([4, 8, 'straight', 1, 'high_speed', undefined]);
    // the step to v15 then says the bridge is not being strengthened, and the step to v16 that it
    // stands at rotation 0
    expect(j.buildings).toContainEqual([4, 8, 'bridge_wood', 0, 1, null, 0]);
    expect(j.stockpile).toEqual({ amounts: { wheat: 200, coal: 50, food: 1000 }, famine: false });
    expect(j.economy.money).toBe(1000);
  });
});

describe('parseSave', () => {
  it('migrates valid save text', () => {
    const j = parseSave(JSON.stringify(oldestSave()));
    expect(j?.version).toBe(SAVE_VERSION);
  });

  it('treats a save with no version as the oldest one', () => {
    const raw = JSON.stringify({ ...oldestSave(), version: undefined });
    const j = parseSave(raw);
    expect(j?.loadedFrom).toBe(SAVE_MIN_VERSION);
  });

  it('refuses anything that is not a save', () => {
    expect(parseSave('null')).toBeNull();
    expect(parseSave('5')).toBeNull();
    expect(parseSave('"text"')).toBeNull();
    expect(parseSave('{}')).toBeNull();
    expect(parseSave('{"version":11}')).toBeNull();
    expect(parseSave('{"seed":"nope"}')).toBeNull();
  });

  it('refuses text that is not JSON at all, without throwing', () => {
    expect(parseSave('{oops')).toBeNull();
    expect(parseSave('')).toBeNull();
  });

  it('refuses a save that lacks what every version has', () => {
    expect(parseSave('{"seed":1,"version":13}')).toBeNull();
  });
});

describe('buildSave', () => {
  it('writes every part, then the current version and the time it is given', () => {
    const parts = fullParts();
    const j = buildSave(parts, {}, 1700000000123);
    expect(j).toEqual({ ...parts, version: SAVE_VERSION, savedAt: 1700000000123 });
  });

  it('carries the fields the loaded file had and this build does not know', () => {
    const j = buildSave(fullParts(), { somethingNewer: { a: 1 } });
    expect(j.somethingNewer).toEqual({ a: 1 });
    expect(Object.keys(j)[0]).toBe('somethingNewer');
  });

  it('never writes settings, load notes or a stale stamp, even when handed them', () => {
    const j = buildSave(
      fullParts(),
      {
        settings: { ...DEFAULT_SETTINGS, music: 0 },
        loadedFrom: 3,
        migrationNotes: ['v3→v4: x'],
        version: 2,
        savedAt: 1,
        seed: 5,
      },
      99,
    );
    for (const key of ['settings', 'loadedFrom', 'migrationNotes'])
      expect(key in j, key).toBe(false);
    expect(j.version).toBe(SAVE_VERSION);
    expect(j.savedAt).toBe(99);
    expect(j.seed).toBe(fullParts().seed);
  });

  it('writes a save that reads back as it was written', () => {
    const j = buildSave(fullParts());
    const read = readSaveText(JSON.stringify(j));
    expect(read).toEqual({ save: j });
  });
});

/** The fields every version since v1 holds and the loader checks, as paths into the save. */
const CORE_PATHS: { path: string[]; kind: 'number' | 'array' }[] = [
  ...[
    ['clock', 'time'],
    ['clock', 'speedIndex'],
    ['economy', 'money'],
    ['economy', 'tickets'],
    ['economy', 'tier'],
    ['camera', 'x'],
    ['camera', 'y'],
    ['camera', 'zoomIndex'],
    ['lastDay'],
  ].map((path) => ({ path, kind: 'number' as const })),
  ...[['track'], ['stations'], ['trains']].map((path) => ({ path, kind: 'array' as const })),
];
/** A copy of `save` with the field at `path` replaced (or taken out, for `undefined`). */
function withField(save: object, path: string[], value: unknown): Record<string, unknown> {
  const copy = JSON.parse(JSON.stringify(save)) as Record<string, unknown>;
  let at = copy;
  for (const key of path.slice(0, -1)) at = at[key] as Record<string, unknown>;
  const last = path[path.length - 1];
  if (value === undefined) delete at[last];
  else at[last] = value;
  return copy;
}

describe('readSaveText', () => {
  it('reads a save of every version the chain accepts', () => {
    for (let version = SAVE_MIN_VERSION; version <= SAVE_VERSION; version++) {
      const read = readSaveText(JSON.stringify({ ...oldestSave(), version }));
      expect('save' in read && read.save.version, `v${version}`).toBe(SAVE_VERSION);
    }
  });

  it('refuses text that is not JSON', () => {
    for (const raw of ['{oops', '', 'undefined', '{"seed":1,'])
      expect(readSaveText(raw), raw).toEqual({ error: 'json' });
  });

  it('refuses JSON that is not a save', () => {
    for (const raw of ['null', '5', '"text"', '[]', '[{"seed":1}]', '{}', '{"seed":"1"}'])
      expect(readSaveText(raw), raw).toEqual({ error: 'notSave' });
  });

  it('refuses a seed and a version alone as damaged, whatever the version', () => {
    expect(readSaveText('{"seed":1,"version":13}')).toEqual({ error: 'damaged' });
    expect(readSaveText('{"seed":1,"version":99}')).toEqual({ error: 'damaged' });
    expect(readSaveText('{"seed":1}')).toEqual({ error: 'damaged' });
  });

  it('refuses a save with any one field every version has taken out or retyped', () => {
    for (const valid of [oldestSave(), buildSave(fullParts())]) {
      expect('save' in readSaveText(JSON.stringify(valid))).toBe(true);
      for (const { path, kind } of CORE_PATHS) {
        const wrong = kind === 'number' ? ['1', null, [], {}, true] : [{}, '[]', 0, null];
        for (const value of [undefined, ...wrong]) {
          const raw = JSON.stringify(withField(valid, path, value));
          expect(readSaveText(raw), `${path.join('.')} = ${JSON.stringify(value)}`).toEqual({
            error: 'damaged',
          });
        }
      }
      for (const block of ['clock', 'economy', 'camera'])
        for (const value of [undefined, null, 5, [], 'x'])
          expect(readSaveText(JSON.stringify(withField(valid, [block], value))), block).toEqual({
            error: 'damaged',
          });
    }
  });

  it('reads the save inside a diagnostics bundle', () => {
    const save = buildSave(fullParts());
    const bundle = {
      diagnostics: 1,
      saveVersion: SAVE_VERSION,
      at: '2026-10-09T12:00:00.000Z',
      traffic: { sections: [] },
      save,
    };
    expect(readSaveText(JSON.stringify(bundle))).toEqual({ save });
    expect(parseSave(JSON.stringify(bundle))).toEqual(save);
    // a bundle carrying a damaged save is refused the same as the save alone
    expect(readSaveText(JSON.stringify({ ...bundle, save: { seed: 1 } }))).toEqual({
      error: 'damaged',
    });
  });

  it('refuses a save a migration step cannot read instead of throwing', () => {
    // v11 to v12 reads each station's storage; no version ever wrote a station without one
    const raw = JSON.stringify({ ...oldestSave(), version: 11, stations: [{ defId: 'town' }] });
    expect(readSaveText(raw)).toEqual({ error: 'damaged' });
  });

  it('counts up from the oldest version when the version is no count at all', () => {
    for (const version of [-1e15, 0, 2.5, '13', null]) {
      const read = readSaveText(JSON.stringify({ ...oldestSave(), version }));
      expect('save' in read && read.save.loadedFrom, String(version)).toBe(SAVE_MIN_VERSION);
    }
  });
});

describe('works buildings in a save', () => {
  it('come back as they were saved, idle until their first tick', () => {
    const b: Building = {
      id: 'sawmill',
      x: 4,
      y: 9,
      acc: 0.25,
      level: 3,
      rot: 2,
      active: true,
      rate: 2,
    };
    expect(buildingToJSON(b)).toEqual([4, 9, 'sawmill', 0.25, 3, null, 2]);
    expect(buildingFromJSON(buildingToJSON(b))).toEqual({
      ...b,
      active: false,
      rate: 0,
    });
  });

  it('take level 1 and rotation 0 where the save has none', () => {
    expect(buildingFromJSON([1, 2, 'mill', 0])).toEqual({
      id: 'mill',
      x: 1,
      y: 2,
      acc: 0,
      level: 1,
      rot: 0,
      active: false,
      rate: 0,
    });
    expect(buildingToJSON({ id: 'mill', x: 1, y: 2, acc: 0, active: false, rate: 0 })).toEqual([
      1,
      2,
      'mill',
      0,
      1,
      null,
      0,
    ]);
  });

  it('carry the upgrade under way, and drop one that is no upgrade to the next level', () => {
    const work = { to: 3, left: 40, total: 90 };
    const b: Building = { id: 'kiln', x: 4, y: 9, acc: 0, level: 2, active: false, rate: 0 };
    b.work = { ...work };
    const j = asStored(buildingToJSON(b)) as BuildingJSON;
    expect(j[5]).toEqual(work);
    expect(buildingFromJSON(j).work).toEqual(work);
    // a work to any other level, without a time, or of another shape is none
    for (const odd of [
      { ...work, to: 4 },
      { ...work, total: 0 },
      { ...work, left: Number.NaN },
      { to: 3, left: '40', total: 90 },
      7,
      null,
    ])
      expect(
        buildingFromJSON([4, 9, 'kiln', 0, 2, odd as Work]).work,
        JSON.stringify(odd),
      ).toBeUndefined();
    // time left beyond the work's time is the whole time
    expect(buildingFromJSON([4, 9, 'kiln', 0, 2, { ...work, left: 500 }]).work).toEqual({
      ...work,
      left: 90,
    });
    // a work past the building's top level, or on a building the game does not know, is none
    const past = (id: string, level: number) =>
      buildingFromJSON([4, 9, id, 0, level, { to: level + 1, left: 0, total: 1 }]).work;
    expect(past('substation', MAX_LEVEL), 'works at the top').toBeUndefined();
    expect(past('bridge_wood', BRIDGE_MAX_LEVEL), 'bridge at its top').toBeUndefined();
    expect(past('sawmill', 2), 'unknown building').toBeUndefined();
    expect(past('bridge_wood', BRIDGE_MAX_LEVEL - 1), 'bridge below its top').toEqual({
      to: BRIDGE_MAX_LEVEL,
      left: 0,
      total: 1,
    });
  });
});

describe('v14 to v15', () => {
  function v14(extra: Partial<SaveGame> = {}): SaveGame {
    return {
      ...oldestSave(),
      version: 14,
      stations: [stationOf('farm', 0), stationOf('depot', 1, 1)],
      buildings: [
        [7, 7, 'windmill', 0.5, 2],
        [9, 7, 'kiln', 0],
      ],
      houses: {
        list: [{ x: 3, y: 4, level: 2, residents: 30, progress: 1 }],
        arrivals: [],
        visited: [],
      },
      ...extra,
    };
  }

  it('says that nothing was being upgraded, on every station, works and house', () => {
    const j = migrate(v14());
    expect(j.version).toBe(SAVE_VERSION);
    const step = MIGRATIONS.find((m) => m.from === 14)!;
    expect(j.migrationNotes?.[0]).toBe(`v14→v15: ${step.note}`);
    expect(j.stations.map((s) => s.work)).toEqual([null, null]);
    // a works saved without its level gets the 1 it always meant, so the work has its place (the
    // step to v16 then turns each to rotation 0)
    expect(j.buildings).toEqual([
      [7, 7, 'windmill', 0.5, 2, null, 0],
      [9, 7, 'kiln', 0, 1, null, 0],
    ]);
    expect(j.houses?.list[0]).toEqual({
      x: 3,
      y: 4,
      level: 2,
      residents: 30,
      progress: 1,
      work: null,
    });
    // and every one loads as it did: open, at its level
    const s = Station.fromJSON(asStored(j.stations[0]) as StationJSON);
    expect([s.level, s.work, s.closed]).toEqual([1, null, false]);
    expect(j.buildings!.map((b) => buildingFromJSON(b))).toEqual(
      v14().buildings!.map((b) => buildingFromJSON(b)),
    );
  });

  it('keeps a work a file already holds, and copes with a file without works or houses', () => {
    const work = { to: 2, left: 10, total: 60 };
    const station = { ...stationOf('farm', 0), work };
    const j = migrate(
      v14({ stations: [station], buildings: [[1, 1, 'kiln', 0, 1, work]], houses: undefined }),
    );
    expect(j.stations[0].work).toEqual(work);
    expect(j.buildings![0][5]).toEqual(work);
    expect(j.houses).toBeUndefined();
    expect(migrate(v14({ buildings: undefined })).buildings).toBeUndefined();
  });

  /** Tiles of the houses standing in the world the houses load into, and one with none. */
  const HOUSE_TILES = [
    [3, 4],
    [7, 8],
    [12, 5],
    [20, 20],
  ] as const;
  /**
   * A v14 file in any shape a build, an older file's steps or a hand could leave: stations, works
   * and houses with or without a work already, a works with no level (v4 to v11 wrote none) or a
   * level written as null, something newer after the work, and items the step must pass over.
   */
  function genV14(rng: Rng): SaveGame {
    const file: Record<string, unknown> = { ...genOldFile(rng), version: 14 };
    const work = () =>
      rng.pick<unknown>([
        null,
        { to: 2, left: 10, total: 60 },
        { to: 4, left: 0, total: 9 },
        7,
        {},
      ]);
    file.stations = Array.from({ length: rng.int(0, 4) }, (_, i) => {
      if (rng.chance(0.1)) return rng.pick([null, 3, 'station']);
      const defId = rng.pick(['farm', 'town', 'warehouse', 'depot']);
      const s = { ...stationOf(defId, rng.pick(ROT_VALUES), i), level: rng.int(1, 6) };
      return rng.chance(0.3) ? { ...s, work: work() } : s;
    });
    if (rng.chance(0.2)) delete file.buildings;
    else
      file.buildings = Array.from({ length: rng.int(0, 5) }, () => {
        const id = rng.pick(['windmill', 'sawmill', 'bridge_wood']);
        const t: unknown[] = [rng.int(0, 31), rng.int(0, 31), id, rng.next()];
        switch (rng.int(0, 6)) {
          case 0:
            return t;
          case 1:
            return [...t, null];
          case 2:
            return [...t, rng.int(1, 4), work()];
          case 3:
            return [...t, rng.int(1, 4), work(), 'newer'];
          case 4:
            return t.slice(0, rng.int(0, 3));
          case 5:
            return rng.pick([null, 'kiln', {}]);
          default:
            return [...t, rng.int(1, 4)];
        }
      });
    const shape = rng.next();
    if (shape < 0.2) delete file.houses;
    else if (shape < 0.3) file.houses = rng.pick([null, 'houses', { list: 'none' }]);
    else
      file.houses = {
        list: Array.from({ length: rng.int(0, 4) }, () => {
          if (rng.chance(0.1)) return rng.pick([null, 5]);
          const [x, y] = rng.pick(HOUSE_TILES);
          const h: Record<string, unknown> = {
            x,
            y,
            level: rng.int(1, 6),
            residents: rng.int(0, 40),
            progress: rng.pick([1, 0.5]),
          };
          if (rng.chance(0.5)) h.grow = rng.int(0, 3);
          if (rng.chance(0.5)) h.full = rng.int(0, 3);
          if (rng.chance(0.3)) h.work = work();
          return h;
        }),
        arrivals: [],
        visited: [],
      };
    return file as unknown as SaveGame;
  }
  /** Smaller v14 files: what `shrinkOldFile` drops, then shorter works and house lists. */
  function* shrinkV14(file: SaveGame): Iterable<SaveGame> {
    const f = file as unknown as Record<string, unknown>;
    for (const smaller of shrinkOldFile(f)) if (smaller.version === 14) yield smaller as never;
    if (Array.isArray(f.buildings))
      for (const buildings of shrinkArray(f.buildings)) yield { ...f, buildings } as never;
    if (isObject(f.houses) && Array.isArray(f.houses.list))
      for (const list of shrinkArray(f.houses.list))
        yield { ...f, houses: { ...f.houses, list } } as never;
  }
  /**
   * `after` with what the step may add taken out again: a `work: null` on a station or house that
   * had no work, and on a works tuple a null work, after a level where the tuple had none (whether
   * that level means what the missing one did is for the load comparison to judge). Anything else
   * the step changed is left for the comparison with the file before to find.
   */
  function unfilled(after: SaveGame, before: SaveGame): unknown {
    const copy = asStored(after) as Record<string, unknown>;
    const was = asStored(before) as Record<string, unknown>;
    const dropWork = (items: unknown, old: unknown) => {
      if (!Array.isArray(items) || !Array.isArray(old)) return;
      items.forEach((item, i) => {
        const o: unknown = old[i];
        if (isObject(item) && isObject(o) && !('work' in o) && item.work === null) delete item.work;
      });
    };
    dropWork(copy.stations, was.stations);
    if (isObject(copy.houses) && isObject(was.houses)) dropWork(copy.houses.list, was.houses.list);
    if (Array.isArray(copy.buildings) && Array.isArray(was.buildings))
      copy.buildings.forEach((b: unknown, i) => {
        const old: unknown = (was.buildings as unknown[])[i];
        if (!Array.isArray(b) || !Array.isArray(old)) return;
        if ((old.length === 4 || old.length === 5) && b.length === 6 && b[5] === null)
          b.length = old.length;
      });
    return copy;
  }

  it('fills an explicit no-work and nothing else, idempotently, and loads as before', () => {
    // The step only fills defaults: taking out what it may add gives back the file it was given,
    // so a work a file holds and everything newer than v15 survive. Each station and house then
    // says it has no work, and each works tuple has the place for one. Run again it finds
    // nothing to do. And the load code sees no difference: every station, works and house loads
    // from the stepped file as it loaded from the v14 file, the houses onto houses standing in a
    // world as a save's houses do (items the load code cannot read at all are left out of both).
    const w = simWorld({ terrain: 'grass', size: 32 });
    w.builder.free = true;
    for (const [x, y] of HOUSE_TILES.slice(0, 3)) w.builder.spawnDecor(x, y, 'townhouse', 0);
    w.builder.free = false;
    w.houses.finishAll();
    const loadHouses = (j: SaveGame) => {
      const houses = j.houses as HousesJSON;
      w.houses.load({ ...houses, list: houses.list.filter(isObject) as HousesJSON['list'] });
      return w.houses.toJSON().list;
    };
    forAll(
      genV14,
      (file) => {
        const before = asStored(file) as SaveGame;
        const once = asStored(runStep(14, asStored(file) as SaveGame)) as SaveGame;
        expect(asStored(runStep(14, asStored(once) as SaveGame)), 'run again').toEqual(once);
        expect(unfilled(once, before), 'beside the defaults it fills').toEqual(before);

        const houseList = (j: SaveGame) =>
          isObject(j.houses) && Array.isArray(j.houses.list) ? (j.houses.list as unknown[]) : [];
        for (const [what, items] of [
          ['station', once.stations as unknown[]],
          ['house', houseList(once)],
        ] as const)
          items.forEach((item, i) => {
            if (isObject(item))
              expect('work' in item, `${what} ${i} says if it has a work`).toBe(true);
          });
        (once.buildings ?? []).forEach((b: unknown, i) => {
          if (Array.isArray(b) && b.length >= 4)
            expect(b.length, `works ${i} has the place for a work`).toBeGreaterThanOrEqual(6);
        });

        (before.stations as unknown[]).forEach((sj, i) => {
          if (!isObject(sj)) return;
          const load = (j: unknown) => Station.fromJSON(asStored(j) as StationJSON).toJSON();
          expect(load(once.stations[i]), `station ${i} loads as before`).toEqual(load(sj));
        });
        (before.buildings ?? []).forEach((bj: unknown, i) => {
          if (!Array.isArray(bj) || bj.length < 3) return;
          const load = (j: unknown) => buildingFromJSON(asStored(j) as BuildingJSON);
          expect(load(once.buildings![i]), `works ${i} loads as before`).toEqual(load(bj));
        });
        if (houseList(before).length)
          expect(loadHouses(once), 'the houses load as before').toEqual(loadHouses(before));
      },
      { shrink: shrinkV14 },
    );
  });
});

describe('v15 to v16', () => {
  beforeEach(() => {
    resetTrainIds(1);
    resetStationIds(1);
    Object.assign(rules, DEFAULT_RULES);
  });

  /** A turn a works tuple could hold: the four, null, and values no build wrote. */
  const TURN_VALUES: unknown[] = [0, 1, 2, 3, null, 5, -1, 2.5, '1'];
  /**
   * A works tuple in any shape a build, an older file's steps or a hand could leave: no level, a
   * level written as null, no work, a turn already there (or null, or one no build wrote),
   * something newer after the turn, too short to be a works, or (unless `tuples`) no tuple at all.
   */
  function genWorks(rng: Rng, tuples = false): unknown {
    const id = rng.pick(['windmill', 'kiln', 'colliery', 'bridge_wood', 'sawmill']);
    const t: unknown[] = [rng.int(0, 31), rng.int(0, 31), id, rng.pick([0, 0.5, rng.next()])];
    const level = () => rng.pick<unknown>([1, 2, 4, 6, null]);
    const work = () => rng.pick<unknown>([null, { to: 2, left: 10, total: 60 }, 7, {}]);
    switch (rng.int(0, tuples ? 5 : 6)) {
      case 0:
        return t;
      case 1:
        return [...t, level()];
      case 2:
        return [...t, level(), work()];
      case 3:
        return [...t, level(), work(), rng.pick(TURN_VALUES)];
      case 4:
        return [...t, level(), work(), rng.pick(TURN_VALUES), 'newer'];
      case 5:
        return t.slice(0, rng.int(0, 3));
      default:
        return rng.pick([null, 'kiln', {}, 7]);
    }
  }
  /** A v15 file, as it reads from disk, with a works list of any shapes or none at all. */
  function genV15(rng: Rng): SaveGame {
    const file: Record<string, unknown> = { ...genOldFile(rng), version: 15 };
    if (rng.chance(0.15)) delete file.buildings;
    else file.buildings = Array.from({ length: rng.int(0, 6) }, () => genWorks(rng));
    return asStored(file) as SaveGame;
  }
  /** Smaller v15 files: what `shrinkOldFile` drops, then a shorter works list. */
  function* shrinkV15(file: SaveGame): Iterable<SaveGame> {
    const f = file as unknown as Record<string, unknown>;
    for (const smaller of shrinkOldFile(f)) if (smaller.version === 15) yield smaller as never;
    if (Array.isArray(f.buildings))
      for (const buildings of shrinkArray(f.buildings)) yield { ...f, buildings } as never;
  }
  /**
   * The step as the brief states it, for one works item: a tuple of at least four places is
   * padded to seven with what a missing place always meant (level 1, no work, turn 0), and a turn
   * written as null is 0; anything else, and every place the tuple had, is as it was.
   */
  function turned(item: unknown): unknown {
    if (!Array.isArray(item) || item.length < 4) return item;
    const t = [...item];
    const defaults = [1, null, 0];
    for (let i = t.length; i < 7; i++) t.push(defaults[i - 4]);
    if (t[6] === null) t[6] = 0;
    return t;
  }

  it('gives each works a turn, fills nothing else, finds nothing to do again, and loads as before', () => {
    forAll(
      genV15,
      (file) => {
        const before = asStored(file) as SaveGame;
        const once = asStored(runStep(15, asStored(file) as SaveGame)) as SaveGame;
        expect(asStored(runStep(15, asStored(once) as SaveGame)), 'run again').toEqual(once);
        // everything but the works list is untouched, and the works are as the brief says
        const { buildings: worksAfter, ...restAfter } = once;
        const { buildings: worksBefore, ...restBefore } = before;
        expect(restAfter, 'beside the works').toEqual(restBefore);
        expect(worksAfter, 'the works list').toEqual(worksBefore?.map(turned));
        // and the load code sees no difference: a missing turn always loaded as r0
        (worksBefore ?? []).forEach((bj: unknown, i) => {
          if (!Array.isArray(bj) || bj.length < 3) return;
          const load = (j: unknown) => buildingFromJSON(asStored(j) as BuildingJSON);
          expect(load(worksAfter![i]), `works ${i} loads as before`).toEqual(load(bj));
        });
      },
      { shrink: shrinkV15 },
    );
  });

  it('leaves every works of a file of any older version with a turn, and a v16 file as it was', () => {
    // Tuples only: the step from v11 reads each works item as a tuple where the file has old
    // bridge track, and refuses the file as damaged when one is not.
    forAll(
      (rng) => {
        const file = genOldFile(rng);
        file.version = rng.int(SAVE_MIN_VERSION, SAVE_VERSION);
        file.buildings = Array.from({ length: rng.int(1, 5) }, () => genWorks(rng, true));
        return asStored(file) as Record<string, unknown>;
      },
      (file) => {
        const read = readSaveText(JSON.stringify(file));
        if (!('save' in read)) throw new Error(`the file was refused as ${read.error}`);
        const works = (read.save.buildings ?? []) as unknown[];
        if (file.version === SAVE_VERSION) {
          expect(works, 'a file of this version').toEqual(file.buildings);
          return;
        }
        works.forEach((b, i) => {
          if (!Array.isArray(b) || b.length < 4) return;
          expect(b.length, `works ${i}: the place for its turn`).toBeGreaterThanOrEqual(7);
          expect(b[6] ?? 'none', `works ${i}: its turn`).not.toBe('none');
          expect(TURN_VALUES, `works ${i}: its turn`).toContain(b[6]);
        });
      },
      {
        shrink: function* (file) {
          for (const smaller of shrinkOldFile(file)) yield smaller;
          if (Array.isArray(file.buildings))
            for (const buildings of shrinkArray(file.buildings)) yield { ...file, buildings };
        },
      },
    );
  });
});

/** An in-memory `localStorage` that counts its writes, so a test can see nothing was written. */
class MemoryStorage {
  items = new Map<string, string>();
  writes = 0;
  getItem(k: string) {
    return this.items.has(k) ? this.items.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.writes++;
    this.items.set(k, String(v));
  }
  removeItem(k: string) {
    this.writes++;
    this.items.delete(k);
  }
}

describe('storage', () => {
  let store: MemoryStorage;
  beforeEach(() => {
    store = new MemoryStorage();
    vi.stubGlobal('localStorage', store);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const playerSettings = JSON.stringify({ ...DEFAULT_SETTINGS, music: 0.7 });
  const refused = ['{oops', 'null', '{}', '{"seed":1,"version":13}', '{"seed":1,"version":99}'];

  it('imports nothing from a refused text', () => {
    store.items.set(SAVE_KEY, JSON.stringify(buildSave(fullParts())));
    store.items.set(SETTINGS_KEY, playerSettings);
    const before = new Map(store.items);
    for (const raw of refused) {
      const r = importSave(raw);
      expect(r.ok, raw).toBe(false);
    }
    expect(importSave('{oops')).toEqual({ ok: false, error: 'json' });
    expect(importSave('[]')).toEqual({ ok: false, error: 'notSave' });
    expect(importSave('{"seed":1,"version":13}')).toEqual({ ok: false, error: 'damaged' });
    expect(store.writes).toBe(0);
    expect(store.items).toEqual(before);
  });

  it("stores an imported save and leaves the player's settings alone", () => {
    store.items.set(SETTINGS_KEY, playerSettings);
    const save = { ...buildSave(fullParts()), settings: { ...DEFAULT_SETTINGS, music: 0 } };
    const r = importSave(JSON.stringify(save));
    expect(r.ok).toBe(true);
    expect(JSON.parse(store.items.get(SAVE_KEY)!)).toEqual(save);
    expect(store.items.get(SETTINGS_KEY)).toBe(playerSettings);
    // with no settings stored, the import does not store any either
    store.items.delete(SETTINGS_KEY);
    expect(importSave(JSON.stringify(save)).ok).toBe(true);
    expect(store.items.has(SETTINGS_KEY)).toBe(false);
  });

  it('stores the save inside an imported diagnostics bundle', () => {
    const save = buildSave(fullParts());
    const r = importSave(JSON.stringify({ diagnostics: 1, saveVersion: SAVE_VERSION, save }));
    expect(r).toEqual({ ok: true, save });
    expect(JSON.parse(store.items.get(SAVE_KEY)!)).toEqual(save);
  });

  it('refuses an import storage will not keep, and Continue still loads the game it held', () => {
    // storage that is full or blocked throws on every write and keeps what it held
    store.setItem = () => {
      store.writes++;
      throw new Error('QuotaExceededError');
    };
    const held = JSON.stringify(buildSave({ ...fullParts(), lastDay: 3 }, {}, 1000));
    store.items.set(SAVE_KEY, held);
    store.items.set(SETTINGS_KEY, playerSettings);
    const before = new Map(store.items);
    const save = buildSave(fullParts(), {}, 2000);
    const taken = [
      JSON.stringify(save),
      JSON.stringify({ diagnostics: 1, saveVersion: SAVE_VERSION, save }),
    ];
    for (const raw of taken) {
      expect(importSave(raw), raw).toEqual({ ok: false, error: 'storage' });
    }
    expect(store.writes).toBe(taken.length);
    // a refused text is refused for what it is; storage is not asked
    for (const raw of refused) {
      const read = readSaveText(raw);
      expect(importSave(raw), raw).toEqual({ ok: false, error: 'error' in read ? read.error : '' });
    }
    expect(store.writes).toBe(taken.length);
    expect(store.items).toEqual(before);
    expect(readSave()?.lastDay).toBe(3);
  });

  it('reads no game from a refused stored save, and leaves it stored', () => {
    for (const raw of refused) {
      store.items.set(SAVE_KEY, raw);
      expect(readSave(), raw).toBeNull();
      expect(continueMeta(), raw).toBeNull();
      expect(store.items.get(SAVE_KEY)).toBe(raw);
    }
    expect(store.writes).toBe(0);
  });

  it('describes the save Continue loads by day, age and money', () => {
    expect(continueMeta()).toBeNull();
    writeSave(buildSave(fullParts(), {}, 5000));
    expect(continueMeta()).toEqual({
      name: '',
      savedAt: 5000,
      version: SAVE_VERSION,
      seed: 777,
      day: 42,
      age: 2,
      money: 12345,
    });
  });

  it('lists named saves by day, age and money, newest first', () => {
    writeSlot('first', buildSave({ ...fullParts(), lastDay: 3 }, {}, 1000));
    writeSlot('second', buildSave(fullParts(), {}, 2000));
    expect(listSlots()).toEqual([
      {
        name: 'second',
        savedAt: 2000,
        version: SAVE_VERSION,
        seed: 777,
        day: 42,
        age: 2,
        money: 12345,
      },
      {
        name: 'first',
        savedAt: 1000,
        version: SAVE_VERSION,
        seed: 777,
        day: 3,
        age: 2,
        money: 12345,
      },
    ]);
  });

  it('reads an old file the way it loads: the tier it had is the age it became', () => {
    const v8 = {
      ...oldestSave(),
      version: 8,
      economy: { money: 50, tickets: 0, tier: 7, granted: [] },
    };
    store.items.set(SLOTS_KEY, JSON.stringify({ old: JSON.stringify(v8) }));
    expect(listSlots()[0]).toMatchObject({ name: 'old', version: 8, age: 2, money: 50 });
    expect(readSlot('old')?.economy.tier).toBe(2);
  });

  it('lists a damaged named save so it can be deleted, with 0 for what it lacks', () => {
    store.items.set(
      SLOTS_KEY,
      JSON.stringify({ broken: '{"seed":5,"economy":{"money":7}}', junk: '{oops', none: '[]' }),
    );
    expect(listSlots()).toEqual([
      { name: 'broken', savedAt: 0, version: 0, seed: 5, day: 0, age: 0, money: 7 },
    ]);
    expect(readSlot('broken')).toBeNull();
    expect(readSlot('junk')).toBeNull();
  });

  it('copes with a slot store that is not a table of saves', () => {
    for (const raw of ['null', '[]', '5', '{oops']) {
      store.items.set(SLOTS_KEY, raw);
      expect(listSlots(), raw).toEqual([]);
      expect(hasSlot('x'), raw).toBe(false);
      expect(readSlot('x'), raw).toBeNull();
    }
  });

  it('tells whether a named save would be replaced', () => {
    expect(hasSlot('My game')).toBe(false);
    writeSlot('  My game  ', buildSave(fullParts()));
    expect(hasSlot('My game')).toBe(true);
    expect(hasSlot(' My game ')).toBe(true);
    expect(hasSlot('Other')).toBe(false);
    expect(hasSlot('toString')).toBe(false);
    const long = 'x'.repeat(31) + ' tail';
    writeSlot(long, buildSave(fullParts()));
    expect(hasSlot(long)).toBe(true);
    for (const { name } of listSlots()) expect(hasSlot(name), name).toBe(true);
  });
});

describe('settings', () => {
  const prompt = uniformContractPolicy('prompt');
  const accept = uniformContractPolicy('accept');

  it('ships defaults that leave every offer waiting for the player', () => {
    for (const r of CONTRACT_RARITIES)
      expect(contractPolicyFor(DEFAULT_SETTINGS, r)).toBe('prompt');
    // and fresh defaults, once stored, are not moved again
    const fresh = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as Partial<Settings>;
    expect(migrateSettings(fresh)).toEqual(DEFAULT_SETTINGS);
  });

  it('moves settings stored under the old default to the new one', () => {
    const old: Partial<Settings>[] = [
      { music: 0.3 },
      { autoContracts: true },
      { contractPolicy: accept },
      // a missing entry read as accept under the old default
      { contractPolicy: { common: 'accept' } as Settings['contractPolicy'] },
      { contractPolicy: null as unknown as Settings['contractPolicy'] },
    ];
    for (const s of old) {
      const label = JSON.stringify(s);
      const m = migrateSettings(s);
      expect(m.contractPolicy, label).toEqual(prompt);
      expect(m.contractPolicyVersion, label).toBe(CONTRACT_POLICY_VERSION);
      expect(m.autoContracts, label).toBeUndefined();
    }
    expect(migrateSettings({ music: 0.3 }).music).toBe(0.3);
  });

  it('keeps a policy chosen under the old default, filling what it left out with accept', () => {
    const off: Partial<Settings> = { autoContracts: false };
    expect(migrateSettings(off).contractPolicy).toEqual(prompt);
    expect(
      migrateSettings({ autoContracts: true, contractPolicy: uniformContractPolicy('deny') }),
    ).toEqual({
      contractPolicy: uniformContractPolicy('deny'),
      contractPolicyVersion: CONTRACT_POLICY_VERSION,
    });
    const mixed = { ...accept, legendary: 'prompt' as const };
    expect(migrateSettings({ contractPolicy: { ...mixed } }).contractPolicy).toEqual(mixed);
    const partial = { epic: 'deny' } as Settings['contractPolicy'];
    expect(migrateSettings({ contractPolicy: partial }).contractPolicy).toEqual({
      ...accept,
      epic: 'deny',
    });
  });

  it('moves the old default once: accept chosen afterwards stays', () => {
    const moved = migrateSettings({ contractPolicy: uniformContractPolicy('accept') });
    expect(moved.contractPolicy).toEqual(prompt);
    const chosen = JSON.parse(JSON.stringify({ ...moved, contractPolicy: accept })) as Settings;
    for (let n = 0; n < 3; n++) expect(migrateSettings(chosen).contractPolicy).toEqual(accept);
    // so does a version a later build wrote
    const later = { contractPolicy: accept, contractPolicyVersion: CONTRACT_POLICY_VERSION + 1 };
    expect(migrateSettings(later).contractPolicy).toEqual(accept);
  });

  it('reads a rarity the policy leaves out as the default, whatever the retired switch says', () => {
    const old = { ...DEFAULT_SETTINGS, contractPolicy: undefined } as Settings;
    for (const r of CONTRACT_RARITIES) {
      expect(contractPolicyFor(old, r)).toBe('prompt');
      expect(contractPolicyFor({ ...old, autoContracts: true }, r)).toBe('prompt');
      expect(contractPolicyFor({ ...old, autoContracts: false }, r)).toBe('prompt');
    }
  });

  it('reads the stored policy where there is one', () => {
    const s: Settings = { ...DEFAULT_SETTINGS, contractPolicy: uniformContractPolicy('deny') };
    expect(contractPolicyFor(s, 'legendary')).toBe('deny');
    expect(
      contractPolicyFor({ ...s, contractPolicy: { ...s.contractPolicy!, epic: 'prompt' } }, 'epic'),
    ).toBe('prompt');
  });

  describe('in storage', () => {
    let store: MemoryStorage;
    beforeEach(() => {
      store = new MemoryStorage();
      vi.stubGlobal('localStorage', store);
    });
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('moves stored settings once, and keeps accept chosen after the move', () => {
      // as a build before the change stored them: every rarity accepted, no version
      const { contractPolicyVersion: _v, ...before } = {
        ...DEFAULT_SETTINGS,
        contractPolicy: accept,
      };
      void _v;
      store.items.set(SETTINGS_KEY, JSON.stringify({ ...before, music: 0.2 }));
      const read = readSettings();
      expect(read.contractPolicy).toEqual(prompt);
      expect(read.music).toBe(0.2);
      for (const r of CONTRACT_RARITIES) expect(contractPolicyFor(read, r)).toBe('prompt');
      writeSettings(read);
      expect(readSettings().contractPolicy).toEqual(prompt);
      // the player turns auto-accept back on
      writeSettings({ ...read, contractPolicy: accept });
      expect(readSettings().contractPolicy).toEqual(accept);
      expect(readSettings().contractPolicy).toEqual(accept);
    });

    it('hands out settings that share no policy with the defaults', () => {
      const a = readSettings();
      a.contractPolicy!.common = 'accept';
      expect(DEFAULT_SETTINGS.contractPolicy).toEqual(prompt);
      expect(readSettings().contractPolicy).toEqual(prompt);
      // stored since the move, with no policy of its own: the default's is merged in
      const since = { music: 0, contractPolicyVersion: CONTRACT_POLICY_VERSION };
      store.items.set(SETTINGS_KEY, JSON.stringify(since));
      const b = readSettings();
      expect(b.contractPolicy).toEqual(prompt);
      b.contractPolicy!.rare = 'deny';
      expect(DEFAULT_SETTINGS.contractPolicy).toEqual(prompt);
    });
  });
});

describe('v12 to v13', () => {
  it('migrates 1x1 regular curves and switches to narrow', () => {
    const j = migrate({
      ...oldestSave(),
      version: 12,
      track: [
        [4, 8, 'curve', 1, 'regular'],
        [6, 8, 'switch', 5],
        [8, 8, 'straight', 1, 'regular'],
        [10, 8, 'curve', 0, 'high_speed'],
        [12, 8, 'crossing', 0, 'regular', 'high_speed'],
      ],
    });
    expect(j.version).toBe(SAVE_VERSION);
    expect(j.track).toEqual([
      [4, 8, 'curve', 1, 'narrow', undefined],
      [6, 8, 'switch', 5, 'narrow', undefined],
      [8, 8, 'straight', 1, 'regular', undefined],
      [10, 8, 'curve', 0, 'high_speed', undefined],
      [12, 8, 'crossing', 0, 'regular', 'high_speed'],
    ]);
  });

  it('hands an old save the starter models that are new, once', () => {
    const rocket = {
      uid: 7,
      defId: 'rocket',
      kind: 'loco',
      level: 1,
      assigned: null,
      dupes: 0,
      obtainedAt: 0,
    };
    const tub = { ...rocket, uid: 9, defId: 'mine_tub', kind: 'wagon' };
    const j = migrate({
      ...oldestSave(),
      version: 12,
      inventory: { items: [rocket, tub], nextUid: 10 },
    });
    const items = (j.inventory as { items: { uid: number; defId: string }[] }).items;
    const count = (id: string) => items.filter((i) => i.defId === id).length;
    expect(count('john_bull')).toBe(1);
    for (const id of ['narrow_tank', 'narrow_box', 'narrow_coach'])
      expect(count(id), id).toBeGreaterThan(0);
    // already owned: left as it is
    expect(count('mine_tub')).toBe(1);
    expect(count('rocket')).toBe(1);
    expect(new Set(items.map((i) => i.uid)).size).toBe(items.length);
    expect((j.inventory as { nextUid: number }).nextUid).toBeGreaterThan(
      Math.max(...items.map((i) => i.uid)),
    );
    expect(MIGRATIONS.find((m) => m.from === 12)!.note).toMatch(/Rocket/);
  });

  it('converts a level drawn before 2x2 regular curves the same way', () => {
    expect(
      convertOneTileRegular([
        [1, 1, 'curve', 2, 'regular'],
        [2, 1, 'straight', 0],
      ]),
    ).toEqual([
      [1, 1, 'curve', 2, 'narrow', undefined],
      [2, 1, 'straight', 0, undefined, undefined],
    ]);
  });
});

// ------------------------------------------------------------------ properties over every file

/** Stand-ins of the wrong type where a file must hold a number, a list or a block. */
const NOT_NUMBERS: unknown[] = ['1', '', null, true, false, [], [1], {}, { n: 1 }];
const NOT_LISTS: unknown[] = [{}, { 0: 1, length: 1 }, '[]', '', 0, 3, null, true];
const NOT_BLOCKS: unknown[] = [null, 0, 'x', true, [], [1, 2, 3], {}];
/** What makes a file a save (its seed) and what the loader holds every version to. */
const V1_CHECKED = new Set([
  'seed',
  'clock',
  'economy',
  'camera',
  'track',
  'stations',
  'trains',
  'lastDay',
]);
/** Versions no build wrote that a file could still hold. */
const ODD_VERSIONS: unknown[] = [0, -3, 2.5, '13', null, true];
const TRACK_KINDS = ['straight', 'curve', 'switch', 'crossing', 'bridge', 'transition'];
const TRACK_CLASSES = ['regular', 'high_speed', 'narrow'];

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
/** A value as it reads back from JSON: a list's undefined items become null. */
const asStored = (v: unknown): unknown => JSON.parse(JSON.stringify(v));
/** The version a file is migrated from: its own when the chain can count up from it, else v1. */
const fromVersion = (v: unknown) =>
  typeof v === 'number' && Number.isInteger(v) && v >= SAVE_MIN_VERSION ? v : SAVE_MIN_VERSION;

/** A number where a file keeps one: zero, whole, negative, fractional or past 2^32. */
function anyNumber(rng: Rng): number {
  switch (rng.int(0, 4)) {
    case 0:
      return 0;
    case 1:
      return rng.int(1, 500);
    case 2:
      return -rng.int(1, 500);
    case 3:
      return rng.range(-1e6, 1e6);
    default:
      return rng.int(0, 2 ** 31) * 4096;
  }
}

/**
 * A file some build could have written: every v1 field well formed, deeper data included so no
 * migration step trips on it; each later field there or not; a version from the oldest to a newer
 * build's, none at all, or one no build wrote.
 */
function genFile(rng: Rng): Record<string, unknown> {
  const list = <T>(max: number, item: (i: number) => T) =>
    Array.from({ length: rng.int(0, max) }, (_, i) => item(i));
  const tile = () => rng.int(0, 63);
  const file: Record<string, unknown> = {
    seed: anyNumber(rng),
    savedAt: rng.int(0, 2 ** 41),
    clock: { time: Math.abs(anyNumber(rng)), speedIndex: rng.int(0, 4) },
    economy: {
      money: anyNumber(rng),
      tickets: rng.int(0, 50),
      tier: rng.int(0, 9),
      granted: list(3, (i) => i),
    },
    track: list(4, () => {
      const t: unknown[] = [tile(), tile(), rng.pick(TRACK_KINDS), rng.int(0, 7)];
      if (rng.chance(0.5)) t.push(rng.pick(TRACK_CLASSES));
      return t;
    }),
    stations: list(3, (i) => ({
      id: i + 1,
      defId: rng.pick(['town', 'farm', 'mine']),
      name: rng.pick(['Town Station 2', 'Alder']),
      x: tile(),
      y: tile(),
      level: rng.int(1, 3),
      storage: { passengers: rng.int(0, 40), wheat: rng.int(0, 40) },
    })),
    trains: list(3, (i) => ({ id: i + 1 })),
    contracts: {
      contracts: list(3, (i) => ({
        id: i + 1,
        cargo: rng.pick(['passengers', 'wood']),
        status: rng.pick(['offer', 'active', 'done']),
      })),
    },
    inventory: {
      items: list(3, (i) => ({ uid: i + 1, defId: rng.pick(['rocket', 'mine_tub', 'mallard']) })),
      nextUid: 4,
    },
    gacha: {},
    camera: { x: anyNumber(rng), y: anyNumber(rng), zoomIndex: rng.int(0, 5) },
    lastDay: rng.int(0, 5000),
  };
  const v = rng.next();
  if (v < 0.75) file.version = rng.int(SAVE_MIN_VERSION, SAVE_VERSION);
  else if (v < 0.85) file.version = SAVE_VERSION + rng.int(1, 4);
  else if (v < 0.95) file.version = rng.pick(ODD_VERSIONS);
  // else no version at all, which reads as the oldest
  const later: Record<string, () => unknown> = {
    decor: () => list(3, () => [tile(), tile(), rng.pick(['signal', 'townhouse']), rng.int(0, 3)]),
    wires: () => list(2, () => [tile(), tile(), 'electric']),
    weather: () => ({ kind: 'clear', intensity: 0, nextChangeAt: 5, rng: rng.int(0, 1e9) }),
    world: () => ({ kind: 'generated', seed: rng.int(0, 1e9), params: { ...DEFAULT_MAP_PARAMS } }),
    rules: () =>
      rng.pick([
        {},
        { contractRefreshDays: 1.5, contractOfferCount: 3 },
        { contractRefreshDays: 6 },
      ]),
    stockpile: () => ({ amounts: { wheat: rng.int(0, 300), coal: rng.int(0, 99) }, famine: false }),
    buildings: () =>
      list(2, () => [
        tile(),
        tile(),
        rng.pick(['sawmill', 'bridge_wood']),
        rng.next(),
        rng.int(1, 4),
      ]),
    regions: () => list(4, () => rng.chance(0.5)),
    seasonOffset: () => rng.int(0, 3),
    towns: () =>
      list(2, (i) => ({ id: i + 1, name: 'Alder', stationId: i + 1, custom: false, color: 0 })),
    trade: () => ({ nextAt: rng.int(0, 99), driftDay: rng.int(0, 99) }),
    crafting: () => ({ recipes: ['rocket'], stats: { unlocks: 0, crafts: 0, failures: 0 } }),
    houses: () => ({ list: [], arrivals: [], visited: [] }),
    supply: () => rng.pick(['simple', 'full']),
    people: () => ({ rng: rng.int(0, 0xffffffff) }),
    settings: () => ({ ...DEFAULT_SETTINGS, music: rng.next() }),
    somethingNewer: () => ({ a: rng.int(0, 9) }),
  };
  for (const [key, make] of Object.entries(later)) if (rng.chance(0.5)) file[key] = make();
  return file;
}

/** Smaller files that stay whole: later fields dropped, lists emptied, no steps to cross. */
function* shrinkFile(file: Record<string, unknown>): Iterable<Record<string, unknown>> {
  // the version only ever moves to the current one, or dropping it and setting it would cycle
  for (const key of Object.keys(file))
    if (!V1_CHECKED.has(key) && key !== 'version')
      yield Object.fromEntries(Object.entries(file).filter(([k]) => k !== key));
  for (const key of ['track', 'stations', 'trains'])
    if ((file[key] as unknown[]).length > 0) yield { ...file, [key]: [] };
  if (file.version !== SAVE_VERSION) yield { ...file, version: SAVE_VERSION };
}

/** One change to a file: the field at `path` set to `to`, or taken out when there is no `to`. */
interface Edit {
  path: string[];
  to?: unknown;
}
/** A copy of `file` with `edit` made; unchanged when the path runs through something else. */
function edited(file: unknown, edit: Edit): unknown {
  const copy = asStored(file);
  let at = copy;
  for (const key of edit.path.slice(0, -1)) at = isObject(at) ? at[key] : undefined;
  if (!isObject(at)) return copy;
  const last = edit.path[edit.path.length - 1];
  if ('to' in edit) at[last] = edit.to;
  else delete at[last];
  return copy;
}
/** One field every version has, taken out or given a value of another type. */
function genCoreEdit(rng: Rng): Edit {
  if (rng.chance(0.2)) {
    const path = [rng.pick(['clock', 'economy', 'camera'])];
    return rng.chance(0.25) ? { path } : { path, to: rng.pick(NOT_BLOCKS) };
  }
  const { path, kind } = rng.pick(CORE_PATHS);
  if (rng.chance(0.25)) return { path };
  return { path, to: rng.pick(kind === 'number' ? NOT_NUMBERS : NOT_LISTS) };
}

/** A diagnostics bundle as the game exports it, carrying `save`. */
const bundled = (save: unknown) => ({
  diagnostics: 1,
  saveVersion: SAVE_VERSION,
  at: '2026-10-09T12:00:00.000Z',
  traffic: { sections: [] },
  save,
});

/**
 * What a text is by the rules of issue #78, written from the issue and apart from the loader: not
 * JSON; not a save (no object with a numeric seed, once a diagnostics bundle is opened); damaged
 * (a field every version since v1 has is missing or of another type); else a save.
 */
function verdictOf(raw: string): SaveRefusal | 'save' {
  let j: unknown;
  try {
    j = JSON.parse(raw);
  } catch {
    return 'json';
  }
  if (isObject(j) && j.diagnostics === 1 && isObject(j.save)) j = j.save;
  if (!isObject(j) || typeof j.seed !== 'number') return 'notSave';
  const numbers = (block: unknown, keys: string[]) =>
    isObject(block) && keys.every((k) => typeof block[k] === 'number');
  const whole =
    numbers(j.clock, ['time', 'speedIndex']) &&
    numbers(j.economy, ['money', 'tickets', 'tier']) &&
    numbers(j.camera, ['x', 'y', 'zoomIndex']) &&
    Array.isArray(j.track) &&
    Array.isArray(j.stations) &&
    Array.isArray(j.trains) &&
    typeof j.lastDay === 'number';
  return whole ? 'save' : 'damaged';
}
/** The file in a text the way `verdictOf` finds it; only for a text it finds a file in. */
function fileIn(raw: string): Record<string, unknown> {
  let j = JSON.parse(raw) as unknown;
  if (isObject(j) && j.diagnostics === 1 && isObject(j.save)) j = j.save;
  return j as Record<string, unknown>;
}

/** A text for the loader: a JSON value, cut short at `cut` when it is set. */
interface TextCase {
  value: unknown;
  cut?: number;
}
const textOf = ({ value, cut }: TextCase) => {
  const raw = JSON.stringify(value);
  return cut === undefined ? raw : raw.slice(0, cut);
};
/** Any JSON value a save text could hold: files whole or damaged, other JSON, and bundles of each. */
function genValue(rng: Rng, depth = 0): unknown {
  switch (rng.int(0, depth > 0 ? 3 : 4)) {
    case 0:
      return genFile(rng);
    case 1: {
      // a file with a field or two taken out or retyped, its seed among them
      let file: unknown = genFile(rng);
      for (let n = rng.int(1, 2); n > 0; n--) {
        const r = rng.next();
        const edit: Edit =
          r < 0.4
            ? genCoreEdit(rng)
            : r < 0.8
              ? { path: [rng.pick(Object.keys(file as object))] }
              : { path: ['seed'], to: rng.pick(['1', null, [], {}]) };
        file = edited(file, edit);
      }
      return file;
    }
    case 2: {
      // what a broken writer could leave of a file
      const file = genFile(rng);
      return Object.fromEntries(Object.entries(file).filter(() => rng.chance(0.7)));
    }
    case 3:
      return rng.pick([null, 0, 7, -1, 'text', '', true, [], {}, [genFile(rng)], { seed: 4 }]);
    default: {
      const save = genValue(rng, depth + 1);
      const r = rng.next();
      if (r < 0.7) return bundled(save);
      // something that only looks like a bundle
      if (r < 0.85) return { ...bundled(save), diagnostics: rng.pick(['1', 2, true, 0]) };
      // a file that carries a bundle's fields beside its own
      return { ...genFile(rng), diagnostics: 1, save: rng.pick([save, 5, null, []]) };
    }
  }
}
function genTextCase(rng: Rng): TextCase {
  const value = genValue(rng);
  if (!rng.chance(0.1)) return { value };
  return { value, cut: rng.int(0, JSON.stringify(value).length - 1) };
}
/** Fewer top-level fields, or shorter top-level lists; never anything deeper, so it stays sound. */
function* shrinkTop(v: unknown): Iterable<unknown> {
  if (Array.isArray(v)) yield* shrinkArray(v);
  if (!isObject(v)) return;
  for (const key of Object.keys(v))
    yield Object.fromEntries(Object.entries(v).filter(([k]) => k !== key));
  for (const [key, x] of Object.entries(v))
    if (Array.isArray(x)) for (const shorter of shrinkArray(x)) yield { ...v, [key]: shorter };
  if (typeof v.version === 'number' && v.version !== SAVE_VERSION)
    yield { ...v, version: SAVE_VERSION };
}
/** The whole text first, then smaller values, inside a bundle's save too. */
function* shrinkTextCase(c: TextCase): Iterable<TextCase> {
  if (c.cut !== undefined) yield { value: c.value };
  for (const value of shrinkTop(c.value)) yield { ...c, value };
  if (isObject(c.value) && isObject(c.value.save))
    for (const save of shrinkTop(c.value.save)) yield { ...c, value: { ...c.value, save } };
}

describe('a file with one field every version has taken out or retyped', () => {
  it('is refused as damaged, while the whole file loads with what that field held', () => {
    // The loader must hold every version to the same v1 fields, before any step fills anything
    // in, and a bundle must not let a damaged save past it.
    forAll(
      (rng) => ({ file: genFile(rng), edit: genCoreEdit(rng), inBundle: rng.chance(0.3) }),
      ({ file, edit, inBundle }) => {
        const text = (f: unknown) => JSON.stringify(inBundle ? bundled(f) : f);
        const whole = readSaveText(text(file));
        if (!('save' in whole)) throw new Error(`the whole file was refused as ${whole.error}`);
        const { save } = whole;
        const from = fromVersion(file.version);
        const economy = file.economy as SaveGame['economy'];
        expect(save.version).toBe(Math.max(from, SAVE_VERSION));
        expect(save.seed).toBe(file.seed);
        expect(save.clock).toEqual(file.clock);
        expect(save.camera).toEqual(file.camera);
        expect(save.lastDay).toBe(file.lastDay);
        // before v9 the tier was a reputation tier, and becomes the age it reached (at most 2)
        expect(save.economy).toMatchObject({
          money: economy.money,
          tickets: economy.tickets,
          tier: from < 9 ? Math.min(2, economy.tier) : economy.tier,
        });
        for (const key of ['track', 'stations', 'trains'] as const)
          expect(save[key], key).toHaveLength((file[key] as unknown[]).length);

        expect(readSaveText(text(edited(file, edit)))).toEqual({ error: 'damaged' });
      },
      {
        shrink: function* (c) {
          if (c.inBundle) yield { ...c, inBundle: false };
          for (const file of shrinkFile(c.file)) yield { ...c, file };
        },
      },
    );
  });
});

describe('readSaveText, for any text', () => {
  it('refuses exactly what the rules refuse, for the reason they give, and loads the rest', () => {
    // The oracle is the issue's own list of reasons. The loader may be neither stricter (a file
    // missing only later fields loads) nor looser (a seed with no clock is damaged).
    forAll(
      genTextCase,
      (c) => {
        const raw = textOf(c);
        const read = readSaveText(raw);
        const verdict = verdictOf(raw);
        expect('save' in read ? 'save' : read.error).toBe(verdict);
        expect(parseSave(raw) === null).toBe(verdict !== 'save');
      },
      { shrink: shrinkTextCase },
    );
  });

  it('brings a save it takes through every step to this version, and invents no field', () => {
    // A version the chain cannot count up from would skip every step ("defaults apply") or never
    // end; a step that writes a field the build does not know would carry it forever.
    forAll(
      genTextCase,
      (c) => {
        const raw = textOf(c);
        const read = readSaveText(raw);
        if (!('save' in read)) return;
        const { save } = read;
        const file = fileIn(raw);
        const from = fromVersion(file.version);
        expect(save.version).toBe(Math.max(from, SAVE_VERSION));
        expect(save.loadedFrom).toBe(from === SAVE_VERSION ? undefined : from);
        if (from < SAVE_VERSION) {
          expect(save.migrationNotes).toHaveLength(SAVE_VERSION - from);
          save.migrationNotes!.forEach((note, i) =>
            expect(note.startsWith(`v${from + i}→v${from + i + 1}: `), note).toBe(true),
          );
        }
        for (const key of Object.keys(save))
          expect(KNOWN_SAVE_KEYS.has(key) || key in file, key).toBe(true);
        // written back as it was read, it reads the same
        const again = readSaveText(JSON.stringify(save));
        expect('save' in again && asStored(again.save)).toEqual(asStored(save));
      },
      { shrink: shrinkTextCase },
    );
  });

  it('reads a diagnostics bundle exactly as the save it carries', () => {
    forAll(
      (rng) => genValue(rng, 1),
      (value) => {
        const inBundle = readSaveText(JSON.stringify(bundled(value)));
        if (!isObject(value)) expect(inBundle).toEqual({ error: 'notSave' });
        else expect(inBundle).toEqual(readSaveText(JSON.stringify(value)));
      },
      { shrink: shrinkTop },
    );
  });
});

/** Parts a game could save: a generated file's fields over the full fixture's. */
function genParts(rng: Rng): SaveParts {
  const file = genFile(rng);
  const parts = fullParts() as unknown as Record<string, unknown>;
  for (const key of Object.keys(parts)) if (key in file) parts[key] = file[key];
  return parts as unknown as SaveParts;
}
const FULL_PARTS = JSON.stringify(fullParts());
const EXTRA_NAMES = ['somethingNewer', 'modData', 'zz', '7', 'Seed', 'settingsV2'];
/** What a loaded file could hand back to be written: known names and unknown ones, any value. */
function genExtra(rng: Rng): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  for (let n = rng.int(0, 6); n > 0; n--) {
    const key = rng.chance(0.5) ? rng.pick([...KNOWN_SAVE_KEYS]) : rng.pick(EXTRA_NAMES);
    extra[key] = rng.pick([rng.int(0, 9), 'x', null, { a: 1 }, [1, 2], { ...DEFAULT_SETTINGS }]);
  }
  return extra;
}

describe('buildSave, for any parts and extras', () => {
  it('writes the unknown extras, then every part, then the stamps, and nothing else', () => {
    // Every key written is known or was unknown in the loaded file; a known name in the extras
    // (settings, the load notes, a stale stamp) is never written over the parts or beside them.
    forAll(
      (rng) => ({ parts: genParts(rng), extra: genExtra(rng), now: rng.int(0, 2 ** 41) }),
      ({ parts, extra, now }) => {
        const j = buildSave(parts, extra, now);
        const unknown = Object.keys(extra).filter((k) => !KNOWN_SAVE_KEYS.has(k));
        expect(Object.keys(j)).toEqual([...unknown, ...Object.keys(parts), 'version', 'savedAt']);
        for (const key of Object.keys(j))
          expect(KNOWN_SAVE_KEYS.has(key) || unknown.includes(key), key).toBe(true);
        for (const key of Object.keys(parts) as (keyof SaveParts)[])
          expect(j[key], key).toBe(parts[key]);
        for (const key of unknown) expect(j[key], key).toBe(extra[key]);
        expect(j.version).toBe(SAVE_VERSION);
        expect(j.savedAt).toBe(now);
        expect(readSaveText(JSON.stringify(j))).toEqual({ save: asStored(j) });
      },
      {
        shrink: function* (c) {
          if (JSON.stringify(c.parts) !== FULL_PARTS) yield { ...c, parts: fullParts() };
          for (const key of Object.keys(c.extra))
            yield {
              ...c,
              extra: Object.fromEntries(Object.entries(c.extra).filter(([k]) => k !== key)),
            };
        },
        format: (c) =>
          JSON.stringify({
            ...c,
            parts: JSON.stringify(c.parts) === FULL_PARTS ? 'fullParts()' : c.parts,
          }),
      },
    );
  });
});

const NAME_CHARS = ['a', 'b', 'Z', ' ', ' ', '\t', ' ', 'é', '😀'];
/** A slot name a player could type: short or around the 32-character cut, spaces anywhere. */
function genName(rng: Rng): string {
  if (rng.chance(0.15))
    return rng.pick(['toString', 'constructor', 'hasOwnProperty', 'valueOf', '']);
  const length = rng.chance(0.5) ? rng.int(0, 6) : rng.int(28, 40);
  return Array.from({ length }, () => rng.pick(NAME_CHARS)).join('');
}
/** A name close to `name`: padded, run on, upper-cased or cut. */
function variantOf(rng: Rng, name: string): string {
  switch (rng.int(0, 3)) {
    case 0:
      return ' '.repeat(rng.int(0, 2)) + name + '\t'.repeat(rng.int(0, 2));
    case 1:
      return name + genName(rng);
    case 2:
      return name.toUpperCase();
    default:
      return name.slice(0, rng.int(0, name.length));
  }
}
function* shrinkName(name: string): Iterable<string> {
  for (const chars of shrinkArray(name.split(''))) yield chars.join('');
}
/** A slot table as storage could hold it: names to texts of any kind, or not a table at all. */
function genSlotsText(rng: Rng): string {
  if (rng.chance(0.15)) return rng.pick(['null', '[]', '5', '"x"', '{oops', '']);
  const table: Record<string, unknown> = {};
  for (let n = rng.int(0, 4); n > 0; n--)
    table[genName(rng)] = rng.chance(0.9) ? textOf(genTextCase(rng)) : rng.pick([5, null, {}, []]);
  return JSON.stringify(table);
}
/** What storage could hold: a stored game, the settings and a slot table, each there or not. */
function genStored(rng: Rng): Record<string, string> {
  const items: Record<string, string> = {};
  if (rng.chance(0.6)) items[SAVE_KEY] = textOf(genTextCase(rng));
  if (rng.chance(0.6))
    items[SETTINGS_KEY] = rng.pick([
      JSON.stringify({ ...DEFAULT_SETTINGS, music: 0.7 }),
      '{"music":0}',
      '{oops',
      'null',
    ]);
  if (rng.chance(0.7)) items[SLOTS_KEY] = genSlotsText(rng);
  if (rng.chance(0.2)) items['terepasztal.levels'] = '[]';
  return items;
}
/** Smaller stored texts: the JSON in `raw` shrunk as a loader's text is, when it is JSON. */
function* shrinkStoredText(raw: string): Iterable<string> {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return;
  }
  for (const c of shrinkTextCase({ value })) yield textOf(c);
}
/** Fewer stored keys, then fewer named saves, then smaller texts in the slots and the game. */
function* shrinkStored(items: Record<string, string>): Iterable<Record<string, string>> {
  for (const key of Object.keys(items))
    yield Object.fromEntries(Object.entries(items).filter(([k]) => k !== key));
  const table = slotTable(items[SLOTS_KEY]);
  for (const name of Object.keys(table)) {
    const fewer = Object.fromEntries(Object.entries(table).filter(([k]) => k !== name));
    yield { ...items, [SLOTS_KEY]: JSON.stringify(fewer) };
  }
  for (const [name, text] of Object.entries(table))
    if (typeof text === 'string')
      for (const smaller of shrinkStoredText(text))
        yield { ...items, [SLOTS_KEY]: JSON.stringify({ ...table, [name]: smaller }) };
  if (items[SAVE_KEY] !== undefined)
    for (const smaller of shrinkStoredText(items[SAVE_KEY]))
      yield { ...items, [SAVE_KEY]: smaller };
}
/** The slot table in a stored text, read apart from the module: a JSON object, else none. */
function slotTable(raw: string | undefined): Record<string, unknown> {
  try {
    const t: unknown = JSON.parse(raw ?? '{}');
    return isObject(t) ? t : {};
  } catch {
    return {};
  }
}
/** What a list shows of a stored text: its stamps as written, the rest read from `s`, 0 if absent. */
function shownAs(name: string, raw: string, s: Record<string, unknown>) {
  const file = fileIn(raw);
  const n = (v: unknown) => (typeof v === 'number' ? v : 0);
  const economy = isObject(s.economy) ? s.economy : {};
  return {
    name,
    savedAt: n(file.savedAt),
    version: n(file.version),
    seed: file.seed,
    day: n(s.lastDay),
    age: n(economy.tier),
    money: n(economy.money),
  };
}

describe('storage, from any state it is in', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  /** A fresh in-memory localStorage holding `items`, in place of the real one. */
  function stubStorage(items: Record<string, string>) {
    const store = new MemoryStorage();
    for (const [k, v] of Object.entries(items)) store.items.set(k, v);
    vi.stubGlobal('localStorage', store);
    return store;
  }

  it('imports a text only when it is taken, in one write, and never touches the settings', () => {
    forAll(
      (rng) => ({ items: genStored(rng), text: genTextCase(rng) }),
      ({ items, text }) => {
        const raw = textOf(text);
        const store = stubStorage(items);
        const before = new Map(store.items);
        const read = readSaveText(raw);
        const r = importSave(raw);
        if ('error' in read) {
          expect(r).toEqual({ ok: false, error: read.error });
          expect(store.writes).toBe(0);
          expect(store.items).toEqual(before);
          return;
        }
        expect(r).toEqual({ ok: true, save: read.save });
        expect(store.writes).toBe(1);
        // the settings, the slots and the rest are as they were, there or not
        const others = (m: Map<string, string>) => [...m].filter(([k]) => k !== SAVE_KEY);
        expect(others(store.items)).toEqual(others(before));
        expect(JSON.parse(store.items.get(SAVE_KEY)!)).toEqual(asStored(read.save));
        // Continue now loads the imported game and describes it
        expect(asStored(readSave())).toEqual(asStored(read.save));
        expect(continueMeta()).toMatchObject({
          seed: read.save.seed,
          day: read.save.lastDay,
          age: read.save.economy.tier,
          money: read.save.economy.money,
        });
      },
      {
        shrink: function* (c) {
          for (const text of shrinkTextCase(c.text)) yield { ...c, text };
          for (const items of shrinkStored(c.items)) yield { ...c, items };
        },
      },
    );
  });

  it('reads without writing, and Continue and the slot list show exactly what loads', () => {
    // Continue is offered exactly when there is a game to load; a slot that loads is listed by
    // what loading gives (an old tier as its age), a damaged one by what it holds, 0 for the rest.
    forAll(
      (rng) => ({ items: genStored(rng), probe: genName(rng) }),
      ({ items, probe }) => {
        const store = stubStorage(items);
        const before = new Map(store.items);

        const game = readSave();
        const meta = continueMeta();
        const stored = items[SAVE_KEY];
        expect(game === null).toBe(stored === undefined || verdictOf(stored) !== 'save');
        expect(meta === null).toBe(game === null);
        if (game) expect(meta).toEqual(shownAs('', stored, game));

        const listed = listSlots();
        let shown = 0;
        for (const [name, text] of Object.entries(slotTable(items[SLOTS_KEY]))) {
          const verdict = typeof text === 'string' ? verdictOf(text) : 'notSave';
          const slot = readSlot(name);
          const metas = listed.filter((m) => m.name === name);
          expect(slot === null, name).toBe(verdict !== 'save');
          if (verdict === 'notSave' || verdict === 'json') expect(metas, name).toEqual([]);
          else {
            shown++;
            const s = slot ?? fileIn(text as string);
            expect(metas, name).toEqual([shownAs(name, text as string, s)]);
          }
        }
        expect(listed).toHaveLength(shown);
        for (let i = 1; i < listed.length; i++)
          expect(listed[i - 1].savedAt).toBeGreaterThanOrEqual(listed[i].savedAt);

        hasSlot(probe);
        readSlot(probe);
        expect(store.writes).toBe(0);
        expect(store.items).toEqual(before);
      },
      {
        shrink: function* (c) {
          for (const items of shrinkStored(c.items)) yield { ...c, items };
          for (const probe of shrinkName(c.probe)) yield { ...c, probe };
        },
      },
    );
  });

  it('finds a named save exactly when writing that name would replace one', () => {
    const save = buildSave(fullParts(), {}, 1);
    forAll(
      (rng) => {
        const names = Array.from({ length: rng.int(0, 4) }, () => genName(rng));
        const near = names.length > 0 && rng.chance(0.6);
        return { names, query: near ? variantOf(rng, rng.pick(names)) : genName(rng) };
      },
      ({ names, query }) => {
        const store = stubStorage({});
        for (const name of names) writeSlot(name, save);
        const count = () => Object.keys(slotTable(store.items.get(SLOTS_KEY))).length;
        const before = count();
        const found = hasSlot(query);
        writeSlot(query, save);
        expect(found).toBe(count() === before);
        expect(hasSlot(query)).toBe(true);
        for (const { name } of listSlots()) expect(hasSlot(name), name).toBe(true);
      },
      {
        shrink: function* (c) {
          for (const names of shrinkArray(c.names, shrinkName)) yield { ...c, names };
          for (const query of shrinkName(c.query)) yield { ...c, query };
        },
      },
    );
  });
});

// ------------------------------------------------------------------ the defaults the steps fill

/** Every route mode a train has today. */
const ROUTE_MODES: readonly unknown[] = ['schedule', ...DYNAMIC_MODES];
/** The names route modes had before the renaming in v7, and the names they have now. */
const OLD_MODE_TO_NEW: ReadonlyMap<string, RouteMode> = new Map([
  ['fixed', 'schedule'],
  ['dynamic', 'production'],
  ['collect', 'collection'],
]);
/** The names route modes had before the renaming in v7. */
const OLD_MODE_NAMES: readonly unknown[] = [...OLD_MODE_TO_NEW.keys()];
/** Modes no build wrote: the step keeps them, and the load code turns them into a schedule. */
const ODD_MODES: readonly unknown[] = ['bogus', 7];
/** What a train's mode could be in a file: none, an old name, today's, and values no build wrote. */
const MODE_VALUES: unknown[] = [
  undefined,
  null,
  '',
  ...OLD_MODE_NAMES,
  ...ROUTE_MODES,
  ...ODD_MODES,
];
/**
 * The fields the step from v13 gives every train, with what a load before v14 left in them: it
 * stands without a route, at no station, with no escape to back off along, free to be asked to
 * back off again, no stop ruled out and no service to head for, and looks for a route and for
 * fuel or water on its first tick.
 */
const RESUME_DEFAULTS: Readonly<Record<string, unknown>> = {
  state: 'noRoute',
  stateTime: 10,
  speed: 0,
  station: null,
  holding: false,
  retreat: null,
  blockedTime: 0,
  yieldCount: 0,
  yieldUntil: 0,
  badTargets: [],
  serviceStop: null,
  nextFuelCheck: 0,
};
/**
 * Values a file may already hold in a field the step from v13 fills, none of them the step's
 * default: unknown fields are carried through, and a step only fills what is absent.
 */
const RESUME_HELD: Readonly<Record<string, readonly unknown[]>> = {
  state: ['moving', 'loading', 'waiting', 'idle'],
  stateTime: [0, 3.5],
  speed: [0.7, 1.4],
  station: [1, 7],
  holding: [true],
  retreat: [{ path: [{ x: 3, y: 4, in: 0, out: 2 }], group: [1, 2] }],
  blockedTime: [2.5],
  yieldCount: [1, 3],
  yieldUntil: [34, 1250.5],
  badTargets: [
    [[2, 240]],
    [
      [1, 60.5],
      [4, 300],
    ],
  ],
  serviceStop: [{ x: 5, y: 6, fuel: true, water: false }],
  nextFuelCheck: [5.05, 812],
};
/** A station's turn in a file: none, one of the four, or null. */
const ROT_VALUES: unknown[] = [undefined, 0, 1, 2, 3, null];
/** A tier a file could hold: whole ones past the Electric Age too, and values no build wrote. */
const TIER_VALUES: unknown[] = [undefined, null, '3', -2, Number.NaN, 1.5, 0, 1, 2, 3, 4, 6, 9];

/** The tier a v4 file stored, uncapped: a number above 0, else 0 (the rule for the v4 step). */
const tierStored = (tier: unknown) => (typeof tier === 'number' && tier > 0 ? tier : 0);

/** A train's mode, battery and the flag older trains had instead of a mode, as a file holds them. */
interface OldTrain {
  mode?: unknown;
  dynamic?: boolean;
  battery?: number;
  /** some of the fields the step from v13 fills, already held (RESUME_HELD) */
  held?: Record<string, unknown>;
}
function genOldTrain(rng: Rng): OldTrain {
  const t: OldTrain = {};
  const mode = rng.pick(MODE_VALUES);
  if (mode !== undefined) t.mode = mode;
  if (rng.chance(0.5)) t.dynamic = rng.chance(0.5);
  if (rng.chance(0.6)) t.battery = rng.pick([0, rng.int(1, 60), rng.range(0, 60), 90]);
  if (rng.chance(0.3)) {
    t.held = {};
    for (const [key, values] of Object.entries(RESUME_HELD))
      if (rng.chance(0.5)) t.held[key] = rng.pick(values);
  }
  return t;
}
/**
 * `base` (a saved train) with the old train's mode, flag, battery and held fields, and no tanks
 * unless `tanks`.
 */
function withOld(base: object, t: OldTrain, tanks = true): Record<string, unknown> {
  const train = asStored(base) as Record<string, unknown> & { tanks?: Record<string, unknown> };
  delete train.mode;
  if ('mode' in t) train.mode = t.mode;
  if ('dynamic' in t) train.dynamic = t.dynamic;
  if (t.held) Object.assign(train, t.held);
  if (!tanks) delete train.tanks;
  else {
    train.tanks = train.tanks ?? { coal: 0, oil: 0, water: 0 };
    delete train.tanks.battery;
    if ('battery' in t) train.tanks.battery = t.battery;
  }
  return train;
}
/** An electric as the game saves it, with a battery cart, so the battery it loads with shows. */
function savedTrain(): Record<string, unknown> {
  const t = new Train([{ uid: 1, level: 1, def: locoDef('kando_v40') }], undefined, 1);
  t.wagons = [
    { uid: 2, def: wagonDef('battery_cart'), level: 1, cargo: null, amount: 0, origin: null },
  ];
  return asStored(t.toJSON()) as Record<string, unknown>;
}
type TrainJSON = ReturnType<Train['toJSON']>;

/** A station of `defId` with `rot` as its turn, or none. */
function stationOf(defId: string, rot: unknown, i = 0): StationJSON {
  const s: Record<string, unknown> = { id: i + 1, defId, name: `S ${i}`, x: i, y: i, level: 1 };
  s.storage = {};
  if (rot !== undefined) s.rot = rot;
  return s as unknown as StationJSON;
}

/** A level of `w` by `h` tiles as the editor saves one, stamped at 0 so nothing reads the clock. */
function levelWorldOf(w: number, h: number, seed = 5): WorldSpec {
  const level = {
    ...levelFromMap(emptyMap(seed, w, h), 'Test', 'test'),
    createdAt: 0,
    updatedAt: 0,
  };
  return { kind: 'level', seed, level };
}
const generatedWorldOf = (w: number, h: number, seed = 77): WorldSpec => ({
  kind: 'generated',
  seed,
  params: { ...DEFAULT_MAP_PARAMS, w, h },
});
/** A world of any size: generated, or a level no larger than a v4 build drew. */
function genWorld(rng: Rng): WorldSpec {
  const side = (max: number) => (rng.chance(0.5) ? 32 * rng.int(1, max / 32) : rng.int(1, max));
  if (rng.chance(0.75)) return generatedWorldOf(side(416), side(416), rng.int(0, 1e6));
  return levelWorldOf(side(160), side(160), rng.int(0, 1e6));
}
/**
 * The chunk grid of the map the game builds for `world`: a level's own map, and for a generated
 * world `emptyMap` of its size, which is how `generateMap` lays its grid (terrain is not needed).
 */
function gridOf(world: WorldSpec | undefined, seed: number): GameMap {
  if (world?.kind === 'level') return mapFromLevel(world.level);
  const p = { ...DEFAULT_MAP_PARAMS, ...world?.params };
  return emptyMap(world?.seed ?? seed, p.w, p.h);
}
/**
 * The chunks `tier` owns, found by growing rather than by measuring: the chunk holding the middle
 * of the start basin (`generateMap`'s start), then once per whole tier every chunk touching an
 * owned one, corners included.
 */
function ownedByGrowth(map: GameMap, tier: number): boolean[] {
  const regions = new RegionState(map);
  const rs = map.regionSize;
  const start = regions.regionIndex(
    (Math.floor((map.regionsX - 1) / 2) + 0.5) * rs,
    (Math.floor((map.regionsY - 1) / 2) + 0.5) * rs,
  );
  let owned = new Array<boolean>(map.regionsX * map.regionsY).fill(false);
  owned[start] = true;
  for (let ring = 1; ring <= tier && owned.includes(false); ring++) {
    const next = [...owned];
    owned.forEach((o, i) => {
      if (o) for (const n of regions.neighbours(i)) next[n] = true;
    });
    owned = next;
  }
  return owned;
}
/** A v4 file of `world` whose economy stored `tier`, or no tier at all. */
function v4File(world: WorldSpec, tier: unknown): SaveGame {
  const economy: Record<string, unknown> = { money: 1000, tickets: 0, granted: [] };
  if (tier !== undefined) economy.tier = tier;
  return { ...oldestSave(), version: 4, world, economy: economy as SaveGame['economy'] };
}
/** What a trade desk holds once it has loaded `trade`. */
function deskOf(trade: unknown) {
  const desk = new TradeDesk();
  desk.load(trade as Parameters<TradeDesk['load']>[0]);
  return desk.toJSON();
}

/**
 * A file of any version whose trains and stations have the shapes old builds wrote (old mode
 * names, the flag, no battery, no turn) and whose world is of any size.
 */
function genOldFile(rng: Rng): Record<string, unknown> {
  const file = genFile(rng);
  file.version = rng.int(SAVE_MIN_VERSION, SAVE_VERSION);
  file.trains = (file.trains as unknown[]).map((_, i) =>
    withOld({ id: i + 1 }, genOldTrain(rng), rng.chance(0.8)),
  );
  for (const s of file.stations as Record<string, unknown>[]) {
    const rot = rng.pick(ROT_VALUES);
    if (rot !== undefined) s.rot = rot;
  }
  if (rng.chance(0.5)) file.world = genWorld(rng);
  return file;
}
/** Smaller old files: fewer fields and items, as `shrinkFile`, then shorter train and station lists. */
function* shrinkOldFile(file: Record<string, unknown>): Iterable<Record<string, unknown>> {
  yield* shrinkFile(file);
  for (const key of ['trains', 'stations'])
    for (const shorter of shrinkArray(file[key] as unknown[])) yield { ...file, [key]: shorter };
}

/** The fields each step fills, taken out of a copy of `file`; the rest is what the step must keep. */
function withoutFilled(from: number, file: unknown): unknown {
  const copy = asStored(file) as Record<string, unknown>;
  const trains = (copy.trains as unknown[]).filter(isObject);
  const top: Record<number, string[]> = {
    1: ['decor'],
    2: ['world'],
    3: ['buildings'],
    4: ['regions'],
    5: ['seasonOffset'],
    6: ['towns'],
    7: ['trade'],
    9: ['crafting'],
  };
  for (const key of top[from] ?? []) delete copy[key];
  if (from === 6) for (const s of (copy.stations as unknown[]).filter(isObject)) delete s.rot;
  // the modes were renamed while saves were v7: the steps from v6 and v7 both map them
  if (from === 6 || from === 7) for (const t of trains) delete t.mode;
  if (from === 9) for (const t of trains) if (isObject(t.tanks)) delete t.tanks.battery;
  if (from === 13) for (const t of trains) for (const key in RESUME_DEFAULTS) delete t[key];
  if (from === 14) {
    for (const s of (copy.stations as unknown[]).filter(isObject)) delete s.work;
    for (const b of Array.isArray(copy.buildings) ? copy.buildings : [])
      if (Array.isArray(b)) b.length = Math.min(b.length, 5);
    const list = isObject(copy.houses) ? copy.houses.list : undefined;
    if (Array.isArray(list)) for (const h of list.filter(isObject)) delete h.work;
  }
  if (from === 15)
    for (const b of Array.isArray(copy.buildings) ? copy.buildings : []) {
      if (!Array.isArray(b) || b.length < 4) continue;
      // what the step may add, taken off the end: rotation 0 in place of none, then the no-work
      // and level 1 it put before it; a value the file held is kept, and must be the same
      if (b.length >= 7 && b[6] === null) b[6] = 0;
      if (b.length === 7 && b[6] === 0) b.length = 6;
      if (b.length === 6 && b[5] === null) b.length = 5;
      if (b.length === 5 && b[4] === 1) b.length = 4;
    }
  return copy;
}

describe('the defaults the steps fill', () => {
  beforeEach(() => {
    resetTrainIds(1);
    resetStationIds(1);
    Object.assign(rules, DEFAULT_RULES);
  });

  it('load every train and station as they loaded before a step filled them', () => {
    // Before the steps filled them, no step touched a train or a station: Train.fromJSON mapped
    // the old route modes and filled the battery, Station.fromJSON the turn. Moving the defaults
    // into the steps may not change what loads. Train.fromJSON no longer maps or fills, so what
    // it did is written out here (`loadedBefore`) and every shape a build of a version wrote is
    // held to it: old mode names and a missing mode up to v7, where the modes were renamed, and a
    // missing battery up to v9, before the battery came. Station.fromJSON still fills the turn and
    // is its own oracle. The shapes are few, so every one is tried from every version, each
    // failure naming the one train or station.
    const track = new TrackGraph(8, 8);
    const base = savedTrain();
    const cap = Train.fromJSON(asStored(base) as TrainJSON, track).batteryCap;
    /** The mode and battery the load code gave a stored train before the steps filled them. */
    const loadedBefore = (t: OldTrain) => {
      const m = t.mode;
      const old = typeof m === 'string' ? OLD_MODE_TO_NEW.get(m) : undefined;
      const mode = m
        ? (old ?? (ROUTE_MODES.includes(m) ? m : 'schedule'))
        : t.dynamic
          ? 'production'
          : 'schedule';
      return { mode, battery: Math.min(cap, t.battery ?? 0) };
    };
    /** Could a build of `version` have written the train: modes and battery as it named them. */
    const wrote = (version: number, t: OldTrain) =>
      (version <= 7 || ROUTE_MODES.includes(t.mode) || ODD_MODES.includes(t.mode)) &&
      (version <= 9 || t.battery !== undefined);
    const trains: OldTrain[] = [];
    for (const mode of MODE_VALUES)
      for (const dynamic of [undefined, true, false])
        for (const battery of [undefined, 0, 45, 90]) {
          const t: OldTrain = {};
          if (mode !== undefined) t.mode = mode;
          if (dynamic !== undefined) t.dynamic = dynamic;
          if (battery !== undefined) t.battery = battery;
          trains.push(t);
        }
    const stations = ROT_VALUES.flatMap((rot) =>
      ['farm', 'town', 'depot', 'lumber'].map((defId) => ({ defId, rot })),
    );
    for (let version = SAVE_MIN_VERSION; version <= SAVE_VERSION; version++) {
      const written = trains.filter((t) => wrote(version, t));
      const file: SaveGame = {
        ...oldestSave(),
        version,
        trains: written.map((t) => withOld(base, t)),
        stations: stations.map((s, i) => stationOf(s.defId, s.rot, i)),
      };
      const before = asStored(file) as SaveGame;
      const j = migrate(file);
      j.trains.forEach((after, i) => {
        const label = `v${version} train ${JSON.stringify(written[i])}`;
        const was = loadedBefore(written[i]);
        const now = Train.fromJSON(asStored(after) as TrainJSON, track);
        expect(now.mode, `${label}: the mode it loads with`).toBe(was.mode);
        expect(now.battery, `${label}: the battery it loads with`).toBe(was.battery);
        const stored = after as { mode?: unknown; tanks: { battery?: unknown } };
        if (version <= 7 && !ODD_MODES.includes(written[i].mode))
          expect(stored.mode, `${label}: the mode the file now holds`).toBe(was.mode);
        if (version <= 9) expect(typeof stored.tanks.battery, label).toBe('number');
      });
      j.stations.forEach((after, i) => {
        const label = `v${version} station ${JSON.stringify(stations[i])}`;
        const was = Station.fromJSON(asStored(before.stations[i]) as StationJSON);
        expect(Station.fromJSON(asStored(after) as StationJSON).rot, label).toBe(was.rot);
        if (version <= 6) expect(after.rot, `${label}: the turn the file holds`).toBe(was.rot);
      });
    }
    // the battery comparison means something only when the train can hold a charge
    expect(
      Train.fromJSON(asStored(withOld(base, { battery: 45 })) as TrainJSON, track).battery,
    ).toBe(45);
  });

  it('bring a file of any version to this one with every default present, and keep what it had', () => {
    // Each field a step fills: kept where the file has it, the step's default where the file is
    // older than the step, and left out where the file is newer (only its own steps run).
    forAll(
      genOldFile,
      (file) => {
        const before = asStored(file) as Record<string, unknown>;
        const from = fromVersion(before.version);
        const read = readSaveText(JSON.stringify(file));
        if (!('save' in read)) throw new Error(`the file was refused as ${read.error}`);
        const save = read.save;
        expect(save.version).toBe(SAVE_VERSION);
        /** The field as the file had it, or as the step from `step` fills it, or still absent. */
        const field = (key: string, step: number, filled: (v: unknown) => void) => {
          if (key in before) expect(asStored(save[key]), key).toEqual(before[key]);
          else if (from <= step) filled(save[key]);
          else expect(key in save, `${key} from v${from}`).toBe(false);
        };
        const tier = tierStored((before.economy as Record<string, unknown>).tier);
        const owned = ownedByGrowth(gridOf(save.world, save.seed), tier);
        field('regions', 4, (v) => expect(v, 'regions').toEqual(owned));
        field('seasonOffset', 5, (v) => expect(v, 'seasonOffset').toBe(0));
        field('towns', 6, (v) => expect(v, 'towns').toEqual([]));
        // the step to v12 restarts a desk's cycle: the rest of a desk the file had is kept
        const besideCycle = (desk: unknown) =>
          Object.entries(desk as object).filter(([k]) => k !== 'nextAt' && k !== 'driftDay');
        if ('trade' in before)
          expect(besideCycle(save.trade), 'trade').toEqual(besideCycle(before.trade));
        else field('trade', 7, (v) => expect(deskOf(v), 'trade').toEqual(deskOf(undefined)));

        const stations = before.stations as Record<string, unknown>[];
        save.stations.forEach((s, i) => {
          const was = stations[i].rot;
          const rot = 'rot' in s ? s.rot : 'absent';
          if (from <= 6) expect(rot, `station ${i}`).toBe(was ?? 0);
          else expect(rot, `station ${i}`).toBe('rot' in stations[i] ? was : 'absent');
        });
        const trains = before.trains as Record<string, unknown>[];
        (save.trains as Record<string, unknown>[]).forEach((t, i) => {
          const was = trains[i];
          const mode = 'mode' in t ? t.mode : 'absent';
          const wasMode = 'mode' in was ? was.mode : 'absent';
          if (from > 7 || ROUTE_MODES.includes(was.mode) || ODD_MODES.includes(was.mode))
            expect(mode, `train ${i}: mode`).toBe(wasMode);
          else expect(ROUTE_MODES, `train ${i}: mode`).toContain(mode);
          for (const [key, value] of Object.entries(RESUME_DEFAULTS)) {
            if (key in was) expect(t[key], `train ${i}: ${key}`).toEqual(was[key]);
            else if (from <= 13) expect(t[key], `train ${i}: ${key}`).toEqual(value);
            else expect(key in t, `train ${i}: ${key} from v${from}`).toBe(false);
          }
          expect(isObject(t.tanks), `train ${i}: tanks`).toBe(isObject(was.tanks));
          if (!isObject(t.tanks) || !isObject(was.tanks)) return;
          const battery = 'battery' in t.tanks ? t.tanks.battery : 'absent';
          const wasBattery = 'battery' in was.tanks ? was.tanks.battery : 'absent';
          if (from <= 9 && wasBattery === 'absent') expect(battery, `train ${i}: battery`).toBe(0);
          else expect(battery, `train ${i}: battery`).toBe(wasBattery);
        });

        // migrating again changes nothing: written back, the save reads as it was
        const again = readSaveText(JSON.stringify(save));
        expect('save' in again && asStored(again.save), 'read back').toEqual(asStored(save));
      },
      { shrink: shrinkOldFile },
    );
  });

  it('have each step fill only its own fields, and change nothing the second time', () => {
    // A step that only fills defaults leaves every other field alone, and finds nothing left to
    // fill when it runs again; a step that rewrote a value it should keep would not.
    forAll(
      (rng) => {
        const from = rng.pick([1, 2, 3, 4, 5, 6, 7, 9, 13, 14, 15]);
        const file: Record<string, unknown> = { ...genOldFile(rng), version: from };
        return { from, file };
      },
      ({ from, file }) => {
        const once = asStored(runStep(from, asStored(file) as SaveGame));
        const twice = asStored(runStep(from, asStored(once) as SaveGame));
        expect(twice, `the step from v${from}, run again`).toEqual(once);
        expect(withoutFilled(from, once), `the step from v${from}, beside its own fields`).toEqual(
          withoutFilled(from, file),
        );
      },
      {
        shrink: function* (c) {
          for (const file of shrinkOldFile(c.file))
            if (file.version === c.from) yield { ...c, file };
        },
      },
    );
  });

  it('own, on every map a v4 build made, what the load code owned for the tier the file stored', () => {
    // v4 builds made square maps of 32 to 160 tiles in steps of 32 (`rules.mapSize`), generated or
    // drawn as a level, so a v4 file meets rings 0 to 2 only. Before the step filled the chunks,
    // applySave built `new RegionState(map, 0)` and called `applyTier` with the tier the economy
    // loaded. That is the oracle on odd grids, for every file the loader takes (a tier that is no
    // number is refused before any step runs); on even grids regionTierMap rounds the start chunk
    // away (issue #58), and there the step owns the start chunk's rings, as on every grid.
    for (const size of [32, 64, 96, 128, 160])
      for (const world of [generatedWorldOf(size, size), levelWorldOf(size, size)]) {
        const map =
          world.kind === 'level' ? mapFromLevel(world.level) : generateMap(77, world.params);
        for (const tier of TIER_VALUES) {
          const label = `${world.kind} ${size}×${size}, tier ${String(tier)}`;
          const j = migrate(v4File(world, tier));
          expect(j.regions, label).toEqual(ownedByGrowth(map, tierStored(tier)));
          const regions = new RegionState(map);
          regions.load(j.regions!);
          expect(regions.unlocked, `${label}: the list the map takes`).toEqual(j.regions);
          const read = readSaveText(JSON.stringify(v4File(world, tier)));
          expect('save' in read, `${label}: loads`).toBe(typeof tier === 'number' && !isNaN(tier));
          if (!('save' in read) || map.regionsX % 2 === 0) continue;
          expect(read.save.regions, `${label}: as read`).toEqual(j.regions);
          const economy = new Economy();
          economy.load(read.save.economy);
          const onLoad = new RegionState(map, 0);
          onLoad.applyTier(economy.tier);
          expect(j.regions, `${label}: what applySave owned`).toEqual(onLoad.unlocked);
        }
      }
  });

  it('own the start chunk and the rings of the stored tier, on a world of any size', () => {
    // Past the sizes v4 builds made, the step follows its own rule: the tier the file stored,
    // uncapped, in whole Chebyshev rings around the chunk map generation starts in, on the grid
    // of the map the world builds, so the map takes the list on load.
    forAll(
      (rng) => ({ world: genWorld(rng), tier: rng.pick(TIER_VALUES) }),
      ({ world, tier }) => {
        const j = migrate(v4File(world, tier));
        const map = gridOf(world, 0);
        expect(j.regions).toEqual(ownedByGrowth(map, tierStored(tier)));
        const regions = new RegionState(map);
        regions.load(j.regions!);
        expect(regions.unlocked, 'the list the map takes').toEqual(j.regions);
      },
      {
        shrink: function* (c) {
          if (typeof c.tier === 'number' && Number.isInteger(c.tier))
            for (const tier of shrinkInt(c.tier)) yield { ...c, tier };
          if (c.world.kind !== 'generated') return;
          const { w, h } = c.world.params;
          for (const n of shrinkInt(w, 32)) yield { ...c, world: generatedWorldOf(n, h) };
          for (const n of shrinkInt(h, 32)) yield { ...c, world: generatedWorldOf(w, n) };
        },
      },
    );
  });
});
