import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { content, DEFAULT_CONTENT } from '../data/content';
import { HU } from '../data/strings.hu';
import { locoDef } from '../gacha/items';
import { AGE_DEFS } from '../sim/ages';
import { DECOR_DEFS } from '../sim/build';
import { BUILDING_DEFS } from '../sim/buildings';
import { Commands } from '../sim/commands';
import { classOf, gaugeLine } from '../sim/compat';
import { STATION_DEFS } from '../sim/stations';
import { startDepotCentre, startDepotKind } from '../sim/startDepot';
import { SimStep, startStock } from '../sim/step';
import { SIM_STEP } from '../sim/time';
import { defaultStop } from '../sim/trains';
import { simWorld, station } from '../testing/simWorld';
import { DEFAULT_RULES, rules } from '../sim/rules';
import { DEFAULT_SUPPLY, SUPPLY_MODES, setSupplyMode, type SupplyMode } from '../sim/supply';
import { ENGLISH, SETTINGS_KEY, STR } from '../strings';
import { AGE_PICTURE, ageNews } from './ageNews';
import {
  guidePages,
  matchingPages,
  pageWords,
  type GuideBlock,
  type GuidePage,
} from './guideContent';
import { KEYMAP } from './keymap';
import { fmtMoney } from './numberFormat';
import { PORTRAIT_IDS } from './rosterPortraits';
import { plain, type Parts } from './tooltipDoc';

vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));

beforeEach(() => Object.assign(rules, DEFAULT_RULES));
afterEach(() => {
  Object.assign(rules, DEFAULT_RULES);
  setSupplyMode(DEFAULT_SUPPLY);
});

/** Every run of parts on a page. */
function partsOfPage(p: GuidePage): Parts[] {
  return p.blocks.flatMap((b): Parts[] => {
    switch (b.kind) {
      case 'text':
        return [b.parts];
      case 'steps':
      case 'list':
        return [...b.items];
      case 'table':
        return b.rows.flat();
      default:
        return [];
    }
  });
}
/** The numbered and plain lists of a page. */
const listsOf = (p: GuidePage) =>
  p.blocks.flatMap((b) => (b.kind === 'steps' || b.kind === 'list' ? [b] : []));
const blocksOf = <K extends GuideBlock['kind']>(p: GuidePage, kind: K) =>
  p.blocks.filter((b): b is Extract<GuideBlock, { kind: K }> => b.kind === kind);

/** The pages of the running game, in the order the Guide lists them, by their ids. */
const IDS = [
  'first',
  'track',
  'stations',
  'trains',
  'signals',
  'goods',
  'contracts',
  'market',
  'ages',
  'keys',
];

const page = (id: string) => guidePages().find((p) => p.id === id)!;
/** A page in one chain, as one lower-case text. */
const words = (id: string, mode: SupplyMode) => {
  setSupplyMode(mode);
  return pageWords(page(id));
};

