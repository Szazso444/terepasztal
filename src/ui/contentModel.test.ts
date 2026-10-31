import { describe, it, expect } from 'vitest';
import { STR } from '../strings';
import { CONTENT_KEYS, content, type ContentBundle } from '../data/content';
import { TRANSFER, applyState, contentTabs, entryName, importBundle } from './contentModel';
import { problemSummary } from './contentReport';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe('the Content editor strip', () => {
  it('has a tab for every table in the order the game keeps them, then Transfer', () => {
    const tabs = contentTabs([]);
    expect(tabs.map((t) => t.id)).toEqual([...CONTENT_KEYS, TRANSFER]);
    expect(tabs.slice(0, -1).map((t) => t.label)).toEqual(
      CONTENT_KEYS.map((k) => STR.content.tabs[k]),
    );
    expect(tabs[tabs.length - 1].label).toBe(STR.content.transfer);
  });

  it('marks the tables that run on a stored edit, and only them', () => {
    const tabs = contentTabs(['wagons', 'cargo']);
    expect(tabs.filter((t) => t.mark).map((t) => t.id)).toEqual(['wagons', 'cargo']);
    expect(tabs.find((t) => t.id === 'wagons')?.mark).toBe(STR.content.customTab);
    expect(contentTabs([]).some((t) => t.mark)).toBe(false);
  });
});

describe('bringing a bundle in as text', () => {
  it('replaces the tables the text holds, each in its own place, and leaves the others', () => {
    const draft = clone(content);
    const wagons = [{ ...draft.wagons[0], name: 'Imported' }];
    const before = draft.locomotives;
    const read = importBundle(draft, JSON.stringify({ wagons }));
    expect(read).toEqual({ ok: true, tables: ['wagons'] });
    expect(draft.wagons).toEqual(wagons);
    expect(draft.locomotives).toBe(before);
  });

  it('says how many tables came in, the keys it does not know being no tables', () => {
    const draft = clone(content);
    const text = JSON.stringify({ cargo: draft.cargo, decor: draft.decor, nothing: 1 });
    const read = importBundle(draft, text);
    expect(read).toEqual({ ok: true, tables: ['cargo', 'decor'] });
  });

  it('refuses text that is no JSON object, and changes nothing', () => {
    for (const text of ['', 'not json', '{', '5', 'null', '"wagons"', '[1,2]']) {
      const draft = clone(content);
      expect(importBundle(draft, text), text).toEqual({ ok: false });
      expect(draft, text).toEqual(content);
    }
  });

  it('takes an empty object for a bundle with no tables', () => {
    expect(importBundle(clone(content) as ContentBundle, '{}')).toEqual({ ok: true, tables: [] });
  });
});

describe('what Apply says', () => {
  const summary = (p: string[]) => problemSummary(p, 4);

  it('waits while the draft has problems, and names them', () => {
    const state = applyState(['a: bad', 'b: bad'], summary);
    expect(state.disabled).toBe(true);
    expect(state.note).toBe('a: bad · b: bad');
  });

  it('counts the problems past the fourth rather than listing them', () => {
    const state = applyState(['1', '2', '3', '4', '5', '6'], summary);
    expect(state.note).toBe('1 · 2 · 3 · 4 (+2)');
  });

  it('says what applying does when there is nothing wrong', () => {
    expect(applyState([], summary)).toEqual({ disabled: false, note: STR.content.applyNote });
  });
});

describe('the name of an entry', () => {
  it('is its id, else its name, else its place in the list', () => {
    expect(entryName({ id: 'rocket', name: 'Rocket' }, 3)).toBe('rocket');
    expect(entryName({ name: 'Rocket' }, 3)).toBe('Rocket');
    expect(entryName({}, 3)).toBe('3');
  });
});
