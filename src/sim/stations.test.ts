import { describe, it, expect, beforeEach } from 'vitest';
import {
  STATION_DEFS,
  Station,
  MAX_LEVEL,
  LEVELS,
  HARVEST_CELLS_MAX,
  HARVEST_RADIUS,
  HarvestCells,
  harvestBreakdown,
  resetStationIds,
  stationDef,
  terrainFactorAt,
  weeklyOutput,
  type HarvestBreakdown,
  type StationJSON,
} from './stations';
import { rules, DEFAULT_RULES, weekSeconds } from './rules';
import { SEASONS, productionMul, seasonOf, setSeasonOffset, type Season } from './weather';
import { biomeAt, biomeDef } from './biomes';
import { TERRAIN_NAMES, Terrain, inBounds, terrainAt, type GameMap } from '../world/tiles';
import { emptyMap, generateMap } from '../world/mapgen';
import type { LevelStation } from '../world/level';
import { Rng } from '../engine/rng';
import { forAll, shrinkArray } from '../testing/property';
import { simWorld, mapParams, line, station as placeStation } from '../testing/simWorld';
import { placeSpan } from './doors';
import { behavesAs } from '../data/content';

/** A value as it reads back from JSON. */
const asStored = (v: unknown): unknown => JSON.parse(JSON.stringify(v));
/** Every whole level a station has, 1 to MAX_LEVEL. */
const WHOLE_LEVELS = Array.from({ length: MAX_LEVEL }, (_, i) => i + 1);
/** The depot kinds: a depot's upgrade never takes time (`Builder.upgradeStation`). */
const DEPOTS = STATION_DEFS.filter((d) => d.depot);
/** Levels a save could hold that no build wrote: none, no number, not whole, out of range. */
const ODD_LEVELS: readonly unknown[] = [
  undefined,
  null,
  Number.NaN,
  Infinity,
  -Infinity,
  0,
  -0,
  -1,
  -7,
  0.5,
  1.5,
  2.999,
  5.5,
  6.5,
  MAX_LEVEL + 1,
  99,
  1e300,
  -1e300,
  Number.MAX_VALUE,
  Number.MIN_VALUE,
  -Number.MIN_VALUE,
  '3',
  '',
  true,
  false,
  {},
  [],
  [2],
];

/**
 * The level a station must have for a saved `v`, read from the rule and apart from the code: the
 * highest whole level that is no more than `v` when `v` is a number of at least 1, else 1.
 */
function levelFor(v: unknown): number {
  if (typeof v !== 'number' || !(v >= 1)) return 1;
  let level = 1;
  for (const l of WHOLE_LEVELS) if (l <= v) level = l;
  return level;
}

/** A saved level of any kind: a whole one, an odd one, or any number. */
function genLevel(rng: Rng): unknown {
  switch (rng.int(0, 3)) {
    case 0:
      return rng.pick(WHOLE_LEVELS);
    case 1:
      return rng.pick(ODD_LEVELS);
    case 2:
      return rng.range(-3, MAX_LEVEL + 3);
    default:
      return rng.pick([-1, 1]) * rng.range(0, 1) * 10 ** rng.int(-5, 300);
  }
}

/** A work a save could hold: a well-formed one towards some level, a broken one, or none. */
function genWork(rng: Rng, toward: number): unknown {
  const total = rng.pick([rng.range(0.1, 400), 60, 1e-3]);
  switch (rng.int(0, 4)) {
    case 0:
      return rng.pick([undefined, null]);
    case 1:
      return { to: toward, left: rng.range(-50, total + 50), total };
    case 2:
      return { to: rng.int(-1, MAX_LEVEL + 2), left: rng.range(0, total), total };
    case 3:
      return {
        to: toward,
        left: rng.pick([Number.NaN, Infinity, '3', null, 5]),
        total: rng.pick([total, 0, -5, Infinity, Number.NaN, '60']),
      };
    default:
      return rng.pick(['x', 5, true, {}, [], { to: toward }]);
  }
}

/**
 * The work a station of a kind other than a depot must load with for a saved `work`, at the level
 * it loads at: a work towards the next level, no higher than MAX_LEVEL, with a finite time above 0
 * and a finite time left (kept within the time); null for anything else.
 */
function workFor(work: unknown, level: number) {
  if (typeof work !== 'object' || work === null) return null;
  const { to, left, total } = work as Record<string, unknown>;
  if (to !== level + 1 || level + 1 > MAX_LEVEL) return null;
  if (typeof total !== 'number' || !Number.isFinite(total) || total <= 0) return null;
  if (typeof left !== 'number' || !Number.isFinite(left)) return null;
  return { to, left: Math.min(total, Math.max(0, left)), total };
}

/** A station of `defId` as a save holds it, with `level` and `work` as given (none if absent). */
function savedStation(defId: string, level: unknown, work?: unknown): StationJSON {
  const j: Record<string, unknown> = {
    id: 1,
    defId,
    name: 'Alder',
    x: 4,
    y: 5,
    storage: {},
    market: {},
    rot: 0,
  };
  if (level !== undefined) j.level = level;
  if (work !== undefined) j.work = work;
  return j as unknown as StationJSON;
}

