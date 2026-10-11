import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Rng } from '../engine/rng';
import { forAll, shrinkArray } from '../testing/property';
import { STR } from '../strings';
import {
  NEW_GAME_TUNING_KEY,
  RULE_PRESETS_KEY,
  RULE_PRESET_NAME_MAX,
  deleteRulePreset,
  listRulePresets,
  rules,
  rulesFrom,
  saveRulePreset,
  stageNewGameTuning,
} from '../sim/rules';
import { keepPick, pickIndex, startNewGame, tuningEntries } from './newGameTuning';

/** What `listRulePresets()` gives: the saved tunings, newest first. */
const saved = (...names: string[]) => names.map((name, i) => ({ name, savedAt: 1000 - i }));

describe('the entries of the New game tuning choice', () => {
  it('shows no choice while no tuning is saved', () => {
    expect(tuningEntries([])).toEqual([]);
  });

  it('lists the shipped rules first, then every saved tuning in the order given', () => {
    const entries = tuningEntries(saved('Rich', 'Poor', 'Hilly'));
    expect(entries.map((e) => e.name)).toEqual([null, 'Rich', 'Poor', 'Hilly']);
    expect(entries[0].label).toBe(STR.menu.shippedRules);
    // a saved tuning is labelled with its own name
    expect(entries.slice(1).map((e) => e.label)).toEqual(['Rich', 'Poor', 'Hilly']);
  });

  it('keeps a tuning named like the shipped entry its own entry', () => {
    const entries = tuningEntries(saved(STR.menu.shippedRules, 'Rich'));
    expect(entries).toHaveLength(3);
    expect(entries[0].label).toBe(entries[1].label);
    expect(entries[0].name).toBeNull();
    expect(entries[1].name).toBe(STR.menu.shippedRules);
    // told apart by name: each pick finds its own position
    expect(pickIndex(entries, null)).toBe(0);
    expect(pickIndex(entries, STR.menu.shippedRules)).toBe(1);
    expect(pickIndex(entries, 'Rich')).toBe(2);
  });
});

describe('the pick across a redraw of the choice', () => {
  it('stays on a tuning that still exists', () => {
    const entries = tuningEntries(saved('Rich', 'Poor'));
    expect(keepPick(entries, 'Poor')).toBe('Poor');
    // a new tuning saved beside it changes nothing
    expect(keepPick(tuningEntries(saved('New', 'Rich', 'Poor')), 'Poor')).toBe('Poor');
  });

  it('falls back to the shipped rules when its tuning is gone, or none is saved', () => {
    expect(keepPick(tuningEntries(saved('Rich')), 'Poor')).toBeNull();
    expect(keepPick(tuningEntries([]), 'Poor')).toBeNull();
  });

  it('stays on the shipped rules, and a tuning named like them is not mistaken for it', () => {
    const entries = tuningEntries(saved('Rich'));
    expect(keepPick(entries, null)).toBeNull();
    // 'Shipped rules' as a name is a pick only while a tuning has that name
    expect(keepPick(entries, STR.menu.shippedRules)).toBeNull();
    const named = tuningEntries(saved(STR.menu.shippedRules));
    expect(keepPick(named, STR.menu.shippedRules)).toBe(STR.menu.shippedRules);
    expect(keepPick(named, null)).toBeNull();
  });

  it('puts the position of an unknown pick on the shipped rules', () => {
    expect(pickIndex(tuningEntries(saved('Rich')), 'Gone')).toBe(0);
  });
});

describe('starting a new game from the pick', () => {
  /** `stageNewGameTuning` and the host's `newGame` as recorders that share one log. */
  function recorders(staged: boolean) {
    const log: string[] = [];
    return {
      log,
      stage: (name: string | null) => {
        log.push(`stage ${JSON.stringify(name)}`);
        return staged;
      },
      start: () => log.push('newGame'),
    };
  }

  it('stages the shipped rules (null) and then starts, for "Shipped rules"', () => {
    const r = recorders(true);
    expect(startNewGame(null, r.stage, r.start)).toBeNull();
    expect(r.log).toEqual(['stage null', 'newGame']);
  });

  it('stages the tuning by its name and then starts', () => {
    const r = recorders(true);
    expect(startNewGame('Rich', r.stage, r.start)).toBeNull();
    expect(r.log).toEqual(['stage "Rich"', 'newGame']);
  });

  it('stages a tuning named like the shipped entry by that name, never as null', () => {
    const r = recorders(true);
    startNewGame(STR.menu.shippedRules, r.stage, r.start);
    expect(r.log).toEqual([`stage ${JSON.stringify(STR.menu.shippedRules)}`, 'newGame']);
  });

  it('does not start when staging is refused, and names the pick in what it reports', () => {
    for (const pick of ['Rich', null]) {
      const r = recorders(false);
      const said = startNewGame(pick, r.stage, r.start);
      expect(r.log).toEqual([`stage ${JSON.stringify(pick)}`]);
      expect(said).toBe(STR.menu.tuningUnusable(pick ?? STR.menu.shippedRules));
      expect(said).toContain(pick ?? STR.menu.shippedRules);
    }
  });

  it('starts at most once, and only after staging', () => {
    const r = recorders(true);
    startNewGame('Rich', r.stage, r.start);
    expect(r.log.filter((l) => l === 'newGame')).toHaveLength(1);
    expect(r.log.indexOf('newGame')).toBeGreaterThan(r.log.findIndex((l) => l.startsWith('stage')));
  });
});

