import { describe, expect, it } from 'vitest';
import {
  CREDITS,
  creditProblems,
  requiredCredits,
  thanksByAuthor,
  vehicleNames,
  type CreditsData,
} from './credits';

const sample: CreditsData = {
  licences: {
    by: { name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/', required: true },
    gml: { name: 'GML', url: 'https://example.org/gml', required: false },
  },
  credits: [
    { kind: 'm', vehicles: ['a'], title: 'Zed', author: 'bob', url: 'https://x/1', licence: 'gml' },
    { kind: 'm', vehicles: ['b'], title: 'Yak', author: 'Ann', url: 'https://x/2', licence: 'by' },
    { kind: 'm', vehicles: ['c'], title: 'Xi', author: 'Bob', url: 'https://x/3', licence: 'gml' },
    { kind: 'm', vehicles: ['d'], title: 'Wu', author: 'bob', url: 'https://x/4', licence: 'gml' },
  ],
};

describe('credits', () => {
  it('the shipped credits file is sound', () => {
    expect(creditProblems(CREDITS)).toEqual([]);
    expect(CREDITS.credits.length).toBeGreaterThan(0);
  });

  it('every licence that asks for credit is shown with its own entry', () => {
    expect(requiredCredits(sample).map((c) => c.title)).toEqual(['Yak']);
  });

  it('the thanks list groups by author, sorted, keeping the file order inside a group', () => {
    const g = thanksByAuthor(sample);
    expect(g.map((x) => x.author)).toEqual(['bob', 'Bob']);
    expect(g[0].credits.map((c) => c.title)).toEqual(['Zed', 'Wu']);
  });

  it('a credit with an unknown licence is reported and counted as required', () => {
    const bad: CreditsData = {
      ...sample,
      credits: [{ ...sample.credits[0], licence: 'nope', url: 'http://x' }],
    };
    expect(requiredCredits(bad)).toHaveLength(1);
    expect(creditProblems(bad)).toHaveLength(2);
  });

  it('vehicle names leave out ids the game does not have', () => {
    const names: Record<string, string> = { a: 'Alpha' };
    expect(vehicleNames({ ...sample.credits[0], vehicles: ['x', 'a'] }, (id) => names[id])).toEqual(
      ['Alpha'],
    );
  });
});