/** Every number a station reads from its level, finite, and an upgrade cost of finite amounts. */
function expectLevelNumbersFinite(s: Station, label: string) {
  const numbers = {
    crew: s.crew,
    capacity: s.capacity,
    loadRate: s.loadRate,
    platforms: s.platforms,
    productionPerWeek: s.productionPerWeek,
    spriteLevel: s.spriteLevel,
  };
  for (const [name, n] of Object.entries(numbers))
    expect(Number.isFinite(n), `${label}: ${name} is ${String(n)}`).toBe(true);
  const cost = s.upgradeCost();
  expect(typeof cost === 'object' && cost !== null, `${label}: upgrade cost`).toBe(true);
  for (const [k, n] of Object.entries(cost))
    expect(Number.isFinite(n), `${label}: upgrade cost ${k} is ${String(n)}`).toBe(true);
}

beforeEach(() => {
  Object.assign(rules, DEFAULT_RULES);
  resetStationIds(1);
  setSeasonOffset(0);
});

describe('a station read from a save or a level file', () => {
  it('has a whole level from 1 to MAX_LEVEL for any level held, a whole one in range unchanged', () => {
    for (const def of STATION_DEFS)
      for (const level of [...WHOLE_LEVELS, ...ODD_LEVELS]) {
        const label = `${def.id} at level ${String(level)}`;
        const want = levelFor(level);
        const s = Station.fromJSON(savedStation(def.id, level));
        expect(s.level, `${label}: save`).toBe(want);
        if (typeof level === 'number' && WHOLE_LEVELS.includes(level))
          expect(s.level, `${label}: a whole level in range`).toBe(level);
        const lv = Station.fromLevel({
          defId: def.id,
          x: 4,
          y: 5,
          level,
          name: 'A',
        } as LevelStation);
        expect(lv.level, `${label}: level file`).toBe(want);
        expectLevelNumbersFinite(s, `${label}: save`);
        expectLevelNumbersFinite(lv, `${label}: level file`);
      }
  });

  it('keeps the rule for any number a file holds, of every kind', () => {
    forAll(
      (rng) => ({ defId: rng.pick(STATION_DEFS).id, level: genLevel(rng) }),
      ({ defId, level }) => {
        const want = levelFor(level);
        const s = Station.fromJSON(savedStation(defId, level));
        expect(Number.isInteger(s.level), 'whole').toBe(true);
        expect(s.level).toBe(want);
        expect(
          Station.fromLevel({ defId, x: 0, y: 0, level, name: '' } as LevelStation).level,
        ).toBe(want);
        expectLevelNumbersFinite(s, defId);
        // written and read again, it is the same station
        const again = Station.fromJSON(asStored(s.toJSON()) as StationJSON);
        expect(again.toJSON()).toEqual(s.toJSON());
      },
    );
  });

  it('keeps a saved work only when it is a work towards the level it loads at plus one', () => {
    // The work is held to the level the station loads at, not the one the file held: a work
    // towards a fraction or past MAX_LEVEL is no upgrade a station can finish.
    forAll(
      (rng) => {
        const defId = rng.pick(STATION_DEFS).id;
        const level = genLevel(rng);
        const raw = typeof level === 'number' ? level + 1 : levelFor(level) + 1;
        const toward = rng.pick([levelFor(level) + 1, raw, levelFor(level), levelFor(level) + 2]);
        return { defId, level, work: genWork(rng, toward) };
      },
      ({ defId, level, work }) => {
        const s = Station.fromJSON(savedStation(defId, level, work));
        const want = s.def.depot ? null : workFor(work, levelFor(level));
        expect(s.work).toEqual(want);
        if (s.work) expect(s.work.to, 'towards the next level').toBe(s.level + 1);
        expect(s.closed).toBe(want !== null);
        expect(s.toJSON().work).toEqual(want);
      },
    );
  });
});

describe('a depot read from a save', () => {
  it('is one of two kinds: the depot and the narrow depot', () => {
    expect(DEPOTS.map((d) => d.id).sort()).toEqual(['depot', 'narrow_depot']);
  });

  it('loads open at every level, whatever work its save holds', () => {
    for (const def of DEPOTS)
      for (const level of WHOLE_LEVELS)
        for (const work of [
          { to: level + 1, left: 30, total: 60 },
          { to: level + 1, left: 60, total: 60 },
          { to: level + 1, left: 0, total: 60 },
          { to: level, left: 30, total: 60 },
          null,
          undefined,
        ]) {
          const label = `${def.id} at level ${level} with ${JSON.stringify(work)}`;
          const s = Station.fromJSON(savedStation(def.id, level, work));
          expect(s.closed, label).toBe(false);
          expect(s.work, label).toBeNull();
          expect(s.crew, label).not.toBe(0);
          expect(s.toJSON().work, `${label}: written again`).toBeNull();
        }
  });

  it('loads open for any level and work a file holds', () => {
    forAll(
      (rng) => {
        const level = genLevel(rng);
        return { defId: rng.pick(DEPOTS).id, level, work: genWork(rng, levelFor(level) + 1) };
      },
      ({ defId, level, work }) => {
        const s = Station.fromJSON(savedStation(defId, level, work));
        expect(s.closed).toBe(false);
        expect(s.work).toBeNull();
        expect(s.crew).toBeGreaterThan(0);
      },
    );
  });
});

