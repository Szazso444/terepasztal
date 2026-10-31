import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, it, expect } from 'vitest';
import { STR } from '../strings';
import { content } from '../data/content';
import { BIOME_DEFS, biomeDef, biomeSummary } from '../sim/biomes';
import { HARVEST_RADIUS, STATION_DEFS, weeklyOutput } from '../sim/stations';
import { cargoName } from '../sim/cargo';
import { PROP_KINDS } from '../world/chunks';
import { levelAt } from '../world/elevation';
import { emptyMap } from '../world/mapgen';
import { Biome, TERRAIN_NAMES, Terrain, type GameMap } from '../world/tiles';
import { biomeTip, stationKindTip } from './biomeTooltip';
import { fmtMoney } from './numberFormat';
import {
  buildingDefTip,
  chunkTip,
  pickTip,
  resourceTip,
  stationTip,
  trainTip,
  worksTip,
  type StationSnapshot,
  type TrainSnapshot,
  type WorksSnapshot,
  type WorksStatus,
} from './tooltipContent';
import {
  bad,
  blockText,
  fill,
  good,
  plain,
  richText,
  row,
  termsOf,
  type Block,
  type Inline,
  type Parts,
  type TermPart,
  type TipDoc,
} from './tooltipDoc';
import { signedPercent } from './tooltipFormat';
import { tileTip, type TileSnapshot } from './tileTooltip';
import { makersOf, usersOf } from './resourceOrder';

/** A biome by its id in src/data/biomes.json, which is its index. */
const biomeId = (id: string) => {
  const i = BIOME_DEFS.findIndex((d) => d.id === id);
  expect(i, `a biome ${id}`).toBeGreaterThanOrEqual(0);
  return i as Biome;
};

/** The tuned level 1 weekly output a snapshot carries: the game's, at the default tuning. */
const WEEKLY = weeklyOutput(1, 1, { productionMul: 1 });

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

