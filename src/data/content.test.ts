import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContentBundle, ContentKey } from './content';

type ContentModule = typeof import('./content');
type Table = Record<string, unknown>;

const KEY = 'terepasztal.content';

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** A Storage over a map, holding `value` under the overrides key. */
function memoryStorage(value?: unknown) {
  const m = new Map<string, string>();
  if (value !== undefined) m.set(KEY, typeof value === 'string' ? value : JSON.stringify(value));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}

/** A fresh content module, loaded with `value` stored under the overrides key. */
async function load(value?: unknown): Promise<ContentModule> {
  vi.stubGlobal('localStorage', memoryStorage(value));
  vi.resetModules();
  return import('./content');
}

/** The module as it loads with nothing stored. */
let shipped: ContentModule;

/** A stored value in the current format, every table stamped with its current shipped stamp. */
function stamped(tables: Partial<Record<ContentKey, unknown>>, stamp?: string) {
  const out: Record<string, { stamp: string; data: unknown }> = {};
  for (const [k, data] of Object.entries(tables))
    out[k] = { stamp: stamp ?? shipped.contentStamp(k as ContentKey), data };
  return { format: 2, tables: out };
}

/** The shipped locomotives with one number changed. */
function editedLocomotives() {
  const locos = clone(shipped.DEFAULT_CONTENT.locomotives);
  locos[0].speed += 1;
  return locos;
}

function warnedAbout(key: string) {
  return vi.mocked(console.warn).mock.calls.some((c) => String(c[0]).includes(`"${key}"`));
}