describe('the pages, in every chain', () => {
  for (const mode of SUPPLY_MODES) {
    const inChain = () => {
      setSupplyMode(mode);
      return guidePages();
    };

    it(`stand in the order a new player needs them (${mode})`, () => {
      expect(inChain().map((p) => p.id)).toEqual(IDS);
    });

    it(`have a title, an icon and something on each (${mode})`, () => {
      for (const p of inChain()) {
        expect(p.title, p.id).toMatch(/\S/);
        expect(p.icon, p.id).toMatch(/\S/);
        expect(p.blocks.length, p.id).toBeGreaterThan(1);
        for (const b of p.blocks)
          if (b.kind === 'head' || b.kind === 'diagram') expect(b.text, p.id).toMatch(/\S/);
          else if (b.kind === 'text') expect(plain(b.parts), p.id).toMatch(/\S/);
          else if (b.kind === 'steps' || b.kind === 'list') {
            expect(b.items.length, p.id).toBeGreaterThan(0);
            for (const i of b.items) expect(plain(i), p.id).toMatch(/\S/);
          } else if (b.kind === 'table') {
            expect(b.rows.length, `${p.id}: ${b.head.join()}`).toBeGreaterThan(0);
            for (const r of b.rows) expect(r.length, p.id).toBe(b.head.length);
          } else if (b.kind === 'keys') expect(b.rows.length, p.id).toBeGreaterThan(0);
          else expect(b.items.length, p.id).toBeGreaterThan(0);
      }
    });

    it(`leave no slot unfilled and no undefined in a line (${mode})`, () => {
      for (const p of inChain()) {
        const text = pageWords(p);
        expect(text, p.id).not.toMatch(/\{\w+\}/);
        expect(text, p.id).not.toMatch(/undefined|nan|\[object/);
      }
    });

    it(`resolve every id they name (${mode})`, () => {
      const goods = new Set([...DEFAULT_CONTENT.cargo.map((c) => c.id), 'power']);
      const stations = new Set(DEFAULT_CONTENT.stations.defs.map((d) => d.id));
      const works = new Set(DEFAULT_CONTENT.buildings.map((d) => d.id));
      const ages = new Set(AGE_DEFS.map((a) => a.id));
      let seen = 0;
      for (const p of inChain()) {
        for (const parts of partsOfPage(p))
          for (const x of parts)
            if (typeof x !== 'string' && 'res' in x) {
              expect(goods, `${p.id}: ${x.res}`).toContain(x.res);
              seen++;
            }
        for (const b of blocksOf(p, 'pictures'))
          for (const i of b.items) {
            if (i.of === 'vehicle') expect(PORTRAIT_IDS, i.id).toContain(i.id);
            else if (i.of === 'station') expect(stations, i.id).toContain(i.id);
            else if (i.of === 'works') expect(works, i.id).toContain(i.id);
            else expect(ages, i.id).toContain(i.id);
            expect(i.caption, i.id).toMatch(/\S/);
            seen++;
          }
      }
      expect(seen).toBeGreaterThan(30);
    });

    it(`name no good of the other chain (${mode})`, () => {
      const other = DEFAULT_CONTENT.cargo.filter((c) => c.supply && c.supply !== mode);
      for (const p of inChain())
        for (const parts of partsOfPage(p))
          for (const x of parts)
            if (typeof x !== 'string' && 'res' in x)
              expect(
                other.map((c) => c.id),
                p.id,
              ).not.toContain(x.res);
    });
  }
});

describe('what the pages say is what the game does', () => {
  it('tells the chains apart where they differ', () => {
    expect(words('goods', 'full')).toContain(STR.menu.supplyHint.full.toLowerCase());
    expect(words('goods', 'simple')).toContain(STR.menu.supplyHint.simple.toLowerCase());
    expect(words('goods', 'full')).toContain('colliery');
    expect(words('goods', 'simple')).not.toContain('colliery');
    expect(words('stations', 'full')).toContain(STR.guide.stations.storesFull.toLowerCase());
    expect(words('stations', 'simple')).toContain(STR.guide.stations.storesSimple.toLowerCase());
    expect(words('trains', 'full')).toContain('sand');
    expect(words('trains', 'simple')).not.toContain('spreads');
  });

  it('prints a rule as it stands now, not as it was written', () => {
    const at = (id: string) => pageWords(page(id));
    rules.startMoney = 12345;
    expect(at('first')).toContain(fmtMoney(12345).toLowerCase());
    rules.contractRefreshDays = 77;
    expect(at('contracts')).toContain('77');
    rules.depotCap = 4321;
    expect(at('stations')).toContain('4,321');
    rules.lineSpeedNarrow = 1.7;
    expect(at('track')).toContain('1.7');
    rules.inCabCost = 7777;
    expect(at('signals')).toContain(fmtMoney(7777).toLowerCase());
  });

  it('lists every line with pieces to build, and none without', () => {
    const lines = blocksOf(page('track'), 'table')[0].rows.map((r) => plain(r[0]));
    expect(lines).toEqual(['Narrow Gauge', 'Branch Line', 'Main Line', 'Trunk Line']);
    rules.narrowUnlocked = 0;
    expect(blocksOf(page('track'), 'table')[0].rows.map((r) => plain(r[0]))).not.toContain(
      'Narrow Gauge',
    );
  });

  it('sends the reader where the signalling level and the shown store are chosen', () => {
    expect(pageWords(page('signals'))).toContain(
      `${STR.topbar.fleet} › ${STR.topbar.signals}`.toLowerCase(),
    );
    const market = pageWords(page('market'));
    expect(market).not.toContain('picked on the top bar');
    expect(market).toContain('shown on the resource bar');
    expect(market).toContain(
      `pick a depot in ${STR.topbar.fleet} or on the ${STR.depot.title} screen`.toLowerCase(),
    );
  });

  it('says a rail network is one store only in the chain where it is', () => {
    const says = (mode: SupplyMode) => words('market', mode).includes('count as one');
    expect(says('simple')).toBe(true);
    expect(says('full')).toBe(false);
  });

  it('puts the track tool down before the step that opens the next category', () => {
    const [, lay, place] = listsOf(page('first'))
      .find((b) => b.kind === 'steps')!
      .items.map(plain);
    const esc = KEYMAP.find((b) => b.action === 'pauseOrClose' && b.context === 'play');
    expect(esc?.code).toBe('Escape');
    expect(lay.endsWith('Press Esc to put the track tool down.')).toBe(true);
    expect(lay).not.toContain('a run');
    expect(place).toContain('Works');
  });

  it('says houses are the player to build, as nothing else adds any', () => {
    const text = pageWords(page('stations'));
    expect(text).toContain('towns do not build houses themselves');
    expect(text).not.toContain('by itself');
    expect(text).not.toMatch(/starts a new house/);
    expect(STR.town).not.toHaveProperty('spawned');
    expect(STR.town).not.toHaveProperty('nextHouse');
  });

  it('heads the first price as that, and reads what each further one adds from the rule', () => {
    expect(blocksOf(page('stations'), 'table')[0].head).toContain('Cost of the first');
    rules.repeatCostStep = 0.35;
    const stations = pageWords(page('stations'));
    expect(stations).toContain('costs more: 35% of the first price');
    expect(stations).toContain('depots, track and bridges keep their price');
    const signals = pageWords(page('signals'));
    expect(signals).toContain('the first semaphore costs');
    expect(signals).toContain('each one more adds 35% of that, rounded up');
  });

  it('prices a second semaphore as the Signals page says', () => {
    const w = simWorld({ size: 64, terrain: 'grass' });
    const { x: cx, y } = startDepotCentre(w.map);
    const depot = station(w, startDepotKind(), cx - 6, y, 0);
    const store = w.stores.byKey(`st:${depot.id}`)!;
    for (const [id, n] of Object.entries(startStock())) store.add(id, n);
    const item = { kind: 'straight', cls: gaugeLine('narrow'), cls2: 'narrow' } as const;
    for (let x = cx - 4; x <= cx + 4; x++)
      expect(w.builder.placeTrack(x, y, item, 1), `${x}`).toBe(true);
    rules.repeatCostStep = 0.5;

    const base = DEFAULT_CONTENT.decor.find((d) => d.id === 'signal')?.cost ?? {};
    expect(w.builder.checkDecor(cx, y, 'signal').cost).toEqual(base);
    expect(w.builder.placeDecor(cx, y, 'signal', 1)).not.toBeNull();
    const second = Object.fromEntries(
      Object.entries(base).map(([good, n]) => [good, Math.ceil(n * 1.5)]),
    );
    expect(w.builder.checkDecor(cx + 2, y, 'signal').cost).toEqual(second);
  });

  it('says whose deadline rarity shortens, from the flag on the kinds', () => {
    const kinds = content.contracts.templates;
    const flagged = kinds.filter((t) => t.rarityDeadline);
    expect(flagged.length).toBeGreaterThan(0);
    const rarityTable = () => blocksOf(page('contracts'), 'table')[0];
    expect(pageWords(page('contracts'))).toContain(
      `only a ${flagged[0].name.toLowerCase()}'s deadline shortens with rarity`,
    );
    expect(rarityTable().head).toContain(STR.guide.contracts.colDeadline);

    // no kind flagged: nothing is left for the column to say
    for (const t of flagged) t.rarityDeadline = false;
    try {
      expect(rarityTable().head).not.toContain(STR.guide.contracts.colDeadline);
      expect(pageWords(page('contracts'))).not.toContain('shortens with rarity');
      expect(rarityTable().rows[0]).toHaveLength(rarityTable().head.length);
    } finally {
      for (const t of flagged) t.rarityDeadline = true;
    }
  });

  it('says the numbers of a contract are those of the first age, and how they grow', () => {
    const text = pageWords(page('contracts'));
    expect(text).toContain('the tables give the numbers of the steam age');
    expect(text).toContain('up to the electric age, adds 25% to the amounts and 15% to the pay');
    expect(text).toContain('economy › contract settings');
  });

  it('writes the slopes as rules, not as what a refused piece says', () => {
    const text = pageWords(page('track'));
    expect(text).toContain('straight track and crossings may climb');
    expect(text).toContain('a bridge platform under every tile');
    expect(text).toContain('stations, works, houses and services need level ground');
    expect(text).not.toContain(STR.build.notLevel.toLowerCase());
    expect(text).not.toContain(STR.build.reclass.size.toLowerCase());
  });

  it('tells recipes from what an age locks, and says where a building stops rising', () => {
    const ages = pageWords(page('ages'));
    expect(ages).toContain('engine recipes: ');
    expect(ages).toContain('wagon recipes: ');
    expect(ages).toContain('no age locks them');
    expect(ages).toContain('steam age buildings rise to level 2');
    expect(ages).toContain('tools: semaphore');
    expect(pageWords(page('stations'))).toContain('some stop earlier: charcoal kiln at level 3');
  });

  it('says what a level adds to a works, and to a windmill', () => {
    const text = pageWords(page('goods'));
    expect(text).toContain('each level adds 50% to the batches');
    expect(text).toContain('also gets 2 more food');
  });

  it('names no fuel of the other chain, and calls the table the prices a game starts with', () => {
    setSupplyMode('simple');
    const text = pageWords(page('market'));
    expect(text).toContain('the prices a game starts with');
    expect(text).toContain('fuel prices (oil)');
  });

  it('says where the Advisor is, and what the Depot does after Dispatch', () => {
    expect(pageWords(page('first'))).toContain('the advisor (view menu)');
    const trains = pageWords(page('trains'));
    expect(trains).toContain('the depot then shows the new train');
    expect(trains).toContain(STR.depot.again.toLowerCase());
  });

  it('gives each age its own heading, picture and what it brings', () => {
    const p = page('ages');
    const heads = blocksOf(p, 'head').map((b) => b.text);
    expect(heads).toEqual(AGE_DEFS.map((a) => STR.ages.name[a.id]));
    expect(blocksOf(p, 'pictures').map((b) => b.items[0].id)).toEqual(AGE_DEFS.map((a) => a.id));
    const text = pageWords(p);
    for (const name of ['Main Line', 'Trunk Line', 'Hydro Plant', 'Battery'])
      expect(text).toContain(name.toLowerCase());
    expect(text).toContain(STR.ages.goal.population.toLowerCase());
  });

  it('prints every key of the keymap, and a text for every action', () => {
    const p = page('keys');
    const shown = blocksOf(p, 'keys').flatMap((b) => b.rows);
    const keys = new Set(shown.flatMap((r) => r.keys));
    for (const r of shown) expect(r.text, r.keys.join()).toMatch(/\S/);
    for (const b of KEYMAP) {
      expect(ENGLISH.guide.keyAction[b.action], b.action).toMatch(/\S/);
      expect(HU.guide.keyAction[b.action], b.action).toMatch(/\S/);
    }
    for (const k of [
      'F',
      'C',
      'G',
      'V',
      'K',
      'M',
      'R',
      'Enter',
      'X',
      'U',
      'Shift+U',
      'Q',
      'Shift+Q',
    ])
      expect(keys, k).toContain(k);
    for (const k of [
      'Tab',
      'Shift+Tab',
      'Ctrl+Z',
      'Ctrl+Y',
      'Ctrl+Shift+Z',
      '+',
      '−',
      '1–9',
      '1–5',
    ])
      expect(keys, k).toContain(k);
    // what lives with the camera and the pointer, not in the keymap
    for (const k of ['W A S D', 'Wheel', 'Right-click', 'Delete']) expect(keys, k).toContain(k);
  });

  it('names no event, build helper or station rating, which the game does not have', () => {
    const all = guidePages().map(pageWords).join(' ');
    expect(all).not.toMatch(/\brating\b/);
    expect(all).not.toMatch(/\bevents?\b/);
    expect(all).not.toMatch(/gacha|ticket/);
  });
});

describe('the first minutes, as the page tells them', () => {
  it('get a first train earning from what a new game gives', () => {
    const w = simWorld({ size: 64, terrain: 'grass' });
    // in the start chunk, which is all a new game owns
    const { x: cx, y } = startDepotCentre(w.map);
    const depot = station(w, startDepotKind(), cx - 6, y, 0);
    const store = w.stores.byKey(`st:${depot.id}`)!;
    for (const [id, n] of Object.entries(startStock())) store.add(id, n);
    w.economy.money = rules.startMoney;

    // lay a run from a gate, on the line of the first engines, paid from the depot's store
    const item = { kind: 'straight', cls: gaugeLine('narrow'), cls2: 'narrow' } as const;
    for (let x = cx - 4; x <= cx + 6; x++)
      expect(w.builder.placeTrack(x, y, item, 1), `${x}`).toBe(true);
    // a station with the track touching one side: that track is its platform
    const farm = w.builder.placeStation(cx + 3, y - 1, 'farm', 0);
    expect(farm).not.toBeNull();
    expect(w.builder.platformTiles(farm!).length).toBeGreaterThan(0);

    // a locomotive and wagons that carry the good, out of what a new game hands out
    const engine = w.inventory.items.find((i) => i.kind === 'loco')!;
    const wagon = w.inventory.items.find((i) => i.defId === 'narrow_box')!;
    const stops = [defaultStop(farm!.id), defaultStop(depot.id)];
    const train = w.fleet.create([engine.uid], [wagon.uid], stops, undefined, 'schedule', depot.id);
    expect(typeof train, String(train)).not.toBe('string');

    // what the train brings goes into the depot store
    const step = new SimStep(w);
    const had = store.get('wheat');
    const ctx = { mode: 'play' as const, weather: false };
    for (let tick = 0; tick < 60000 && store.get('wheat') <= had + 1; tick++) {
      w.clock.time += SIM_STEP;
      step.run(SIM_STEP, ctx);
    }
    expect(store.get('wheat')).toBeGreaterThan(had + 1);

    // and selling some of it on the Market is the first income
    const money = w.economy.money;
    const commands = new Commands(w);
    expect(commands.spotSell('wheat', 10, store).ok).toBe(true);
    expect(w.economy.money).toBeGreaterThan(money);
    expect(w.economy.earned).toBeGreaterThan(0);
  }, 30_000);
});

describe('the search', () => {
  it('keeps the pages that hold every word, in any case', () => {
    const pages = guidePages();
    expect(matchingPages(pages, '').map((p) => p.id)).toEqual(IDS);
    expect(matchingPages(pages, 'SEMAPHORE').map((p) => p.id)).toContain('signals');
    expect(matchingPages(pages, 'semaphore gap').map((p) => p.id)).toEqual(['signals']);
    expect(matchingPages(pages, 'no such word anywhere')).toEqual([]);
  });

  it('reads past accents, typed or printed', () => {
    const pages = guidePages();
    expect(matchingPages(pages, 'SÉMAPHORE').map((p) => p.id)).toContain('signals');
    expect(matchingPages(pages, 'mav').map((p) => p.id)).toContain('first');
  });
});

describe('with a def the Content editor took away', () => {
  type Named = [{ id: string }[], string];
  const NAMED: Named[] = [
    ...['farm', 'lumber', 'quarry', 'town', 'warehouse', 'station', 'depot', 'narrow_depot'].map(
      (id): Named => [STATION_DEFS, id],
    ),
    ...['windmill', 'substation'].map((id): Named => [BUILDING_DEFS, id]),
    ...['signal', 'townhouse', 'power_line'].map((id): Named => [DECOR_DEFS, id]),
  ];

  /** Runs `then` with these defs gone from their lists, and puts them back. */
  function without(gone: Named[], then: () => void) {
    const taken = gone.map(([list, id]) => {
      const at = list.findIndex((d) => d.id === id);
      expect(at, id).toBeGreaterThanOrEqual(0);
      return { list, at, def: list.splice(at, 1)[0] };
    });
    try {
      then();
    } finally {
      for (const t of taken.reverse()) t.list.splice(t.at, 0, t.def);
    }
  }

  for (const named of NAMED)
    it(`opens without ${named[1]}, every slot filled`, () => {
      without([named], () => {
        for (const p of guidePages()) {
          expect(pageWords(p), p.id).not.toMatch(/\{\w+\}|undefined/);
          for (const b of listsOf(p)) expect(b.items.length).toBeGreaterThan(0);
        }
      });
    });

  it('opens with all of them gone', () => {
    without(NAMED, () => {
      expect(guidePages().map((p) => p.id)).toEqual(IDS);
    });
  });
});

describe('the pictures of the ages', () => {
  it('has an entry for every age, a shipped file or none', () => {
    expect(Object.keys(AGE_PICTURE)).toEqual(AGE_DEFS.map((a) => a.id));
    for (const path of Object.values(AGE_PICTURE))
      if (path)
        expect(existsSync(new URL(`../../public/${path}`, import.meta.url)), path).toBe(true);
  });

  it('shows a train of the first age a Branch Line takes', () => {
    const id = /portraits\/(.+)\.png$/.exec(AGE_PICTURE.steam ?? '')?.[1] ?? '';
    expect(classOf(locoDef(id))).toBe('frigate');
  });

  it('shows a vehicle of the age where it has one', () => {
    for (const [i, a] of AGE_DEFS.entries()) {
      const path = AGE_PICTURE[a.id];
      if (!path) continue;
      const id = /portraits\/(.+)\.png$/.exec(path)?.[1];
      if (id)
        expect(
          ageNews(i).locos.map((l) => l.id),
          a.id,
        ).toContain(id);
    }
  });
});

/** A fresh copy of the Guide, as a page load in the language of the stored settings reads it. */
async function loaded(language: string) {
  vi.resetModules();
  const items = new Map([[SETTINGS_KEY, JSON.stringify({ language })]]);
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => items.set(k, v),
    removeItem: (k: string) => items.delete(k),
  });
  const guide = await import('./guideContent');
  const supply = await import('../sim/supply');
  return { guide, supply };
}