describe('the looks of a line and a row', () => {
  it('makes a good line green and a bad one red', () => {
    expect(good('Met')).toEqual({ kind: 'text', parts: ['Met'], tone: 'good' });
    expect(bad('No')).toEqual({ kind: 'text', parts: ['No'], tone: 'bad' });
  });
  it('gives a row an accent tone and an indent, which its text does not show', () => {
    const r = row('Diesel Age', 'current', { tone: 'accent', indent: true });
    expect(r).toMatchObject({ kind: 'row', tone: 'accent', indent: true });
    expect(blockText(r)).toBe('Diesel Age: current');
    expect(row('a', 'b')).not.toHaveProperty('indent');
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
    weeklyAtLevel1: WEEKLY,
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
    status: { kind: 'running' },
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

  it('words each status from STR, closed and full and running and no store as plain lines', () => {
    const said = (status: WorksStatus) => lines(worksTip(works(plain1, { status })))[2];
    expect(said({ kind: 'running' })).toBe(STR.building.running);
    expect(said({ kind: 'full' })).toBe(STR.building.full);
    expect(said({ kind: 'closed' })).toBe(STR.upgrade.closed);
    expect(said({ kind: 'noStore', range: 24 })).toBe(STR.stores.noStoreNear(24));
  });

  it('names what a waiting works lacks as a resource: its icon and its underlined name', () => {
    const cargo = Object.keys(plain1.recipe.in)[0];
    const doc = worksTip(works(plain1, { status: { kind: 'starved', missing: cargo } }));
    const status = doc[2];
    expect(status.kind).toBe('text');
    const parts = status.kind === 'text' ? status.parts : [];
    expect(parts.filter((p) => typeof p !== 'string' && 'res' in p)).toEqual([
      { res: cargo, name: cargoName(cargo) },
    ]);
    // it says what the panel says, bar the resource's capital
    expect(plain(parts)).toBe(STR.building.starved(cargoName(cargo).toLowerCase()));
    // the resource is no longer inside a finished sentence
    expect(parts.filter((p) => typeof p === 'string').join('')).not.toContain(cargoName(cargo));
  });

  it('keeps the wording of the waiting status the panel and the tooltip share', () => {
    const [before, after] = STR.building.waiting.split('{res}');
    expect(STR.building.starved('X')).toBe(`${before}X${after}`);
  });

  it('says a question mark where no input can be named', () => {
    const doc = worksTip(works(plain1, { status: { kind: 'starved', missing: null } }));
    expect(lines(doc)[2]).toBe(STR.building.starved(STR.building.unknownInput));
    expect(
      doc[2].kind === 'text' && doc[2].parts.some((p) => typeof p !== 'string' && 'res' in p),
    ).toBe(false);
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
    weeklyAtLevel1: WEEKLY,
  });
  /** the lines after the dim line about the terrain: what the game adds */
  const extras = (doc: TipDoc) => lines(doc.slice(doc.findIndex((b) => b.kind === 'dim') + 1));

  /**
   * A 15 x 15 map of grass with a block of `terrain` seven tiles across around (cx, cy), whose
   * middle tile has `biome` over `climate`. Levels follow the terrain (src/world/elevation.ts), so
   * the middle of a mountain block is at level 4 and a tile two from the map's edge at level 3.
   */
  const field = (terrain: Terrain, biome: string, climate = biome, cx = 7, cy = 7): GameMap => {
    const map = emptyMap(7, 15, 15, Terrain.Grass);
    for (let y = Math.max(0, cy - 3); y <= cy + 3; y++)
      for (let x = Math.max(0, cx - 3); x <= cx + 3; x++) map.terrain[y * map.w + x] = terrain;
    map.biome[cy * map.w + cx] = biomeId(biome);
    map.climate = Uint8Array.from(map.biome);
    map.climate[cy * map.w + cx] = biomeId(climate);
    return map;
  };
  const LAND = [Terrain.Grass, Terrain.Forest, Terrain.Hill, Terrain.Rock, Terrain.Sand] as const;
  const TERRAINS = [...LAND, Terrain.Mountain, Terrain.Water] as const;
  const labelOf = (b: Block) => (b.kind === 'row' ? plain(b.label) : '');
  const valueOf = (b: Block): Parts => (b.kind === 'row' ? b.value : []);
  const snowRow = (doc: TipDoc) => doc.find((b) => labelOf(b) === STR.tile.snowLine);

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

  it('names the terrains Grass and Rock, as the demo does', () => {
    expect(STR.tile.terrain.grass).toBe('Grass');
    expect(STR.tile.terrain.rock).toBe('Rock');
    expect(blockText(tileTip(bare(field(Terrain.Rock, 'plains'), 7, 7))[0])).toBe('Rock');
  });

  it('prints no biome summary', () => {
    const map = grid();
    const text = lines(tileTip(bare(map, 5, 5))).join('\n');
    expect(text).not.toContain(biomeSummary(biomeId('desert')));
  });

  it('is a title, the Biome and Elevation rows and one dim line about each terrain', () => {
    // desert snow starts above the highest level, so none of these is snow
    for (const t of TERRAINS) {
      const name = TERRAIN_NAMES[t];
      const doc = tileTip(bare(field(t, 'desert'), 7, 7));
      expect(
        doc.map((b) => b.kind),
        name,
      ).toEqual(['title', 'row', 'row', 'dim']);
      expect(blockText(doc[0]), name).toBe(STR.tile.terrain[name]);
      expect(labelOf(doc[1]), name).toBe(STR.tile.biome);
      expect(labelOf(doc[2]), name).toBe(STR.tile.elevationRow);
      expect(blockText(doc[3]), name).toBe(
        t === Terrain.Water ? STR.tile.water : STR.tile.about[name],
      );
    }
  });

  it('says the level in bold on the Elevation row', () => {
    const map = field(Terrain.Hill, 'plains');
    const level = levelAt(map, 7, 7);
    expect(level).toBe(2);
    const value = valueOf(tileTip(bare(map, 7, 7))[2]);
    expect(plain(value)).toBe(STR.tile.level(level));
    expect(value).toContainEqual({ num: String(level) });
  });

  it('describes each land terrain, the forest holding buildings and the rock no longer barred', () => {
    for (const name of TERRAIN_NAMES.filter((n) => n !== 'water'))
      expect(STR.tile.about[name], name).toMatch(/\S/);
    expect(STR.tile.about.forest).toMatch(/building/i);
    expect(STR.tile.about.rock).not.toMatch(/nothing is built/i);
  });

  it('calls a mountain at level 4 under a plains climate "Mountain, snow", biome Mountain', () => {
    const map = field(Terrain.Mountain, 'mountain', 'plains');
    expect(levelAt(map, 7, 7)).toBe(4);
    const doc = tileTip(bare(map, 7, 7));
    expect(blockText(doc[0])).toBe('Mountain, snow');
    expect(blockText(doc[0])).toBe(STR.tile.snow(STR.tile.terrain.mountain));
    // the Biome row reads the biome, not the climate
    const term = termIn(partsOf(doc[1])).term;
    expect(term).toBe(biomeDef(biomeId('mountain')).name);
    expect(term).not.toBe(biomeDef(biomeId('plains')).name);
    expect(doc.map((b) => b.kind)).toEqual(['title', 'row', 'row', 'row', 'dim']);
    expect(labelOf(doc[3])).toBe(STR.tile.snowLine);
    expect(valueOf(doc[3])).toContainEqual({ num: '3' });
  });

  it('puts the snow line of a Taiga mountain at "above level 2"', () => {
    const map = field(Terrain.Mountain, 'mountain', 'taiga');
    expect(levelAt(map, 7, 7)).toBe(4);
    expect(blockText(snowRow(tileTip(bare(map, 7, 7)))!)).toBe('Snow line: above level 2');
  });

  it("is snow where the level reaches the snow level of the tile's climate, and not on water", () => {
    // every terrain under every climate, the biome a mountain's own
    for (const t of TERRAINS)
      for (const [c, climate] of BIOME_DEFS.entries()) {
        const map = field(t, 'mountain', climate.id);
        const level = levelAt(map, 7, 7);
        const doc = tileTip(bare(map, 7, 7));
        const snow = t !== Terrain.Water && level >= climate.snowLevel;
        const what = `${TERRAIN_NAMES[t]} at level ${level} under ${climate.id} (${c})`;
        const name = STR.tile.terrain[TERRAIN_NAMES[t]];
        expect(blockText(doc[0]), what).toBe(snow ? STR.tile.snow(name) : name);
        const row = snowRow(doc);
        expect(row !== undefined, what).toBe(snow);
        if (row) expect(valueOf(row), what).toContainEqual({ num: String(climate.snowLevel - 1) });
      }
  });

  it('reads the climate, never the biome, for the snow line', () => {
    const taiga = biomeDef(biomeId('taiga')).snowLevel;
    const desert = biomeDef(biomeId('desert')).snowLevel;
    expect(taiga).toBeLessThan(desert);
    // a mountain at level 4: a taiga climate under a desert biome is snow, the other way is not
    const top = (biome: string, climate: string) =>
      tileTip(bare(field(Terrain.Mountain, biome, climate), 7, 7));
    expect(snowRow(top('desert', 'taiga'))).toBeDefined();
    expect(snowRow(top('taiga', 'desert'))).toBeUndefined();
    // a map with no climate plane reads the biome, which is its climate
    const map = field(Terrain.Mountain, 'desert', 'taiga');
    delete map.climate;
    expect(snowRow(tileTip(bare(map, 7, 7))) !== undefined).toBe(4 >= desert);
  });

  it('turns to snow exactly at the snow level', () => {
    // two tiles from the map's edge a mountain is at level 3: Taiga snow starts there, plains not
    const edge = (climate: string) => field(Terrain.Mountain, 'mountain', climate, 2, 7);
    expect(levelAt(edge('taiga'), 2, 7)).toBe(3);
    expect(biomeDef(biomeId('taiga')).snowLevel).toBe(3);
    expect(blockText(tileTip(bare(edge('taiga'), 2, 7))[0])).toBe('Mountain, snow');
    expect(blockText(tileTip(bare(edge('plains'), 2, 7))[0])).toBe('Mountain');
    expect(snowRow(tileTip(bare(edge('plains'), 2, 7)))).toBeUndefined();
  });

  it('keeps the rows in order on a snow tile, then what the game adds', () => {
    const doc = tileTip({
      ...bare(field(Terrain.Mountain, 'mountain', 'plains'), 7, 7),
      charted: false,
      track: 'straight',
      powered: true,
      trackCostFactor: 1.5,
    });
    expect(doc.map((b) => b.kind)).toEqual([
      'title',
      'row',
      'row',
      'row',
      'dim',
      'text',
      'text',
      'text',
      'text',
    ]);
    expect(doc.filter((b) => b.kind === 'row').map(labelOf)).toEqual([
      STR.tile.biome,
      STR.tile.elevationRow,
      STR.tile.snowLine,
    ]);
  });

  it('says what stands on the tile, after the description', () => {
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
    expect(extras(doc)).toEqual([
      STR.tile.uncharted,
      STR.tile.track('straight'),
      'Lamp',
      'Reach: 3 tiles',
      'No station in reach',
      `2× ${STR.tile.prop.oak}, ${STR.tile.prop.bush}`,
      STR.tile.powered,
      STR.tile.trackCost(1.5),
    ]);
  });

  it('names a prop from the strings, never by its kind id, and shows an unknown kind as given', () => {
    const map = grid();
    const props = (kinds: string[]) => extras(tileTip({ ...bare(map, 5, 5), props: kinds }));
    for (const kind of PROP_KINDS) {
      expect(STR.tile.prop[kind], kind).toMatch(/\S/);
      expect(props([kind]), kind).toEqual([STR.tile.prop[kind]]);
    }
    expect(props(['deadtree', 'coal'])).toEqual([
      `${STR.tile.prop.deadtree}, ${STR.tile.prop.coal}`,
    ]);
    expect(props(['deadtree'])[0]).not.toBe('deadtree');
    expect(props(['unlisted', 'unlisted'])).toEqual(['2× unlisted']);
  });

  it('names a wheat field from the strings, so the name stands before the world adds the kind', () => {
    const map = grid();
    const props = (kinds: string[]) => extras(tileTip({ ...bare(map, 5, 5), props: kinds }));
    expect(STR.tile.prop.wheat).toMatch(/\S/);
    expect(props(['wheat'])).toEqual([STR.tile.prop.wheat]);
    expect(props(['wheat'])[0]).not.toBe('wheat');
  });

  it('says no track can be laid where the cost factor is 0, and nothing at 1', () => {
    const map = grid();
    expect(extras(tileTip({ ...bare(map, 5, 5), trackCostFactor: 0 }))).toContain(STR.tile.noTrack);
    expect(extras(tileTip(bare(map, 5, 5)))).toEqual([]);
    expect(lines(tileTip(bare(map, 5, 5))).join('\n')).not.toMatch(/Track costs/);
  });

  it('explains water and names its terrain', () => {
    const map = grid();
    const doc = tileTip(bare(map, 2, 2));
    expect(blockText(doc[0])).toBe(STR.tile.terrain.water);
    expect(blockText(doc.find((b) => b.kind === 'dim')!)).toBe(STR.tile.water);
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
    // the same on a snow tile, whose rows hold two more numbers
    const snow = tileTip(bare(field(Terrain.Mountain, 'mountain', 'taiga'), 7, 7));
    for (const s of everyString(snow)) expect(s).not.toMatch(/\d/);
    expect(valueOf(snowRow(snow)!)).toContainEqual({ num: '2' });
  });
});

describe('the biome tooltip', () => {
  const production = (def: (typeof BIOME_DEFS)[number]) => Object.entries(def.production);

  it('titles the biome, describes it, and lists a row per production entry in data order', () => {
    for (const [i, def] of BIOME_DEFS.entries()) {
      const doc = biomeTip(i as Biome, WEEKLY);
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
      expect(rows(biomeTip(i as Biome, WEEKLY)), def.id).toHaveLength(
        production(def).length + extra.length,
      );
    }
  });

  it('colours a row green when it is good for the player and red when it is bad', () => {
    for (const [i, def] of BIOME_DEFS.entries()) {
      const tones = rows(biomeTip(i as Biome, WEEKLY)).map((r) =>
        r.kind === 'row' ? r.tone : undefined,
      );
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
    const doc = biomeTip(biomeId('plains'), WEEKLY);
    expect(doc).toHaveLength(3);
    const r = doc[2];
    expect(r).toMatchObject({ kind: 'row', tone: 'good' });
    expect(blockText(r)).toBe('wheat from farm halts: +25%');
    expect(termIn(partsOf(r)).term).toBe('farm halts');
  });

  it('shows Desert with a red water use row and signed percents of both colours', () => {
    const doc = biomeTip(biomeId('desert'), WEEKLY);
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
    const doc = biomeTip(biomeId('mountain'), WEEKLY);
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
      const doc = biomeTip(biomeId(id), WEEKLY);
      expect(blockText(doc[0])).toBe(STR.biome.title(biomeDef(biomeId(id)).name));
      expect(rows(doc).length).toBeGreaterThan(0);
    }
  });

  it('draws the water use row with the water icon and its name', () => {
    const r = rows(biomeTip(biomeId('desert'), WEEKLY)).find((x) =>
      blockText(x).includes('Steam'),
    )!;
    if (r.kind !== 'row') throw new Error('a row');
    expect(r.label.some((p) => typeof p !== 'string' && 'res' in p && p.res === 'water')).toBe(
      true,
    );
  });

  it('gives each production row the resource its station makes', () => {
    for (const [i, def] of BIOME_DEFS.entries())
      rows(biomeTip(i as Biome, WEEKLY))
        .slice(0, production(def).length)
        .forEach((r, k) => {
          const kind = STATION_DEFS.find((d) => d.id === production(def)[k][0])!;
          const res = partsOf(r).find((p) => typeof p !== 'string' && 'res' in p);
          expect(res, `${def.id} ${kind.id}`).toMatchObject({ res: kind.produces[0].cargo });
        });
  });

  it('bolds every number in the tooltip and the ones it opens', () => {
    for (const i of BIOME_DEFS.keys())
      for (const s of everyString(biomeTip(i as Biome, WEEKLY)))
        expect(s, String(i)).not.toMatch(/\d/);
  });
});

describe('the station tooltip a biome opens', () => {
  const named = [...new Set(BIOME_DEFS.flatMap((d) => Object.keys(d.production)))];

  it('is opened from the plural of every station kind a biome names, and titles the station', () => {
    expect(named.length).toBeGreaterThan(0);
    for (const [i, def] of BIOME_DEFS.entries()) {
      const terms = termsOf(biomeTip(i as Biome, WEEKLY));
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

  /** The bold numbers of a station tooltip's sentence, in the order it says them. */
  const bold = (id: string, weekly: number) => {
    const doc = stationKindTip(id, weekly);
    const parts = doc[1].kind === 'text' ? doc[1].parts : [];
    return parts.flatMap((p) => (typeof p !== 'string' && 'num' in p ? [p.num] : []));
  };

  it('prints the weekly figure it is given and the radius from the harvest radius', () => {
    // 30 at the data's tuning, 45 with the output raised by half: what the game will do
    const tuned = (productionMul: number) => weeklyOutput(1, 1, { productionMul });
    expect(tuned(1)).toBe(30);
    expect(tuned(1.5)).toBe(45);
    expect(bold('farm', tuned(1))).toEqual(['30', '1', String(HARVEST_RADIUS)]);
    expect(bold('farm', tuned(1.5))).toEqual(['45', '1', String(HARVEST_RADIUS)]);
    expect(bold('farm', 37.46)[0]).toBe('37.5');
  });

  it('prints the figure of the snapshot at the end of a chain of nested tooltips', () => {
    // field tile -> its biome -> the station kind the biome names; and a station -> the same
    const map = emptyMap(7, 8, 8, Terrain.Grass);
    map.biome[0] = biomeId('plains');
    const tile: TileSnapshot = {
      map,
      x: 0,
      y: 0,
      charted: true,
      track: null,
      decor: null,
      props: [],
      powered: false,
      trackCostFactor: 1,
      weeklyAtLevel1: 45,
    };
    const station: StationSnapshot = {
      name: 'Hillside',
      level: 1,
      work: null,
      stored: 0,
      capacity: 60,
      biome: biomeId('plains'),
      weeklyAtLevel1: 45,
    };
    for (const doc of [tileTip(tile), stationTip(station)]) {
      const biome = termIn(partsOf(doc.find((b) => b.kind === 'row' && termsOf([b]).length)!));
      const kind = termsOf(biome.tip())[0];
      const sentence = kind.tip()[1];
      expect(sentence.kind).toBe('text');
      expect(partsOf(sentence)).toContainEqual({ num: '45' });
    }
  });

  it('is built from the figure it is given: no tooltip builder reads the level table', () => {
    for (const file of [
      'tooltipContent.ts',
      'biomeTooltip.ts',
      'tileTooltip.ts',
      'tooltipDoc.ts',
    ]) {
      const source = ts.createSourceFile(
        file,
        readFileSync(new URL(file, import.meta.url), 'utf8'),
        ts.ScriptTarget.Latest,
      );
      const imported = source.statements.flatMap((st) =>
        ts.isImportDeclaration(st) && st.importClause?.namedBindings
          ? ts.isNamedImports(st.importClause.namedBindings)
            ? st.importClause.namedBindings.elements.map((e) => (e.propertyName ?? e.name).text)
            : []
          : [],
      );
      expect(imported, file).not.toContain('LEVELS');
      expect(imported, file).not.toContain('weeklyOutput');
    }
  });

  it('names the resource, the ground and the radius of each station', () => {
    for (const id of named) {
      const def = STATION_DEFS.find((d) => d.id === id)!;
      const doc = stationKindTip(id, WEEKLY);
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
    expect(blockText(stationKindTip(noGround.id, WEEKLY)[1])).not.toMatch(/within/);
  });

  it('does not break on a station kind the data lacks', () => {
    expect(lines(stationKindTip('no_such_station', WEEKLY))).toEqual(['no_such_station']);
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

describe('the resource tooltips', () => {
  it('a resource tooltip names its stock, its week and links its buildings', () => {
    const doc = resourceTip({
      id: 'wheat',
      have: 300,
      cap: 1000,
      produced: 6,
      consumed: 2,
      tier: 0,
    });
    const lines = doc.map(blockText);
    expect(lines[0]).toContain(cargoName('wheat'));
    expect(lines.some((l) => l.includes('300') && l.includes('1000'))).toBe(true);
    expect(lines.some((l) => l.startsWith(STR.res.madeBy))).toBe(true);
    expect(termsOf(doc).map((t) => t.term)).toEqual(
      expect.arrayContaining(['Farm Halt', 'Windmill']),
    );
  });
  it('a resource tooltip says what every store holds together; the funds are no store good', () => {
    const wheat = resourceTip({
      id: 'wheat',
      have: 30,
      cap: 100,
      total: 345.8,
      produced: 0,
      consumed: 0,
      tier: 0,
    });
    expect(lines(wheat)).toContain(STR.res.allStores(345));
    const funds = lines(resourceTip({ id: 'money', have: 25000, cap: Infinity, tier: 0 }));
    expect(funds.join('\n')).not.toContain('All stores');
  });
  it('a resource tooltip names the store the bar shows, which the bar itself no longer does', () => {
    const tip = (store?: string) =>
      lines(resourceTip({ id: 'wheat', have: 30, cap: 100, store, tier: 0 }));
    expect(tip('Narrow Depot')).toContain(STR.res.shownStore('Narrow Depot'));
    expect(tip().join('\n')).not.toContain(STR.res.shownStore(''));
  });
  it('a building tooltip from a resource says what it costs and when it unlocks', () => {
    const ref = makersOf('oil')[0];
    const lines = buildingDefTip(ref, 0).map(blockText);
    expect(lines.some((l) => l.includes(STR.build.tierLocked(1)))).toBe(true);
  });
  it('water and coal say where trains take them', () => {
    expect(
      resourceTip({ id: 'water', have: 0, cap: 0, produced: 0, consumed: 0, tier: 0 })
        .map(blockText)
        .some((l) => l.startsWith(STR.res.takenAt)),
    ).toBe(true);
    const coal = resourceTip({ id: 'coal', have: 0, cap: 0, produced: 0, consumed: 0, tier: 0 });
    expect(lines(coal)).toContain(`${STR.res.takenAt}: Coaling Stage`);
    expect(termsOf(coal).map((t) => t.term)).toContain('Coaling Stage');
  });
  it('the funds read as money, with no cap and no flows, and say what they are for', () => {
    const text = lines(resourceTip({ id: 'money', have: 25000, cap: Infinity, tier: 0 }));
    expect(text[0]).toBe(STR.res.funds);
    expect(text).toContain(`${STR.res.funds}: ${fmtMoney(25000)}`);
    expect(text.join('\n')).not.toContain('Infinity');
    expect(text.some((l) => l.startsWith(STR.res.producedDay))).toBe(false);
    expect(text.some((l) => l.startsWith(STR.res.consumedDay))).toBe(false);
    expect(text).toContain(STR.res.fundsHint);
  });
  it('population counts the people and the food they eat, and nothing received', () => {
    const doc = resourceTip({ id: 'population', have: 40, cap: Infinity, eats: 12, tier: 0 });
    const text = lines(doc);
    expect(text).toContain(`${STR.res.people}: 40`);
    expect(text).toContain(`${STR.res.eats}: 12.0 food ${STR.res.perWeek}`);
    const eats = doc.find((b) => blockText(b).startsWith(STR.res.eats))!;
    expect(partsOf(eats)).toContainEqual({ res: 'food', name: cargoName('food') });
    expect(text.some((l) => l.startsWith(STR.res.producedDay))).toBe(false);
    expect(text.some((l) => l.startsWith(STR.res.consumedDay))).toBe(false);
  });
  it('passengers count those waiting at the stations, with no cap and no flows', () => {
    const text = lines(resourceTip({ id: 'passengers', have: 7, cap: Infinity, tier: 0 }));
    expect(text).toContain(`${STR.res.waiting}: 7`);
    expect(text.some((l) => l.startsWith(STR.res.producedDay))).toBe(false);
  });
  it('a building whose age has come names no age, and lists its cost and recipe', () => {
    const mill = usersOf('wheat').find((r) => r.id === 'windmill')!;
    const text = lines(buildingDefTip(mill, 0));
    expect(text[0]).toBe('Windmill');
    expect(text.some((l) => l.startsWith('Cost '))).toBe(true);
    expect(text.some((l) => l.startsWith(`${STR.building.recipe}: `) && l.includes('wheat'))).toBe(
      true,
    );
    expect(text.join('\n')).not.toContain(STR.build.tierLocked(0));
  });
});
