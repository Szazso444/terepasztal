import { describe, it, expect } from 'vitest';
import {
  SAVE_VERSION,
  SAVE_MIN_VERSION,
  MIGRATIONS,
  KNOWN_SAVE_KEYS,
  DEFAULT_SETTINGS,
  migrate,
  parseSave,
  migrateSettings,
  contractPolicyFor,
  uniformContractPolicy,
  CONTRACT_RARITIES,
  type SaveGame,
  type Settings,
} from './save';

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

  it('lists every field of a current save as known', () => {
    for (const key of Object.keys(oldestSave())) expect(KNOWN_SAVE_KEYS.has(key)).toBe(true);
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
    expect(crafting.recipes.sort()).toEqual(['flying_scotsman', 'rocket']);
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
    expect(tuned.rules).toEqual({ contractRefreshDays: 6, contractOfferCount: 2 });

    const byHand = migrate({
      ...oldestSave(),
      version: 10,
      rules: { contractRefreshDays: 4, contractOfferCount: 5 },
    });
    expect(byHand.rules).toEqual({ contractRefreshDays: 4, contractOfferCount: 5 });
  });

  it('copes with a save that has no rules block', () => {
    expect(() => migrate({ ...oldestSave(), version: 10 })).not.toThrow();
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

  it('throws on text that is not JSON at all, for the caller to catch', () => {
    expect(() => parseSave('{oops')).toThrow();
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