describe('a station of any other kind read from a save', () => {
  it('still loads closed with a work under way kept, at every level that has a next one', () => {
    for (const def of STATION_DEFS.filter((d) => !d.depot))
      for (const level of WHOLE_LEVELS.slice(0, -1)) {
        const label = `${def.id} at level ${level}`;
        const work = { to: level + 1, left: 30, total: 60 };
        const s = Station.fromJSON(savedStation(def.id, level, work));
        expect(s.closed, label).toBe(true);
        expect(s.work, label).toEqual(work);
        expect(s.crew, label).toBe(0);
        expect(s.toJSON().work, `${label}: written again`).toEqual(work);
      }
  });
});

/** The ground each harvesting kind counts, as the game has always counted it. */
const COUNTS: Record<string, readonly Terrain[]> = {
  farm: [Terrain.Grass],
  big_farm: [Terrain.Grass],
  lumber: [Terrain.Forest],
  quarry: [Terrain.Rock, Terrain.Hill],
  mine: [Terrain.Rock, Terrain.Hill],
  copper_mine: [Terrain.Rock, Terrain.Hill],
  sand_pit: [Terrain.Sand],
  pump: [Terrain.Water],
};
/** Every kind of station that harvests ground, of the plain and the full production chain. */
const HARVESTERS = STATION_DEFS.filter((d) => d.terrain);
/**
 * Every terrain a tile can have, read from the names so a terrain added later (a waterfall, a
 * headwater) lands in the patchwork, where the recount counts it only if COUNTS lists it.
 */
const TERRAINS = TERRAIN_NAMES.map((_, i) => i as Terrain);

/**
 * terrainFactorAt as it stood before the harvest breakdown, kept verbatim as the oracle: every
 * placed station, and every save on load, got its factor from it. Only the footprint is new: the
 * ground is counted from the nearest tile of the station's footprint (`footprintOf`, from its
 * span), and a station of one tile is as it was.
 */
function factorBefore(map: GameMap, x: number, y: number, defId: string, rot = 0): number {
  const want = stationDef(defId).terrain;
  if (!want) return 1;
  const match = (t: Terrain) =>
    want === 'grass'
      ? t === Terrain.Grass
      : want === 'forest'
        ? t === Terrain.Forest
        : want === 'rock'
          ? t === Terrain.Rock || t === Terrain.Hill
          : want === 'sand'
            ? t === Terrain.Sand
            : t === Terrain.Water;
  let sum = 0;
  const feet = footprintOf(x, y, defId, rot);
  for (let ty = y - 4; ty <= y + feet.h + 3; ty++)
    for (let tx = x - 4; tx <= x + feet.w + 3; tx++) {
      if (!inBounds(map, tx, ty)) continue;
      if (!match(terrainAt(map, tx, ty))) continue;
      const d = feet.nearest(tx, ty);
      if (!d) continue;
      sum += 1 / (1 + d);
    }
  return Math.max(0.15, Math.min(1.6, sum / 12));
}

/**
 * Station.productionPerWeek as it stood before the harvest breakdown, kept verbatim as the oracle:
 * what every station made a week, under the live rules.
 */
function perWeekBefore(s: Station): number {
  if (s.closed) return 0;
  const rate = LEVELS.production[s.level - 1] * rules.productionMul * s.terrainFactor;
  return behavesAs(s.def) === 'station' ? Math.min(rate, s.passengerPopulation * 0.4) : rate;
}

/** A breakdown's rows, without the buffer its tiles went into (`tilesOf` reads that). */
function rowsOf(b: HarvestBreakdown | null): Partial<HarvestBreakdown> | null {
  if (!b) return null;
  const rows: Partial<HarvestBreakdown> = { ...b };
  delete rows.cells;
  return rows;
}
/** The tiles a breakdown counted, as its buffer holds them now. */
function tilesOf(b: HarvestBreakdown | null) {
  if (!b) return null;
  const c = b.cells;
  return Array.from({ length: c.count }, (_, i) => [c.x[i], c.y[i], c.d[i], c.weight[i]]);
}
/** Copies of a failing case with one field set back to a plain value; none equal to the case. */
function plainer<T extends object>(c: T, plain: Partial<T>): T[] {
  const out: T[] = [];
  for (const k of Object.keys(plain) as (keyof T)[])
    if (!Object.is(c[k], plain[k])) out.push({ ...c, [k]: plain[k] });
  return out;
}
/** Every number a level could be given as: whole, odd or out of range. */
const NUMBER_LEVELS = [
  ...WHOLE_LEVELS,
  ...ODD_LEVELS.filter((v): v is number => typeof v === 'number'),
];

/**
 * The footprint of a station of the kind with its corner at (x, y), turned to `rot`, listed tile
 * by tile and measured by looking at every one, so that it shares no arithmetic with the code.
 */
function footprintOf(x: number, y: number, defId: string, rot: number) {
  const span = placeSpan(stationDef(defId));
  const [w, h] = rot % 2 === 0 ? [span.w, span.h] : [span.h, span.w];
  const tiles: { x: number; y: number }[] = [];
  for (let ty = y; ty < y + h; ty++)
    for (let tx = x; tx < x + w; tx++) tiles.push({ x: tx, y: ty });
  /** the Chebyshev distance from (tx, ty) to the nearest tile of the footprint; 0 inside it */
  const nearest = (tx: number, ty: number) =>
    Math.min(...tiles.map((t) => Math.max(Math.abs(t.x - tx), Math.abs(t.y - ty))));
  return { w, h, nearest };
}

