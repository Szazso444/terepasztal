import { describe, expect, it } from 'vitest';
import type { Rng } from '../engine/rng';
import { STR } from '../strings';
import { BIOME_DEFS, biomeDef } from '../sim/biomes';
import {
  HARVEST_RADIUS,
  MAX_LEVEL,
  STATION_DEFS,
  harvestBreakdown,
  weeklyOutput,
  type HarvestBreakdown,
} from '../sim/stations';
import { SEASONS, type Season } from '../sim/weather';
import { forAll } from '../testing/property';
import { emptyMap } from '../world/mapgen';
import { Terrain, type Biome, type GameMap } from '../world/tiles';
import { groundRows, harvestRows, placingTip, yieldLabel } from './placingTooltip';
import {
  blockText,
  plain,
  richText,
  type Block,
  type DimPart,
  type Inline,
  type Parts,
  type TermPart,
} from './tooltipDoc';
import { contribution, multiplier, weekly } from './tooltipFormat';

/** Every station that harvests, the Full chain's included. */
const HARVESTERS = STATION_DEFS.filter((d) => d.terrain);
const WEEKLY = weeklyOutput(1, 1, { productionMul: 1 });
/** The station sits in the middle, so every ring lies on the map. */
const SIDE = 2 * HARVEST_RADIUS + 3;
const MID = HARVEST_RADIUS + 1;

/** A biome by its id in src/data/biomes.json, which is its index. */
const biomeId = (id: string) => {
  const i = BIOME_DEFS.findIndex((d) => d.id === id);
  expect(i, `a biome ${id}`).toBeGreaterThanOrEqual(0);
  return i as Biome;
};

type Row = Extract<Block, { kind: 'row' }>;
const isNum = (p: Inline): p is { num: string } => typeof p !== 'string' && 'num' in p;
const isDim = (p: Inline): p is DimPart => typeof p !== 'string' && 'dim' in p;
const isTerm = (p: Inline): p is TermPart => typeof p !== 'string' && 'term' in p;
const nums = (parts: Parts) => parts.filter(isNum).map((p) => p.num);
const rowsOf = (doc: readonly Block[]) => doc.filter((b): b is Row => b.kind === 'row');
/** A document as it reads: each block's kind, text, colour, rule and terms (a term's tooltip is a new function each time). */
const shape = (doc: readonly Block[]) =>
  doc.map((b) => ({
    kind: b.kind,
    text: blockText(b),
    tone: 'tone' in b ? b.tone : undefined,
    total: b.kind === 'row' ? b.total : undefined,
    terms: (b.kind === 'row' ? [...b.label, ...b.value] : b.parts)
      .filter(isTerm)
      .map((t) => t.term),
  }));

/** A map of `fill` with the given tiles of `terrain` around the station, and the station's biome. */
function mapWith(fill: Terrain, tiles: [number, number][], terrain: Terrain, biome = 0): GameMap {
  const map = emptyMap(1, SIDE, SIDE, fill);
  for (const [dx, dy] of tiles) map.terrain[(MID + dy) * SIDE + MID + dx] = terrain;
  map.biome[MID * SIDE + MID] = biome;
  return map;
}

function breakdown(
  map: GameMap,
  defId = 'farm',
  season: Season = 'spring',
  productionMul = 1,
  level = 1,
): HarvestBreakdown {
  const b = harvestBreakdown(map, MID, MID, defId, level, season, { productionMul });
  expect(b, `${defId} harvests`).not.toBeNull();
  return b!;
}

const cargoOf = (defId: string) =>
  STATION_DEFS.find((d) => d.id === defId)!.produces.map((p) => p.cargo);
const rows = (b: HarvestBreakdown) => harvestRows(b, cargoOf(b.defId), WEEKLY);

/**
 * The rows, read back in the order they must come in: one per ring with matching ground, then
 * Placement, the biome, the Season and Game tuning rows where present, and the total. Fails on a
 * row out of its place.
 */
function read(doc: readonly Block[]) {
  const all = rowsOf(doc);
  let i = 0;
  const ring: Row[] = [];
  while (i < all.length && plain(all[i].label) !== STR.placing.placement) ring.push(all[i++]);
  const placement = all[i++];
  const biome = all[i++];
  const season = Object.values(STR.placing.season).includes(plain(all[i]?.label ?? []))
    ? all[i++]
    : null;
  const tuning = plain(all[i]?.label ?? []) === STR.placing.tuning ? all[i++] : null;
  const total = all[i++];
  expect(i, 'no rows after the total').toBe(all.length);
  return { ring, placement, biome, season, tuning, total };
}