// ----------------------------------------------------------------- properties over generated cases
//
// Every case below is drawn from `Rng(seed)` by `forAll` (src/testing/property.ts) over the seeds
// 1 to 100; a failure names its seed and the smallest case found.

/** Names a player might give tunings. Several would confuse code that told entries by label. */
const POOL = [
  STR.menu.shippedRules,
  STR.menu.newGameTuning,
  'Rich',
  'Poor',
  'Hilly 2',
  'a',
  'null',
  'constructor',
  '__proto__',
  'é🚂',
];

/** 0 to 8 distinct names from the pool, in a random order: what `listRulePresets()` could give. */
function savedList(rng: Rng): string[] {
  return rng.shuffle([...POOL]).slice(0, rng.int(0, 8));
}

describe('the entries and the pick, over generated lists of saved tunings', () => {
  const shrink = (names: string[]) => shrinkArray(names);

  it('lists nothing for none, else the shipped rules and then every tuning in order', () => {
    forAll(
      savedList,
      (names) => {
        const entries = tuningEntries(saved(...names));
        if (!names.length) {
          expect(entries).toEqual([]);
          return;
        }
        expect(entries).toHaveLength(names.length + 1);
        expect(entries[0]).toEqual({ name: null, label: STR.menu.shippedRules });
        expect(entries.slice(1)).toEqual(names.map((name) => ({ name, label: name })));
      },
      { shrink },
    );
  });

  it('finds every entry by its name, also where two entries carry the same label', () => {
    let sharedLabels = 0;
    forAll(
      savedList,
      (names) => {
        const entries = tuningEntries(saved(...names));
        if (new Set(entries.map((e) => e.label)).size < entries.length) sharedLabels++;
        for (const e of entries) expect(entries[pickIndex(entries, e.name)]).toBe(e);
      },
      { shrink },
    );
    // the generator does reach the confusing case (a tuning named like the shipped entry)
    expect(sharedLabels).toBeGreaterThan(0);
  });

  it('keeps a pick that is still an entry and drops one that is not, whatever else changed', () => {
    forAll(
      (rng) => ({ names: savedList(rng), pick: rng.pick<string | null>([null, ...POOL, 'Gone']) }),
      ({ names, pick }) => {
        const entries = tuningEntries(saved(...names));
        const kept = keepPick(entries, pick);
        const exists = pick !== null && names.includes(pick);
        expect(kept).toBe(exists ? pick : null);
        // a second redraw changes nothing, and what is kept is something the choice can show
        expect(keepPick(entries, kept)).toBe(kept);
        if (entries.length) expect(entries[pickIndex(entries, kept)].name).toBe(kept);
      },
      { shrink: (c) => [...shrinkArray(c.names)].map((names) => ({ ...c, names })) },
    );
  });

  it('puts a name that is no entry on the shipped rules', () => {
    forAll(savedList, (names) => {
      const entries = tuningEntries(saved(...names));
      expect(pickIndex(entries, 'Gone')).toBe(0);
    });
  });
});

describe('starting a new game, over every pick and both answers of the staging', () => {
  it('stages the pick once, starts once and only after it worked, and reports otherwise', () => {
    forAll(
      (rng) => ({ pick: rng.pick<string | null>([null, ...POOL]), staged: rng.chance(0.5) }),
      ({ pick, staged }) => {
        const log: unknown[] = [];
        const said = startNewGame(
          pick,
          (name) => {
            log.push(['stage', name]);
            return staged;
          },
          () => log.push('newGame'),
        );
        // the pick goes to the staging as it is: null stays null, a name stays its own name
        expect(log).toEqual(staged ? [['stage', pick], 'newGame'] : [['stage', pick]]);
        if (staged) expect(said).toBeNull();
        else expect(said).toBe(STR.menu.tuningUnusable(pick ?? STR.menu.shippedRules));
      },
    );
  });
});

