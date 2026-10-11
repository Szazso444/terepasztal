import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Rules } from './rules';

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
