import { describe, it, expect, beforeEach, vi } from 'vitest';
import { emptyMap } from '../world/mapgen';
import { Terrain } from '../world/tiles';
import { RegionState } from '../world/regions';
import { TrackGraph } from '../world/track';
import { Rng } from '../engine/rng';
import { STR } from '../strings';
import { SEEDS } from '../testing/property';
import {
  AGE_DEFS,
  AGE_COUNT,
  LAST_AGE,
  RAIL_AGES,
  ageDef,
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
    e.advanceAge({ depots: 1e9, population: 1e9, earned: 1e12, substations: 1e9, wires: 1e9 });
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
