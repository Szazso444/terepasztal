import { describe, it, expect, beforeEach, vi } from 'vitest';
import { emptyMap } from '../world/mapgen';
import { Terrain } from '../world/tiles';
import { RegionState } from '../world/regions';
import { TrackGraph } from '../world/track';
import { Rng } from '../engine/rng';
import { STR } from '../strings';
import { SEEDS, forAll } from '../testing/property';
import agesJson from '../data/ages.json';
import {
  AGE_DEFS,
  AGE_COUNT,
  GOAL_KINDS,
  LAST_AGE,
  RAIL_AGES,
  ageDef,
  ageProblems,
  ageStatus,
  goalsMet,
  railAge,
  type AgeSnapshot,
} from './ages';
import { Economy } from './economy';
import { Builder } from './build';
import { Stockpile } from './stockpile';
import { resetStationIds } from './stations';
import { rules, DEFAULT_RULES } from './rules';
import { ContractBoard, type Contract } from './contracts';

vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));

beforeEach(() => {
  Object.assign(rules, DEFAULT_RULES);
  resetStationIds(1);
});

/** Every goal of the first three ages met, none of the new ones. */
const AT_ELECTRIC: AgeSnapshot = {
  depots: 3,
  population: 1000,
  earned: 100000,
  substations: 0,
  wires: 0,
  chunks: 1,
};

/** An economy that has just entered the Electric Age, with the age-up hook recorded. */
function electric() {
  const e = new Economy();
  e.setAge(2);
  const entered: number[] = [];
  e.onAgeUp = (t) => entered.push(t);
  return { e, entered };
}

describe('the six ages', () => {
  it('has six ages in order', () => {
    expect(AGE_DEFS.map((a) => a.id)).toEqual([
      'steam',
      'diesel',
      'electric',
      'nuclear',
      'magnetic',
      'hyper',
    ]);
    expect(AGE_COUNT).toBe(6);
    expect(LAST_AGE).toBe(5);
    for (const [i, a] of AGE_DEFS.entries()) {
      const name = STR.ages.name[a.id];
      expect(name, a.id).toBeTruthy();
      // the messages that name an age by its number find the same name
      expect(STR.build.tierLocked(i)).toContain(name);
    }
    // an index past either end is the nearest age
    expect(ageDef(99).id).toBe('hyper');
    expect(ageDef(-1).id).toBe('steam');
  });

  it('walks through the new ages as their goals are met', () => {
    const { e, entered } = electric();
    const tickets = e.tickets;
    e.advanceAge(AT_ELECTRIC);
    expect(e.tier).toBe(2);

    e.advanceAge({ ...AT_ELECTRIC, substations: 1 });
    expect(e.tier).toBe(3);
    expect(e.tickets).toBe(tickets + 5);

    e.advanceAge({ ...AT_ELECTRIC, substations: 1, earned: 149999 });
    expect(e.tier).toBe(3);
    e.advanceAge({ ...AT_ELECTRIC, substations: 1, earned: 150000 });
    expect(e.tier).toBe(4);
    expect(e.tickets).toBe(tickets + 10);

    e.advanceAge({ ...AT_ELECTRIC, substations: 1, earned: 499999 });
    expect(e.tier).toBe(4);
    e.advanceAge({ ...AT_ELECTRIC, substations: 1, earned: 500000 });
    expect(e.tier).toBe(5);
    expect(e.tickets).toBe(tickets + 15);

    // the last age has nowhere further to go
    e.advanceAge({
      depots: 1e9,
      population: 1e9,
      earned: 1e12,
      substations: 1e9,
      wires: 1e9,
      chunks: 1e9,
    });
    expect(e.tier).toBe(LAST_AGE);
    expect(e.tickets).toBe(tickets + 15);
    expect(entered).toEqual([3, 4, 5]);
  });

  it('passes every age whose goals are met in one check, and each pays its tickets once', () => {
    const { e, entered } = electric();
    const tickets = e.tickets;
    e.advanceAge({ ...AT_ELECTRIC, substations: 1, earned: 500000 });
    expect(e.tier).toBe(5);
    expect(entered).toEqual([3, 4, 5]);
    expect(e.tickets).toBe(tickets + 15);
  });

  it('keeps the age a save was made in, the new ones too', () => {
    const { e } = electric();
    e.setAge(LAST_AGE);
    const back = new Economy();
    back.load(JSON.parse(JSON.stringify(e.toJSON())));
    expect(back.tier).toBe(LAST_AGE);
    // tickets already paid for an age are not paid again
    const tickets = back.tickets;
    back.setAge(LAST_AGE);
    back.advanceAge({ ...AT_ELECTRIC, substations: 1, earned: 500000 });
    expect(back.tickets).toBe(tickets);
  });
});

