import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Rng } from '../engine/rng';
import { SEEDS, forAll } from '../testing/property';
import type { RuleMeta, Rules } from './rules';

type RulesModule = typeof import('./rules');

/** The key older builds stored the tuning under; no build reads or writes it any more. */
const RULES_KEY = 'terepasztal.rules';
const PRESETS_KEY = 'terepasztal.rulePresets';
const STAGED_KEY = 'terepasztal.newGameTuning';

/** An in-memory `localStorage` or `sessionStorage`, so each test starts from a store it writes. */
class MemoryStorage {
  private items = new Map<string, string>();
  getItem(k: string) {
    return this.items.has(k) ? this.items.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.items.set(k, String(v));
  }
  removeItem(k: string) {
    this.items.delete(k);
  }
  clear() {
    this.items.clear();
  }
}

let store: MemoryStorage;
let session: MemoryStorage;

/** A fresh copy of the module, which starts its rules like a page load does. */
async function load(): Promise<RulesModule> {
  vi.resetModules();
  return import('./rules');
}

/** Pin the wall clock a preset's `savedAt` is taken from. */
function at(ms: number) {
  vi.spyOn(Date, 'now').mockReturnValue(ms);
}

/** Every write (`set` or `remove`) made to `s` from now on, as `[kind, key]`. */
function writesTo(s: MemoryStorage): [string, string][] {
  const out: [string, string][] = [];
  const set = s.setItem.bind(s);
  const remove = s.removeItem.bind(s);
  vi.spyOn(s, 'setItem').mockImplementation((k, v) => {
    out.push(['set', k]);
    set(k, v);
  });
  vi.spyOn(s, 'removeItem').mockImplementation((k) => {
    out.push(['remove', k]);
    remove(k);
  });
  return out;
}

/** A storage whose every call throws, like one a browser refuses. */
const refusing = {
  getItem: () => {
    throw new Error('denied');
  },
  setItem: () => {
    throw new Error('denied');
  },
  removeItem: () => {
    throw new Error('denied');
  },
};

/** The values the old read remapped (four rules, five values), with the rule each belongs to. */
const OLD_VALUES: [keyof Rules, number][] = [
  ['startMoney', 25000],
  ['contractRefreshDays', 2],
  ['contractRefreshDays', 6],
  ['contractOfferCount', 2],
  ['startingResourceScale', 1],
];

