import { describe, it, expect } from 'vitest';
import { STR } from '../strings';
import { content } from '../data/content';
import { BIOME_DEFS, biomeDef, biomeSummary } from '../sim/biomes';
import { HARVEST_RADIUS, LEVELS, STATION_DEFS } from '../sim/stations';
import { cargoName } from '../sim/cargo';
import { emptyMap } from '../world/mapgen';
import { Biome, Terrain, type GameMap } from '../world/tiles';
import { biomeTip, stationKindTip } from './biomeTooltip';
import { fmtMoney } from './numberFormat';
import {
  chunkTip,
  pickTip,
  stationTip,
  trainTip,
  worksTip,
  type StationSnapshot,
  type TrainSnapshot,
  type WorksSnapshot,
} from './tooltipContent';
import {
  blockText,
  fill,
  plain,
  richText,
  termsOf,
  type Block,
  type Inline,
  type Parts,
  type TermPart,
  type TipDoc,
} from './tooltipDoc';
import { signedPercent } from './tooltipFormat';
import { tileTip, type TileSnapshot } from './tileTooltip';

/** A biome by its id in src/data/biomes.json, which is its index. */
const biomeId = (id: string) => {
  const i = BIOME_DEFS.findIndex((d) => d.id === id);
  expect(i, `a biome ${id}`).toBeGreaterThanOrEqual(0);
  return i as Biome;
};

const lines = (doc: TipDoc) => doc.map(blockText);
const partsOf = (b: Block): Parts => (b.kind === 'row' ? [...b.label, ...b.value] : b.parts);
const rows = (doc: TipDoc) => doc.filter((b) => b.kind === 'row');
const termIn = (parts: Parts): TermPart => {
  const t = parts.find((p): p is TermPart => typeof p !== 'string' && 'term' in p);
  expect(t, 'a term').toBeDefined();
  return t!;
};

/** The plain text inside every tooltip a document opens, nested ones included. */
function everyString(doc: TipDoc, seen = new Set<TipDoc>()): string[] {
  if (seen.has(doc)) return [];
  seen.add(doc);
  const out: string[] = [];
  for (const b of doc)
    for (const p of partsOf(b)) {
      if (typeof p === 'string') out.push(p);
      else if ('term' in p) out.push(...everyString(p.tip(), seen));
    }
  return out;
}

describe('numbers in a sentence', () => {
  const nums = (s: string) => richText(s).filter((p) => typeof p !== 'string' && 'num' in p);
  const tokens = (s: string) => nums(s).map((p) => (p as { num: string }).num);

  it('makes each number token whole and bold, and leaves the words around it', () => {
    expect(richText('Level 3')).toEqual(['Level ', { num: '3' }]);
    expect(tokens('Storage: 12 / 60')).toEqual(['12', '60']);
    expect(tokens('Upgrading to level 3 · 4 h left')).toEqual(['3', '4']);
    expect(tokens('12u aboard')).toEqual(['12']);
    expect(tokens('Track costs ×1.5')).toEqual(['×1.5']);
    expect(tokens('2× oak')).toEqual(['2×']);
    expect(tokens('+25% and −50%')).toEqual(['+25%', '−50%']);
    expect(tokens('Price $1,200')).toEqual(['$1,200']);
    expect(tokens('12, 13')).toEqual(['12', '13']);
  });

  it('keeps the text it was given', () => {
    for (const s of ['Level 3', 'Track costs ×1.5', 'Price $1,200', 'none at all', '', '7'])
      expect(plain(richText(s))).toBe(s);
  });

  it('leaves a digit inside a name alone', () => {
    expect(tokens('Mk2 and h2o')).toEqual([]);
  });

  it('fills a template slot with what it is given and keeps a slot it was not given', () => {
    const n: Inline = { num: '30' };
    expect(fill('Makes {n} a week', { n })).toEqual(['Makes ', n, ' a week']);
    expect(plain(fill('{a} to {b}', { a: ['x', n], b: 'y' }))).toBe('x30 to y');
    expect(plain(fill('{missing} here', {}))).toBe('{missing} here');
  });

  it('bolds the digits of a template around its slots, not the slots', () => {
    expect(fill('{who} has 3', { who: 'Mk2' })).toEqual(['Mk2', ' has ', { num: '3' }]);
  });
});