/** A new game's numbers: one depot, nobody housed, nothing earned, the start chunk. */
const NEW_GAME: AgeSnapshot = {
  depots: 1,
  population: 0,
  earned: 0,
  substations: 0,
  wires: 0,
  chunks: 1,
};

/** The age a Steam-age economy reaches on one check of a new game's numbers changed by `s`. */
function ageAfter(s: Partial<AgeSnapshot>) {
  const e = new Economy();
  e.advanceAge({ ...NEW_GAME, ...s });
  return e.tier;
}

/** Depot counts around anything a goal could ever have asked of them, and a thousand. */
const DEPOT_COUNTS = [0, 1, 2, 3, 1e3];

describe('the diesel goal', () => {
  it('opens the Diesel age at 100 residents or nine owned chunks, with a single depot', () => {
    expect(ageAfter({ depots: 1, population: 100 }), '100 residents').toBe(1);
    expect(ageAfter({ depots: 1, chunks: 9 }), '9 chunks').toBe(1);
    expect(ageAfter({ depots: 1, population: 100, chunks: 9 }), 'both alternatives').toBe(1);
  });

  it('keeps the Steam age in a new game, and short of both alternatives however many depots', () => {
    expect(ageAfter({}), 'a new game').toBe(0);
    for (const depots of DEPOT_COUNTS)
      expect(ageAfter({ depots, population: 99, chunks: 8 }), `${depots} depots, short`).toBe(0);
  });

  it('opens exactly on 100 residents or nine chunks, whatever the depots, around every threshold', () => {
    for (const depots of DEPOT_COUNTS)
      for (const population of [0, 99, 100, 1000])
        for (const chunks of [1, 8, 9, 16]) {
          const opens = population >= 100 || chunks >= 9;
          expect(
            ageAfter({ depots, population, chunks }),
            `${depots} depots, ${population} residents, ${chunks} chunks`,
          ).toBe(opens ? 1 : 0);
        }
  });

  it('shows only the two alternatives, in one group, with their progress on the age card', () => {
    const card = (depots: number) =>
      ageStatus(0, { ...NEW_GAME, depots, population: 40, chunks: 9 })[1].goals;
    const goals = card(1);
    const group = goals[0].anyOf;
    expect(group).toBeTypeOf('number');
    expect(goals).toEqual([
      { kind: 'population', target: 100, current: 40, done: false, anyOf: group },
      { kind: 'chunks', target: 9, current: 9, done: true, anyOf: group },
    ]);
    for (const g of goals) expect(STR.ages.goal[g.kind], g.kind).toBeTruthy();
    // the depots change nothing the card shows
    for (const depots of DEPOT_COUNTS) expect(card(depots), `${depots} depots`).toEqual(goals);
  });

  it('leaves a save past the Diesel age where it is, and moves a Steam save up on its next check', () => {
    for (let tier = 1; tier <= LAST_AGE; tier++) {
      const e = new Economy();
      e.setAge(tier);
      const back = new Economy();
      back.load(JSON.parse(JSON.stringify(e.toJSON())));
      back.advanceAge(NEW_GAME);
      expect(back.tier, `a save in age ${tier}`).toBe(tier);
    }
    const steam = new Economy();
    steam.load(JSON.parse(JSON.stringify(new Economy().toJSON())));
    expect(steam.tier).toBe(0);
    steam.advanceAge({ ...NEW_GAME, depots: 1, chunks: 9 });
    expect(steam.tier).toBe(1);
  });
});

describe('the age card and the age check', () => {
  it('agree: an age opens exactly when each goal of its own and one alternative of each group is done', () => {
    forAll(
      (rng): AgeSnapshot => ({
        depots: rng.int(0, 4),
        population: rng.pick([0, 99, 100, 999, 1000, 5000]),
        earned: rng.pick([0, 99999, 100000, 150000, 500000]),
        substations: rng.int(0, 2),
        wires: rng.int(0, 50),
        chunks: rng.int(1, 16),
      }),
      (s) => {
        for (const a of ageStatus(0, s)) {
          const groups = new Map<number, boolean>();
          let own = true;
          for (const g of a.goals) {
            expect(g.done, `${a.id} ${g.kind}`).toBe(g.current >= g.target);
            if (g.anyOf === undefined) own &&= g.done;
            else groups.set(g.anyOf, (groups.get(g.anyOf) ?? false) || g.done);
          }
          const met = own && [...groups.values()].every(Boolean);
          expect(goalsMet(a.index, s), a.id).toBe(met);
        }
      },
    );
  });
});