/** A random site: ground of every kind in random places, a random biome, season and tuning. */
function site(rng: Rng) {
  const def = rng.pick(HARVESTERS);
  // one terrain is common, so a site may be sparse, dense or held at a bound
  const common = rng.int(0, 6);
  const density = rng.pick([0, 0.1, 0.5, 0.9, 1]);
  const map = emptyMap(1, SIDE, SIDE, Terrain.Water);
  for (let i = 0; i < SIDE * SIDE; i++)
    map.terrain[i] = rng.chance(density) ? common : rng.int(0, 6);
  map.biome[MID * SIDE + MID] = rng.int(0, BIOME_DEFS.length - 1);
  return {
    map,
    defId: def.id,
    season: rng.pick(SEASONS),
    productionMul: rng.pick([1, 1, 0.5, 2, rng.range(0.1, 5)]),
    level: rng.int(1, MAX_LEVEL),
  };
}
type Site = ReturnType<typeof site>;
const format = (s: Site) =>
  JSON.stringify({
    ...s,
    map: Array.from(s.map.terrain).join(''),
    biome: s.map.biome[MID * SIDE + MID],
  });

describe('the placing tooltip', () => {
  it('is offered for every station that harvests, the Full chain included', () => {
    expect(
      HARVESTERS.some((d) => d.supply === 'full'),
      'a Full chain harvester',
    ).toBe(true);
    for (const d of HARVESTERS) expect(STR.tile.phrase[d.terrain!], d.id).toBeDefined();
  });

  it('is titled after the station, then gives its rows and how to place it', () => {
    forAll(
      site,
      (s) => {
        const def = STATION_DEFS.find((d) => d.id === s.defId)!;
        const b = breakdown(s.map, s.defId, s.season, s.productionMul);
        const doc = placingTip({
          name: def.name,
          refusal: null,
          breakdown: b,
          cargo: cargoOf(def.id),
          weeklyAtLevel1: WEEKLY,
        });
        expect(doc[0]).toEqual({ kind: 'title', parts: [STR.placing.title(def.name)] });
        expect(shape(doc.slice(1, -1))).toEqual(shape(rows(b)));
        expect(doc.at(-1)).toEqual({ kind: 'hint', parts: [STR.placing.click] });
      },
      { format },
    );
  });

  it('says only why, in red, where the station cannot stand', () => {
    const b = breakdown(mapWith(Terrain.Grass, [], Terrain.Grass));
    for (const reason of [STR.build.occupied, STR.build.nothingOn.water, STR.build.needTrack]) {
      const doc = placingTip({
        name: 'Farm Halt',
        refusal: reason,
        // what a breakdown would say is not shown
        breakdown: b,
        cargo: ['wheat'],
        weeklyAtLevel1: WEEKLY,
      });
      expect(doc).toHaveLength(2);
      expect(doc[1]).toEqual({ kind: 'text', parts: [reason], tone: 'bad' });
      expect(rowsOf(doc)).toEqual([]);
    }
  });
});