describe('the station tooltip', () => {
  const station: StationSnapshot = {
    name: 'Hillside',
    level: 2,
    work: null,
    stored: 12.7,
    capacity: 120,
    biome: Biome.Taiga,
  };
  /** the lines `updateRtsTooltip` printed before, minus the biome summary */
  const today = (s: StationSnapshot) => [
    s.name,
    STR.station.level(s.level),
    ...(s.work ? [STR.upgrade.closed, STR.upgrade.running(s.work.to, s.work.hoursLeft)] : []),
    `${STR.station.storage}: ${Math.floor(s.stored)} / ${s.capacity}`,
  ];

  it('says what it said, with the biome as a row last', () => {
    const doc = stationTip(station);
    expect(lines(doc).slice(0, -1)).toEqual(today(station));
    const biome = doc[doc.length - 1];
    expect(biome.kind).toBe('row');
    if (biome.kind !== 'row') return;
    expect(plain(biome.label)).toBe(STR.station.biome);
  });

  it('names the biome as a term whose nested tooltip is the biome tooltip', () => {
    const last = stationTip(station).at(-1)!;
    const t = termIn(partsOf(last));
    expect(t.term).toBe(biomeDef(Biome.Taiga).name);
    expect(lines(t.tip())[0]).toBe(STR.biome.title(biomeDef(Biome.Taiga).name));
  });

  it('adds the closed line and the hours left while an upgrade runs', () => {
    const busy = { ...station, work: { to: 3, hoursLeft: 4.2 } };
    expect(lines(stationTip(busy)).slice(0, -1)).toEqual(today(busy));
    expect(lines(stationTip(busy))).toContain(STR.upgrade.running(3, 4.2));
  });

  it('prints no biome summary', () => {
    for (const b of [Biome.Plains, Biome.Desert, Biome.Swamp]) {
      const text = lines(stationTip({ ...station, biome: b })).join('\n');
      expect(text).not.toContain(biomeSummary(b));
    }
  });
});

describe('the works tooltip', () => {
  const altBuilding = content.buildings.find((b) => b.altIn)!;
  const plain1 = content.buildings.find((b) => !b.altIn)!;
  const works = (def: typeof altBuilding, over: Partial<WorksSnapshot> = {}): WorksSnapshot => ({
    name: def.name,
    recipe: def.recipe,
    altIn: def.altIn,
    status: STR.building.running,
    work: null,
    rate: 12.46,
    ...over,
  });

  it('says its recipe, status and rate, apart from the resource names', () => {
    const w = works(plain1);
    const out = lines(worksTip(w));
    expect(out).toHaveLength(4);
    expect(out[0]).toBe(plain1.name);
    expect(out[2]).toBe(STR.building.running);
    expect(out[3]).toBe(`${STR.building.rate}: ${STR.station.perWeek(12.5)}`);
    // the recipe is what `BuildingPanel.recipeText` read: amounts, an arrow, amounts, with the
    // resources by name
    const amounts = (cost: Record<string, number>) =>
      Object.entries(cost)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => `${Math.ceil(v)} ${cargoName(k).toLowerCase()}`)
        .join(', ');
    expect(out[1]).toBe(`${amounts(plain1.recipe.in)} → ${amounts(plain1.recipe.out)}`);
  });

  it('names the fall-back inputs only when the works has them', () => {
    expect(lines(worksTip(works(plain1)))[1]).not.toContain(STR.building.or);
    expect(lines(worksTip(works(altBuilding)))[1]).toContain(`(${STR.building.or} `);
  });

  it('shows every resource of the recipe as an icon with its name', () => {
    const doc = worksTip(works(altBuilding));
    const shown = doc[1].kind === 'text' ? doc[1].parts : [];
    const cargo = shown.flatMap((p) => (typeof p !== 'string' && 'res' in p ? [p.res] : []));
    const want = [
      ...Object.keys(altBuilding.recipe.in),
      ...Object.keys(altBuilding.altIn ?? {}),
      ...Object.keys(altBuilding.recipe.out),
    ];
    expect(cargo).toEqual(want);
  });

  it('adds the upgrade line while one runs', () => {
    const doc = worksTip(works(plain1, { work: { to: 2, hoursLeft: 6 } }));
    expect(lines(doc)).toContain(STR.upgrade.running(2, 6));
    expect(doc).toHaveLength(5);
  });
});

