import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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