/** The tiles a harvest at (x, y) must count, rows north to south, each west to east. */
function countedTiles(map: GameMap, x: number, y: number, defId: string, rot = 0) {
  const out: { x: number; y: number; d: number }[] = [];
  const feet = footprintOf(x, y, defId, rot);
  for (let ty = y - 4; ty <= y + feet.h + 3; ty++)
    for (let tx = x - 4; tx <= x + feet.w + 3; tx++) {
      const d = feet.nearest(tx, ty);
      if (!d || !inBounds(map, tx, ty)) continue;
      if (!COUNTS[defId].includes(terrainAt(map, tx, ty))) continue;
      out.push({ x: tx, y: ty, d });
    }
  return out;
}

/** Where a breakdown is asked for: the kind, the tile, the level and the season. */
interface HarvestSite {
  x: number;
  y: number;
  defId: string;
  level: number;
  season: Season;
  /** the footprint's turn, 0 where it is not given */
  rot?: number;
}

/**
 * What a station of the kind placed on the tile at the level makes a week in the season, under
 * the live rules: its own productionPerWeek times the season and biome multiplier Game gives it
 * on placing (`Game.onStationChanged`).
 */
function stationOutput(map: GameMap, at: HarvestSite) {
  const s = new Station(at.defId, at.x, at.y);
  s.level = at.level;
  s.rot = at.rot ?? 0;
  s.terrainFactor = terrainFactorAt(map, at.x, at.y, at.defId, s.rot);
  s.productionMul =
    productionMul(behavesAs(stationDef(at.defId)), at.season) *
    (biomeDef(biomeAt(map, at.x, at.y)).production[behavesAs(stationDef(at.defId))] ?? 1);
  return s.productionPerWeek * s.productionMul;
}

/** Every row of a breakdown, each read again from the map apart from the code that made it. */
function expectBreakdown(b: HarvestBreakdown | null, map: GameMap, at: HarvestSite, label: string) {
  const { x, y, defId, level, season } = at;
  const rot = at.rot ?? 0;
  expect(b, `${label}: a harvesting station has a breakdown`).not.toBeNull();
  if (!b) return;
  const want = countedTiles(map, x, y, defId, rot);
  const got = Array.from({ length: b.cells.count }, (_, i) => ({
    x: b.cells.x[i],
    y: b.cells.y[i],
    d: b.cells.d[i],
  }));
  expect(got, `${label}: the tiles counted, in order`).toEqual(want);
  let sum = 0;
  for (let i = 0; i < b.cells.count; i++) {
    expect(b.cells.weight[i], `${label}: weight of tile ${i}`).toBe(1 / (1 + b.cells.d[i]));
    sum += b.cells.weight[i];
  }
  expect(b.sum, `${label}: the sum of the weights, in order`).toBe(sum);
  expect(
    b.rings.map((r) => r.d),
    `${label}: one ring per distance`,
  ).toEqual([1, 2, 3, 4]);
  let fromRings = 0;
  for (const r of b.rings) {
    expect(r.n, `${label}: tiles at ${r.d}`).toBe(want.filter((c) => c.d === r.d).length);
    expect(r.contribution, `${label}: ring ${r.d}`).toBe(r.n / (1 + r.d));
    fromRings += r.contribution;
  }
  expect(Math.abs(fromRings - b.sum), `${label}: the rings add up to the sum`).toBeLessThan(1e-12);
  expect(b.raw, `${label}: raw`).toBe(b.sum / 12);
  const clamped = b.raw < 0.15 ? 'floor' : b.raw > 1.6 ? 'ceil' : null;
  expect(b.clamped, `${label}: clamped`).toBe(clamped);
  expect(b.factor, `${label}: factor`).toBe(
    clamped === 'floor' ? 0.15 : clamped === 'ceil' ? 1.6 : b.raw,
  );
  expect(b.factor, `${label}: the factor stations always got`).toBe(
    factorBefore(map, x, y, defId, rot),
  );
  expect(terrainFactorAt(map, x, y, defId, rot), `${label}: terrainFactorAt`).toBe(b.factor);
  const biome = biomeDef(biomeAt(map, x, y));
  expect(b.biome, `${label}: biome of its own tile`).toBe(biome.id);
  expect(b.biomeMul, `${label}: biome multiplier`).toBe(
    biome.production[behavesAs(stationDef(defId))] ?? 1,
  );
  expect([b.season, b.seasonMul], `${label}: season`).toEqual([
    season,
    productionMul(behavesAs(stationDef(defId)), season),
  ]);
  expect(b.rulesMul, `${label}: tuning`).toBe(rules.productionMul);
  expect([b.level, b.base], `${label}: the level's base`).toEqual([
    level,
    LEVELS.production[level - 1],
  ]);
  const product = b.base * b.rulesMul * b.factor * b.biomeMul * b.seasonMul;
  expect(
    Math.abs(b.perWeek - product),
    `${label}: per week is the product of the rows`,
  ).toBeLessThanOrEqual(1e-12 * Math.max(1, product));
  expect(b.perWeek, `${label}: per week is what the station makes`).toBe(stationOutput(map, at));
}

/**
 * The seeds of the generated worlds cases are drawn on: a few, each generated once and kept, since
 * a new world plans the rivers of the chunks around its start (#341), most of a tenth of a second.
 */