describe('the train tooltip', () => {
  const train: TrainSnapshot = {
    name: 'Rhubarb',
    state: 'moving',
    blocked: false,
    next: 'Hillside',
    cargo: 18.4,
    weight: 120.6,
    power: 300.2,
  };
  /** the lines `describePick` made, and the field hover's hint after them */
  const today = (t: TrainSnapshot) => [
    t.name,
    `${t.blocked && t.state === 'moving' ? STR.depot.state.held : STR.depot.state[t.state]}${t.next ? ` → ${t.next}` : ''}`,
    STR.depot.cargo(Math.round(t.cargo)),
    `${Math.round(t.weight)} / ${Math.round(t.power)} t`,
  ];

  it('says what describePick said, and the click hint on the field only', () => {
    expect(lines(trainTip(train, false))).toEqual(today(train));
    expect(lines(trainTip(train, true))).toEqual([...today(train), STR.train.clickHint]);
  });

  it('says held for a moving train that is blocked, and the state as it is otherwise', () => {
    expect(lines(trainTip({ ...train, blocked: true }, false))[1]).toContain(STR.depot.state.held);
    const waiting = { ...train, state: 'waiting', blocked: true };
    expect(lines(trainTip(waiting, false))[1]).toContain(STR.depot.state.waiting);
    expect(lines(trainTip(waiting, false))[1]).not.toContain(STR.depot.state.held);
  });

  it('leaves the station out when the train has no route', () => {
    expect(lines(trainTip({ ...train, next: null }, false))[1]).toBe(STR.depot.state.moving);
  });

  it('keeps a station name as it is, digits and all', () => {
    const doc = trainTip({ ...train, next: 'Halt 7' }, false);
    const state = doc[1].kind === 'text' ? doc[1].parts : [];
    expect(state.filter((p) => typeof p !== 'string')).toEqual([]);
    expect(plain(state)).toContain('Halt 7');
  });

  it('states every state of the depot', () => {
    for (const state of Object.keys(STR.depot.state))
      expect(lines(trainTip({ ...train, state }, false))[1]).toContain(STR.depot.state[state]);
  });
});

describe('the overview tooltips', () => {
  it('picks a station as describePick did: name, level, storage', () => {
    const doc = pickTip({
      kind: 'station',
      name: 'Hillside',
      level: 3,
      stored: 40.9,
      capacity: 200,
    });
    expect(lines(doc)).toEqual([
      'Hillside',
      STR.station.level(3),
      `${STR.station.storage}: 40 / 200`,
    ]);
  });

  it('picks a train as the field does, without the click hint', () => {
    const t: TrainSnapshot = {
      name: 'Rhubarb',
      state: 'loading',
      blocked: false,
      next: null,
      cargo: 3,
      weight: 10,
      power: 20,
    };
    expect(lines(pickTip({ kind: 'train', ...t }))).toEqual(lines(trainTip(t, false)));
  });

  it('names a pick that is gone by its kind and id', () => {
    expect(lines(pickTip({ kind: 'gone', of: 'train', id: 4 }))).toEqual([
      STR.overview.gone('train', 4),
    ]);
  });

  it('prices an uncharted chunk as the overview did', () => {
    expect(lines(chunkTip({ price: 1200 }))).toEqual([
      STR.overview.chunkTitle,
      ...STR.overview.chunkLines(fmtMoney(1200)),
    ]);
  });
});

