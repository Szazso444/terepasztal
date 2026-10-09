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
  contractPolicyFor,
  uniformContractPolicy,
  convertOneTileRegular,
  CONTRACT_RARITIES,
  type SaveGame,
  type SaveParts,
  type Settings,
} from './save';
import { buildingFromJSON, buildingToJSON, type Building } from './buildings';
import { DEFAULT_MAP_PARAMS } from '../world/mapgen';
import { forAll, shrinkArray, shrinkInt } from '../testing/property';

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
    expect(j.houses?.list).toEqual([
      { x: 3, y: 4, level: 1, residents: 6, progress: 1 },
      { x: 7, y: 8, level: 1, residents: 6, progress: 1 },
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
    expect(j.buildings).toContainEqual([4, 8, 'bridge_wood', 0, 1]);
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
    const b: Building = { id: 'sawmill', x: 4, y: 9, acc: 0.25, level: 3, active: true, rate: 2 };
    expect(buildingToJSON(b)).toEqual([4, 9, 'sawmill', 0.25, 3]);
    expect(buildingFromJSON(buildingToJSON(b))).toEqual({
      ...b,
      active: false,
      rate: 0,
    });
  });

  it('take level 1 where the save has none', () => {
    expect(buildingFromJSON([1, 2, 'mill', 0])).toEqual({
      id: 'mill',
      x: 1,
      y: 2,
      acc: 0,
      level: 1,
      active: false,
      rate: 0,
    });
    expect(buildingToJSON({ id: 'mill', x: 1, y: 2, acc: 0, active: false, rate: 0 })).toEqual([
      1,
      2,
      'mill',
      0,
      1,
    ]);
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
  it('turns the retired auto-accept switch into a per-rarity policy', () => {
    const on: Partial<Settings> = { autoContracts: true };
    const off: Partial<Settings> = { autoContracts: false };
    expect(migrateSettings(on).contractPolicy).toEqual(uniformContractPolicy('accept'));
    expect(migrateSettings(off).contractPolicy).toEqual(uniformContractPolicy('prompt'));
    expect(on.autoContracts).toBeUndefined();
  });

  it('leaves a policy the player already has', () => {
    const policy = uniformContractPolicy('deny');
    const s = migrateSettings({ autoContracts: true, contractPolicy: policy });
    expect(s.contractPolicy).toBe(policy);
    expect(s.autoContracts).toBeUndefined();
  });

  it('adds no policy where there was no switch either', () => {
    const blank: Partial<Settings> = {};
    expect(migrateSettings(blank).contractPolicy).toBeUndefined();
  });

  it('falls back per rarity for settings written before the policy existed', () => {
    const old = { ...DEFAULT_SETTINGS, contractPolicy: undefined } as Settings;
    for (const r of CONTRACT_RARITIES) {
      expect(contractPolicyFor(old, r)).toBe('accept');
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

  it('ships defaults that accept everything', () => {
    for (const r of CONTRACT_RARITIES)
      expect(contractPolicyFor(DEFAULT_SETTINGS, r)).toBe('accept');
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
    expect(j.version).toBe(13);
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
