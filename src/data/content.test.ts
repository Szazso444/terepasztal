import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PAST_SHIPPED } from './pastShipped';
import type { ContentBundle, ContentKey, HouseConfig, StationLevels, TrackConfig } from './content';

type ContentModule = typeof import('./content');
type Table = Record<string, unknown>;

const KEY = 'terepasztal.content';

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** A Storage over a map, holding `value` under the overrides key; writes are spied on. */
function memoryStorage(value?: unknown) {
  const m = new Map<string, string>();
  if (value !== undefined) m.set(KEY, typeof value === 'string' ? value : JSON.stringify(value));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: vi.fn((k: string, v: string) => void m.set(k, String(v))),
    removeItem: vi.fn((k: string) => void m.delete(k)),
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}

/** A fresh content module, loaded over `storage`. */
async function loadOver(storage: ReturnType<typeof memoryStorage>): Promise<ContentModule> {
  vi.stubGlobal('localStorage', storage);
  vi.resetModules();
  return import('./content');
}

/** A fresh content module, loaded with `value` stored under the overrides key. */
async function load(value?: unknown): Promise<ContentModule> {
  return loadOver(memoryStorage(value));
}

/** The module loaded again over what the last load left in storage, counting only new writes. */
async function reload(): Promise<ContentModule> {
  vi.mocked(localStorage.setItem).mockClear();
  vi.mocked(localStorage.removeItem).mockClear();
  vi.mocked(console.warn).mockClear();
  vi.mocked(console.info).mockClear();
  vi.resetModules();
  return import('./content');
}

/** The module as it loads with nothing stored. */
let shipped: ContentModule;

/** A stored value in the current format, every table stamped with its current shipped stamp. */
function stamped(tables: Partial<Record<ContentKey, unknown>>, stamp?: string) {
  const out: Record<string, { stamp: string; data: unknown }> = {};
  for (const [k, data] of Object.entries(tables))
    out[k] = { stamp: stamp ?? shipped.contentStamp(k as ContentKey), data };
  return { format: 2, tables: out };
}

/** The shipped locomotives with one number changed. */
function editedLocomotives() {
  const locos = clone(shipped.DEFAULT_CONTENT.locomotives);
  locos[0].speed += 1;
  return locos;
}

function warnedAbout(key: string) {
  return vi.mocked(console.warn).mock.calls.some((c) => String(c[0]).includes(`"${key}"`));
}

/** The level table and houses of an override stored before one level per age (#92), verbatim. */
const PRE_92_STATION_LEVELS = {
  capacity: [60, 120, 200, 320, 500],
  loadRate: [4, 6, 9, 13, 18],
  platforms: [1, 1, 2, 2, 3],
  production: [30, 50, 80, 120, 170],
  upgradeCostMul: [0, 0.8, 1.2, 1.8, 2.6],
  spriteByLevel: [1, 2, 3, 4, 5],
  maxLevelByTier: [3, 4, 5],
  crew: [2, 3, 5, 8, 12],
};
const PRE_92_HOUSES: HouseConfig = {
  capacity: [20, 60, 140, 300],
  startResidents: 8,
  constructionDays: 2,
  growthDays: 0.5,
  autoUpgradeDays: 3,
  upgradeCost: [
    { wood: 60, stone: 40 },
    { wood: 80, stone: 140, iron: 30 },
    { stone: 260, iron: 90 },
  ],
  spawnAt: 0.8,
  spawnMulCap: 3,
  trafficPerMul: 10,
  trafficWindowDays: 3,
  bonusIndustry: 5,
  bonusFirstTrain: 3,
};

/** What the editor stored before stamps: the whole live bundle, edited or not, with no format. */
function oldBundle(edit: (b: ContentBundle) => void) {
  const b = clone(shipped.content);
  edit(b);
  return b;
}

/**
 * Tables the build at 8a03538 (main, the newest build that writes the old format) shipped:
 * houses verbatim, the others as today's table with exactly the differences that build had.
 */