describe('the tile tooltip', () => {
  const grid = (): GameMap => {
    const map = emptyMap(7, 8, 8, Terrain.Grass);
    map.terrain[2 * map.w + 2] = Terrain.Water;
    map.biome[2 * map.w + 2] = biomeId('ocean');
    map.biome[5 * map.w + 5] = biomeId('desert');
    return map;
  };
  const bare = (map: GameMap, x: number, y: number): TileSnapshot => ({
    map,
    x,
    y,
    charted: true,
    track: null,
    decor: null,
    props: [],
    powered: false,
    trackCostFactor: 1,
  });
  /** the lines of `Game.tileInfo` after the biome summary, the elevation line first */
  const after = (doc: TipDoc) => lines(doc).slice(2);

  it('titles the terrain and names the biome in a row of its own, as a term', () => {
    const map = grid();
    const doc = tileTip(bare(map, 5, 5));
    expect(doc[0]).toMatchObject({ kind: 'title' });
    expect(blockText(doc[0])).toBe(STR.tile.terrain.grass);
    const biome = doc[1];
    expect(biome.kind).toBe('row');
    expect(plain(partsOf(biome).slice(0, 1))).toBe(STR.tile.biome);
    const t = termIn(partsOf(biome));
    expect(t.term).toBe(biomeDef(biomeId('desert')).name);
    expect(blockText(t.tip()[0])).toBe(STR.biome.title(t.term));
  });

  it('prints no biome summary', () => {
    const map = grid();
    const text = lines(tileTip(bare(map, 5, 5))).join('\n');
    expect(text).not.toContain(biomeSummary(biomeId('desert')));
  });

  it('then the elevation as Game.tileInfo said it', () => {
    const map = grid();
    expect(after(tileTip(bare(map, 5, 5)))).toEqual([STR.tile.elevation(0)]);
  });

  it('says what stands on the tile, in the order tileInfo did', () => {
    const map = grid();
    const doc = tileTip({
      ...bare(map, 5, 5),
      charted: false,
      track: 'straight',
      decor: { name: 'Lamp', lines: ['Reach: 3 tiles', 'No station in reach'] },
      props: ['oak', 'bush', 'oak'],
      powered: true,
      trackCostFactor: 1.5,
    });
    expect(after(doc)).toEqual([
      STR.tile.elevation(0),
      STR.tile.uncharted,
      STR.tile.track('straight'),
      'Lamp',
      'Reach: 3 tiles',
      'No station in reach',
      '2× oak, bush',
      STR.tile.powered,
      STR.tile.trackCost(1.5),
    ]);
  });

  it('says no track can be laid where the cost factor is 0, and nothing at 1', () => {
    const map = grid();
    expect(after(tileTip({ ...bare(map, 5, 5), trackCostFactor: 0 }))).toContain(STR.tile.noTrack);
    expect(after(tileTip(bare(map, 5, 5)))).not.toContain(STR.tile.noTrack);
    expect(lines(tileTip(bare(map, 5, 5))).join('\n')).not.toMatch(/Track costs/);
  });

  it('explains water and names its terrain', () => {
    const map = grid();
    const doc = tileTip(bare(map, 2, 2));
    expect(blockText(doc[0])).toBe(STR.tile.terrain.water);
    expect(lines(doc).at(-1)).toBe(STR.tile.water);
    expect(termIn(partsOf(doc[1])).term).toBe(biomeDef(biomeId('ocean')).name);
  });

  it('bolds every number it prints', () => {
    const map = grid();
    const doc = tileTip({
      ...bare(map, 5, 5),
      charted: false,
      track: 'curve',
      decor: { name: 'Lamp', lines: ['Reach: 3 tiles'] },
      props: ['oak', 'oak'],
      trackCostFactor: 1.5,
    });
    // what is left in plain text, the nested biome tooltip included, has no digit
    for (const s of everyString(doc)) expect(s).not.toMatch(/\d/);
    expect(doc.some((b) => partsOf(b).some((p) => typeof p !== 'string' && 'num' in p))).toBe(true);
  });
});