describe('the yield rows', () => {
  it('give one row per distance with matching ground, nearest first, its count and share', () => {
    forAll(
      site,
      (s) => {
        const b = breakdown(s.map, s.defId, s.season, s.productionMul, s.level);
        const { ring } = read(rows(b));
        const counted = b.rings.filter((r) => r.n > 0);
        expect(ring).toHaveLength(counted.length);
        const phrase = STR.tile.phrase[b.terrain];
        ring.forEach((r, i) => {
          const { n, d, contribution: c } = counted[i];
          expect(nums(r.label), 'the count, then the distance').toEqual([String(n), String(d)]);
          // one tile is named in the singular, more in the plural
          expect(r.label).toContain(n === 1 ? phrase.one : phrase.many);
          expect(r.label).not.toContain(n === 1 ? phrase.many : phrase.one);
          expect(r.value).toEqual([{ num: contribution(c) }]);
          expect(r.tone, 'a ring row has no colour').toBeUndefined();
        });
      },
      { format },
    );
  });

  it('name a single tile in the singular and several in the plural', () => {
    // one grass tile beside the farm, three two away
    const b = breakdown(
      mapWith(
        Terrain.Water,
        [
          [1, 0],
          [2, 0],
          [0, 2],
          [-2, -2],
        ],
        Terrain.Grass,
      ),
    );
    const { ring } = read(rows(b));
    expect(ring.map((r) => plain(r.label))).toEqual([
      STR.placing.ring
        .replace('{n}', '1')
        .replace('{tiles}', STR.tile.phrase.grass.one)
        .replace('{d}', '1'),
      STR.placing.ring
        .replace('{n}', '3')
        .replace('{tiles}', STR.tile.phrase.grass.many)
        .replace('{d}', '2'),
    ]);
    expect(ring.map((r) => nums(r.value))).toEqual([['+0.50'], ['+1.00']]);
  });

  it('show Placement green from 1 up and red below, and say when it is held at a bound', () => {
    forAll(
      site,
      (s) => {
        const b = breakdown(s.map, s.defId, s.season, s.productionMul);
        const { placement } = read(rows(b));
        expect(plain(placement.label)).toBe(STR.placing.placement);
        expect(placement.tone).toBe(b.factor >= 1 ? 'good' : 'bad');
        expect(nums(placement.value)).toEqual([multiplier(b.factor)]);
        const held = placement.value.filter(isDim).map((p) => p.dim);
        expect(held).toEqual(
          b.clamped === 'ceil'
            ? [STR.placing.atMost]
            : b.clamped === 'floor'
              ? [STR.placing.atLeast]
              : [],
        );
      },
      { format },
    );
  });

  it('hold Placement at its ceiling on dense ground and at its floor on none', () => {
    const dense = read(rows(breakdown(mapWith(Terrain.Grass, [], Terrain.Grass)))).placement;
    expect(dense.value).toEqual([{ dim: STR.placing.atMost }, ' ', { num: '×1.60' }]);
    expect(dense.tone).toBe('good');
    const none = read(rows(breakdown(mapWith(Terrain.Water, [], Terrain.Grass)))).placement;
    expect(none.value).toEqual([{ dim: STR.placing.atLeast }, ' ', { num: '×0.15' }]);
    expect(none.tone).toBe('bad');
  });

  it('name the biome of the station tile as a term, green above 1, red below, plain at 1', () => {
    forAll(
      site,
      (s) => {
        const b = breakdown(s.map, s.defId, s.season, s.productionMul);
        const { biome } = read(rows(b));
        const term = biome.label.find(isTerm);
        expect(term?.term).toBe(biomeDef(s.map.biome[MID * SIDE + MID] as Biome).name);
        expect(biome.value).toEqual([{ num: multiplier(b.biomeMul) }]);
        expect(biome.tone).toBe(b.biomeMul > 1 ? 'good' : b.biomeMul < 1 ? 'bad' : undefined);
      },
      { format },
    );
    // a farm: plains suit it, the desert does not, and a forest biome leaves it alone
    const tone = (biome: string) =>
      read(rows(breakdown(mapWith(Terrain.Grass, [], Terrain.Grass, biomeId(biome))))).biome.tone;
    expect(tone('plains')).toBe('good');
    expect(tone('desert')).toBe('bad');
    expect(tone('forest')).toBeUndefined();
  });

  it('give a Season row and a Game tuning row only when they change the yield', () => {
    forAll(
      site,
      (s) => {
        const b = breakdown(s.map, s.defId, s.season, s.productionMul);
        const { season, tuning } = read(rows(b));
        if (b.seasonMul === 1) expect(season).toBeNull();
        else {
          expect(plain(season!.label)).toBe(STR.placing.season[b.season]);
          expect(season!.value).toEqual([{ num: multiplier(b.seasonMul) }]);
          expect(season!.tone).toBe(b.seasonMul > 1 ? 'good' : 'bad');
        }
        if (b.rulesMul === 1) expect(tuning).toBeNull();
        else {
          expect(tuning!.value).toEqual([{ num: multiplier(b.rulesMul) }]);
          expect(tuning!.tone).toBe(b.rulesMul > 1 ? 'good' : 'bad');
        }
      },
      { format },
    );
    const map = mapWith(Terrain.Grass, [], Terrain.Grass);
    const plainRows = read(rows(breakdown(map, 'farm', 'spring', 1)));
    expect([plainRows.season, plainRows.tuning]).toEqual([null, null]);
    const autumn = read(rows(breakdown(map, 'farm', 'autumn', 2)));
    expect([autumn.season?.tone, autumn.tuning?.tone]).toEqual(['good', 'good']);
    const winter = read(rows(breakdown(map, 'farm', 'winter', 0.5)));
    expect([winter.season?.tone, winter.tuning?.tone]).toEqual(['bad', 'bad']);
  });

  it('end with the total a week the breakdown gives, under a rule, after the resource', () => {
    forAll(
      site,
      (s) => {
        const b = breakdown(s.map, s.defId, s.season, s.productionMul, s.level);
        const { total } = read(rows(b));
        expect(total.total).toBe(true);
        expect(nums(total.value)).toEqual([weekly(b.perWeek)]);
        const shown = total.label.flatMap((p) =>
          typeof p !== 'string' && 'res' in p ? [p.res] : [],
        );
        expect(shown).toEqual(cargoOf(s.defId));
      },
      { format },
    );
  });

  it('are what a station panel shows for a harvest station, and the biome term for any other', () => {
    const map = mapWith(Terrain.Grass, [], Terrain.Grass, biomeId('desert'));
    const b = breakdown(map, 'farm', 'summer', 2, 3);
    const biome = biomeId('desert');
    expect(
      shape(groundRows({ biome, breakdown: b, cargo: ['wheat'], weeklyAtLevel1: WEEKLY })),
    ).toEqual(shape(harvestRows(b, ['wheat'], WEEKLY)));
    const other = groundRows({ biome, breakdown: null, cargo: [], weeklyAtLevel1: WEEKLY });
    expect(other).toHaveLength(1);
    const row = other[0] as Row;
    expect(row.label).toEqual([STR.station.biome]);
    expect(row.value.find(isTerm)?.term).toBe(biomeDef(biome).name);
  });
});

describe('the yield label', () => {
  it('is the weekly yield in whole units', () => {
    forAll(
      (rng) => rng.pick([0, 0.49, 0.5, 4.5, 37.5, rng.range(0, 400), rng.range(0, 400)]),
      (v) => {
        const tokens = richText(yieldLabel(v))
          .filter(isNum)
          .map((p) => p.num);
        expect(tokens).toEqual([String(Math.round(v))]);
      },
    );
  });
});