// ------------------------------------------------------------- against the real saved tunings
//
// The choice, the pick and the start run against `src/sim/rules.ts` over in-memory storage, the way
// the title screen runs them: the choice is redrawn from `listRulePresets()` whenever the Game
// tuning screen closes, and the New game button stages the pick with `stageNewGameTuning`.

/** An in-memory `localStorage` or `sessionStorage`. */
class MemoryStorage {
  items = new Map<string, string>();
  getItem(k: string) {
    return this.items.has(k) ? this.items.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.items.set(k, String(v));
  }
  removeItem(k: string) {
    this.items.delete(k);
  }
}

let local: MemoryStorage;
let session: MemoryStorage;
beforeEach(() => {
  local = new MemoryStorage();
  session = new MemoryStorage();
  vi.stubGlobal('localStorage', local);
  vi.stubGlobal('sessionStorage', session);
  // each save is a moment later than the one before, so "newest first" has no ties
  let now = 1_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => (now += 1000));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

type Step =
  | { op: 'save'; name: string; funds: number }
  | { op: 'delete'; name: string }
  | { op: 'close' }
  | { op: 'pick'; at: number }
  | { op: 'press' };

/** Few names, so a step finds the tuning an earlier one saved, picked or deleted. */
const STEP_NAMES = [STR.menu.shippedRules, 'Rich', 'Poor', 'é🚂'];

/** 0 to 20 steps: tunings saved and deleted, the Game tuning screen closed, a pick, New game. */
function steps(rng: Rng): Step[] {
  const out: Step[] = [];
  for (let n = rng.int(0, 20); n > 0; n--) {
    const k = rng.int(0, 11);
    if (k < 3) out.push({ op: 'save', name: rng.pick(STEP_NAMES), funds: rng.int(1, 400) * 1000 });
    else if (k < 5) out.push({ op: 'delete', name: rng.pick(STEP_NAMES) });
    else if (k < 7) out.push({ op: 'close' });
    else if (k < 9) out.push({ op: 'pick', at: rng.int(0, 8) });
    else out.push({ op: 'press' });
  }
  return out;
}

describe('the New game choice against the tunings the Game tuning screen saves and deletes', () => {
  it('follows what is saved at each close, and starts a game from the pick without a trace', () => {
    // the cases that matter must be reached by the generator, or the property says little
    const seen = { kept: 0, dropped: 0, stale: 0, sameLabel: 0, shipped: 0, tuning: 0 };
    forAll(
      steps,
      (all) => {
        local.items.clear();
        session.items.clear();
        // what the model says is saved: names newest first, and the funds each one sets
        let order: string[] = [];
        const funds = new Map<string, number>();
        // what the choice shows (as of the last redraw), the pick on it, and the pick it should be
        let shown: string[] = [];
        let pick: string | null = null;
        let wantPick: string | null = null;

        const redraw = (at: string) => {
          const entries = tuningEntries(listRulePresets());
          expect(
            entries.map((e) => e.name),
            `${at}: entries`,
          ).toEqual(order.length ? [null, ...order] : []);
          pick = keepPick(entries, pick);
          const stays = wantPick !== null && order.includes(wantPick);
          if (stays) seen.kept++;
          else if (wantPick !== null) seen.dropped++;
          wantPick = stays ? wantPick : null;
          expect(pick, `${at}: pick`).toBe(wantPick);
          shown = entries.slice(1).map((e) => e.name!);
        };
        redraw('the title screen drawn');

        all.forEach((s, i) => {
          const at = `step ${i + 1} (${s.op})`;
          if (s.op === 'save') {
            expect(saveRulePreset(s.name, rulesFrom({ startMoney: s.funds })), at).toBe(true);
            order = [s.name, ...order.filter((n) => n !== s.name)];
            funds.set(s.name, s.funds);
          } else if (s.op === 'delete') {
            expect(deleteRulePreset(s.name), at).toBe(order.includes(s.name));
            order = order.filter((n) => n !== s.name);
          } else if (s.op === 'close') redraw(at);
          else if (s.op === 'pick') {
            // the player can only pick what the choice shows: the shipped rules or a listed tuning
            const options = [null, ...shown];
            pick = wantPick = options[s.at % options.length];
          } else {
            const before = { live: { ...rules }, presets: local.getItem(RULE_PRESETS_KEY) };
            const log: string[] = [];
            const said = startNewGame(pick, stageNewGameTuning, () => log.push('newGame'));
            // a tuning deleted since the last redraw cannot start a game, and nothing starts
            const usable = pick === null || order.includes(pick);
            if (!usable) seen.stale++;
            else if (pick === null) seen.shipped++;
            else if (pick === STR.menu.shippedRules) seen.sameLabel++;
            else seen.tuning++;
            expect(log, at).toEqual(usable ? ['newGame'] : []);
            if (usable) expect(said, at).toBeNull();
            else expect(said, at).toBe(STR.menu.tuningUnusable(pick!));
            const staged = session.getItem(NEW_GAME_TUNING_KEY);
            if (usable && pick === null)
              expect(staged, `${at}: the shipped rules stage no tuning`).toBeNull();
            // a tuning named like the shipped entry stages its own rules, never none
            if (usable && pick !== null)
              expect(JSON.parse(staged!).startMoney, `${at}: staged rules`).toBe(funds.get(pick));
            // the game in play and the saved tunings are as they were
            expect({ ...rules }, at).toEqual(before.live);
            expect(local.getItem(RULE_PRESETS_KEY), at).toBe(before.presets);
          }
        });
      },
      { shrink: (all) => shrinkArray(all) },
    );
    for (const [what, n] of Object.entries(seen))
      expect(n, `cases with ${what}`).toBeGreaterThan(0);
  });

  /** Save a tuning under a name as typed, up to `longest` characters, and start from what is listed. */
  const startsFromWhatIsListed = (longest: number) => {
    const chars = ['a', 'B', '7', ' ', '-', 'é', '🚂'];
    forAll(
      (rng) => Array.from({ length: rng.int(1, longest) }, () => rng.pick(chars)),
      (typed) => {
        local.items.clear();
        session.items.clear();
        // as typed, padded: the name a player gives is not always the one that is kept
        const given = ` ${typed.join('')} `;
        if (!saveRulePreset(given)) {
          // a name of nothing but spaces is refused, and then nothing is listed
          expect(listRulePresets()).toEqual([]);
          return;
        }
        const listed = tuningEntries(listRulePresets()).slice(1);
        expect(listed).toHaveLength(1);
        const log: string[] = [];
        const said = startNewGame(listed[0].name, stageNewGameTuning, () => log.push('newGame'));
        expect({ said, log }, JSON.stringify(listed[0].name)).toEqual({
          said: null,
          log: ['newGame'],
        });
      },
      {
        // shorter names first, then plainer characters
        shrink: (typed) => shrinkArray(typed, (c) => (c === 'a' ? [] : ['a'])),
        format: (typed) => JSON.stringify(typed.join('')),
      },
    );
  };

  it('can start a game from every tuning it lists, for names up to the longest a preset keeps', () => {
    startsFromWhatIsListed(RULE_PRESET_NAME_MAX);
  });

  // KNOWN FAILURE, a finding for Gameplay (src/sim/rules.ts, `presetName`): a name cut to 32
  // characters can end in a space, which a second `presetName` trims off, so the tuning is listed
  // under a name the staging (and Load, and Delete) cannot find again. Smallest case: 31 times 'a',
  // a space and one more character. When rules.ts keeps the stored name findable, this test fails
  // with "expected to fail": make it a plain `it`.
  it.fails('can start a game from every tuning it lists, whatever its name was cut from', () => {
    startsFromWhatIsListed(RULE_PRESET_NAME_MAX + 16);
  });

  it('clears a staged tuning when the next game starts from the shipped rules', () => {
    expect(saveRulePreset('Rich', rulesFrom({ startMoney: 90000 }))).toBe(true);
    const go = (pick: string | null) => startNewGame(pick, stageNewGameTuning, () => undefined);
    expect(go('Rich')).toBeNull();
    expect(JSON.parse(session.getItem(NEW_GAME_TUNING_KEY)!).startMoney).toBe(90000);
    expect(go(null)).toBeNull();
    expect(session.getItem(NEW_GAME_TUNING_KEY)).toBeNull();
  });

  it('starts nothing and reports the pick when sessionStorage refuses the staging', () => {
    expect(saveRulePreset('Rich')).toBe(true);
    const denied = () => {
      throw new Error('denied');
    };
    vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: denied, removeItem: denied });
    for (const pick of ['Rich', null]) {
      const log: string[] = [];
      const said = startNewGame(pick, stageNewGameTuning, () => log.push('newGame'));
      expect(log, String(pick)).toEqual([]);
      expect(said, String(pick)).toBe(STR.menu.tuningUnusable(pick ?? STR.menu.shippedRules));
    }
  });
});