describe('the biome tooltip', () => {
  const production = (def: (typeof BIOME_DEFS)[number]) => Object.entries(def.production);

  it('titles the biome, describes it, and lists a row per production entry in data order', () => {
    for (const [i, def] of BIOME_DEFS.entries()) {
      const doc = biomeTip(i as Biome);
      expect(blockText(doc[0]), def.id).toBe(STR.biome.title(def.name));
      expect(doc[1]).toMatchObject({ kind: 'dim' });
      expect(blockText(doc[1])).toBe(def.desc);
      const prod = rows(doc).slice(0, production(def).length);
      production(def).forEach(([stationId, m], k) => {
        const row = prod[k];
        if (row.kind !== 'row') throw new Error('a row');
        expect(plain(row.value), `${def.id} ${stationId}`).toBe(signedPercent(m));
        expect(termIn(row.label).term).toBe(STR.station.plural[stationId]);
      });
    }
  });

  it('leaves out track cost, water use and speed at 1, and lists them otherwise', () => {
    for (const [i, def] of BIOME_DEFS.entries()) {
      const extra = [def.trackCostMul, def.waterUseMul, def.speedMul].filter((m) => m !== 1);
      expect(rows(biomeTip(i as Biome)), def.id).toHaveLength(
        production(def).length + extra.length,
      );
    }
  });

  it('colours a row green when it is good for the player and red when it is bad', () => {
    for (const [i, def] of BIOME_DEFS.entries()) {
      const tones = rows(biomeTip(i as Biome)).map((r) => (r.kind === 'row' ? r.tone : undefined));
      const want = [
        ...production(def).map(([, m]) => (m === 1 ? undefined : m > 1 ? 'good' : 'bad')),
        ...(def.trackCostMul !== 1 ? [def.trackCostMul > 1 ? 'bad' : 'good'] : []),
        ...(def.waterUseMul !== 1 ? [def.waterUseMul > 1 ? 'bad' : 'good'] : []),
        ...(def.speedMul !== 1 ? [def.speedMul < 1 ? 'bad' : 'good'] : []),
      ];
      expect(tones, def.id).toEqual(want);
    }
  });

  it('shows Plains as one green row and nothing else', () => {
    const doc = biomeTip(biomeId('plains'));
    expect(doc).toHaveLength(3);
    const r = doc[2];
    expect(r).toMatchObject({ kind: 'row', tone: 'good' });
    expect(blockText(r)).toBe('wheat from farm halts: +25%');
    expect(termIn(partsOf(r)).term).toBe('farm halts');
  });

  it('shows Desert with a red water use row and signed percents of both colours', () => {
    const doc = biomeTip(biomeId('desert'));
    expect(rows(doc).map(blockText)).toEqual([
      'stone from quarries: +30%',
      'water from water pumps: −50%',
      'wheat from farm halts: −50%',
      "Steam engines' water use: +50%",
    ]);
    expect(rows(doc).map((r) => (r.kind === 'row' ? r.tone : null))).toEqual([
      'good',
      'bad',
      'bad',
      'bad',
    ]);
  });

  it('shows Mountain with a red track cost and a red train speed', () => {
    const doc = biomeTip(biomeId('mountain'));
    expect(rows(doc).map(blockText)).toEqual([
      'stone from quarries: +30%',
      'water from water pumps: −40%',
      'Track cost: +50%',
      'Train speed: −10%',
    ]);
    expect(rows(doc).map((r) => (r.kind === 'row' ? r.tone : null))).toEqual([
      'good',
      'bad',
      'bad',
      'bad',
    ]);
  });

  it('lists Lake, River and Beach from the data like any other biome', () => {
    for (const id of ['lake', 'river', 'beach']) {
      const doc = biomeTip(biomeId(id));
      expect(blockText(doc[0])).toBe(STR.biome.title(biomeDef(biomeId(id)).name));
      expect(rows(doc).length).toBeGreaterThan(0);
    }
  });

  it('draws the water use row with the water icon and its name', () => {
    const r = rows(biomeTip(biomeId('desert'))).find((x) => blockText(x).includes('Steam'))!;
    if (r.kind !== 'row') throw new Error('a row');
    expect(r.label.some((p) => typeof p !== 'string' && 'res' in p && p.res === 'water')).toBe(
      true,
    );
  });

  it('gives each production row the resource its station makes', () => {
    for (const [i, def] of BIOME_DEFS.entries())
      rows(biomeTip(i as Biome))
        .slice(0, production(def).length)
        .forEach((r, k) => {
          const kind = STATION_DEFS.find((d) => d.id === production(def)[k][0])!;
          const res = partsOf(r).find((p) => typeof p !== 'string' && 'res' in p);
          expect(res, `${def.id} ${kind.id}`).toMatchObject({ res: kind.produces[0].cargo });
        });
  });

  it('bolds every number in the tooltip and the ones it opens', () => {
    for (const i of BIOME_DEFS.keys())
      for (const s of everyString(biomeTip(i as Biome))) expect(s, String(i)).not.toMatch(/\d/);
  });
});

