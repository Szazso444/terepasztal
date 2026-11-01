import { describe, it, expect } from 'vitest';
import { STR } from '../strings';
import { CONTENT_KEYS, changedTables, content, type ContentBundle } from '../data/content';
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
    expect(read).toEqual({ ok: true, tables: ['wagons'], skipped: [] });
    expect(draft.wagons).toEqual(wagons);
    expect(draft.locomotives).toBe(before);
  });

  it('says how many tables came in, the keys it does not know being no tables', () => {
    const draft = clone(content);
    const text = JSON.stringify({ cargo: draft.cargo, decor: draft.decor, nothing: 1 });
    const read = importBundle(draft, text);
    expect(read).toEqual({ ok: true, tables: ['cargo', 'decor'], skipped: [] });
  });

  it('passes over the gacha table of a bundle exported before the gacha left', () => {
    const draft = clone(content);
    const wagons = [{ ...draft.wagons[0], name: 'Imported' }];
    const text = JSON.stringify({ wagons, gacha: { banners: [] } });
    expect(importBundle(draft, text)).toEqual({ ok: true, tables: ['wagons'], skipped: [] });
    expect('gacha' in draft).toBe(false);
  });

  describe('a bundle exported while contracts paid tickets', () => {
    type Row = Record<string, unknown>;
    /** The contracts table as such an export holds it. */
    const exported = () => {
      const t = clone(content.contracts);
      for (const row of t.templates as unknown as Row[]) row.tickets = 2;
      for (const row of t.rarities as unknown as Row[]) row.ticketMul = 3;
      return t;
    };

    it('changes nothing when it was not edited: the contracts stay the shipped table', () => {
      const draft = clone(content);
      const text = JSON.stringify({ contracts: exported() });
      expect(importBundle(draft, text)).toEqual({ ok: true, tables: ['contracts'], skipped: [] });
      expect(changedTables(draft)).toEqual({});
      expect(JSON.stringify(draft.contracts)).not.toMatch(/ticket/i);
    });

    it('keeps an edit, and leaves the ticket fields behind', () => {
      const draft = clone(content);
      const edited = exported();
      edited.cancelFine = 0.5;
      importBundle(draft, JSON.stringify({ contracts: edited }));
      expect(Object.keys(changedTables(draft))).toEqual(['contracts']);
      expect(draft.contracts.cancelFine).toBe(0.5);
      expect(JSON.stringify(draft.contracts)).not.toMatch(/ticket/i);
    });

    it('still leaves out a contracts table of the wrong shape', () => {
      const draft = clone(content);
      expect(importBundle(draft, JSON.stringify({ contracts: [1] }))).toEqual({
        ok: true,
        tables: [],
        skipped: ['contracts'],
      });
      expect(draft.contracts).toEqual(content.contracts);
    });
  });

  it('refuses text that is no JSON object, and changes nothing', () => {
    for (const text of ['', 'not json', '{', '5', 'null', '"wagons"', '[1,2]']) {
      const draft = clone(content);
      expect(importBundle(draft, text), text).toEqual({ ok: false });
      expect(draft, text).toEqual(content);
    }
  });

  it('takes an empty object for a bundle with no tables', () => {
    expect(importBundle(clone(content) as ContentBundle, '{}')).toEqual({
      ok: true,
      tables: [],
      skipped: [],
    });
  });

  it('leaves out a table that is not in the shape of its own: the editor could not draw it', () => {
    const draft = clone(content);
    const locomotives = draft.locomotives;
    const stations = draft.stations;
    const text = JSON.stringify({
      locomotives: 5,
      stations: [1],
      wagons: null,
      cargo: draft.cargo,
    });
    expect(importBundle(draft, text)).toEqual({
      ok: true,
      tables: ['cargo'],
      skipped: ['locomotives', 'wagons', 'stations'],
    });
    expect(draft.locomotives).toBe(locomotives);
    expect(draft.stations).toBe(stations);
  });

  it('takes an object for an object table and a list for a list, whatever is in them', () => {
    const draft = clone(content);
    const read = importBundle(
      draft,
      JSON.stringify({ locomotives: [], stations: { levels: [], defs: [] } }),
    );
    expect(read).toEqual({ ok: true, tables: ['locomotives', 'stations'], skipped: [] });
    expect(draft.locomotives).toEqual([]);
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
    expect(applyState([], summary, 0).disabled).toBe(false);
  });

  it('waits while a box holds a value the form refused: the draft has none of it', () => {
    const one = applyState([], summary, 1);
    expect(one.disabled).toBe(true);
    expect(one.note).toBe(STR.content.refusedValues(1));
    expect(applyState([], summary, 3).note).toBe(STR.content.refusedValues(3));
    // the refused value is named before the draft's own problems: it is what the player sees red
    expect(applyState(['a: bad'], summary, 2).note).toBe(STR.content.refusedValues(2));
    expect(STR.content.refusedValues(1)).not.toBe(STR.content.refusedValues(2));
  });

  it('does not promise a save the screen does not make: it says a game in play is saved', () => {
    expect(STR.content.applyNote).toMatch(/game in play/);
    expect(STR.content.applyNote).not.toMatch(/current game/);
  });
});

describe('the name of an entry', () => {
  it('is its id, else its name, else its place in the list', () => {
    expect(entryName({ id: 'rocket', name: 'Rocket' }, 3)).toBe('rocket');
    expect(entryName({ name: 'Rocket' }, 3)).toBe('Rocket');
    expect(entryName({}, 3)).toBe('3');
  });
});
