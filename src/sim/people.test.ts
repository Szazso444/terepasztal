import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { emptyMap } from '../world/mapgen';
import { Terrain } from '../world/tiles';
import { RegionState } from '../world/regions';
import { TrackGraph } from '../world/track';
import { Rng } from '../engine/rng';
import { Builder } from './build';
import { Stockpile } from './stockpile';
import { Economy } from './economy';
import { resetStationIds, type Station } from './stations';
import { rules, DEFAULT_RULES } from './rules';
import { PeopleSim } from './people';

vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));

/** A line with a passenger station on it and two crewed buildings within walking distance. */
function world(seed = 4242) {
  const map = emptyMap(seed, 64, 64, Terrain.Grass),
    track = new TrackGraph(64, 64),
    economy = new Economy();
  const builder = new Builder(map, new RegionState(map), track, economy, new Stockpile());
  builder.free = true;
  for (let x = 2; x < 60; x++) track.place(x, 30, 'straight', 1);
  const station = builder.placeStation(30, 31, 'station')!;
  expect(station).not.toBeNull();
  expect(builder.placeBuilding(27, 34, 'windmill')).not.toBeNull();
  expect(builder.placeBuilding(33, 34, 'kiln')).not.toBeNull();
  return { map, builder, station };
}

const POPULATION = 12;
const DT = 1;
const MIDDAY = 0.5;

/** Who waits at the station after each tick, with where everyone is. */
function run(people: PeopleSim, station: Station, ticks: number) {
  const trace: string[] = [];
  for (let i = 0; i < ticks; i++) {
    people.tick(DT, POPULATION, MIDDAY);
    const waiting = people.waitingAt(station.id).length;
    const where = people.persons.map((p) => `${p.state}@${p.x.toFixed(3)},${p.y.toFixed(3)}`);
    trace.push(`${waiting}|${where.join(';')}`);
  }
  return trace;
}
const waitingCounts = (trace: string[]) => trace.map((t) => Number(t.split('|')[0]));

beforeEach(() => {
  Object.assign(rules, DEFAULT_RULES);
  resetStationIds(1);
  vi.spyOn(Math, 'random').mockImplementation(() => {
    throw new Error('the walkers drew from Math.random');
  });
});
afterEach(() => vi.restoreAllMocks());

describe('PeopleSim randomness', () => {
  it('gives the same walkers from the same map seed, without Math.random', () => {
    const { map, builder, station } = world();
    const a = run(new PeopleSim(map, builder), station, 400);
    const b = run(new PeopleSim(map, builder), station, 400);
    expect(b).toEqual(a);
    // the trace is worth comparing: travellers do reach the platform
    expect(Math.max(...waitingCounts(a))).toBeGreaterThan(0);
  });

  it('gives the same walkers from the same injected seed', () => {
    const { map, builder, station } = world();
    const a = run(new PeopleSim(map, builder, new Rng(77)), station, 400);
    const b = run(new PeopleSim(map, builder, new Rng(77)), station, 400);
    expect(b).toEqual(a);
    expect(Math.max(...waitingCounts(a))).toBeGreaterThan(0);
  });

  it('seeds from the map when no stream is given', () => {
    const { map, builder } = world(4242);
    const other = world(4243);
    const draws = (people: PeopleSim) => {
      const rng = new Rng(0);
      rng.state = people.toJSON().rng;
      return Array.from({ length: 8 }, () => rng.next());
    };
    expect(draws(new PeopleSim(map, builder))).toEqual(draws(new PeopleSim(map, builder)));
    expect(draws(new PeopleSim(other.map, other.builder))).not.toEqual(
      draws(new PeopleSim(map, builder)),
    );
  });

  it('continues the same draws after a load at any tick', () => {
    const { map, builder, station } = world();
    for (const at of [0, 1, 37, 200]) {
      const ra = new Rng(map.seed ^ 0x51);
      const a = new PeopleSim(map, builder, ra);
      run(a, station, at);
      const save = JSON.parse(JSON.stringify(a.toJSON())) as unknown;
      const rc = new Rng(12345);
      const c = new PeopleSim(map, builder, rc);
      c.load(save);
      const next = (rng: Rng) => Array.from({ length: 32 }, () => rng.next());
      expect(next(rc)).toEqual(next(ra));
    }
  });

  it('plays the same from the same save, persons starting over', () => {
    const { map, builder, station } = world();
    const a = new PeopleSim(map, builder, new Rng(9));
    run(a, station, 150);
    const save = a.toJSON();
    const c1 = new PeopleSim(map, builder);
    const c2 = new PeopleSim(map, builder, new Rng(1));
    c1.load(save);
    c2.load(save);
    const t1 = run(c1, station, 250);
    expect(run(c2, station, 250)).toEqual(t1);
    // a fresh sim with no persons, on the original's stream, is what a load restores
    a.persons.length = 0;
    expect(run(a, station, 250)).toEqual(t1);
  });

  it('keeps the seeded stream when a save carries none', () => {
    const { map, builder } = world();
    const seeded = new PeopleSim(map, builder).toJSON();
    for (const j of [undefined, null, {}, { rng: '17' }, { rng: null }, 5]) {
      const people = new PeopleSim(map, builder);
      people.load(j);
      expect(people.toJSON()).toEqual(seeded);
    }
  });
});