describe('the station tooltip a biome opens', () => {
  const named = [...new Set(BIOME_DEFS.flatMap((d) => Object.keys(d.production)))];

  it('is opened from the plural of every station kind a biome names, and titles the station', () => {
    expect(named.length).toBeGreaterThan(0);
    for (const [i, def] of BIOME_DEFS.entries()) {
      const terms = termsOf(biomeTip(i as Biome));
      expect(
        terms.map((t) => t.term),
        def.id,
      ).toEqual(Object.keys(def.production).map((id) => STR.station.plural[id]));
      Object.keys(def.production).forEach((id, k) =>
        expect(blockText(terms[k].tip()[0]), `${def.id} ${id}`).toBe(
          STATION_DEFS.find((d) => d.id === id)!.name,
        ),
      );
    }
  });

  it('reads 30 from the first level of the data and 4 from the harvest radius', () => {
    const words = (id: string) => {
      const doc = stationKindTip(id);
      return doc[1].kind === 'text' ? doc[1].parts : [];
    };
    const bold = (parts: Parts) =>
      parts.flatMap((p) => (typeof p !== 'string' && 'num' in p ? [p.num] : []));
    expect(bold(words('farm'))).toEqual([
      String(LEVELS.production[0]),
      '1',
      String(HARVEST_RADIUS),
    ]);
    const was = LEVELS.production[0];
    try {
      LEVELS.production[0] = was + 6;
      expect(bold(words('farm'))[0]).toBe(String(was + 6));
    } finally {
      LEVELS.production[0] = was;
    }
  });

  it('names the resource, the ground and the radius of each station', () => {
    for (const id of named) {
      const def = STATION_DEFS.find((d) => d.id === id)!;
      const doc = stationKindTip(id);
      const text = blockText(doc[1]);
      expect(text, id).toContain(STR.tile.phrase[def.terrain!].many);
      expect(text, id).toMatch(/^Makes /);
      const res =
        doc[1].kind === 'text'
          ? doc[1].parts.find((p) => typeof p !== 'string' && 'res' in p)
          : null;
      expect(res, id).toMatchObject({ res: def.produces[0].cargo });
    }
  });

  it('makes a station that counts no ground say only what it makes', () => {
    const noGround = STATION_DEFS.find((d) => d.produces.length && !d.terrain);
    if (!noGround) return;
    expect(blockText(stationKindTip(noGround.id)[1])).not.toMatch(/within/);
  });

  it('does not break on a station kind the data lacks', () => {
    expect(lines(stationKindTip('no_such_station'))).toEqual(['no_such_station']);
  });
});

describe('the words for stations and ground', () => {
  const terrains = [...new Set(STATION_DEFS.flatMap((d) => (d.terrain ? [d.terrain] : [])))];

  it('has a singular and a plural tile phrase for every terrain a station harvests', () => {
    expect(terrains.length).toBeGreaterThan(0);
    for (const t of terrains) {
      const p = STR.tile.phrase[t];
      expect(p, t).toBeDefined();
      expect(p.one.trim(), t).not.toBe('');
      expect(p.many.trim(), t).not.toBe('');
      expect(p.one, t).not.toBe(p.many);
    }
  });

  it('keeps rock and hill together in the phrase of the rock station', () => {
    expect(STR.tile.phrase.rock.one).toMatch(/rock/);
    expect(STR.tile.phrase.rock.one).toMatch(/hill/);
    expect(STR.tile.phrase.rock.many).toMatch(/rock/);
    expect(STR.tile.phrase.rock.many).toMatch(/hill/);
  });

  it('has a written-out plural for every harvesting station and every station a biome names', () => {
    const ids = new Set([
      ...STATION_DEFS.filter((d) => d.terrain).map((d) => d.id),
      ...BIOME_DEFS.flatMap((d) => Object.keys(d.production)),
    ]);
    for (const id of ids) {
      const p = STR.station.plural[id];
      expect(p, id).toBeDefined();
      expect(p.trim(), id).not.toBe('');
    }
  });

  it('spells the plural of quarry with an ie, not an s added', () => {
    expect(STR.station.plural.quarry).toBe('quarries');
  });

  it('gives every template its slots', () => {
    const slots = (t: string) => [...t.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    expect(slots(STR.biome.production)).toEqual(['res', 'station']);
    expect(slots(STR.biome.waterUse)).toEqual(['res']);
    expect(slots(STR.station.makes).sort()).toEqual(
      ['amount', 'level', 'radius', 'res', 'tiles'].sort(),
    );
    expect(slots(STR.station.makesAnywhere).sort()).toEqual(['amount', 'level', 'res']);
    expect(slots(STR.train.toward)).toEqual(['state', 'station']);
    expect(slots(STR.building.recipeLine)).toEqual(['input', 'output']);
    expect(slots(STR.building.recipeAlt)).toEqual(['input', 'alt', 'output']);
  });
});