describe('the pages, in every language', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  for (const language of ['en', 'hu'])
    for (const mode of SUPPLY_MODES)
      it(`read in full in ${language}, ${mode} chain`, async () => {
        const { guide, supply } = await loaded(language);
        supply.setSupplyMode(mode);
        const pages = guide.guidePages();
        expect(pages.map((p) => p.id)).toEqual(IDS);
        for (const p of pages) {
          expect(p.title, p.id).toMatch(/\S/);
          const text = guide.pageWords(p);
          expect(text.length, p.id).toBeGreaterThan(100);
          expect(text, p.id).not.toMatch(/\{\w+\}/);
          expect(text, p.id).not.toMatch(/undefined|\[object/);
        }
      }, 30_000);

  it('finds a Hungarian word typed with no accents', async () => {
    const { guide } = await loaded('hu');
    const found = guide.matchingPages(guide.guidePages(), 'kofejto').map((p) => p.id);
    expect(found).toContain('stations');
  }, 30_000);

  it('writes Hungarian in Hungarian, the data and the numbers with it', async () => {
    const { guide } = await loaded('hu');
    const text = guide.guidePages().map(guide.pageWords).join(' ');
    expect(text).toContain('fűtőház');
    expect(text).toContain('kőfejtő');
    expect(text).not.toContain('lumber yard');
    expect(text).toContain('40 000 $');
  }, 30_000);
});