beforeEach(() => {
  store = new MemoryStorage();
  session = new MemoryStorage();
  vi.stubGlobal('localStorage', store);
  vi.stubGlobal('sessionStorage', session);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('the two tables', () => {
  it('list the same keys: every default is tunable and every tunable has a default', async () => {
    const m = await load();
    const meta = m.RULE_META.map((x) => x.key as string);
    const twice = meta.filter((k, i) => meta.indexOf(k) !== i);
    expect(twice, `listed twice in RULE_META: ${twice.join(', ')}`).toEqual([]);
    const defaults = Object.keys(m.DEFAULT_RULES);
    const noMeta = defaults.filter((k) => !meta.includes(k));
    const noDefault = meta.filter((k) => !defaults.includes(k));
    expect(noMeta, `in DEFAULT_RULES, not in RULE_META: ${noMeta.join(', ')}`).toEqual([]);
    expect(noDefault, `in RULE_META, not in DEFAULT_RULES: ${noDefault.join(', ')}`).toEqual([]);
  });
});

describe('rules an older build wrote', () => {
  // `reputationMul` and `tradeCycleDays` were settings no screen showed and nothing read;
  // `collectMin` was the pile a warehouse held before a freight train came for it, and freight
  // takes nothing out of a store any more.
  const old = { reputationMul: 3, tradeCycleDays: 2, collectMin: 30 };
  const gone = (r: object) => {
    for (const k of Object.keys(old)) expect(Object.hasOwn(r, k), k).toBe(false);
  };

  it('are tolerated by rulesFrom, which drops what it has no setting for', async () => {
    const m = await load();
    const r = m.rulesFrom({ ...m.DEFAULT_RULES, ...old } as Partial<Rules>);
    expect(r).toEqual(m.DEFAULT_RULES);
    gone(r);
  });

  it('are dropped from a stored preset on read, and the rest of it reads as before', async () => {
    store.setItem(
      PRESETS_KEY,
      JSON.stringify({
        format: 1,
        presets: { older: { savedAt: 5, rules: { payoutMul: 2, mapSize: 224, ...old } } },
      }),
    );
    const m = await load();
    const r = m.readRulePreset('older')!;
    gone(r);
    expect(r).toEqual(m.rulesFrom({ payoutMul: 2, mapSize: 224 }));
    expect(r.payoutMul).toBe(2);
    expect(r.mapSize).toBe(224);
  });

  it('are left out of the live rules when a save puts its rules in force', async () => {
    const m = await load();
    m.applyGameRules({ ...m.DEFAULT_RULES, payoutMul: 2, ...old } as Partial<Rules>);
    gone(m.rules);
    expect(m.rules.payoutMul).toBe(2);
  });
});

describe('rules from anywhere', () => {
  /** What a saved object may hold: a setting with any value, or a name this build has no setting for. */
  interface Saved {
    /** setting key -> what the object holds under it */
    known: Record<string, unknown>;
    /** names no setting answers to, with a number under each */
    strays: Record<string, number>;
  }
  const STRAYS = ['reputationMul', 'tradeCycleDays', 'aSettingFromTheFuture', 'constructor'];

  it('come out with exactly the settings the game has, each in its range, by every way in', async () => {
    const m = await load();
    const keys = m.RULE_META.map((x) => x.key as string);
    const odd = [Number.NaN, Infinity, -Infinity, '3', null, true, [], {}];
    forAll(
      (rng): Saved => {
        const known: Record<string, unknown> = {};
        for (const k of keys)
          if (rng.chance(0.6))
            known[k] = rng.chance(0.15)
              ? rng.pick(odd)
              : Math.round(rng.range(-50, 2000) * 100) / 100;
        const strays: Record<string, number> = {};
        for (const k of STRAYS) if (rng.chance(0.6)) strays[k] = rng.int(-9, 9);
        return { known, strays };
      },
      ({ known, strays }) => {
        const saved = { ...known, ...strays } as Partial<Rules>;
        const before = JSON.stringify(saved);

        // the three ways a stored object becomes rules: a pure overlay, a preset, a loaded save
        store.setItem(
          PRESETS_KEY,
          JSON.stringify({ format: 1, presets: { p: { savedAt: 1, rules: saved } } }),
        );
        // each case starts from the defaults alone, so a key one case leaked cannot show in the next
        for (const k of Object.keys(m.rules))
          delete (m.rules as unknown as Record<string, unknown>)[k];
        Object.assign(m.rules, m.DEFAULT_RULES);
        m.applyGameRules(saved);
        const ways: [string, object][] = [
          ['rulesFrom', m.rulesFrom(saved)],
          ['readRulePreset', m.readRulePreset('p')!],
          ['applyGameRules', m.rules],
        ];
        expect(JSON.stringify(saved), 'the saved object is left as it was').toBe(before);
        for (const [way, r] of ways) {
          const has = Object.keys(r).sort();
          expect(has, `${way}: its keys are the keys of DEFAULT_RULES`).toEqual(
            keys.slice().sort(),
          );
          for (const meta of m.RULE_META) {
            const v = known[meta.key];
            const got = (r as Record<string, number>)[meta.key];
            if (meta.key === 'mapSize') {
              expect(got % 32, `${way}: mapSize in whole chunks`).toBe(0);
              expect(got, `${way}: mapSize at least one chunk`).toBeGreaterThanOrEqual(32);
            } else if (typeof v === 'number' && Number.isFinite(v)) {
              expect(got, `${way}: ${meta.key} held ${v}`).toBe(
                Math.min(meta.max, Math.max(meta.min, v)),
              );
            } else {
              expect(got, `${way}: ${meta.key} held ${String(v)}`).toBe(m.DEFAULT_RULES[meta.key]);
            }
          }
        }
      },
      {
        shrink: function* ({ known, strays }) {
          // fewer names, then plainer values
          const without = <T>(o: Record<string, T>, k: string) =>
            Object.fromEntries(Object.entries(o).filter(([n]) => n !== k));
          for (const k of Object.keys(strays)) yield { known, strays: without(strays, k) };
          for (const k of Object.keys(known)) yield { known: without(known, k), strays };
        },
      },
    );
  });
});

describe('rulesFrom', () => {
  it('is the defaults when nothing is saved', async () => {
    const m = await load();
    expect(m.rulesFrom(undefined)).toEqual(m.DEFAULT_RULES);
    expect(m.rulesFrom({})).toEqual(m.DEFAULT_RULES);
  });

  it('overlays the saved values on the defaults, clamped, and touches neither input', async () => {
    const m = await load();
    const saved = { payoutMul: 99, trainSpeedMul: 1.5 };
    const r = m.rulesFrom(saved);
    const meta = m.RULE_META.find((x) => x.key === 'payoutMul')!;
    expect(r.payoutMul).toBe(meta.max);
    expect(r.trainSpeedMul).toBe(1.5);
    expect(r.loadRateMul).toBe(m.DEFAULT_RULES.loadRateMul);
    expect(saved).toEqual({ payoutMul: 99, trainSpeedMul: 1.5 });
    expect(r).not.toBe(m.rules);
  });

  it('gives rules saved before offers grew with the land the defaults for the growth', async () => {
    const m = await load();
    const grown = ['contractOffersPerChunk', 'contractOfferMax'] as const;
    // every rule a save of that time held, its open offers tuned to 3
    const old: Record<string, unknown> = { ...m.DEFAULT_RULES, contractOfferCount: 3 };
    for (const k of grown) delete old[k];
    m.applyGameRules(JSON.parse(JSON.stringify(old)) as Partial<Rules>);
    expect(m.rules.contractOfferCount).toBe(3);
    for (const k of grown) {
      expect(m.rules[k], k).toBe(m.DEFAULT_RULES[k]);
      // a player can drag it: it has a label, a hint and a range holding its default
      const meta = m.RULE_META.find((x) => x.key === k);
      expect(meta?.label, k).toBeTruthy();
      expect(meta?.hint, k).toBeTruthy();
      expect(m.DEFAULT_RULES[k], k).toBeGreaterThanOrEqual(meta!.min);
      expect(m.DEFAULT_RULES[k], k).toBeLessThanOrEqual(meta!.max);
    }
  });

  it('names the cap in the hint of the start-chunk offers, so a start value above it is explained', async () => {
    const m = await load();
    const start = m.RULE_META.find((x) => x.key === 'contractOfferCount');
    const cap = m.RULE_META.find((x) => x.key === 'contractOfferMax');
    expect(cap?.label).toBeTruthy();
    expect(start?.hint).toContain(cap!.label);
  });
});

describe('a page load starts from the shipped rules', () => {
  it.each([
    ['the four old values', Object.fromEntries(OLD_VALUES)],
    ['an out-of-range value', { payoutMul: 99, trainSpeedMul: -1 }],
    ['an ordinary tuning', { trainSpeedMul: 2, loadRateMul: 3 }],
    ['an empty object', {}],
  ])('ignores a stored tuning of %s and deletes it', async (_what, tuning) => {
    store.setItem(RULES_KEY, JSON.stringify(tuning));
    const m = await load();
    expect({ ...m.rules }).toEqual(m.DEFAULT_RULES);
    expect(m.readRules()).toEqual(m.DEFAULT_RULES);
    expect(store.getItem(RULES_KEY)).toBeNull();
    // deleted, not converted to a preset
    expect(m.listRulePresets()).toEqual([]);
    expect(store.getItem(PRESETS_KEY)).toBeNull();
  });

  it.each(['{bad', '42', '[]', 'null', '""'])(
    'ignores and deletes a stored tuning that reads %s',
    async (raw) => {
      store.setItem(RULES_KEY, raw);
      const m = await load();
      expect({ ...m.rules }).toEqual(m.DEFAULT_RULES);
      expect(store.getItem(RULES_KEY)).toBeNull();
    },
  );

  it('never reads the old key, at load or in readRules', async () => {
    store.setItem(RULES_KEY, JSON.stringify({ trainSpeedMul: 2 }));
    const reads = vi.spyOn(store, 'getItem');
    const m = await load();
    m.readRules();
    expect(reads.mock.calls.map((c) => c[0])).not.toContain(RULES_KEY);
  });

  it('leaves the presets and the other keys it does not own alone', async () => {
    store.setItem(RULES_KEY, JSON.stringify({ trainSpeedMul: 2 }));
    store.setItem('terepasztal.save', 'x');
    store.setItem(PRESETS_KEY, JSON.stringify({ format: 1, presets: {} }));
    const writes = writesTo(store);
    await load();
    expect(writes).toEqual([['remove', RULES_KEY]]);
    expect(store.getItem('terepasztal.save')).toBe('x');
    expect(store.getItem(PRESETS_KEY)).toBe(JSON.stringify({ format: 1, presets: {} }));
  });

  it.each([
    ['localStorage is missing', 'localStorage', undefined],
    ['localStorage throws', 'localStorage', refusing],
    ['sessionStorage is missing', 'sessionStorage', undefined],
    ['sessionStorage throws', 'sessionStorage', refusing],
  ])('does not throw at import when %s, and gives the shipped rules', async (_what, name, v) => {
    vi.stubGlobal(name, v);
    const m = await load();
    expect({ ...m.rules }).toEqual(m.DEFAULT_RULES);
    expect(m.readRules()).toEqual(m.DEFAULT_RULES);
  });

  it('does not throw at import with neither storage', async () => {
    vi.stubGlobal('localStorage', undefined);
    vi.stubGlobal('sessionStorage', undefined);
    const m = await load();
    expect({ ...m.rules }).toEqual(m.DEFAULT_RULES);
  });
});

describe('a loaded game keeps its rules to itself', () => {
  it('applyGameRules puts the save in force without writing any storage', async () => {
    const m = await load();
    const live = m.rules;
    const local = writesTo(store);
    const tab = writesTo(session);

    m.applyGameRules({ payoutMul: 3 });
    expect(m.rules).toBe(live);
    expect(m.rules.payoutMul).toBe(3);
    expect(local).toEqual([]);
    expect(tab).toEqual([]);

    // The next page load, a new game, starts from the shipped rules, not the save's rules.
    const next = await load();
    expect({ ...next.rules }).toEqual(next.DEFAULT_RULES);
  });

  it('applyGameRules replaces the session tuning with the save, not merges into it', async () => {
    const m = await load();
    m.setRules({ trainSpeedMul: 2 });
    m.applyGameRules({ payoutMul: 3 });
    expect(m.rules.trainSpeedMul).toBe(m.DEFAULT_RULES.trainSpeedMul);
    expect(m.rules.payoutMul).toBe(3);
  });

  it('applyGameRules with no saved rules is the defaults', async () => {
    const m = await load();
    m.setRules({ trainSpeedMul: 2 });
    m.applyGameRules(undefined);
    expect({ ...m.rules }).toEqual(m.DEFAULT_RULES);
  });

  it('a tuning change during a loaded game stays in that session', async () => {
    const m = await load();
    m.applyGameRules({ payoutMul: 3, trainSpeedMul: 1.5 });

    m.setRules({ loadRateMul: 2 });
    expect(m.rules.loadRateMul).toBe(2);
    expect(m.rules.payoutMul).toBe(3);
    expect(m.rules.trainSpeedMul).toBe(1.5);
    expect(store.getItem(RULES_KEY)).toBeNull();

    const next = await load();
    expect({ ...next.rules }).toEqual(next.DEFAULT_RULES);
  });
});

describe('setRules, resetRules and applyRulePreset', () => {
  it('put their change in force for the session and store nothing', async () => {
    const m = await load();
    const live = m.rules;
    m.saveRulePreset('p', m.rulesFrom({ payoutMul: 3 }));
    const preset = store.getItem(PRESETS_KEY);
    const local = writesTo(store);
    const tab = writesTo(session);

    m.setRules({ startMoney: 25000 });
    expect(m.rules.startMoney).toBe(25000);
    expect(store.getItem(RULES_KEY)).toBeNull();

    m.resetRules();
    expect({ ...m.rules }).toEqual(m.DEFAULT_RULES);
    expect(store.getItem(RULES_KEY)).toBeNull();

    expect(m.applyRulePreset('p')).toBe(true);
    expect(m.rules.payoutMul).toBe(3);
    expect(store.getItem(RULES_KEY)).toBeNull();

    m.setRules({ startMoney: 25000 });
    expect(m.rules).toBe(live);
    expect(m.rules.startMoney).toBe(25000);
    expect(local).toEqual([]);
    expect(tab).toEqual([]);
    expect(store.getItem(PRESETS_KEY)).toBe(preset);

    const next = await load();
    expect({ ...next.rules }).toEqual(next.DEFAULT_RULES);
    expect(store.getItem(RULES_KEY)).toBeNull();
  });

  it('setRules takes the patch alone, merges it over the live rules and clamps it', async () => {
    const m = await load();
    m.setRules({ loadRateMul: 2 });
    // @ts-expect-error a second argument (the old `persist`) is gone
    m.setRules({ trainSpeedMul: 1000 }, true);
    const max = m.RULE_META.find((x) => x.key === 'trainSpeedMul')!.max;
    expect(m.rules.trainSpeedMul).toBe(max);
    expect(m.rules.loadRateMul).toBe(2);
    expect(store.getItem(RULES_KEY)).toBeNull();
  });

  it('resetRules puts the live rules back to the shipped rules and touches no storage', async () => {
    const m = await load();
    const live = m.rules;
    m.setRules({ trainSpeedMul: 2, loadRateMul: 3 });
    session.setItem(STAGED_KEY, 'kept');
    store.setItem(PRESETS_KEY, 'kept');
    const reads = vi.spyOn(store, 'getItem');
    const tabReads = vi.spyOn(session, 'getItem');
    const local = writesTo(store);
    const tab = writesTo(session);

    m.resetRules();
    expect(m.rules).toBe(live);
    expect({ ...m.rules }).toEqual(m.DEFAULT_RULES);
    expect(reads).not.toHaveBeenCalled();
    expect(tabReads).not.toHaveBeenCalled();
    expect(local).toEqual([]);
    expect(tab).toEqual([]);
  });

  it('resetRules goes back to the shipped rules, not to the tuning this load was staged with', async () => {
    const m = await load();
    m.saveRulePreset('Rich', m.rulesFrom({ payoutMul: 3 }));
    expect(m.stageNewGameTuning('Rich')).toBe(true);
    const staged = await load();
    expect(staged.rules.payoutMul).toBe(3);
    staged.resetRules();
    expect({ ...staged.rules }).toEqual(staged.DEFAULT_RULES);
  });
});

describe('no value is remapped on read', () => {
  it.each(OLD_VALUES)('%s = %d comes back as written', async (key, value) => {
    const m = await load();
    const written = m.rulesFrom({ [key]: value });
    expect(written[key]).toBe(value);

    // a preset
    expect(m.saveRulePreset('old', written)).toBe(true);
    expect(m.readRulePreset('old')![key]).toBe(value);
    expect(m.applyRulePreset('old')).toBe(true);
    expect(m.rules[key]).toBe(value);

    // the input of applyGameRules
    m.resetRules();
    m.applyGameRules({ [key]: value });
    expect(m.rules[key]).toBe(value);

    // a staged tuning, on the page load that takes it
    expect(m.stageNewGameTuning('old')).toBe(true);
    const next = await load();
    expect(next.rules[key]).toBe(value);
    expect(next.readRules()[key]).toBe(value);
  });

  it('a preset written by hand with the old values lists and loads as written', async () => {
    const old = Object.fromEntries(OLD_VALUES);
    store.setItem(
      PRESETS_KEY,
      JSON.stringify({ format: 1, presets: { Old: { savedAt: 7, rules: old } } }),
    );
    const m = await load();
    expect(m.readRulePreset('Old')).toMatchObject(old);
    expect(m.stageNewGameTuning('Old')).toBe(true);
    const next = await load();
    expect(next.rules).toMatchObject(old);
  });
});

describe('stageNewGameTuning', () => {
  it('stores the preset rules, read and clamped now, under the session key and returns true', async () => {
    store.setItem(
      PRESETS_KEY,
      JSON.stringify({
        format: 1,
        presets: {
          wild: { savedAt: 5, rules: { payoutMul: 99, trainSpeedMul: -1, mapSize: 200 } },
        },
      }),
    );
    const m = await load();
    const local = writesTo(store);

    expect(m.stageNewGameTuning('wild')).toBe(true);
    const staged = JSON.parse(session.getItem(STAGED_KEY)!) as Record<string, unknown>;
    // the rules, not the name, and already clamped
    expect(typeof staged).toBe('object');
    expect(staged).toEqual(m.readRulePreset('wild'));
    expect(staged.payoutMul).toBe(m.RULE_META.find((x) => x.key === 'payoutMul')!.max);
    expect(staged.trainSpeedMul).toBe(m.RULE_META.find((x) => x.key === 'trainSpeedMul')!.min);
    // the localStorage side is untouched, and the live rules are too
    expect(local).toEqual([]);
    expect({ ...m.rules }).toEqual(m.DEFAULT_RULES);
  });

  it('is a copy taken when staged: a preset changed afterwards does not change it', async () => {
    const m = await load();
    m.saveRulePreset('a', m.rulesFrom({ payoutMul: 2 }));
    m.stageNewGameTuning('a');
    m.saveRulePreset('a', m.rulesFrom({ payoutMul: 4 }));
    m.deleteRulePreset('a');
    const next = await load();
    expect(next.rules.payoutMul).toBe(2);
  });

  it('stages the latest of two calls', async () => {
    const m = await load();
    m.saveRulePreset('a', m.rulesFrom({ payoutMul: 2 }));
    m.saveRulePreset('b', m.rulesFrom({ payoutMul: 4 }));
    m.stageNewGameTuning('a');
    m.stageNewGameTuning('b');
    const next = await load();
    expect(next.rules.payoutMul).toBe(4);
  });

  it('null removes a staged tuning and returns true, staged or not', async () => {
    const m = await load();
    m.saveRulePreset('a', m.rulesFrom({ payoutMul: 2 }));
    expect(m.stageNewGameTuning(null)).toBe(true);
    expect(m.stageNewGameTuning('a')).toBe(true);
    expect(session.getItem(STAGED_KEY)).not.toBeNull();
    expect(m.stageNewGameTuning(null)).toBe(true);
    expect(session.getItem(STAGED_KEY)).toBeNull();
    const next = await load();
    expect({ ...next.rules }).toEqual(next.DEFAULT_RULES);
  });

  it('an unknown name returns false and leaves nothing staged', async () => {
    const m = await load();
    const local = writesTo(store);
    expect(m.stageNewGameTuning('Nope')).toBe(false);
    expect(session.getItem(STAGED_KEY)).toBeNull();

    // nor does it leave an earlier choice behind
    m.saveRulePreset('a', m.rulesFrom({ payoutMul: 2 }));
    local.length = 0;
    expect(m.stageNewGameTuning('a')).toBe(true);
    expect(m.stageNewGameTuning('Nope')).toBe(false);
    expect(session.getItem(STAGED_KEY)).toBeNull();
    expect(local).toEqual([]);
  });

  it('returns false and leaves nothing staged when sessionStorage refuses', async () => {
    const m = await load();
    m.saveRulePreset('a', m.rulesFrom({ payoutMul: 2 }));
    expect(m.stageNewGameTuning('a')).toBe(true);

    // a write that fails: the earlier staged value is not left to be taken in its place
    vi.spyOn(session, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(m.stageNewGameTuning('a')).toBe(false);
    expect(session.getItem(STAGED_KEY)).toBeNull();

    vi.stubGlobal('sessionStorage', refusing);
    expect(m.stageNewGameTuning('a')).toBe(false);
    expect(m.stageNewGameTuning(null)).toBe(false);
    expect(m.stageNewGameTuning('Nope')).toBe(false);

    vi.stubGlobal('sessionStorage', undefined);
    expect(m.stageNewGameTuning('a')).toBe(false);
    expect(m.stageNewGameTuning(null)).toBe(false);
  });
});

describe('a page load takes the staged tuning once', () => {
  it('starts from the staged preset, clears it, and the load after is the shipped rules', async () => {
    const m = await load();
    m.saveRulePreset('Rich', m.rulesFrom({ startMoney: 90000, payoutMul: 2, mapSize: 224 }));
    expect(m.stageNewGameTuning('Rich')).toBe(true);

    const first = await load();
    expect({ ...first.rules }).toEqual(first.readRulePreset('Rich'));
    expect(first.rules.startMoney).toBe(90000);
    expect(first.readRules()).toEqual(first.readRulePreset('Rich'));
    expect(session.getItem(STAGED_KEY)).toBeNull();
    // the preset itself is still there, and no tuning key appeared
    expect(first.listRulePresets().map((p) => p.name)).toEqual(['Rich']);
    expect(store.getItem(RULES_KEY)).toBeNull();

    const second = await load();
    expect({ ...second.rules }).toEqual(second.DEFAULT_RULES);
  });

  it('keeps the live object identity through the session and readRules unchanged', async () => {
    const m = await load();
    m.saveRulePreset('Rich', m.rulesFrom({ payoutMul: 2 }));
    m.saveRulePreset('Poor', m.rulesFrom({ payoutMul: 4 }));
    m.stageNewGameTuning('Rich');

    const first = await load();
    const live = first.rules;
    const started = first.readRules();
    first.setRules({ loadRateMul: 3 });
    // staged for the load after this one: this load's rules do not move
    expect(first.stageNewGameTuning('Poor')).toBe(true);
    expect(first.rules).toBe(live);
    expect(first.rules.payoutMul).toBe(2);
    expect(first.readRules()).toEqual(started);
    expect(first.readRules()).not.toBe(first.readRules());

    const second = await load();
    expect(second.rules.payoutMul).toBe(4);
    expect(second.rules.loadRateMul).toBe(second.DEFAULT_RULES.loadRateMul);
  });

  it('clamps the staged values again and remaps none', async () => {
    session.setItem(STAGED_KEY, JSON.stringify({ payoutMul: 99, startMoney: 25000, mapSize: 200 }));
    const m = await load();
    expect(m.rules.payoutMul).toBe(m.RULE_META.find((x) => x.key === 'payoutMul')!.max);
    expect(m.rules.startMoney).toBe(25000);
    expect(m.rules.mapSize % 32).toBe(0);
    expect(m.rules.loadRateMul).toBe(m.DEFAULT_RULES.loadRateMul);
  });

  it.each(['{bad', '42', '[]', 'null', '"x"', 'true'])(
    'a staged value that reads %s gives the shipped rules, does not throw, and is cleared',
    async (raw) => {
      session.setItem(STAGED_KEY, raw);
      const m = await load();
      expect({ ...m.rules }).toEqual(m.DEFAULT_RULES);
      expect(session.getItem(STAGED_KEY)).toBeNull();
    },
  );

  it('ignores a non-numeric entry in the staged value', async () => {
    session.setItem(STAGED_KEY, JSON.stringify({ payoutMul: 'lots', loadRateMul: 2 }));
    const m = await load();
    expect(m.rules.payoutMul).toBe(m.DEFAULT_RULES.payoutMul);
    expect(m.rules.loadRateMul).toBe(2);
  });

  it('prefers the staged tuning to an old stored one, and deletes the old one', async () => {
    store.setItem(RULES_KEY, JSON.stringify({ trainSpeedMul: 2, payoutMul: 3 }));
    session.setItem(STAGED_KEY, JSON.stringify({ payoutMul: 2 }));
    const m = await load();
    expect(m.rules.payoutMul).toBe(2);
    expect(m.rules.trainSpeedMul).toBe(m.DEFAULT_RULES.trainSpeedMul);
    expect(store.getItem(RULES_KEY)).toBeNull();
    expect(session.getItem(STAGED_KEY)).toBeNull();
  });

  it('gives the shipped rules when the staged tuning cannot be removed (it would load again)', async () => {
    session.setItem(STAGED_KEY, JSON.stringify({ payoutMul: 2 }));
    vi.spyOn(session, 'removeItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const m = await load();
    expect({ ...m.rules }).toEqual(m.DEFAULT_RULES);
  });

  it('does not touch localStorage but for the old key', async () => {
    session.setItem(STAGED_KEY, JSON.stringify({ payoutMul: 2 }));
    const writes = writesTo(store);
    await load();
    expect(writes).toEqual([['remove', RULES_KEY]]);
  });
});

describe('rulesDiffer', () => {
  it('lists the keys that differ from the defaults, of the live rules or a given set', async () => {
    const m = await load();
    expect(m.rulesDiffer()).toEqual([]);
    m.applyGameRules({ payoutMul: 3 });
    expect(m.rulesDiffer()).toEqual(['payoutMul']);
    expect(m.rulesDiffer(m.rulesFrom({ loadRateMul: 2, deadlineMul: 2 })).sort()).toEqual([
      'deadlineMul',
      'loadRateMul',
    ]);
    expect(m.rulesDiffer(m.rulesFrom())).toEqual([]);
  });
});

describe('rule presets', () => {
  it('round-trips a preset and lists it', async () => {
    const m = await load();
    const r = m.rulesFrom({ payoutMul: 2, mapSize: 224 });
    at(1000);
    expect(m.saveRulePreset('Rich', r)).toBe(true);
    expect(m.listRulePresets()).toEqual([{ name: 'Rich', savedAt: 1000 }]);
    expect(m.readRulePreset('Rich')).toEqual(r);
    expect(m.readRulePreset('Nope')).toBeNull();

    const raw = JSON.parse(store.getItem(PRESETS_KEY)!);
    expect(raw.format).toBe(1);
    expect(raw.presets.Rich.savedAt).toBe(1000);
  });

  it('stores a name cut just after a space in the form a lookup finds, for every cut', async () => {
    const m = await load();
    for (let len = 1; len <= m.RULE_PRESET_NAME_MAX + 2; len++) {
      // a space falls exactly on the last character the cut keeps when len = MAX
      const typed = `${'a'.repeat(m.RULE_PRESET_NAME_MAX - 1)} ${'b'.repeat(len)}`;
      expect(m.saveRulePreset(typed, m.rulesFrom({ payoutMul: 2 }))).toBe(true);
      for (const { name } of m.listRulePresets()) {
        expect(name).toBe(name.trim());
        expect(m.readRulePreset(name)).not.toBeNull();
      }
      expect(m.readRulePreset(typed)).not.toBeNull();
      expect(m.deleteRulePreset(typed)).toBe(true);
      expect(m.listRulePresets()).toEqual([]);
    }
  });

  it('saves the live rules when no set is given, and writes no tuning key', async () => {
    const m = await load();
    m.applyGameRules({ deadlineMul: 2 });
    expect(m.saveRulePreset('Live')).toBe(true);
    expect(m.readRulePreset('Live')!.deadlineMul).toBe(2);
    expect(store.getItem(RULES_KEY)).toBeNull();
  });

  it('lists newest first and overwrites a preset of the same name', async () => {
    const m = await load();
    at(1000);
    m.saveRulePreset('a', m.rulesFrom({ payoutMul: 2 }));
    at(3000);
    m.saveRulePreset('b', m.rulesFrom());
    at(2000);
    m.saveRulePreset('c', m.rulesFrom());
    expect(m.listRulePresets().map((p) => p.name)).toEqual(['b', 'c', 'a']);

    at(4000);
    expect(m.saveRulePreset('a', m.rulesFrom({ payoutMul: 4 }))).toBe(true);
    expect(m.listRulePresets()).toEqual([
      { name: 'a', savedAt: 4000 },
      { name: 'b', savedAt: 3000 },
      { name: 'c', savedAt: 2000 },
    ]);
    expect(m.readRulePreset('a')!.payoutMul).toBe(4);
  });

  it('trims the name, cuts it to 32 characters and refuses an empty one', async () => {
    const m = await load();
    expect(m.saveRulePreset('   ')).toBe(false);
    expect(m.saveRulePreset('')).toBe(false);
    expect(m.listRulePresets()).toEqual([]);
    expect(store.getItem(PRESETS_KEY)).toBeNull();

    expect(m.saveRulePreset('  Fast  ')).toBe(true);
    const long = 'x'.repeat(40);
    expect(m.saveRulePreset(long)).toBe(true);
    expect(
      m
        .listRulePresets()
        .map((p) => p.name)
        .sort(),
    ).toEqual(['Fast', 'x'.repeat(32)]);
    expect(m.readRulePreset(long)).not.toBeNull();
  });

  it('deletes a preset and reports one that is not there', async () => {
    const m = await load();
    m.saveRulePreset('a');
    m.saveRulePreset('b');
    expect(m.deleteRulePreset('a')).toBe(true);
    expect(m.listRulePresets().map((p) => p.name)).toEqual(['b']);
    expect(m.readRulePreset('a')).toBeNull();
    expect(m.deleteRulePreset('a')).toBe(false);
  });

  it('clamps a stored preset to each rule range on read', async () => {
    store.setItem(
      PRESETS_KEY,
      JSON.stringify({
        format: 1,
        presets: { wild: { savedAt: 5, rules: { payoutMul: 99, trainSpeedMul: -1 } } },
      }),
    );
    const m = await load();
    const r = m.readRulePreset('wild')!;
    const meta = (k: string) => m.RULE_META.find((x) => x.key === k)!;
    expect(r.payoutMul).toBe(meta('payoutMul').max);
    expect(r.trainSpeedMul).toBe(meta('trainSpeedMul').min);
    expect(r.loadRateMul).toBe(m.DEFAULT_RULES.loadRateMul);
  });

  it('applying a preset puts the whole clamped preset in force for the session only', async () => {
    store.setItem(
      PRESETS_KEY,
      JSON.stringify({
        format: 1,
        presets: { wild: { savedAt: 5, rules: { payoutMul: 99, trainSpeedMul: 2 } } },
      }),
    );
    const m = await load();
    const live = m.rules;
    m.setRules({ loadRateMul: 3 });
    expect(m.applyRulePreset('wild')).toBe(true);
    expect(m.rules).toBe(live);
    expect({ ...m.rules }).toEqual(m.readRulePreset('wild'));
    expect(m.rules.payoutMul).toBe(m.RULE_META.find((x) => x.key === 'payoutMul')!.max);
    // the whole preset: what the live rules held before and the preset leaves out is gone
    expect(m.rules.loadRateMul).toBe(m.DEFAULT_RULES.loadRateMul);
    expect(store.getItem(RULES_KEY)).toBeNull();

    const next = await load();
    expect({ ...next.rules }).toEqual(next.DEFAULT_RULES);
  });

  it('applying a name that is no preset returns false and changes nothing', async () => {
    const m = await load();
    m.saveRulePreset('p', m.rulesFrom({ payoutMul: 3 }));
    m.setRules({ loadRateMul: 2 });
    const before = { ...m.rules };
    const presets = store.getItem(PRESETS_KEY);
    const local = writesTo(store);
    const tab = writesTo(session);
    expect(m.applyRulePreset('missing')).toBe(false);
    expect({ ...m.rules }).toEqual(before);
    expect(store.getItem(PRESETS_KEY)).toBe(presets);
    expect(local).toEqual([]);
    expect(tab).toEqual([]);
  });

  it('keeps the format 1 store: a preset written by the current build still lists and loads', async () => {
    store.setItem(
      PRESETS_KEY,
      JSON.stringify({
        format: 1,
        presets: { Mine: { savedAt: 1700000000000, rules: { payoutMul: 2, mapSize: 224 } } },
      }),
    );
    const m = await load();
    expect(m.listRulePresets()).toEqual([{ name: 'Mine', savedAt: 1700000000000 }]);
    expect(m.applyRulePreset('Mine')).toBe(true);
    expect(m.rules.payoutMul).toBe(2);
    expect(m.rules.mapSize).toBe(224);
    // and a save writes the same shape back
    m.saveRulePreset('More');
    const raw = JSON.parse(store.getItem(PRESETS_KEY)!);
    expect(raw.format).toBe(1);
    expect(Object.keys(raw.presets).sort()).toEqual(['Mine', 'More']);
    expect(Object.keys(raw.presets.More).sort()).toEqual(['rules', 'savedAt']);
  });

  it.each([
    ['not JSON', '{bad'],
    ['not an object', '42'],
    ['another format', JSON.stringify({ format: 2, presets: { a: { savedAt: 1, rules: {} } } })],
    ['presets not an object', JSON.stringify({ format: 1, presets: [] })],
  ])('a stored value that is %s lists as no presets', async (_what, raw) => {
    store.setItem(PRESETS_KEY, raw);
    const m = await load();
    expect(() => m.listRulePresets()).not.toThrow();
    expect(m.listRulePresets()).toEqual([]);
    expect(m.readRulePreset('a')).toBeNull();
    expect(m.deleteRulePreset('a')).toBe(false);
  });

  it('skips a malformed entry and keeps the rest', async () => {
    store.setItem(
      PRESETS_KEY,
      JSON.stringify({
        format: 1,
        presets: { good: { savedAt: 1, rules: {} }, bad: { savedAt: 'x', rules: {} }, worse: 7 },
      }),
    );
    const m = await load();
    expect(m.listRulePresets()).toEqual([{ name: 'good', savedAt: 1 }]);
  });

  it('names that shadow object members are ordinary names', async () => {
    const m = await load();
    expect(m.readRulePreset('constructor')).toBeNull();
    expect(m.readRulePreset('__proto__')).toBeNull();
    expect(m.saveRulePreset('__proto__', m.rulesFrom({ payoutMul: 2 }))).toBe(true);
    expect(m.listRulePresets().map((p) => p.name)).toEqual(['__proto__']);
    expect(m.readRulePreset('__proto__')!.payoutMul).toBe(2);
  });

  it('never throws when the storage itself fails', async () => {
    const m = await load();
    vi.stubGlobal('localStorage', refusing);
    expect(m.listRulePresets()).toEqual([]);
    expect(m.saveRulePreset('a')).toBe(false);
    expect(m.readRulePreset('a')).toBeNull();
    expect(m.applyRulePreset('a')).toBe(false);
    expect(m.stageNewGameTuning('a')).toBe(false);
    expect(() => m.setRules({ loadRateMul: 2 })).not.toThrow();
    expect(() => m.resetRules()).not.toThrow();
    expect(() => m.applyGameRules({ payoutMul: 2 })).not.toThrow();
    expect(() => m.readRules()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------------------------
// Properties over generated inputs. A page load is a fresh import, and `forAll` is synchronous
// while an import is not, so `eachSeed` runs each seed's case against fresh imports first and
// then has `forAll` judge what was observed for that one seed: a failure names its seed and case.
// The oracles and the model below are written from the issue, not from the code under test.

type Json = Record<string, unknown>;
type Shipped = Pick<RulesModule, 'DEFAULT_RULES' | 'RULE_META'>;

/** Every value an older build remapped on read, by rule. */
const OLD_BY_KEY = new Map<string, number[]>();
for (const [k, v] of OLD_VALUES) OLD_BY_KEY.set(k, [...(OLD_BY_KEY.get(k) ?? []), v]);

function freshStorage() {
  store = new MemoryStorage();
  session = new MemoryStorage();
  vi.stubGlobal('localStorage', store);
  vi.stubGlobal('sessionStorage', session);
}

/** One case per seed: `run` does the async work on fresh storage, `judge` is the property. */
async function eachSeed<T, O>(
  gen: (rng: Rng) => T,
  run: (c: T) => Promise<O>,
  judge: (c: T, seen: O) => void,
  seeds: readonly number[] = SEEDS,
) {
  for (const seed of seeds) {
    freshStorage();
    const seen = await run(gen(new Rng(seed)));
    forAll(gen, (c) => judge(c, seen), { seeds: [seed] });
  }
}

/** A rule's value from each class a stored tuning can hold, the old remapped values among them. */
function rawValue(rng: Rng, m: RuleMeta): unknown {
  const inside = () => (m.key === 'mapSize' ? 32 * rng.int(1, 15) : rng.range(m.min, m.max));
  switch (rng.int(0, 8)) {
    case 0:
      return m.min;
    case 1:
      return m.max;
    case 2:
    case 3:
      return inside();
    case 4:
      return m.max + 1 + rng.int(0, 1_000_000);
    case 5:
      return m.min - 1 - rng.int(0, 1_000_000);
    case 6:
    case 7: {
      const old = OLD_BY_KEY.get(m.key);
      return old ? rng.pick(old) : inside();
    }
    default:
      return rng.pick(['7', null, true, [], {}, 'NaN', '']);
  }
}

/** Like rawValue but always a finite number, which is what a slider hands `setRules`. */
function numeric(rng: Rng, m: RuleMeta): number {
  for (;;) {
    const v = rawValue(rng, m);
    if (typeof v === 'number') return v;
  }
}

/** A stored tuning: a random subset of the rules, maybe all four old values, a rule with no meta. */
function tuningOf(rng: Rng, meta: readonly RuleMeta[]): Json {
  const out: Json = {};
  const density = rng.pick([0.1, 0.3, 0.6, 1]);
  for (const m of meta) if (rng.chance(density)) out[m.key] = rawValue(rng, m);
  if (rng.chance(0.3)) for (const [k, vs] of OLD_BY_KEY) out[k] = rng.pick(vs);
  if (rng.chance(0.2)) out.reputationMul = rng.range(0, 5);
  if (rng.chance(0.2)) out.notARule = rng.range(0, 5);
  return out;
}

/**
 * What a tuning must read as: each rule's finite number clamped to its range, every other value
 * (a string, null, absent) the shipped one, mapSize on the 32-tile grid, no value remapped.
 */
function clampAll(s: Shipped, raw: Json): Rules {
  const out: Json = { ...s.DEFAULT_RULES };
  for (const m of s.RULE_META) {
    const v = raw[m.key];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    out[m.key] = v < m.min ? m.min : v > m.max ? m.max : v;
  }
  out.mapSize = Math.max(32, 32 * Math.round((out.mapSize as number) / 32));
  return out as unknown as Rules;
}

/** Aside from mapSize's grid, a rule written inside its range comes back exactly as written. */
function expectAsWritten(s: Shipped, raw: Json, got: Rules, at: string) {
  for (const m of s.RULE_META) {
    const v = raw[m.key];
    if (m.key === 'mapSize' || typeof v !== 'number') continue;
    if (v >= m.min && v <= m.max) expect(got[m.key], `${at}: ${m.key}`).toBe(v);
  }
}

const JUNK = ['{bad', '42', '[]', 'null', '""', 'true', ''];
// A preset name as stored: trimmed, cut to 32 characters, trimmed again (a cut can end in a space).
const CANON = (n: string) => Array.from(n.trim()).slice(0, 32).join('').trim();

type Op =
  | { op: 'set'; patch: Record<string, number> }
  | { op: 'reset' }
  | { op: 'game'; saved?: Json }
  | { op: 'save'; name: string; rules?: Json }
  | { op: 'apply'; name: string }
  | { op: 'stage'; name: string | null }
  | { op: 'delete'; name: string }
  | { op: 'scribble' }
  | { op: 'reload' };

interface Seq {
  oldKey?: Json;
  ops: Op[];
}

const SAVE_NAMES = ['a', 'b', 'Rich Poor', ' b '];
const ASK_NAMES = ['a', 'b', 'Rich Poor', 'missing', ' a ', ' Rich Poor'];
const PROBES = ['a', 'b', 'Rich Poor', 'missing'];

/**
 * 0 to 16 operations of the nine kinds, then two reloads so a staged tuning is seen taken. Half the
 * sequences open by staging a saved tuning and loading it, so the rest runs on a load that took one.
 */
function sequence(rng: Rng, meta: readonly RuleMeta[]): Seq {
  const ops: Op[] = [];
  if (rng.chance(0.5)) {
    const name = rng.pick(SAVE_NAMES);
    ops.push({ op: 'save', name, rules: tuningOf(rng, meta) }, { op: 'stage', name });
    ops.push({ op: 'reload' });
  }
  for (let n = rng.int(0, 16); n > 0; n--) {
    const k = rng.int(0, 19);
    if (k < 3) {
      const patch: Record<string, number> = {};
      for (let j = rng.int(1, 3); j > 0; j--) {
        const m = rng.pick(meta);
        patch[m.key] = numeric(rng, m);
      }
      ops.push({ op: 'set', patch });
    } else if (k < 4) ops.push({ op: 'reset' });
    else if (k < 6)
      ops.push({ op: 'game', saved: rng.chance(0.2) ? undefined : tuningOf(rng, meta) });
    else if (k < 9) {
      const rules = rng.chance(0.4) ? undefined : tuningOf(rng, meta);
      ops.push({ op: 'save', name: rng.pick(SAVE_NAMES), rules });
    } else if (k < 11) ops.push({ op: 'apply', name: rng.pick(ASK_NAMES) });
    else if (k < 14) ops.push({ op: 'stage', name: rng.chance(0.15) ? null : rng.pick(ASK_NAMES) });
    else if (k < 15) ops.push({ op: 'delete', name: rng.pick(ASK_NAMES) });
    else if (k < 16) ops.push({ op: 'scribble' });
    else ops.push({ op: 'reload' });
  }
  ops.push({ op: 'reload' }, { op: 'reload' });
  return { oldKey: rng.chance(0.5) ? tuningOf(rng, meta) : undefined, ops };
}

/** What the module and both stores showed after the boot (step 0) and after each operation. */
interface Step {
  returned: unknown;
  /** `rules` is still the object this load started with */
  same: boolean;
  live: Rules;
  started: Rules;
  tuningKey: string | null;
  staged: unknown;
  presets: (Rules | null)[];
  listed: string[];
  local: [string, string][];
  tab: [string, string][];
}

describe('properties over generated inputs', () => {
  it('uses the storage keys the issue names', async () => {
    const m = await load();
    expect(m.RULES_KEY).toBe(RULES_KEY);
    expect(m.RULE_PRESETS_KEY).toBe(PRESETS_KEY);
    expect(m.NEW_GAME_TUNING_KEY).toBe(STAGED_KEY);
  });

  it('a stored tuning of any content never applies, and is deleted rather than converted', async () => {
    const s = await load();
    const kept = JSON.stringify({ format: 1, presets: { Keep: { savedAt: 3, rules: {} } } });
    await eachSeed(
      (rng) => ({
        stored: rng.chance(0.15) ? rng.pick(JUNK) : JSON.stringify(tuningOf(rng, s.RULE_META)),
        hasPreset: rng.chance(0.5),
      }),
      async (c) => {
        store.setItem(RULES_KEY, c.stored);
        store.setItem('terepasztal.save', 'x');
        if (c.hasPreset) store.setItem(PRESETS_KEY, kept);
        const local = writesTo(store);
        const tab = writesTo(session);
        const m = await load();
        return {
          live: { ...m.rules },
          read: m.readRules(),
          key: store.getItem(RULES_KEY),
          presets: store.getItem(PRESETS_KEY),
          listed: m.listRulePresets().length,
          save: store.getItem('terepasztal.save'),
          local,
          tab,
        };
      },
      (c, o) => {
        expect(o.live).toEqual(s.DEFAULT_RULES);
        expect(o.read).toEqual(s.DEFAULT_RULES);
        expect(o.key).toBeNull();
        expect(o.presets).toBe(c.hasPreset ? kept : null);
        expect(o.listed).toBe(c.hasPreset ? 1 : 0);
        expect(o.save).toBe('x');
        expect(o.local).toEqual([['remove', RULES_KEY]]);
        expect(o.tab).toEqual([]);
      },
    );
  });

  it('a staged value with a __proto__ or an unknown key reaches nothing but the rules', async () => {
    session.setItem(
      STAGED_KEY,
      '{"__proto__":{"payoutMul":99,"polluted":1},"notARule":7,"payoutMul":2}',
    );
    const m = await load();
    expect(m.rules.payoutMul).toBe(2);
    expect(Object.keys(m.rules).sort()).toEqual(Object.keys(m.DEFAULT_RULES).sort());
    expect(Object.getPrototypeOf(m.rules)).toBe(Object.prototype);
    const bare: Json = {};
    expect(bare.payoutMul).toBeUndefined();
    expect(bare.polluted).toBeUndefined();
  });

  it('a staged tuning loads once, clamped and as written, and the load after is the shipped rules', async () => {
    const s = await load();
    const chars = ['a', 'B', '7', ' ', '-', 'é', '🚂'];
    await eachSeed(
      (rng) => {
        let name = '';
        while (!CANON(name)) {
          name = Array.from({ length: rng.int(1, 48) }, () => rng.pick(chars)).join('');
        }
        return {
          stored: CANON(name),
          // the name as a player might type it: padded, or longer than a preset name may be
          asked: ' '.repeat(rng.int(0, 2)) + name + ' '.repeat(rng.int(0, 2)),
          preset: tuningOf(rng, s.RULE_META),
          via: rng.pick(['name', 'session']),
        };
      },
      async (c) => {
        const presets = JSON.stringify({
          format: 1,
          presets: {
            [c.stored]: { savedAt: 1, rules: c.preset },
            Other: { savedAt: 2, rules: { payoutMul: 4 } },
          },
        });
        store.setItem(PRESETS_KEY, presets);
        const m = await load();
        const local = writesTo(store);
        let ok: boolean | undefined;
        if (c.via === 'name') ok = m.stageNewGameTuning(c.asked);
        else session.setItem(STAGED_KEY, JSON.stringify(c.preset));
        const staged = session.getItem(STAGED_KEY);
        const stageWrites = [...local];
        const liveAfterStage = { ...m.rules };

        const first = await load();
        const afterFirst = session.getItem(STAGED_KEY);
        const second = await load();
        return {
          ok,
          staged,
          stageWrites,
          liveAfterStage,
          first: { ...first.rules },
          firstRead: first.readRules(),
          afterFirst,
          second: { ...second.rules },
          secondRead: second.readRules(),
          afterSecond: session.getItem(STAGED_KEY),
          presetsBefore: presets,
          presetsAfter: store.getItem(PRESETS_KEY),
        };
      },
      (c, o) => {
        const want = clampAll(s, c.preset);
        if (c.via === 'name') {
          expect(o.ok).toBe(true);
          // the rules, already clamped, not the name
          expect(JSON.parse(o.staged!)).toEqual(want);
          expect(o.stageWrites).toEqual([]);
        }
        // staging is for the next load: nothing in force moves
        expect(o.liveAfterStage).toEqual(s.DEFAULT_RULES);
        expect(o.first).toEqual(want);
        expect(o.firstRead).toEqual(want);
        expectAsWritten(s, c.preset, o.first, 'the load that took it');
        expect(o.afterFirst).toBeNull();
        expect(o.second).toEqual(s.DEFAULT_RULES);
        expect(o.secondRead).toEqual(s.DEFAULT_RULES);
        expect(o.afterSecond).toBeNull();
        expect(o.presetsAfter).toBe(o.presetsBefore);
      },
    );
  });

  // slow because the rules module is imported afresh at the start of each seeded sequence and at
  // every reload in it: half a second alone
  it('any sequence of operations and reloads follows the model and stores only what it owns', async () => {
    const s = await load();
    at(1000);
    const run = async (c: Seq): Promise<Step[]> => {
      if (c.oldKey) store.setItem(RULES_KEY, JSON.stringify(c.oldKey));
      const local = writesTo(store);
      const tab = writesTo(session);
      let m = await load();
      let first = m.rules;
      const seen: Step[] = [];
      const observe = (returned: unknown) => {
        const raw = session.getItem(STAGED_KEY);
        seen.push({
          returned,
          same: m.rules === first,
          live: { ...m.rules },
          started: m.readRules(),
          tuningKey: store.getItem(RULES_KEY),
          staged: raw === null ? null : JSON.parse(raw),
          presets: PROBES.map((n) => m.readRulePreset(n)),
          listed: m
            .listRulePresets()
            .map((p) => p.name)
            .sort(),
          local: local.splice(0),
          tab: tab.splice(0),
        });
      };
      observe(undefined);
      for (const o of c.ops) {
        let returned: unknown;
        if (o.op === 'set') m.setRules(o.patch);
        else if (o.op === 'reset') m.resetRules();
        else if (o.op === 'game') m.applyGameRules(o.saved as Partial<Rules> | undefined);
        else if (o.op === 'save') returned = m.saveRulePreset(o.name, o.rules as unknown as Rules);
        else if (o.op === 'apply') returned = m.applyRulePreset(o.name);
        else if (o.op === 'stage') returned = m.stageNewGameTuning(o.name);
        else if (o.op === 'delete') returned = m.deleteRulePreset(o.name);
        else if (o.op === 'scribble') {
          // what readRules hands back is the caller's to change
          const r = m.readRules();
          r.startMoney = -1;
          r.payoutMul = -1;
        } else {
          m = await load();
          first = m.rules;
        }
        observe(returned);
      }
      return seen;
    };

    await eachSeed(
      (rng) => sequence(rng, s.RULE_META),
      run,
      (c, seen) => {
        const D = s.DEFAULT_RULES;
        let live: Rules = { ...D };
        let started: Rules = { ...D };
        let staged: Rules | null = null;
        const presets = new Map<string, Rules>();
        expect(seen).toHaveLength(c.ops.length + 1);

        for (let i = 0; i < seen.length; i++) {
          const op = i === 0 ? undefined : c.ops[i - 1];
          const kind = op?.op ?? 'boot';
          const at = `step ${i} (${op ? JSON.stringify(op) : 'boot'})`;
          let returned: unknown;
          if (op?.op === 'set') live = clampAll(s, { ...live, ...op.patch });
          else if (op?.op === 'reset') live = { ...D };
          else if (op?.op === 'game') live = clampAll(s, op.saved ?? {});
          else if (op?.op === 'save') {
            presets.set(CANON(op.name), op.rules ? clampAll(s, op.rules) : { ...live });
            returned = true;
          } else if (op?.op === 'apply') {
            const p = presets.get(CANON(op.name));
            if (p) live = { ...p };
            returned = p !== undefined;
          } else if (op?.op === 'stage') {
            const p = op.name === null ? undefined : presets.get(CANON(op.name));
            staged = p ? { ...p } : null;
            returned = op.name === null || p !== undefined;
          } else if (op?.op === 'delete') returned = presets.delete(CANON(op.name));
          else if (op?.op === 'reload') {
            live = staged ? { ...staged } : { ...D };
            started = { ...live };
            staged = null;
          }

          const step = seen[i];
          expect(step.returned, at).toBe(returned);
          expect(step.same, `${at}: rules kept its identity`).toBe(true);
          expect(step.live, at).toEqual(live);
          expect(step.started, `${at}: readRules is what this load started with`).toEqual(started);
          expect(step.tuningKey, `${at}: the old key stays absent`).toBeNull();
          expect(step.staged, `${at}: the staged tuning`).toEqual(staged);
          expect(step.presets, `${at}: presets`).toEqual(PROBES.map((n) => presets.get(n) ?? null));
          expect(step.listed, `${at}: listed presets`).toEqual([...presets.keys()].sort());

          // each operation writes only the storage it owns
          const sets = (log: [string, string][], key: string) =>
            log.every(([kind, k]) => kind === 'set' && k === key);
          const touches = (log: [string, string][], key: string) => log.every(([, k]) => k === key);
          const wrote = `${at} wrote ${JSON.stringify([step.local, step.tab])}`;
          if (kind === 'boot' || kind === 'reload') {
            expect(step.local, `${at}: a load deletes the old key and writes nothing else`).toEqual(
              [['remove', RULES_KEY]],
            );
            expect(
              step.tab.every(([kind, k]) => kind === 'remove' && k === STAGED_KEY),
              wrote,
            ).toBe(true);
          } else {
            if (kind === 'save' || kind === 'delete')
              expect(sets(step.local, PRESETS_KEY), wrote).toBe(true);
            else expect(step.local, wrote).toEqual([]);
            if (kind === 'save') expect(step.local.length, wrote).toBeGreaterThan(0);
            if (kind === 'stage') expect(touches(step.tab, STAGED_KEY), wrote).toBe(true);
            else expect(step.tab, wrote).toEqual([]);
          }
        }
      },
    );
  }, 30_000);
});

describe('the import-time read over every way storage can fail', () => {
  type Mode = 'ok' | 'missing' | 'throws' | 'remove throws';
  const locals: Mode[] = ['ok', 'missing', 'throws'];
  const sessions: Mode[] = ['ok', 'missing', 'throws', 'remove throws'];
  const kinds = ['none', 'valid', 'malformed'] as const;
  const cases = locals.flatMap((l) =>
    sessions.flatMap((t) => kinds.map((k) => [l, t, k] as const)),
  );
  const staged = { payoutMul: 2, startMoney: 25000 };

  it.each(cases)(
    'localStorage %s, sessionStorage %s, staged tuning %s: never throws, takes the tuning once',
    async (l, t, kind) => {
      const disk = new MemoryStorage();
      disk.setItem(RULES_KEY, JSON.stringify({ trainSpeedMul: 2 }));
      const tab = new MemoryStorage();
      if (kind === 'valid') tab.setItem(STAGED_KEY, JSON.stringify(staged));
      if (kind === 'malformed') tab.setItem(STAGED_KEY, '{bad');
      const as = (mode: Mode, mem: MemoryStorage) =>
        mode === 'ok'
          ? mem
          : mode === 'missing'
            ? undefined
            : mode === 'throws'
              ? refusing
              : Object.assign(mem, {
                  removeItem: () => {
                    throw new Error('denied');
                  },
                });
      vi.stubGlobal('localStorage', as(l, disk));
      vi.stubGlobal('sessionStorage', as(t, tab));

      const m = await load();
      const live = { ...m.rules };
      const want = clampAll(m, staged);
      // a tuning that cannot be removed is not taken: it would load again
      const taken = t === 'ok' && kind === 'valid';
      if (taken && l === 'ok') expect(live).toEqual(want);
      // the old key and the staged tuning are separate stores: whether a broken localStorage
      // still lets a readable sessionStorage hand over its tuning is not pinned
      else if (taken) expect([m.DEFAULT_RULES, want]).toContainEqual(live);
      else expect(live).toEqual(m.DEFAULT_RULES);
      expect(m.readRules()).toEqual(live);
      if (l === 'ok') expect(disk.getItem(RULES_KEY)).toBeNull();
      if (t === 'ok' && kind === 'valid') expect(tab.getItem(STAGED_KEY)).toBeNull();
    },
  );
});
