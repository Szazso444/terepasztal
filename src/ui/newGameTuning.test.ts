import { describe, it, expect } from 'vitest';
import { STR } from '../strings';
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