const WORLD_SEEDS = [1, 7412, 20260912, 31337];
/** A map a case is drawn on: a new game's, a patchwork of every terrain and biome, or grass. */
interface MapSpec {
  kind: 'generated' | 'patchwork' | 'grass';
  seed: number;
  size: number;
}
const MAPS = new Map<string, GameMap>();
function mapOf(m: MapSpec): GameMap {
  const key = JSON.stringify(m);
  let map = MAPS.get(key);
  if (map) return map;
  if (m.kind === 'generated') map = generateMap(m.seed, mapParams(m.size));
  else {
    map = emptyMap(m.seed, m.size, m.size, Terrain.Grass);
    if (m.kind === 'patchwork') {
      const rng = new Rng(m.seed);
      for (let i = 0; i < map.terrain.length; i++) {
        map.terrain[i] = rng.pick(TERRAINS);
        map.biome[i] = rng.int(0, 5);
      }
    }
  }
  MAPS.set(key, map);
  return map;
}

/** The limit of a property below that takes most of a second alone (docs/process/verification.md). */
const SLOW = { timeout: 20_000 };

describe('a harvest breakdown', () => {
  it('covers every harvesting kind, the full production chain included', () => {
    expect(HARVESTERS.map((d) => d.id).sort()).toEqual(Object.keys(COUNTS).sort());
    for (const id of ['mine', 'sand_pit', 'copper_mine'])
      expect(stationDef(id).supply, `${id} is of the full chain`).toBe('full');
  });

  // a map per seed (the generated ones of a few worlds) and 24 sites read again tile by tile:
  // about two seconds alone
  it(
    'counts each tile at its weight, gives the rows the demo shows, and the factor and yield stations always got',
    SLOW,
    () => {
      const seen = { floor: 0, ceil: 0, within: 0 };
      forAll(
        (rng) => {
          const size = rng.pick([12, 24, 40]);
          const kind = rng.pick(['generated', 'generated', 'patchwork', 'grass'] as const);
          const seed = kind === 'generated' ? rng.pick(WORLD_SEEDS) : rng.int(1, 1_000_000);
          const map: MapSpec = { kind, seed, size };
          // tiles over the whole map and a band past its edges, where no station stands
          const tiles = Array.from({ length: 24 }, () => ({
            x: rng.int(-3, size + 2),
            y: rng.int(-3, size + 2),
          }));
          return {
            map,
            defId: rng.pick(HARVESTERS).id,
            level: rng.int(1, MAX_LEVEL),
            season: rng.pick(SEASONS),
            rot: rng.int(0, 3),
            productionMul: rng.pick([1, 0, 0.1, 2.5, 5, Math.round(rng.range(0, 50)) / 10]),
            tiles,
          };
        },
        (c) => {
          rules.productionMul = c.productionMul;
          const map = mapOf(c.map);
          const cells = new HarvestCells();
          for (const t of c.tiles) {
            const at = { ...t, defId: c.defId, level: c.level, season: c.season, rot: c.rot };
            const b = harvestBreakdown(
              map,
              t.x,
              t.y,
              c.defId,
              c.level,
              c.season,
              rules,
              cells,
              c.rot,
            );
            expectBreakdown(b, map, at, `${c.defId} at ${t.x},${t.y}`);
            expect(b?.cells, 'the tiles go into the buffer given').toBe(cells);
            if (b?.clamped === 'floor') seen.floor++;
            else if (b?.clamped === 'ceil') seen.ceil++;
            else seen.within++;
          }
        },
        { shrink: (c) => [...shrinkArray(c.tiles)].map((tiles) => ({ ...c, tiles })) },
      );
      // not vacuous: sparse, plain and crowded sites all came up
      expect(seen.floor).toBeGreaterThan(0);
      expect(seen.ceil).toBeGreaterThan(0);
      expect(seen.within).toBeGreaterThan(0);
    },
  );

  it('gives a farm on plain grass at level 1 its base of 30, its ground held at the ceiling', () => {
    const map = emptyMap(1, 11, 11, Terrain.Grass);
    // every tile within the radius of its one tile is grass: 8/2 + 16/3 + 24/4 + 32/5 = 21.7, raw 1.81
    const b = harvestBreakdown(map, 5, 4, 'farm', 1, 'spring', { productionMul: 1 });
    expect(b?.base).toBe(30);
    expect(b?.rings.map((r) => r.n)).toEqual([8, 16, 24, 32]);
    expect(b?.clamped).toBe('ceil');
    expect(b?.factor).toBe(1.6);
    expect([b?.biome, b?.biomeMul, b?.seasonMul]).toEqual(['plains', 1.25, 1]);
    expect(b?.perWeek).toBe(30 * 1 * 1.6 * (1 * 1.25));
  });

  it('gives a Big Farm Halt the same base, season and biome, its ground round its two tiles', () => {
    const map = emptyMap(1, 11, 11, Terrain.Grass);
    // every tile within the radius of its two tiles is grass: 10/2 + 18/3 + 26/4 + 34/5 = 24.3, raw 2.03
    const b = harvestBreakdown(map, 5, 4, 'big_farm', 1, 'spring', { productionMul: 1 });
    expect(b?.base).toBe(30);
    expect(b?.rings.map((r) => r.n)).toEqual([10, 18, 26, 34]);
    expect(b?.clamped).toBe('ceil');
    expect(b?.factor).toBe(1.6);
    expect([b?.biome, b?.biomeMul, b?.seasonMul]).toEqual(['plains', 1.25, 1]);
    expect(b?.perWeek).toBe(30 * 1 * 1.6 * (1 * 1.25));
  });

  /** The tiles `cells` holds, as `x,y` keys with their distance. */
  const heldTiles = (cells: HarvestCells) => {
    const out = new Map<string, number>();
    for (let i = 0; i < cells.count; i++) out.set(`${cells.x[i]},${cells.y[i]}`, cells.d[i]);
    return out;
  };

  it("counts a Big Farm Halt's ground round its footprint, not round its corner", () => {
    // an 11 x 11 plain: the halt (1 x 2 at rotation 0) stands on 5,4 and 5,5, clear of the edges
    const map = emptyMap(1, 11, 11, Terrain.Grass);
    const cells = new HarvestCells();
    const b = harvestBreakdown(map, 5, 4, 'big_farm', 1, 'spring', { productionMul: 1 }, cells, 0);
    // ring d: the (1 + 2d) x (2 + 2d) tiles within d of the pair, less those inside it
    expect(b?.rings.map((r) => r.n)).toEqual([10, 18, 26, 34]);
    const tiles = heldTiles(cells);
    expect(tiles.has('5,5'), "the halt's second tile is not grass round it").toBe(false);
    expect(tiles.has('5,4'), 'nor is its corner').toBe(false);
    // a tile beyond the second tile is as near as one beside the corner
    expect(['5,3', '5,6', '6,5', '7,5', '5,8'].map((k) => tiles.get(k))).toEqual([1, 1, 1, 2, 3]);
  });

  it('turns the footprint with the halt: rotation 1 is 2 x 1, and rotation 2 is rotation 0', () => {
    const map = emptyMap(1, 11, 11, Terrain.Grass);
    const tuning = { productionMul: 1 };
    const at = (rot: number) => {
      const cells = new HarvestCells();
      const b = harvestBreakdown(map, 4, 5, 'big_farm', 1, 'spring', tuning, cells, rot);
      return { b, tiles: heldTiles(cells) };
    };
    const turned = at(1);
    expect(turned.b?.rings.map((r) => r.n)).toEqual([10, 18, 26, 34]);
    expect(turned.tiles.has('5,5'), 'the second tile, east of the corner').toBe(false);
    expect(turned.tiles.has('4,6'), 'a tile that is the second at rotation 0').toBe(true);
    const a = at(0);
    const c = at(2);
    expect([...c.tiles]).toEqual([...a.tiles]);
    expect(c.b?.sum).toBe(a.b?.sum);
    // terrainFactorAt reads the same footprint
    expect(terrainFactorAt(map, 4, 5, 'big_farm', 1)).toBe(turned.b?.factor);
    expect(terrainFactorAt(map, 4, 5, 'big_farm', 0)).toBe(a.b?.factor);
  });

  it('holds a one-tile station to the ring it always had, whatever the rotation', () => {
    const map = emptyMap(1, 9, 9, Terrain.Forest);
    const tuning = { productionMul: 1 };
    const base = harvestBreakdown(map, 4, 4, 'lumber', 1, 'spring', tuning);
    expect(base?.rings.map((r) => r.n)).toEqual([8, 16, 24, 32]);
    for (let rot = 0; rot < 4; rot++) {
      const b = harvestBreakdown(map, 4, 4, 'lumber', 1, 'spring', tuning, undefined, rot);
      expect(
        b?.rings.map((r) => r.n),
        `rotation ${rot}`,
      ).toEqual([8, 16, 24, 32]);
      expect(b?.sum).toBe(base?.sum);
    }
  });

  it('gives its buffer room for the ring round the largest footprint a harvester takes', () => {
    for (const d of HARVESTERS) {
      const { w, h } = placeSpan(d);
      const ring = (w + 2 * HARVEST_RADIUS) * (h + 2 * HARVEST_RADIUS) - w * h;
      expect(ring, `${d.id}: ${w} x ${h}`).toBeLessThanOrEqual(HARVEST_CELLS_MAX);
    }
  });

  it('is null, with factor 1 and no tiles, for a station that harvests nothing', () => {
    const map = mapOf({ kind: 'patchwork', seed: 5, size: 16 });
    const cells = new HarvestCells();
    for (const def of STATION_DEFS.filter((d) => !d.terrain)) {
      // an earlier harvest left its tiles in the buffer
      harvestBreakdown(map, 8, 8, 'farm', 1, 'spring', rules, cells);
      expect(cells.count).toBeGreaterThan(0);
      expect(harvestBreakdown(map, 8, 8, def.id, 1, 'summer', rules, cells), def.id).toBeNull();
      expect(cells.count, `${def.id}: no tiles`).toBe(0);
      expect(terrainFactorAt(map, 8, 8, def.id), def.id).toBe(1);
    }
  });

  it('writes a later call over an earlier one in the same buffer', () => {
    const map = mapOf({ kind: 'patchwork', seed: 9, size: 20 });
    const cells = new HarvestCells();
    const first = harvestBreakdown(map, 2, 2, 'lumber', 1, 'spring', rules, cells);
    const second = harvestBreakdown(map, 15, 12, 'quarry', 3, 'winter', rules, cells);
    expect(first?.cells).toBe(cells);
    expect(second?.cells).toBe(cells);
    const at: HarvestSite = { x: 15, y: 12, defId: 'quarry', level: 3, season: 'winter' };
    expectBreakdown(second, map, at, 'second');
  });

  it("leaves a caller's tiles alone: a call without a buffer, or terrainFactorAt, writes elsewhere", () => {
    forAll(
      (rng) => {
        const site = () => ({
          x: rng.int(0, 23),
          y: rng.int(0, 23),
          defId: rng.pick(HARVESTERS).id,
        });
        return { seed: rng.int(1, 1_000_000), held: site(), own: site(), later: [site(), site()] };
      },
      (c) => {
        const map = mapOf({ kind: 'patchwork', seed: c.seed, size: 24 });
        const ask = (s: { x: number; y: number; defId: string }, buffer?: HarvestCells) =>
          harvestBreakdown(map, s.x, s.y, s.defId, 1, 'spring', rules, buffer);
        const cells = new HarvestCells();
        // the hover's buffer, then terrainFactorAt straight after it (a placement, a terrain edit)
        const held = ask(c.held, cells);
        const heldTiles = tilesOf(held);
        for (const s of c.later) terrainFactorAt(map, s.x, s.y, s.defId);
        expect(tilesOf(held), 'the buffer given, after terrainFactorAt').toEqual(heldTiles);
        // a breakdown that was given none, then more of both
        const own = ask(c.own);
        expect(own?.cells, 'a buffer of its own').not.toBe(cells);
        const ownTiles = tilesOf(own);
        for (const s of c.later) {
          ask(s);
          terrainFactorAt(map, s.x, s.y, s.defId);
        }
        expect(tilesOf(held), 'the buffer given').toEqual(heldTiles);
        expect(tilesOf(own), 'the buffer made for a call').toEqual(ownTiles);
        expect(tilesOf(held), 'what a fresh call counts').toEqual(tilesOf(ask(c.held)));
      },
      { shrink: (c) => [...shrinkArray(c.later)].map((later) => ({ ...c, later })) },
    );
  });

  it('reads the tuning it is given and not the live rules, and the live rules when given none', () => {
    forAll(
      (rng) => {
        const kind = rng.pick(['generated', 'patchwork'] as const);
        const seed = kind === 'generated' ? rng.pick(WORLD_SEEDS) : rng.int(1, 1_000_000);
        return {
          map: { kind, seed, size: 24 },
          defId: rng.pick(HARVESTERS).id,
          level: rng.pick(WHOLE_LEVELS),
          season: rng.pick(SEASONS),
          x: rng.int(0, 23),
          y: rng.int(0, 23),
          // the two never agree, so reading the wrong one shows in rulesMul and perWeek
          live: rng.pick([1, 0.5, 3]),
          given: rng.pick([0.25, 2, 4.2, rng.range(0.1, 0.4)]),
        };
      },
      (c) => {
        const map = mapOf(c.map);
        const at = [map, c.x, c.y, c.defId, c.level, c.season] as const;
        rules.productionMul = c.given;
        const asLive = rowsOf(harvestBreakdown(...at, rules));
        rules.productionMul = c.live;
        const given = rowsOf(harvestBreakdown(...at, { productionMul: c.given }));
        expect(given?.rulesMul, 'the tuning given').toBe(c.given);
        expect(given, 'what the live rules give when they are that tuning').toEqual(asLive);
        const byDefault = rowsOf(harvestBreakdown(...at));
        expect(byDefault?.rulesMul, 'none given: the live rules').toBe(c.live);
        expect(byDefault, 'none given').toEqual(rowsOf(harvestBreakdown(...at, rules)));
        const f = given?.factor ?? NaN;
        rules.productionMul = c.given;
        const asLiveWeek = weeklyOutput(c.level, f);
        rules.productionMul = c.live;
        expect(weeklyOutput(c.level, f, { productionMul: c.given }), 'weeklyOutput').toBe(
          asLiveWeek,
        );
      },
      { shrink: (c) => plainer(c, { level: 1, season: 'spring' as Season }) },
    );
  });

  it('is the breakdown of the whole level a station would have, for any level it is given', () => {
    forAll(
      (rng) => ({
        map: { kind: 'patchwork' as const, seed: rng.int(1, 1_000_000), size: 16 },
        defId: rng.pick(HARVESTERS).id,
        season: rng.pick(SEASONS),
        x: rng.int(0, 15),
        y: rng.int(0, 15),
        level: rng.pick([
          rng.pick(NUMBER_LEVELS),
          rng.range(-3, MAX_LEVEL + 3),
          rng.pick([-1, 1]) * rng.range(0, 1) * 10 ** rng.int(-5, 300),
        ]),
      }),
      (c) => {
        const map = mapOf(c.map);
        const want = levelFor(c.level);
        const b = harvestBreakdown(map, c.x, c.y, c.defId, c.level, c.season);
        expect(b?.level, 'the whole level').toBe(want);
        expect(Number.isFinite(b?.perWeek), 'a finite yield').toBe(true);
        expect(rowsOf(b), `as at level ${want}`).toEqual(
          rowsOf(harvestBreakdown(map, c.x, c.y, c.defId, want, c.season)),
        );
      },
      { shrink: (c) => plainer(c, { season: 'spring' as Season }) },
    );
  });

  // a generated world per seed, one of a few, and seven stations placed on it: about two seconds
  // alone
  it(
    'gives the yield a station makes once placed, at every level, and gave it as a preview where it could not stand yet',
    SLOW,
    () => {
      const placed = new Map<string, number>();
      forAll(
        (rng) => ({
          seed: rng.pick(WORLD_SEEDS),
          seasonOffset: rng.int(0, 3),
          productionMul: rng.pick([1, 0.5, 2, Math.round(rng.range(0, 50)) / 10]),
          // per harvesting kind, where to try it, in order
          tries: HARVESTERS.map(() =>
            Array.from({ length: 30 }, () => ({ x: rng.int(1, 46), y: rng.int(1, 45) })),
          ),
        }),
        (c) => {
          setSeasonOffset(c.seasonOffset);
          rules.productionMul = c.productionMul;
          const w = simWorld({ seed: c.seed, size: 48 });
          const season = seasonOf(w.clock.day);
          HARVESTERS.forEach((def, k) => {
            for (const t of c.tries[k]) {
              const label = `${def.id} at ${t.x},${t.y}`;
              // the preview where it cannot stand: no track beside it, or the wrong ground
              if (w.builder.checkStation(t.x, t.y, def.id).ok) continue;
              const at: HarvestSite = { ...t, defId: def.id, level: 1, season };
              const before = harvestBreakdown(w.map, t.x, t.y, def.id, 1, season, rules);
              expectBreakdown(before, w.map, at, `${label}, before`);
              try {
                line(w, t.x, t.y + placeSpan(def).h, t.x);
                placeStation(w, def.id, t.x, t.y);
              } catch {
                continue;
              }
              const s = w.builder.stationAt(t.x, t.y);
              if (!s) throw new Error(`${label}: placed but not found`);
              placed.set(def.id, (placed.get(def.id) ?? 0) + 1);
              expect(before?.perWeek, `${label}: the preview is what it makes`).toBe(
                s.productionPerWeek * s.productionMul,
              );
              rules.capacityMul = 1e6;
              for (const level of WHOLE_LEVELS) {
                s.level = level;
                const b = harvestBreakdown(w.map, s.x, s.y, def.id, level, season, rules);
                expect(b?.factor, `${label}: factor`).toBe(s.terrainFactor);
                const perWeek = b?.perWeek ?? NaN;
                expect(perWeek, `${label} at level ${level}`).toBe(
                  s.productionPerWeek * s.productionMul,
                );
                // a week of its own tick makes that much, with room to spare
                s.storage.clear();
                s.tick(weekSeconds());
                const made = s.totalStored();
                expect(
                  Math.abs(made - perWeek),
                  `${label} at level ${level}: a week's goods ${made}, ${perWeek} shown`,
                ).toBeLessThanOrEqual(1e-9 * Math.max(1, perWeek));
              }
              rules.capacityMul = DEFAULT_RULES.capacityMul;
              break;
            }
          });
        },
      );
      for (const def of HARVESTERS)
        expect(placed.get(def.id) ?? 0, `${def.id} was placed`).toBeGreaterThan(0);
    },
  );
});