beforeEach(async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  shipped = await load();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('a bad stored override never stops the load', () => {
  it.each(['{"contracts":{}}', '{"locomotives":null}', '{"stations":{"defs":[]}}', '{"track":{}}'])(
    'old whole-bundle value %s: shipped tables, set aside as stale, kept in storage',
    async (raw) => {
      const mod = await load(raw);
      expect(mod.content).toEqual(shipped.content);
      const key = Object.keys(JSON.parse(raw) as Table)[0];
      expect(mod.contentOverrideReport()).toEqual({
        applied: [],
        setAside: [{ key, reason: 'stale', problems: [] }],
      });
      expect(mod.contentIsCustom()).toBe(false);
      expect(warnedAbout(key)).toBe(true);
      expect(localStorage.getItem(KEY)).toBe(raw);
    },
  );

  it.each([
    ['contracts', {}],
    ['locomotives', null],
    ['stations', { defs: [] }],
    ['track', {}],
    ['houses', 'x'],
    ['cargo', [null]],
    ['gacha', { banners: [{ id: 'b', pool: null }], rates: null }],
  ] as [ContentKey, unknown][])(
    'current-stamped %s table of the wrong shape: shipped tables, set aside as invalid',
    async (key, data) => {
      const mod = await load(stamped({ [key]: data }));
      expect(mod.content).toEqual(shipped.content);
      const { applied, setAside } = mod.contentOverrideReport();
      expect(applied).toEqual([]);
      expect(setAside.map((s) => [s.key, s.reason])).toEqual([[key, 'invalid']]);
      expect(setAside[0].problems.length).toBeGreaterThan(0);
      expect(warnedAbout(key)).toBe(true);
    },
  );

  it.each([
    'not json{',
    '[]',
    '42',
    '{"format":2}',
    '{"format":2,"tables":{"locomotives":5}}',
    '{"format":2,"tables":{"locomotives":{"data":[]}}}',
    '{"format":3,"tables":{"locomotives":{"stamp":"0","data":[]}}}',
  ])('stored value %s: shipped tables', async (raw) => {
    const mod = await load(raw);
    expect(mod.content).toEqual(shipped.content);
    expect(mod.contentIsCustom()).toBe(false);
    expect(mod.contentOverrideReport().applied).toEqual([]);
  });
});

describe('validateContent', () => {
  it('passes the shipped tables', () => {
    expect(shipped.validateContent(shipped.DEFAULT_CONTENT)).toEqual([]);
  });

  it('requires contract rarities and every station level table', () => {
    const noRarities = clone(shipped.DEFAULT_CONTENT) as unknown as { contracts: Table };
    delete noRarities.contracts.rarities;
    expect(shipped.validateContent(noRarities as unknown as ContentBundle)).not.toEqual([]);
    for (const k of Object.keys(shipped.DEFAULT_CONTENT.stations.levels)) {
      const b = clone(shipped.DEFAULT_CONTENT) as unknown as { stations: { levels: Table } };
      delete b.stations.levels[k];
      expect(shipped.validateContent(b as unknown as ContentBundle), k).not.toEqual([]);
    }
  });

  it('reports a table of the wrong shape instead of throwing', () => {
    for (const k of shipped.CONTENT_KEYS)
      for (const v of [null, 42, 'x', {}, [null]]) {
        const b = { ...shipped.DEFAULT_CONTENT, [k]: v } as ContentBundle;
        expect(() => shipped.validateContent(b), `${k} = ${JSON.stringify(v)}`).not.toThrow();
        expect(shipped.validateContent(b), `${k} = ${JSON.stringify(v)}`).not.toEqual([]);
      }
    expect(shipped.validateContent(null as unknown as ContentBundle)).not.toEqual([]);
  });

  it('reports missing or malformed fields inside a table instead of throwing', () => {
    const breaks: ((b: Table & ContentBundle) => void)[] = [
      (b) => ((b.stations.defs[0] as unknown as Table).accepts = null),
      (b) => ((b.stations.defs[0] as unknown as Table).produces = [null]),
      (b) => ((b.stations as unknown as Table).levels = null),
      (b) => (b.stations.levels.capacity = b.stations.levels.capacity.slice(0, -1)),
      (b) => ((b.buildings[0] as unknown as Table).recipe = null),
      (b) => ((b.buildings[0].recipe as unknown as Table).in = 'coal'),
      (b) => ((b.gacha.banners[0] as unknown as Table).pool = null),
      (b) => ((b.gacha as unknown as Table).rates = { N: '1' }),
      (b) => ((b.track as unknown as Table).pieces = null),
      (b) => ((b.track.pieces as unknown as Table)[Object.keys(b.track.pieces)[0]] = null),
      (b) => ((b.contracts as unknown as Table).templates = null),
      (b) => ((b.contracts.rarities as unknown[])[0] = null),
      (b) => ((b.contracts.rarities[0] as unknown as Table).weight = 'heavy'),
      (b) => ((b.locomotives[0] as unknown as Table).id = null),
      (b) => ((b.crafting as unknown as Table).ownedRefund = null),
    ];
    breaks.forEach((brk, i) => {
      const b = clone(shipped.DEFAULT_CONTENT) as Table & ContentBundle;
      brk(b);
      expect(() => shipped.validateContent(b), `break ${i}`).not.toThrow();
      expect(shipped.validateContent(b), `break ${i}`).not.toEqual([]);
    });
  });
});

describe('stamps', () => {
  it('are short hex hashes, one per table, and the same whatever loads', async () => {
    const stamps = shipped.CONTENT_KEYS.map((k) => shipped.contentStamp(k));
    for (const s of stamps) expect(s).toMatch(/^[0-9a-f]{8}$/);
    expect(new Set(stamps).size).toBe(stamps.length);
    // a session running on an edited table still stamps from the shipped files
    const mod = await load(stamped({ locomotives: editedLocomotives() }));
    expect(mod.contentIsCustom()).toBe(true);
    expect(mod.CONTENT_KEYS.map((k) => mod.contentStamp(k))).toEqual(stamps);
  });
});

describe('applying stored tables', () => {
  it('applies a locomotives table stamped with the current shipped table', async () => {
    const locos = editedLocomotives();
    const mod = await load(stamped({ locomotives: locos }));
    expect(mod.content.locomotives).toEqual(locos);
    expect(mod.contentOverrideReport()).toEqual({ applied: ['locomotives'], setAside: [] });
    expect(mod.contentIsCustom()).toBe(true);
    for (const k of mod.CONTENT_KEYS)
      if (k !== 'locomotives') expect(mod.content[k], k).toEqual(shipped.content[k]);
  });

  it('sets aside the same table stamped from another shipped table, and keeps it stored', async () => {
    const other = shipped.contentStamp('locomotives') === '00000000' ? '00000001' : '00000000';
    const value = stamped({ locomotives: editedLocomotives() }, other);
    const mod = await load(value);
    expect(mod.content.locomotives).toEqual(shipped.content.locomotives);
    expect(mod.contentOverrideReport()).toEqual({
      applied: [],
      setAside: [{ key: 'locomotives', reason: 'stale', problems: [] }],
    });
    expect(mod.contentIsCustom()).toBe(false);
    expect(warnedAbout('locomotives')).toBe(true);
    expect(localStorage.getItem(KEY)).toBe(JSON.stringify(value));
  });

  it('applies a valid table and sets aside an invalid one stored with it', async () => {
    const locos = editedLocomotives();
    const houses = { ...clone(shipped.DEFAULT_CONTENT.houses), capacity: [] };
    const mod = await load(stamped({ locomotives: locos, houses }));
    expect(mod.content.locomotives).toEqual(locos);
    expect(mod.content.houses).toEqual(shipped.content.houses);
    const report = mod.contentOverrideReport();
    expect(report.applied).toEqual(['locomotives']);
    expect(report.setAside.map((s) => [s.key, s.reason])).toEqual([['houses', 'invalid']]);
    expect(report.setAside[0].problems.length).toBeGreaterThan(0);
    expect(mod.contentIsCustom()).toBe(true);
  });

  it('applies tables that only validate together', async () => {
    const locos = clone(shipped.DEFAULT_CONTENT.locomotives);
    locos.push({ ...locos[0], id: 'test_loco', starter: false });
    const gacha = clone(shipped.DEFAULT_CONTENT.gacha);
    gacha.banners[0].pool.push('test_loco');
    const mod = await load(stamped({ locomotives: locos, gacha }));
    expect(mod.contentOverrideReport()).toEqual({
      applied: ['locomotives', 'gacha'],
      setAside: [],
    });
    expect(mod.content.gacha.banners[0].pool).toContain('test_loco');
  });

  it('sets aside a table that breaks a shipped one and keeps the tables valid without it', async () => {
    const used = shipped.DEFAULT_CONTENT.stations.defs.flatMap((s) => s.accepts)[0];
    const cargo = clone(shipped.DEFAULT_CONTENT.cargo).filter((c) => c.id !== used);
    const stations = clone(shipped.DEFAULT_CONTENT.stations);
    stations.defs[0].flavor += ' (edited)';
    const mod = await load(stamped({ cargo, stations }));
    const report = mod.contentOverrideReport();
    expect(report.applied).toEqual(['stations']);
    expect(report.setAside.map((s) => [s.key, s.reason])).toEqual([['cargo', 'invalid']]);
    expect(report.setAside[0].problems.some((p) => p.includes(`"${used}"`))).toBe(true);
    expect(mod.content.stations).toEqual(stations);
    expect(mod.content.cargo).toEqual(shipped.content.cargo);
  });

  it('sets aside a broken table and applies a table that refers to it once it is gone', async () => {
    const stations = clone(shipped.DEFAULT_CONTENT.stations);
    stations.defs[0].flavor += ' (edited)';
    const mod = await load(stamped({ cargo: null, stations }));
    const report = mod.contentOverrideReport();
    expect(report.applied).toEqual(['stations']);
    expect(report.setAside.map((s) => [s.key, s.reason])).toEqual([['cargo', 'invalid']]);
  });
});

describe('writing overrides', () => {
  it('stores only the changed tables, each with the current stamp', () => {
    const draft = clone(shipped.content);
    draft.locomotives[0].speed += 1;
    expect(shipped.changedTables(draft)).toEqual({ locomotives: draft.locomotives });
    expect(shipped.writeContentOverrides(draft)).toBe(true);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({
      format: 2,
      tables: {
        locomotives: { stamp: shipped.contentStamp('locomotives'), data: draft.locomotives },
      },
    });
  });

  it('takes no notice of derived wagon accept lists', () => {
    const draft = clone(shipped.content);
    expect(draft.wagons.some((w) => w.accepts?.length)).toBe(true);
    expect(shipped.changedTables(draft)).toEqual({});
  });

  it('applies what it wrote on the next load', async () => {
    const draft = clone(shipped.content);
    draft.wagons[0].capacity += 5;
    shipped.writeContentOverrides(draft);
    const mod = await load(localStorage.getItem(KEY)!);
    expect(mod.contentOverrideReport()).toEqual({ applied: ['wagons'], setAside: [] });
    expect(mod.content.wagons).toEqual(draft.wagons);
  });

  it('clears the stored value when nothing differs from the shipped tables', async () => {
    const mod = await load(stamped({ locomotives: editedLocomotives() }, '00000000'));
    expect(mod.writeContentOverrides(clone(mod.content))).toBe(true);
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(mod.readContentOverrides()).toBeNull();
  });

  it('reads back the stored tables whether or not they applied', async () => {
    const locos = editedLocomotives();
    const mod = await load(stamped({ locomotives: locos }, '00000000'));
    expect(mod.readContentOverrides()).toEqual({ locomotives: locos });
  });
});
