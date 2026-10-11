import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Rules } from './rules';
import { forAll } from '../testing/property';

type RulesModule = typeof import('./rules');

const RULES_KEY = 'terepasztal.rules';
const PRESETS_KEY = 'terepasztal.rulePresets';

/** An in-memory `localStorage`, so each test starts from a store it writes itself. */
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

/** A fresh copy of the module, which reads the stored tuning at load like a page load does. */
async function load(): Promise<RulesModule> {
  vi.resetModules();
  return import('./rules');
}

function stored(): Record<string, unknown> | null {
  const raw = store.getItem(RULES_KEY);
  return raw === null ? null : (JSON.parse(raw) as Record<string, unknown>);
}

/** Pin the wall clock a preset's `savedAt` is taken from. */
function at(ms: number) {
  vi.spyOn(Date, 'now').mockReturnValue(ms);
}

beforeEach(() => {
  store = new MemoryStorage();
  vi.stubGlobal('localStorage', store);
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
  // `reputationMul` and `tradeCycleDays` were settings no screen showed and nothing read.
  const old = { reputationMul: 3, tradeCycleDays: 2 };
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

describe('a loaded game keeps its rules to itself', () => {
  it('applyGameRules puts the save in force without writing the stored tuning', async () => {
    store.setItem(RULES_KEY, JSON.stringify({ trainSpeedMul: 2 }));
    const m = await load();
    expect(m.rules.trainSpeedMul).toBe(2);
    const live = m.rules;

    m.applyGameRules({ payoutMul: 3 });
    expect(m.rules).toBe(live);
    expect(m.rules.trainSpeedMul).toBe(m.DEFAULT_RULES.trainSpeedMul);
    expect(m.rules.payoutMul).toBe(3);
    expect(stored()).toEqual({ trainSpeedMul: 2 });

    // The next page load, a new game, starts from the stored tuning, not the save's rules.
    const next = await load();
    expect(next.rules.trainSpeedMul).toBe(2);
    expect(next.rules.payoutMul).toBe(next.DEFAULT_RULES.payoutMul);
  });

  it('applyGameRules with no saved rules is the defaults', async () => {
    store.setItem(RULES_KEY, JSON.stringify({ trainSpeedMul: 2 }));
    const m = await load();
    m.applyGameRules(undefined);
    expect({ ...m.rules }).toEqual(m.DEFAULT_RULES);
    expect(stored()).toEqual({ trainSpeedMul: 2 });
  });

  it('a tuning change during a loaded game stores only the key it changed', async () => {
    store.setItem(RULES_KEY, JSON.stringify({ trainSpeedMul: 2 }));
    const m = await load();
    m.applyGameRules({ payoutMul: 3, trainSpeedMul: 1.5 });

    m.setRules({ loadRateMul: 2 });
    expect(m.rules.loadRateMul).toBe(2);
    expect(m.rules.payoutMul).toBe(3);
    expect(m.rules.trainSpeedMul).toBe(1.5);
    const s = stored()!;
    expect(s.loadRateMul).toBe(2);
    expect(s.trainSpeedMul).toBe(2);
    expect(s).not.toHaveProperty('payoutMul');
  });

  it('setRules stores the clamped value it put in force', async () => {
    const m = await load();
    m.setRules({ trainSpeedMul: 1000 });
    const max = m.RULE_META.find((x) => x.key === 'trainSpeedMul')!.max;
    expect(m.rules.trainSpeedMul).toBe(max);
    expect(stored()).toEqual({ trainSpeedMul: max });
  });

  it('setRules without persist leaves the stored tuning alone', async () => {
    store.setItem(RULES_KEY, JSON.stringify({ trainSpeedMul: 2 }));
    const m = await load();
    m.setRules({ loadRateMul: 2 }, false);
    expect(m.rules.loadRateMul).toBe(2);
    expect(stored()).toEqual({ trainSpeedMul: 2 });
  });

  it('setRules overwrites a stored tuning that is not an object instead of throwing', async () => {
    store.setItem(RULES_KEY, '{bad');
    const m = await load();
    expect({ ...m.rules }).toEqual(m.DEFAULT_RULES);
    m.setRules({ loadRateMul: 2 });
    expect(stored()).toEqual({ loadRateMul: 2 });
  });

  it('resetRules puts the live and the stored tuning back to the defaults', async () => {
    store.setItem(RULES_KEY, JSON.stringify({ trainSpeedMul: 2, loadRateMul: 3 }));
    const m = await load();
    const live = m.rules;
    m.resetRules();
    expect(m.rules).toBe(live);
    expect({ ...m.rules }).toEqual(m.DEFAULT_RULES);
    expect(m.readRules()).toEqual(m.DEFAULT_RULES);
    const next = await load();
    expect({ ...next.rules }).toEqual(next.DEFAULT_RULES);
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

  it('saves the live rules when no set is given, and leaves the stored tuning alone', async () => {
    const m = await load();
    m.applyGameRules({ deadlineMul: 2 });
    expect(m.saveRulePreset('Live')).toBe(true);
    expect(m.readRulePreset('Live')!.deadlineMul).toBe(2);
    expect(stored()).toBeNull();
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

  it('applying a preset puts the whole preset in force and stores it as the tuning', async () => {
    store.setItem(RULES_KEY, JSON.stringify({ trainSpeedMul: 2 }));
    const m = await load();
    const live = m.rules;
    m.saveRulePreset('p', m.rulesFrom({ payoutMul: 3 }));
    expect(m.applyRulePreset('p')).toBe(true);
    expect(m.rules).toBe(live);
    expect({ ...m.rules }).toEqual(m.rulesFrom({ payoutMul: 3 }));

    const next = await load();
    expect({ ...next.rules }).toEqual(next.rulesFrom({ payoutMul: 3 }));
    expect(next.applyRulePreset('missing')).toBe(false);
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
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    });
    expect(m.listRulePresets()).toEqual([]);
    expect(m.saveRulePreset('a')).toBe(false);
    expect(() => m.setRules({ loadRateMul: 2 })).not.toThrow();
    expect(() => m.resetRules()).not.toThrow();
  });
});