const PAST = {
  houses: () => clone(PRE_92_HOUSES),
  stations: () => ({
    levels: clone(PRE_92_STATION_LEVELS) as unknown as StationLevels,
    defs: clone(shipped.DEFAULT_CONTENT.stations.defs),
  }),
  buildings: () => {
    const list = clone(shipped.DEFAULT_CONTENT.buildings);
    delete list.find((b) => b.id === 'kiln')!.lastTier;
    list.find((b) => b.id === 'windmill')!.flavor =
      'Mills wheat into food. One wheat makes 5 food, then 7, 9 and 11 with upgrades.';
    return list;
  },
};
type PastKey = keyof typeof PAST;
const PAST_KEYS = Object.keys(PAST) as PastKey[];

/**
 * A past shipped table. It is checked against the list first: a fixture that is not a listed
 * version means a shipped table changed after 8a03538 (the list never changes), so the fixture
 * is what to rebuild, from `git show 8a03538:src/data/<table>.json`.
 */
function past<K extends PastKey>(key: K): ReturnType<(typeof PAST)[K]> {
  const table = PAST[key]() as ReturnType<(typeof PAST)[K]>;
  expect(
    PAST_SHIPPED[key],
    `the ${key} fixture is no past shipped version: a shipped table changed since 8a03538, rebuild the fixture`,
  ).toContain(shipped.tableHash(key, table));
  return table;
}

/** The tables in the form the old editor stored them, all of them untouched past versions. */
function untouchedPastBundle() {
  return oldBundle((b) => {
    for (const k of PAST_KEYS) (b as unknown as Table)[k] = past(k);
  });
}

