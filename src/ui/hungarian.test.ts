import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import biomeJson from '../data/biomes.json';
import { DEFAULT_CONTENT } from '../data/content';
import { HU_MIGRATIONS, HU_NAMES, HU_RULES, HU_RULE_GROUPS } from '../data/names.hu';
import { MIGRATIONS, SETTINGS_KEY, readSettings } from '../sim/save';
import { RULE_META } from '../sim/rules';
import { ENGLISH, languageOf, type Strings } from '../strings';
import { HU } from '../strings.hu';

/** A table walked to its leaves, each under the path of keys that leads to it. */
function leaves(node: unknown, path = '', out = new Map<string, unknown>()) {
  if (node && typeof node === 'object')
    for (const [k, v] of Object.entries(node)) leaves(v, path ? `${path}.${k}` : k, out);
  else out.set(path, node);
  return out;
}
const english = leaves(ENGLISH);
const hungarian = leaves(HU);

/** The stored settings a page load finds, in a storage of its own. */
function storing(settings: unknown) {
  const items = new Map<string, string>();
  if (settings !== undefined) items.set(SETTINGS_KEY, JSON.stringify(settings));
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => items.set(k, v),
    removeItem: (k: string) => items.delete(k),
  });
  return items;
}
/** A fresh copy of a module, as a page load in the language of the stored settings reads it. */
async function loaded<T>(language: string, load: () => Promise<T>): Promise<T> {
  vi.resetModules();
  storing({ language });
  return load();
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('the Hungarian table has the shape of the English one', () => {
  it('holds every key and no other, down to the last array', () => {
    expect([...hungarian.keys()].sort()).toEqual([...english.keys()].sort());
  });

  it('holds a text for a text and a function for a function, of as many arguments', () => {
    for (const [path, en] of english) {
      const hu = hungarian.get(path);
      expect(typeof hu, path).toBe(typeof en);
      if (typeof en === 'function') expect((hu as () => void).length, path).toBe(en.length);
    }
  });

  it('is a type error with a key missing or added, or a function of the wrong signature', () => {
    // @ts-expect-error a key is missing
    const a: Strings = { title: 'x' };
    // @ts-expect-error a key is added
    const b: Strings = { ...HU, added: 'x' };
    // @ts-expect-error the function takes a number
    const c: Strings['hud']['day'] = (d: string) => d;
    expect([a, b, c].length).toBe(3);
  });

  it('keeps every {slot} of a template', () => {
    const slots = (s: string) => [...s.matchAll(/\{\w+\}/g)].map((m) => m[0]).sort();
    for (const [path, en] of english)
      if (typeof en === 'string')
        expect(slots(hungarian.get(path) as string), path).toEqual(slots(en));
  });

  it('says in a function what the English one says, whichever way it fills it', () => {
    const called = (fn: unknown, args: unknown[]) => {
      try {
        const out = (fn as (...a: unknown[]) => unknown)(...args);
        return typeof out === 'string' ? out : Array.isArray(out) ? out.join('\n') : null;
      } catch {
        return null;
      }
    };
    for (const [path, en] of english) {
      if (typeof en !== 'function') continue;
      const hu = hungarian.get(path);
      let spoke = false;
      let heard = false;
      for (const stand of [
        ['aaa1', 'bbb2', 'ccc3', 'ddd4', 'eee5'],
        [7011, 7022, 7033, 7044, 7055],
      ]) {
        const said = called(en, stand);
        if (said === null) continue;
        spoke = true;
        const huSaid = called(hu, stand);
        // a text stand-in where a number goes: the round of numbers checks that function
        if (huSaid === null || huSaid.includes('NaN')) continue;
        heard = true;
        for (const s of stand)
          if (said.toLowerCase().includes(String(s)))
            expect(huSaid.toLowerCase(), `${path} loses ${s}`).toContain(String(s));
      }
      expect(heard, `${path} says nothing`).toBe(spoke);
    }
  });

  it('words a text of its own, but for what is the same in both languages', () => {
    const same = new Set(
      [...english]
        .filter(([path, en]) => typeof en === 'string' && hungarian.get(path) === en)
        .map(([, en]) => en as string),
    );
    expect([...same].sort()).toEqual(SAME_IN_BOTH);
  });

  it('reads as the mock writes it', () => {
    expect(HU.hud.day(14)).toBe('14. nap');
    expect(HU.saves.ago(30_000)).toBe('az imént');
    expect(HU.saves.ago(5 * 60_000)).toBe('5 perce');
    expect(HU.saves.ago(3 * 3_600_000)).toBe('3 órája');
    expect(HU.saves.ago(2 * 86_400_000)).toBe('2 napja');
    expect(HU.saves.detail(3, HU.ages.name.steam, '1\u00a0000\u00a0$')).toBe(
      '3. nap · Gőzkorszak · 1\u00a0000\u00a0$',
    );
    expect(HU.hud.ageUp(1)).toContain('Dízelkorszak');
    expect(HU.build.tierLocked(2)).toContain('Villamos korszak');
    expect(HU.overview.price(40_000)).toBe('40\u00a0000\u00a0$');
    expect(HU.compat.runsOn('Fregatt', ['Mellékvonal'])).toBe('Fregatt · Mellékvonal pályán jár');
    expect(HU.history.demolishedTiles(4, 'sín')).toBe('Lebontva: sín, 4 csempe');
    expect(HU.town.needs(true, true)).toContain('egy lakóház és egy raktár');
    expect(HU.town.needs(false, true)).toContain('kell egy raktár 7');
  });
});

describe('the names of the data', () => {
  const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();
  const covers = (texts: object, rows: { id: string }[], fields: string[]) => {
    expect(Object.keys(texts).sort()).toEqual(ids(rows));
    for (const [id, text] of Object.entries(texts))
      expect(Object.keys(text as object).sort(), id).toEqual([...fields].sort());
  };
  const d = DEFAULT_CONTENT;

  it('has an entry for every id of every table, with every text the screen shows', () => {
    covers(HU_NAMES.locomotives, d.locomotives, ['era']);
    covers(HU_NAMES.wagons, d.wagons, ['name', 'era']);
    covers(HU_NAMES.cargo, d.cargo, ['name']);
    covers(HU_NAMES.stations, d.stations.defs, ['name', 'flavor']);
    covers(HU_NAMES.buildings, d.buildings, ['name', 'flavor']);
    covers(HU_NAMES.decor, d.decor, ['name', 'flavor']);
    covers(HU_NAMES.banners, d.gacha.banners, ['name']);
    covers(HU_NAMES.contractTemplates, d.contracts.templates, ['name']);
    covers(HU_NAMES.contractRarities, d.contracts.rarities, ['name']);
    covers(HU_NAMES.biomes, biomeJson, ['name', 'desc']);
    expect(Object.keys(HU_NAMES.trackPieces).sort()).toEqual(Object.keys(d.track.pieces).sort());
  });

  it('gives no engine a name: a proper name stays as it is', () => {
    for (const text of Object.values(HU_NAMES.locomotives)) expect(text).not.toHaveProperty('name');
  });

  it('has a row for every tuning value, its hint and its group', () => {
    expect(Object.keys(HU_RULES).sort()).toEqual(RULE_META.map((m) => m.key as string).sort());
    for (const m of RULE_META) {
      expect(!!HU_RULES[m.key].hint, `${m.key} hint`).toBe(!!m.hint);
      expect(HU_RULE_GROUPS[m.group], m.group).toBeTruthy();
    }
  });

  it('has a note for every step of the save format', () => {
    expect(Object.keys(HU_MIGRATIONS).map(Number)).toEqual(MIGRATIONS.map((m) => m.from));
  });
});

describe('the language setting', () => {
  it('is English with no settings file and for an older one', () => {
    storing(undefined);
    expect(readSettings().language).toBe('en');
    storing({ master: 0.4 });
    expect(readSettings().language).toBe('en');
    expect(readSettings().master).toBe(0.4);
  });

  it('keeps Hungarian, and takes anything it does not know for English', () => {
    storing({ language: 'hu' });
    expect(readSettings().language).toBe('hu');
    storing({ language: 'de' });
    expect(readSettings().language).toBe('en');
    expect(languageOf(undefined)).toBe('en');
    expect(languageOf('hu')).toBe('hu');
  });

  it('chooses the strings as the page loads, and an unreadable file leaves it English', async () => {
    const hu = await loaded('hu', () => import('../strings'));
    expect(hu.LANGUAGE).toBe('hu');
    expect(hu.STR.menu.continue).toBe('Folytatás');
    const en = await loaded('en', () => import('../strings'));
    expect(en.STR.menu.continue).toBe('Continue');
    vi.resetModules();
    vi.stubGlobal('localStorage', { getItem: () => '{not json' });
    expect((await import('../strings')).LANGUAGE).toBe('en');
  });
});

describe('a game in Hungarian', () => {
  const modules = () =>
    Promise.all([
      import('../data/content'),
      import('../sim/stations'),
      import('../sim/contracts'),
      import('../sim/biomes'),
      import('../sim/rules'),
      import('../sim/cargo'),
      import('../sim/stores'),
      import('./numberFormat'),
      import('./noteText'),
      import('../strings'),
    ]);

  it('reads the data in Hungarian, and the engines under their own names', async () => {
    const [{ content, dataName, sourceContent }, , , biomes, rules, cargo, stores] = await loaded(
      'hu',
      modules,
    );
    const wheat = content.cargo.find((c) => c.id === 'wheat')!;
    expect(wheat.name).toBe('Búza');
    expect(dataName(wheat)).toBe('Wheat');
    expect(cargo.cargoName('wheat')).toBe('Búza');
    expect(cargo.cargoName('power')).toBe('áram');
    expect(content.stations.defs.find((s) => s.id === 'depot')!.name).toBe('Fűtőház');
    expect(content.track.pieces.curve.name).toBe('Ív');
    const rocket = content.locomotives.find((l) => l.id === 'rocket')!;
    expect(rocket.name).toBe("Stephenson's Rocket");
    expect(rocket.era).toContain('Rainhilli');
    expect(biomes.BIOME_DEFS[0].name).toBe('Síkság');
    expect(rules.RULE_META.find((m) => m.key === 'startMoney')!.label).toBe('Kezdő pénz');
    expect(stores.fmtCost({ wood: 3, iron_ore: 2 })).toBe('3 fa, 2 vasérc');
    // the content editor works on the data as it ships, not on what is shown
    expect(sourceContent.cargo.find((c) => c.id === 'wheat')!.name).toBe('Wheat');
  });

  it('leaves a name an edit of the content gave an entry as it is', async () => {
    vi.resetModules();
    const items = storing({ language: 'hu' });
    const base = await import('../data/content');
    const cargo = structuredClone(base.DEFAULT_CONTENT.cargo);
    cargo.find((c) => c.id === 'wheat')!.name = 'Rye';
    base.writeContentOverrides({ cargo });
    expect(items.has(base.CONTENT_KEY)).toBe(true);
    vi.resetModules();
    const { content, sourceContent } = await import('../data/content');
    expect(content.cargo.find((c) => c.id === 'wheat')!.name).toBe('Rye');
    expect(content.cargo.find((c) => c.id === 'coal')!.name).toBe('Szén');
    expect(sourceContent.cargo.find((c) => c.id === 'coal')!.name).toBe('Coal');
  });

  it('shows a default name in Hungarian and keeps it in English', async () => {
    const [, { Station }] = await loaded('hu', modules);
    const farm = new Station('farm', 1, 1);
    expect(farm.name).toBe('Tanyai megálló');
    expect(farm.toJSON().name).toBe('Farm Halt');
    const second = new Station('farm', 2, 1, 'Farm Halt 2');
    expect(second.name).toBe('Tanyai megálló 2');
    expect(second.toLevel().name).toBe('Farm Halt 2');
    const inTown = new Station('station', 3, 1, 'Kisvár Station 2');
    expect(inTown.name).toBe('Kisvár Station 2');
    inTown.townName = 'Kisvár';
    expect(inTown.name).toBe('Kisvár állomás 2');
  });

  it('never touches a name the player gave', async () => {
    const [, { Station }] = await loaded('hu', modules);
    const s = new Station('station', 1, 1, 'Grand Central Station');
    s.townName = 'Kisvár';
    expect(s.name).toBe('Grand Central Station');
    s.name = 'Nagyállomás';
    expect(s.name).toBe('Nagyállomás');
    expect(s.toJSON().name).toBe('Nagyállomás');
  });

  it('writes a contract and a train note in Hungarian from what the world keeps', async () => {
    const m = await loaded('hu', modules);
    const { contractTitle } = m[2];
    const { noteText } = m[8];
    const { ENGLISH: en, STR } = m[9];
    expect(contractTitle('Local haul')).toBe('Helyi fuvar');
    expect(contractTitle('A contract a mod added')).toBe('A contract a mod added');
    expect(noteText(en.traffic.jammed)).toBe(STR.traffic.jammed);
    expect(noteText(en.trainNote.parked)).toBe(STR.trainNote.parked);
    expect(noteText(en.fleet.mixedGaugeTrain)).toBe(STR.fleet.mixedGaugeTrain);
    expect(noteText(en.trainNote.onContract('Rush order'))).toBe('szerződésen: Sürgős rendelés');
    expect(noteText(en.trainNote.noPlatform('Farm Halt 2'))).toBe(
      'Tanyai megálló 2: nincs peronvágány',
    );
    expect(noteText(en.trainNote.noPlatform('Kisvár Station'))).toBe(
      'Kisvár állomás: nincs peronvágány',
    );
    expect(noteText('')).toBe('');
  });

  it('writes numbers the Hungarian way where the formats are kept in one place', async () => {
    const m = await loaded('hu', modules);
    const { fmtInt, fmtMoney, fmtDuration, fmtDecimal } = m[7];
    expect(fmtInt(1000)).toBe('1\u00a0000');
    expect(fmtMoney(1234567)).toBe('1\u00a0234\u00a0567\u00a0$');
    expect(fmtDecimal(1.5)).toBe('1,5');
    expect(fmtDuration(240 * 4.1)).toBe('4,1 nap');
    expect(fmtDuration(240 * 0.5)).toBe('12 ó 00 p');
  });

  it('bolds a Hungarian number whole in a tooltip', async () => {
    const { richText } = await import('./tooltipDoc');
    expect(richText('Ár: 40\u00a0000\u00a0$')).toEqual(['Ár: ', { num: '40\u00a0000\u00a0$' }]);
    expect(richText('1,5 csempe')).toEqual([{ num: '1,5' }, ' csempe']);
  });

  it('leaves the English formats as they were', async () => {
    const m = await loaded('en', modules);
    const { fmtInt, fmtMoney, fmtDuration, fmtDecimal } = m[7];
    expect(fmtInt(1000)).toBe('1,000');
    expect(fmtMoney(1234567)).toBe('$1,234,567');
    expect(fmtDecimal(1.5)).toBe('1.5');
    expect(fmtDuration(240 * 4.1)).toBe('4.1d');
    expect(m[8].noteText(m[9].ENGLISH.traffic.jammed)).toBe(m[9].ENGLISH.traffic.jammed);
  });
});

describe('nothing in the world depends on the language', () => {
  /** One scripted game: what its domains would write to a save, and an order they keep. */
  async function game(language: string) {
    return loaded(language, async () => {
      const { simWorld, line, station } = await import('../testing/simWorld');
      const w = simWorld({ size: 64, terrain: 'grass' });
      line(w, 8, 20, 50);
      station(w, 'farm', 12, 19);
      station(w, 'farm', 16, 19);
      station(w, 'lumber', 20, 19);
      station(w, 'town', 30, 19);
      station(w, 'station', 34, 19);
      station(w, 'warehouse', 38, 19);
      w.towns.refresh();
      for (let i = 0; i < 6; i++) w.contracts.generate(i, true);
      for (const id of w.inventory.ownedDefs()) w.crafting.recipes.add(id);
      w.crafting.recipes.add('boxcar').add('flatbed').add('steel_hopper').add('wooden_coach');
      return {
        stations: w.builder.stations.map((s) => s.toJSON()),
        level: w.builder.stations.map((s) => s.toLevel()),
        towns: w.towns.toJSON(),
        contracts: w.contracts.toJSON(),
        known: w.crafting.known(),
        shown: w.builder.stations.map((s) => s.name),
      };
    });
  }

  it('saves the same game in either language, and shows it in its own', async () => {
    const { shown: en, ...inEnglish } = await game('en');
    const { shown: hu, ...inHungarian } = await game('hu');
    expect(JSON.stringify(inHungarian)).toBe(JSON.stringify(inEnglish));
    expect(inEnglish.contracts.contracts.length).toBeGreaterThan(0);
    expect(inEnglish.known.length).toBeGreaterThan(4);
    expect(en).toContain('Farm Halt 2');
    expect(hu).toContain('Tanyai megálló 2');
    expect(hu).not.toContain('Farm Halt 2');
  });

  it('keeps every train note out of the language: the simulation writes none through STR', () => {
    for (const file of ['../sim/trains.ts', '../sim/fleet.ts']) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8');
      expect(source).not.toMatch(/STR\.traffic\./);
      expect(source).not.toMatch(/lastMessage = [`'"][^'"`]/);
      expect(source).not.toMatch(/\.idle\(['"`][^'"`]/);
    }
  });
});

/** What Hungarian writes as English does: terms of the trade, keys, numbers and marks. */
const SAME_IN_BOTH = [
  '+',
  '1x',
  '1–5',
  '1–9',
  '2x',
  '3x',
  '?',
  'Auto',
  'C',
  'CTC',
  'Ctrl+Shift+Z',
  'Ctrl+Y',
  'Ctrl+Z',
  'Delete',
  'E',
  'Enter',
  'Esc',
  'F',
  'FPS',
  'G',
  'Gacha',
  'K',
  'M',
  'OK',
  'Q',
  'Q / E',
  'R',
  'Shift+E',
  'Shift+Q',
  'Shift+U',
  'Tab',
  'Terepasztal',
  'Token',
  'Trend',
  'U',
  'V',
  'W A S D',
  'X',
  '`',
  '{input} → {output}',
  '{state} → {station}',
  '½x',
  '−',
  '∞',
  '❚❚',
];
