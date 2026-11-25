import { describe, it, expect } from 'vitest';
import { RULE_META } from '../sim/rules';
import { clampToRange, parseNumber } from './kit';
import { groupRules, isChanged, splitInTwo } from './tuningModel';

describe('the rules by group', () => {
  it('keeps the groups in the order they first appear and the rules in their own', () => {
    const groups = groupRules([
      { group: 'B', n: 1 },
      { group: 'A', n: 2 },
      { group: 'B', n: 3 },
      { group: 'C', n: 4 },
      { group: 'A', n: 5 },
    ]);
    expect(groups.map((g) => g.name)).toEqual(['B', 'A', 'C']);
    expect(groups.map((g) => g.rules.map((r) => r.n))).toEqual([[1, 3], [2, 5], [4]]);
    expect(groupRules([])).toEqual([]);
  });

  it('puts every rule of the game on the screen once, in a group of its own name', () => {
    const groups = groupRules(RULE_META);
    expect(groups.reduce((n, g) => n + g.rules.length, 0)).toBe(RULE_META.length);
    for (const g of groups) for (const r of g.rules) expect(r.group).toBe(g.name);
    expect(new Set(groups.map((g) => g.name)).size).toBe(groups.length);
    expect(new Set(RULE_META.map((m) => m.key)).size).toBe(RULE_META.length);
  });
});

describe('the two columns of the Tuning screen', () => {
  it('cuts blocks that read in order where the taller column is shortest', () => {
    expect(splitInTwo([5, 5])).toBe(1);
    expect(splitInTwo([10, 1, 1, 1])).toBe(1);
    expect(splitInTwo([1, 1, 1, 10])).toBe(3);
    expect(splitInTwo([4, 3, 3, 4])).toBe(2);
  });

  it('puts everything in the left column when it is one block or none', () => {
    expect(splitInTwo([])).toBe(0);
    expect(splitInTwo([7])).toBe(0);
  });

  it('is never worse than the whole in one column, and takes the earlier cut when two tie', () => {
    const heights = [5, 3, 2, 8, 1];
    const cut = splitInTwo(heights);
    const total = heights.reduce((a, b) => a + b, 0);
    const left = heights.slice(0, cut).reduce((a, b) => a + b, 0);
    expect(Math.max(left, total - left)).toBeLessThan(total);
    // [2, 2]: a cut of one and a cut that leaves one side empty are not the same
    expect(splitInTwo([2, 2])).toBe(1);
    expect(splitInTwo([1, 1, 1, 1])).toBe(2);
  });

  it('balances the real rules: the presets (5 rows) and the groups, neither column far taller', () => {
    const heights = [5, ...groupRules(RULE_META).map((g) => g.rules.length + 1)];
    const cut = splitInTwo(heights);
    const left = heights.slice(0, cut).reduce((a, b) => a + b, 0);
    const right = heights.slice(cut).reduce((a, b) => a + b, 0);
    expect(cut).toBeGreaterThan(0);
    expect(cut).toBeLessThan(heights.length);
    expect(Math.abs(left - right)).toBeLessThanOrEqual(Math.max(...heights));
  });
});

describe('a rule marked as changed', () => {
  it('is one whose value is not the shipped one', () => {
    expect(isChanged(1, 1)).toBe(false);
    expect(isChanged(1.25, 1)).toBe(true);
    expect(isChanged(0, 0)).toBe(false);
  });
});

describe('a value typed beside a slider', () => {
  const range = { min: 0, max: 5 };

  it('keeps its digits: it is not taken to the track steps', () => {
    expect(parseNumber('1.234', range, 1)).toBe(1.234);
    expect(parseNumber(' 40000 ', { min: 0, max: 1e6 }, 1)).toBe(40000);
    // the track itself does snap, which is why the typed value takes no step
    expect(clampToRange(1.234, { ...range, step: 0.1 })).toBe(1.2);
  });

  it('stays in the rule range, and what is no number leaves the value as it was', () => {
    expect(parseNumber('99', range, 1)).toBe(5);
    expect(parseNumber('-3', range, 1)).toBe(0);
    expect(parseNumber('abc', range, 1.5)).toBe(1.5);
    expect(parseNumber('', range, 1.5)).toBe(1.5);
  });
});