beforeEach(async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  shipped = await load();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('a bad stored override never stops the load', () => {
  it.each(['{"contracts":{}}', '{"locomotives":null}', '{"stations":{"defs":[]}}', '{"track":{}}'])(
    'old whole-bundle value %s: shipped tables, set aside as invalid, kept in storage',
    async (raw) => {
      const mod = await load(raw);
      expect(mod.content).toEqual(shipped.content);
      const [[key, data]] = Object.entries(JSON.parse(raw) as Table);
      const { applied, setAside } = mod.contentOverrideReport();
      expect(applied).toEqual([]);
      expect(setAside.map((s) => [s.key, s.reason])).toEqual([[key, 'invalid']]);
      expect(setAside[0].problems.length).toBeGreaterThan(0);
      expect(mod.contentIsCustom()).toBe(false);
      expect(warnedAbout(key)).toBe(true);
      expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual(stamped({ [key]: data }));
    },
  );

  it.each([
    ['contracts', {}],
    ['locomotives', null],
    ['stations', { defs: [] }],
    ['track', {}],
    ['houses', 'x'],
    ['cargo', [null]],
    ['gacha', { banners: [{ id: 'b', pool: null }], rates: null }],
  ] as [ContentKey, unknown][])(
    'current-stamped %s table of the wrong shape: shipped tables, set aside as invalid',
    async (key, data) => {
      const mod = await load(stamped({ [key]: data }));
      expect(mod.content).toEqual(shipped.content);
      const { applied, setAside } = mod.contentOverrideReport();
      expect(applied).toEqual([]);
      expect(setAside.map((s) => [s.key, s.reason])).toEqual([[key, 'invalid']]);
      expect(setAside[0].problems.length).toBeGreaterThan(0);
      expect(warnedAbout(key)).toBe(true);
    },
  );

  it.each([
    'not json{',
    '[]',
    '42',
    '{"format":2}',
    '{"format":2,"tables":{"locomotives":5}}',
    '{"format":2,"tables":{"locomotives":{"data":[]}}}',
    '{"format":3,"tables":{"locomotives":{"stamp":"0","data":[]}}}',
  ])('stored value %s: shipped tables', async (raw) => {
    const mod = await load(raw);
    expect(mod.content).toEqual(shipped.content);
    expect(mod.contentIsCustom()).toBe(false);
    expect(mod.contentOverrideReport().applied).toEqual([]);
  });
});

describe('validateContent', () => {
  it('passes the shipped tables', () => {
    expect(shipped.validateContent(shipped.DEFAULT_CONTENT)).toEqual([]);
  });

  it('requires contract rarities and every station level table', () => {
    const noRarities = clone(shipped.DEFAULT_CONTENT) as unknown as { contracts: Table };
    delete noRarities.contracts.rarities;
    expect(shipped.validateContent(noRarities as unknown as ContentBundle)).not.toEqual([]);
    for (const k of Object.keys(shipped.DEFAULT_CONTENT.stations.levels)) {
      const b = clone(shipped.DEFAULT_CONTENT) as unknown as { stations: { levels: Table } };
      delete b.stations.levels[k];
      expect(shipped.validateContent(b as unknown as ContentBundle), k).not.toEqual([]);
    }
  });

  it('reports a table of the wrong shape instead of throwing', () => {
    for (const k of shipped.CONTENT_KEYS)
      for (const v of [null, 42, 'x', {}, [null]]) {
        const b = { ...shipped.DEFAULT_CONTENT, [k]: v } as ContentBundle;
        expect(() => shipped.validateContent(b), `${k} = ${JSON.stringify(v)}`).not.toThrow();
        expect(shipped.validateContent(b), `${k} = ${JSON.stringify(v)}`).not.toEqual([]);
      }
    expect(shipped.validateContent(null as unknown as ContentBundle)).not.toEqual([]);
  });

  it('reports missing or malformed fields inside a table instead of throwing', () => {
    const breaks: ((b: Table & ContentBundle) => void)[] = [
      (b) => ((b.stations.defs[0] as unknown as Table).accepts = null),
      (b) => ((b.stations.defs[0] as unknown as Table).produces = [null]),
      (b) => ((b.stations as unknown as Table).levels = null),
      (b) => (b.stations.levels.capacity = b.stations.levels.capacity.slice(0, -1)),
      (b) => ((b.buildings[0] as unknown as Table).recipe = null),
      (b) => ((b.buildings[0].recipe as unknown as Table).in = 'coal'),
      (b) => ((b.gacha.banners[0] as unknown as Table).pool = null),
      (b) => ((b.gacha as unknown as Table).rates = { N: '1' }),
      (b) => ((b.track as unknown as Table).pieces = null),
      (b) => ((b.track.pieces as unknown as Table)[Object.keys(b.track.pieces)[0]] = null),
      (b) => ((b.contracts as unknown as Table).templates = null),
      (b) => ((b.contracts.rarities as unknown[])[0] = null),
      (b) => ((b.contracts.rarities[0] as unknown as Table).weight = 'heavy'),
      (b) => ((b.locomotives[0] as unknown as Table).id = null),
      (b) => ((b.crafting as unknown as Table).ownedRefund = null),
    ];
    breaks.forEach((brk, i) => {
      const b = clone(shipped.DEFAULT_CONTENT) as Table & ContentBundle;
      brk(b);
      expect(() => shipped.validateContent(b), `break ${i}`).not.toThrow();
      expect(shipped.validateContent(b), `break ${i}`).not.toEqual([]);
    });
  });
});

describe('stamps', () => {
  it('are short hex hashes, one per table, and the same whatever loads', async () => {
    const stamps = shipped.CONTENT_KEYS.map((k) => shipped.contentStamp(k));
    for (const s of stamps) expect(s).toMatch(/^[0-9a-f]{8}$/);
    expect(new Set(stamps).size).toBe(stamps.length);
    // a session running on an edited table still stamps from the shipped files
    const mod = await load(stamped({ locomotives: editedLocomotives() }));
    expect(mod.contentIsCustom()).toBe(true);
    expect(mod.CONTENT_KEYS.map((k) => mod.contentStamp(k))).toEqual(stamps);
  });
});

describe('applying stored tables', () => {
  it('applies a locomotives table stamped with the current shipped table', async () => {
    const locos = editedLocomotives();
    const mod = await load(stamped({ locomotives: locos }));
    expect(mod.content.locomotives).toEqual(locos);
    expect(mod.contentOverrideReport()).toEqual({ applied: ['locomotives'], setAside: [] });
    expect(mod.contentIsCustom()).toBe(true);
    for (const k of mod.CONTENT_KEYS)
      if (k !== 'locomotives') expect(mod.content[k], k).toEqual(shipped.content[k]);
  });

  it('sets aside the same table stamped from another shipped table, and keeps it stored', async () => {
    const other = shipped.contentStamp('locomotives') === '00000000' ? '00000001' : '00000000';
    const value = stamped({ locomotives: editedLocomotives() }, other);
    const mod = await load(value);
    expect(mod.content.locomotives).toEqual(shipped.content.locomotives);
    expect(mod.contentOverrideReport()).toEqual({
      applied: [],
      setAside: [{ key: 'locomotives', reason: 'stale', problems: [] }],
    });
    expect(mod.contentIsCustom()).toBe(false);
    expect(warnedAbout('locomotives')).toBe(true);
    expect(localStorage.getItem(KEY)).toBe(JSON.stringify(value));
  });

  it('applies a valid table and sets aside an invalid one stored with it', async () => {
    const locos = editedLocomotives();
    const houses = { ...clone(shipped.DEFAULT_CONTENT.houses), capacity: [] };
    const mod = await load(stamped({ locomotives: locos, houses }));
    expect(mod.content.locomotives).toEqual(locos);
    expect(mod.content.houses).toEqual(shipped.content.houses);
    const report = mod.contentOverrideReport();
    expect(report.applied).toEqual(['locomotives']);
    expect(report.setAside.map((s) => [s.key, s.reason])).toEqual([['houses', 'invalid']]);
    expect(report.setAside[0].problems.length).toBeGreaterThan(0);
    expect(mod.contentIsCustom()).toBe(true);
  });

  it('applies tables that only validate together', async () => {
    const locos = clone(shipped.DEFAULT_CONTENT.locomotives);
    locos.push({ ...locos[0], id: 'test_loco', starter: false });
    const gacha = clone(shipped.DEFAULT_CONTENT.gacha);
    gacha.banners[0].pool.push('test_loco');
    const mod = await load(stamped({ locomotives: locos, gacha }));
    expect(mod.contentOverrideReport()).toEqual({
      applied: ['locomotives', 'gacha'],
      setAside: [],
    });
    expect(mod.content.gacha.banners[0].pool).toContain('test_loco');
  });

  it('sets aside a table that breaks a shipped one and keeps the tables valid without it', async () => {
    const used = shipped.DEFAULT_CONTENT.stations.defs.flatMap((s) => s.accepts)[0];
    const cargo = clone(shipped.DEFAULT_CONTENT.cargo).filter((c) => c.id !== used);
    const stations = clone(shipped.DEFAULT_CONTENT.stations);
    stations.defs[0].flavor += ' (edited)';
    const mod = await load(stamped({ cargo, stations }));
    const report = mod.contentOverrideReport();
    expect(report.applied).toEqual(['stations']);
    expect(report.setAside.map((s) => [s.key, s.reason])).toEqual([['cargo', 'invalid']]);
    expect(report.setAside[0].problems.some((p) => p.includes(`"${used}"`))).toBe(true);
    expect(mod.content.stations).toEqual(stations);
    expect(mod.content.cargo).toEqual(shipped.content.cargo);
  });

  it('sets aside a broken table and applies a table that refers to it once it is gone', async () => {
    const stations = clone(shipped.DEFAULT_CONTENT.stations);
    stations.defs[0].flavor += ' (edited)';
    const mod = await load(stamped({ cargo: null, stations }));
    const report = mod.contentOverrideReport();
    expect(report.applied).toEqual(['stations']);
    expect(report.setAside.map((s) => [s.key, s.reason])).toEqual([['cargo', 'invalid']]);
  });
});

describe('an override in the old whole-bundle format', () => {
  /** The past houses table with one edit, which the shipped table of today is not. */
  function editedHouses() {
    const houses = past('houses');
    houses.startResidents += 1;
    return houses;
  }
  /** The past stations table with one edit. */
  function editedStations() {
    const stations = past('stations');
    stations.defs[0].flavor += ' (edited)';
    return stations;
  }

  it('converts an edited table into an applied override stamped with the shipped table', async () => {
    const old = oldBundle((b) => (b.houses.startResidents += 1));
    const mod = await load(old);
    expect(mod.contentOverrideReport()).toEqual({ applied: ['houses'], setAside: [] });
    expect(mod.contentIsCustom()).toBe(true);
    expect(mod.content.houses).toEqual(old.houses);
    for (const k of mod.CONTENT_KEYS)
      if (k !== 'houses') expect(mod.content[k], k).toEqual(shipped.content[k]);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual(stamped({ houses: old.houses }));
    expect(console.warn).not.toHaveBeenCalled();
  });

  it.each(PAST_KEYS)('drops an untouched past %s table without a word', async (key) => {
    const table = past(key);
    expect(shipped.tableHash(key, table), 'a version other than the shipped one').not.toBe(
      shipped.contentStamp(key),
    );
    const mod = await load(oldBundle((b) => ((b as unknown as Table)[key] = table)));
    expect(mod.contentOverrideReport()).toEqual({ applied: [], setAside: [] });
    expect(mod.contentIsCustom()).toBe(false);
    expect(mod.content).toEqual(shipped.content);
    expect(console.warn).not.toHaveBeenCalled();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('knows a past table by its data, not by the order of its keys', async () => {
    const reversed = Object.fromEntries(Object.entries(past('houses')).reverse());
    const mod = await load(oldBundle((b) => (b.houses = reversed as unknown as HouseConfig)));
    expect(mod.contentOverrideReport()).toEqual({ applied: [], setAside: [] });
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('loads a bundle of untouched past versions as the shipped content and finds nothing to do next time', async () => {
    const old = untouchedPastBundle();
    // converted, these would have changed the game or been set aside as invalid
    expect(old.houses).not.toEqual(shipped.content.houses);
    expect(
      shipped.validateContent({ ...shipped.DEFAULT_CONTENT, stations: old.stations }),
    ).not.toEqual([]);
    expect(old.buildings).not.toEqual(shipped.content.buildings);

    const mod = await load(old);
    expect(mod.contentOverrideReport()).toEqual({ applied: [], setAside: [] });
    expect(mod.contentIsCustom()).toBe(false);
    expect(mod.content).toEqual(shipped.content);
    expect(console.warn).not.toHaveBeenCalled();
    expect(localStorage.getItem(KEY)).toBeNull();

    const second = await reload();
    expect(second.contentOverrideReport()).toEqual({ applied: [], setAside: [] });
    expect(second.content).toEqual(shipped.content);
    expect(localStorage.setItem).not.toHaveBeenCalled();
    expect(localStorage.removeItem).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
    expect(console.info).not.toHaveBeenCalled();
  });

  it('converts only the edited table of a bundle of past versions, once', async () => {
    const houses = editedHouses();
    const mod = await load(
      oldBundle((b) => {
        b.houses = houses;
        b.stations = past('stations');
        b.buildings = past('buildings');
      }),
    );
    expect(mod.contentOverrideReport()).toEqual({ applied: ['houses'], setAside: [] });
    expect(mod.content.houses).toEqual(houses);
    for (const k of mod.CONTENT_KEYS)
      if (k !== 'houses') expect(mod.content[k], k).toEqual(shipped.content[k]);
    expect(console.warn).not.toHaveBeenCalled();
    const rewritten = localStorage.getItem(KEY)!;
    expect(JSON.parse(rewritten)).toEqual(stamped({ houses }));

    const second = await reload();
    expect(second.contentOverrideReport()).toEqual({ applied: ['houses'], setAside: [] });
    expect(second.content).toEqual(mod.content);
    expect(localStorage.setItem).not.toHaveBeenCalled();
    expect(localStorage.removeItem).not.toHaveBeenCalled();
    expect(localStorage.getItem(KEY)).toBe(rewritten);
  });

  it('sets aside only an edited past table that fails validation and converts one whose shipped table changed', async () => {
    const houses = editedHouses();
    const stations = editedStations();
    const mod = await load(
      oldBundle((b) => {
        b.houses = houses;
        b.stations = stations;
        b.buildings = past('buildings');
      }),
    );
    const report = mod.contentOverrideReport();
    expect(report.applied).toEqual(['houses']);
    expect(report.setAside.map((s) => [s.key, s.reason])).toEqual([['stations', 'invalid']]);
    expect(report.setAside[0].problems.some((p) => p.startsWith('station levels:'))).toBe(true);
    expect(warnedAbout('stations')).toBe(true);
    expect(warnedAbout('houses')).toBe(false);
    expect(warnedAbout('buildings')).toBe(false);
    expect(mod.content.stations).toEqual(shipped.content.stations);
    expect(mod.content.houses).toEqual(houses);
    // the set-aside table stays stored until the editor next writes or resets
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual(stamped({ stations, houses }));
  });

  it('sets aside a past stations table with one edit alone, as invalid', async () => {
    const stations = editedStations();
    const mod = await load(oldBundle((b) => (b.stations = stations)));
    const report = mod.contentOverrideReport();
    expect(report.applied).toEqual([]);
    expect(report.setAside.map((s) => [s.key, s.reason])).toEqual([['stations', 'invalid']]);
    expect(mod.content).toEqual(shipped.content);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual(stamped({ stations }));
  });

  it('converts once: the next load reads the per-table overrides and writes nothing', async () => {
    const old = oldBundle((b) => {
      b.houses.startResidents += 1;
      b.track = {} as TrackConfig;
    });
    const first = await load(old);
    const rewritten = localStorage.getItem(KEY)!;
    expect(JSON.parse(rewritten)).toMatchObject({ format: 2 });
    const second = await reload();
    expect(localStorage.setItem).not.toHaveBeenCalled();
    expect(localStorage.removeItem).not.toHaveBeenCalled();
    expect(localStorage.getItem(KEY)).toBe(rewritten);
    expect(console.info).not.toHaveBeenCalled();
    expect(second.contentOverrideReport()).toEqual(first.contentOverrideReport());
    expect(second.contentOverrideReport().applied).toEqual(['houses']);
    expect(second.content).toEqual(first.content);
  });

  it('clears the stored value when no table differs from the shipped ones', async () => {
    const mod = await load(oldBundle(() => {}));
    expect(mod.contentOverrideReport()).toEqual({ applied: [], setAside: [] });
    expect(console.warn).not.toHaveBeenCalled();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  describe('when the stored value cannot be rewritten', () => {
    const rewriteWarned = () =>
      vi
        .mocked(console.warn)
        .mock.calls.some((c) => String(c[0]).includes('could not be rewritten'));

    it('applies the edited tables, drops the untouched ones, warns and keeps the old value', async () => {
      const houses = editedHouses();
      const old = oldBundle((b) => {
        b.houses = houses;
        b.stations = past('stations');
      });
      const storage = memoryStorage(old);
      storage.setItem.mockImplementation(() => {
        throw new Error('storage is full');
      });
      const mod = await loadOver(storage);
      expect(mod.contentOverrideReport()).toEqual({ applied: ['houses'], setAside: [] });
      expect(mod.content.houses).toEqual(houses);
      expect(mod.content.stations).toEqual(shipped.content.stations);
      expect(rewriteWarned()).toBe(true);
      expect(storage.getItem(KEY)).toBe(JSON.stringify(old));
    });

    it('drops untouched tables and keeps the old value when only they are stored', async () => {
      const old = untouchedPastBundle();
      const storage = memoryStorage(old);
      storage.removeItem.mockImplementation(() => {
        throw new Error('storage is locked');
      });
      const mod = await loadOver(storage);
      expect(mod.contentOverrideReport()).toEqual({ applied: [], setAside: [] });
      expect(mod.content).toEqual(shipped.content);
      expect(rewriteWarned()).toBe(true);
      expect(storage.getItem(KEY)).toBe(JSON.stringify(old));
    });
  });
});

describe('the list of past shipped tables', () => {
  it('hashes a shipped table to the stamp it is stored under, whatever load derived from it', () => {
    for (const k of shipped.CONTENT_KEYS) {
      expect(shipped.tableHash(k, shipped.DEFAULT_CONTENT[k]), k).toBe(shipped.contentStamp(k));
      expect(shipped.tableHash(k, shipped.content[k]), k).toBe(shipped.contentStamp(k));
    }
    expect(shipped.content.wagons.some((w) => w.accepts?.length)).toBe(true);
  });

  it('holds at least one version of every table, each a unique eight-digit hex hash', () => {
    expect(Object.keys(PAST_SHIPPED).sort()).toEqual([...shipped.CONTENT_KEYS].sort());
    for (const k of shipped.CONTENT_KEYS) {
      expect(PAST_SHIPPED[k].length, k).toBeGreaterThan(0);
      for (const h of PAST_SHIPPED[k]) expect(h, k).toMatch(/^[0-9a-f]{8}$/);
      expect(new Set(PAST_SHIPPED[k]).size, k).toBe(PAST_SHIPPED[k].length);
    }
  });

  it('is frozen', () => {
    expect(Object.isFrozen(PAST_SHIPPED)).toBe(true);
    for (const k of shipped.CONTENT_KEYS) expect(Object.isFrozen(PAST_SHIPPED[k]), k).toBe(true);
  });
});

describe('writing overrides', () => {
  it('stores only the changed tables, each with the current stamp', () => {
    const draft = clone(shipped.content);
    draft.locomotives[0].speed += 1;
    expect(shipped.changedTables(draft)).toEqual({ locomotives: draft.locomotives });
    expect(shipped.writeContentOverrides(draft)).toBe(true);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({
      format: 2,
      tables: {
        locomotives: { stamp: shipped.contentStamp('locomotives'), data: draft.locomotives },
      },
    });
  });

  it('takes no notice of derived wagon accept lists', () => {
    const draft = clone(shipped.content);
    expect(draft.wagons.some((w) => w.accepts?.length)).toBe(true);
    expect(shipped.changedTables(draft)).toEqual({});
  });

  it('applies what it wrote on the next load', async () => {
    const draft = clone(shipped.content);
    draft.wagons[0].capacity += 5;
    shipped.writeContentOverrides(draft);
    const mod = await load(localStorage.getItem(KEY)!);
    expect(mod.contentOverrideReport()).toEqual({ applied: ['wagons'], setAside: [] });
    expect(mod.content.wagons).toEqual(draft.wagons);
  });

  it('clears the stored value when nothing differs from the shipped tables', async () => {
    const mod = await load(stamped({ locomotives: editedLocomotives() }, '00000000'));
    expect(mod.writeContentOverrides(clone(mod.content))).toBe(true);
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(mod.readContentOverrides()).toBeNull();
  });

  it('reads back the stored tables whether or not they applied', async () => {
    const locos = editedLocomotives();
    const mod = await load(stamped({ locomotives: locos }, '00000000'));
    expect(mod.readContentOverrides()).toEqual({ locomotives: locos });
  });
});