describe("a station's weekly output", () => {
  it('is what it was before the harvest breakdown, bit for bit, for every kind, level and state', () => {
    const seen = { closed: 0, capped: 0, uncapped: 0 };
    forAll(
      (rng) => ({
        level: rng.pick(WHOLE_LEVELS),
        terrainFactor: rng.pick([1, 0.15, 1.6, rng.range(0.15, 1.6), rng.range(0.15, 1.6)]),
        productionMul: rng.pick([1, 0, 0.1, 2.5, rng.range(0, 5), rng.range(0, 5)]),
        passengers: rng.pick([0, rng.int(0, 600), rng.range(0, 600)]),
        closed: rng.int(0, 3) === 0,
      }),
      (c) => {
        rules.productionMul = c.productionMul;
        for (const def of STATION_DEFS) {
          const s = new Station(def.id, 3, 4);
          s.level = c.level;
          s.terrainFactor = c.terrainFactor;
          s.passengerPopulation = c.passengers;
          if (c.closed) s.work = { to: c.level + 1, left: 30, total: 60 };
          expect(s.productionPerWeek, def.id).toBe(perWeekBefore(s));
          if (s.closed) seen.closed++;
          else if (behavesAs(def) === 'station') {
            const open = weeklyOutput(s.level, s.terrainFactor);
            seen[s.passengerPopulation * 0.4 < open ? 'capped' : 'uncapped']++;
          }
        }
        expect(weeklyOutput(c.level, c.terrainFactor), 'weeklyOutput').toBe(
          LEVELS.production[c.level - 1] * rules.productionMul * c.terrainFactor,
        );
      },
      {
        shrink: (c) =>
          plainer(c, {
            closed: false,
            passengers: 0,
            level: 1,
            productionMul: 1,
            terrainFactor: 1,
          }),
      },
    );
    // not vacuous: closed stations, and passenger stations both held to their people and not
    expect(seen.closed).toBeGreaterThan(0);
    expect(seen.capped).toBeGreaterThan(0);
    expect(seen.uncapped).toBeGreaterThan(0);
  });
});

describe('the definition of a station kind', () => {
  it('is found by its id, and an id no kind has is refused', () => {
    for (const def of STATION_DEFS)
      expect(stationDef(def.id), def.id).toBe(STATION_DEFS.find((d) => d.id === def.id));
    for (const id of ['', 'mill', 'Farm', 'farm ', 'toString', 'constructor', '__proto__'])
      expect(() => stationDef(id), JSON.stringify(id)).toThrow(`unknown station ${id}`);
  });
});
