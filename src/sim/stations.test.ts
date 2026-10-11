import { describe, it, expect, beforeEach } from 'vitest';
import { STATION_DEFS, Station, MAX_LEVEL, resetStationIds, type StationJSON } from './stations';
import { rules, DEFAULT_RULES } from './rules';
import type { LevelStation } from '../world/level';
import type { Rng } from '../engine/rng';
import { forAll } from '../testing/property';

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
