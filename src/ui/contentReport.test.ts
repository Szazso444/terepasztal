import { describe, it, expect } from 'vitest';
import { STR } from '../strings';
import { CONTENT_KEYS, type ContentOverrideReport } from '../data/content';
import { problemSummary, setAsideLines } from './contentReport';

const problems = (key: string, n: number) => Array.from({ length: n }, (_, i) => `${key}: p${i}`);

describe('the set-aside lines of the content editor', () => {
  it('says nothing when every stored table loaded', () => {
    expect(setAsideLines({ applied: ['locomotives'], setAside: [] })).toEqual([]);
    expect(setAsideLines({ applied: [], setAside: [] })).toEqual([]);
  });

  it('gives each set-aside table one line, in order, naming its tab', () => {
    const report: ContentOverrideReport = {
      applied: ['wagons'],
      setAside: [
        { key: 'cargo', reason: 'stale', problems: [] },
        { key: 'stations', reason: 'invalid', problems: problems('stations', 1) },
        { key: 'houses', reason: 'stale', problems: [] },
      ],
    };
    const lines = setAsideLines(report);
    expect(lines.map((l) => l.key)).toEqual(['cargo', 'stations', 'houses']);
    for (const l of lines) expect(l.text).toContain(STR.content.tabs[l.key]);
    // an applied table is not set aside
    expect(lines.some((l) => l.key === 'wagons')).toBe(false);
  });

  it('tells a stale edit from an invalid one', () => {
    for (const key of CONTENT_KEYS) {
      const [stale] = setAsideLines({
        applied: [],
        setAside: [{ key, reason: 'stale', problems: [] }],
      });
      const [invalid] = setAsideLines({
        applied: [],
        setAside: [{ key, reason: 'invalid', problems: problems(key, 1) }],
      });
      expect(stale.kind).toBe('warn');
      expect(invalid.kind).toBe('bad');
      expect(stale.text).not.toBe(invalid.text);
    }
  });

  it('shows the first problems of an invalid table and counts the rest', () => {
    const list = problems('cargo', 7);
    const [line] = setAsideLines({
      applied: [],
      setAside: [{ key: 'cargo', reason: 'invalid', problems: list }],
    });
    expect(line.text).toContain(list[0]);
    expect(line.text).not.toContain(list[list.length - 1]);
    const shown = list.filter((p) => line.text.includes(p)).length;
    expect(shown).toBeGreaterThan(0);
    expect(line.text).toContain(String(list.length - shown));
  });

  it('keeps an invalid line readable without problems', () => {
    const [line] = setAsideLines({
      applied: [],
      setAside: [{ key: 'track', reason: 'invalid', problems: [] }],
    });
    expect(line.text).toContain(STR.content.tabs.track);
    expect(line.text).not.toMatch(/\(\s*\)|:\s*$/);
  });
});

describe('a problem summary', () => {
  it('lists up to the cap and counts what it leaves out', () => {
    expect(problemSummary([], 4)).toBe('');
    const list = ['a', 'b', 'c', 'd', 'e', 'f'];
    const s = problemSummary(list, 4);
    for (const p of list.slice(0, 4)) expect(s).toContain(p);
    for (const p of list.slice(4)) expect(s).not.toContain(p);
    expect(s).toContain('2');
    expect(problemSummary(list.slice(0, 4), 4)).not.toContain('+');
  });
});