describe('the ages table', () => {
  it('is well formed, and every goal kind has a label', () => {
    expect(ageProblems(agesJson)).toEqual([]);
    expect(ageProblems(AGE_DEFS)).toEqual([]);
    for (const k of GOAL_KINDS) expect(STR.ages.goal[k], k).toBeTruthy();
  });

  it('reports a goal no snapshot can measure and a group that can never be met', () => {
    const steam = { id: 'steam', goals: [] };
    const bad = (goals: unknown[]) => ageProblems([steam, { id: 'diesel', goals }]);
    expect(bad([{ kind: 'depots', target: 2 }])).toEqual([]);
    expect(bad([{ anyOf: [{ kind: 'chunks', target: 9 }] }])).toEqual([]);
    expect(bad([{ kind: 'trains', target: 2 }])).toHaveLength(1);
    expect(bad([{ kind: 'depots', target: -1 }])).toHaveLength(1);
    expect(bad([{ kind: 'depots' }])).toHaveLength(1);
    expect(bad([{ anyOf: [] }])).toHaveLength(1);
    expect(bad([{ anyOf: {} }])).toHaveLength(1);
    expect(bad([{ anyOf: [{ anyOf: [{ kind: 'depots', target: 2 }] }] }])).toHaveLength(2);
    expect(
      bad([
        {
          anyOf: [
            { kind: 'depots', target: 2 },
            { kind: 'chunk', target: 9 },
          ],
        },
      ]),
    ).toEqual(['age diesel goal 0 anyOf 1: unknown kind "chunk"']);
    expect(ageProblems({})).toHaveLength(1);
    expect(ageProblems([{ goals: [] }, { id: 'x' }])).toHaveLength(2);
  });
});

/** Three producers and two towns along one line: several cargo routes to draw offers from. */
function world() {
  const map = emptyMap(4242, 96, 96, Terrain.Grass),
    track = new TrackGraph(96, 96);
  const builder = new Builder(map, new RegionState(map), track, new Economy(), new Stockpile());
  builder.free = true;
  for (let x = 2; x < 90; x++) track.place(x, 30, 'straight', 1);
  for (const [x, id] of [
    [10, 'farm'],
    [20, 'lumber'],
    [30, 'quarry'],
    [50, 'town'],
    [80, 'town'],
  ] as const)
    expect(builder.placeStation(x, 31, id)).not.toBeNull();
  return builder;
}

/** `n` forced offers from a board with its own seed, in the given age. */
function offers(builder: Builder, seed: number, age: number, n = 8): Contract[] {
  const economy = new Economy();
  economy.tier = age;
  const board = new ContractBoard(new Rng(seed), builder, economy);
  return Array.from({ length: n }, () => board.generate(1000, true)!);
}

describe('the age trains, contracts and land see', () => {
  it('stops at the electric age', () => {
    expect([0, 1, 2, 3, 4, 5].map(railAge)).toEqual([0, 1, 2, 2, 2, 2]);
    expect(ageDef(RAIL_AGES - 1).id).toBe('electric');
    for (let t = 0; t <= LAST_AGE; t++) expect(railAge(t)).toBeLessThan(RAIL_AGES);
  });

  it('offers the same contracts in every age after electric as in electric', () => {
    const builder = world();
    for (const seed of SEEDS.slice(0, 20)) {
      const atElectric = offers(builder, seed, 2);
      expect(atElectric.every((c) => c && c.amount > 0 && c.payout > 0)).toBe(true);
      for (let age = 3; age <= LAST_AGE; age++)
        expect(offers(builder, seed, age), `seed ${seed}, age ${age}`).toEqual(atElectric);
    }
  });

  it('still asks more of the electric age than of the diesel age', () => {
    // the comparison above means something only while the age does change the offers
    const builder = world();
    const diesel = offers(builder, SEEDS[0], 1);
    const electricOffers = offers(builder, SEEDS[0], 2);
    expect(electricOffers).not.toEqual(diesel);
  });
});
