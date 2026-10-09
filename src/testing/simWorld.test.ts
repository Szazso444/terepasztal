import { describe, it, expect, beforeEach } from 'vitest';
import { simWorld, line, station, mapParams, SIM_WORLD_SEED, type SimWorld } from './simWorld';
import { generateMap } from '../world/mapgen';
import { Terrain, terrainAt } from '../world/tiles';
import { railProfile } from '../world/railProfile';
import { Rng } from '../engine/rng';
import { rules, DEFAULT_RULES } from '../sim/rules';
import { setSupplyMode, supplyMode, DEFAULT_SUPPLY } from '../sim/supply';
import { setSeasonOffset } from '../sim/weather';
import { biomeAt, biomeDef } from '../sim/biomes';
import { resetTrainIds } from '../sim/trains';
import { resetStationIds } from '../sim/stations';
import { PeopleSim } from '../sim/people';
import { SIM_STEP } from '../sim/time';

beforeEach(() => {
  Object.assign(rules, DEFAULT_RULES);
  setSupplyMode(DEFAULT_SUPPLY);
  setSeasonOffset(0);
  resetTrainIds();
  resetStationIds();
});

/** World seeds every case runs: the fixture's default, a small one and mapgen's golden seed. */
const SEEDS = [SIM_WORLD_SEED, 7, 20260912];

/** Tiles of the test line east of the depot's gate. */
const RUN = 14;

/**
 * The first site, scanning rows then columns, where a depot and a line of RUN tiles east of it
 * fit with a free row on either side: every tile from x - 1 to x + RUN + 2 on rows y - 1 to y + 1
 * takes track or a station. Null when the map has none.
 */
function findSite(w: SimWorld): { x: number; y: number } | null {
  const ok = (x: number, y: number) => {
    const t = terrainAt(w.map, x, y);
    return t !== Terrain.Water && t !== Terrain.Rock && t !== Terrain.Mountain;
  };
  for (let y = 2; y < w.map.h - 3; y++)
    for (let x = 2; x + RUN + 3 < w.map.w; x++) {
      let fits = true;
      for (let dy = -1; dy <= 1 && fits; dy++)
        for (let dx = -1; dx <= RUN + 2 && fits; dx++) fits = ok(x + dx, y + dy);
      if (fits) return { x, y };
    }
  return null;
}

/**
 * The same build on any world: a depot at the site, a line from its east gate RUN tiles on, a
 * quarry holding 40 stone and a warehouse beside the line, coal and water in the stockpile for the
 * tanks, and one train of the starter steam engine and a hopper from fleet.create, running between
 * the quarry and the warehouse.
 */
function build(w: SimWorld) {
  const site = findSite(w);
  if (!site) throw new Error(`seed ${w.seed}: no site for the line`);
  const { x, y } = site;
  station(w, 'depot', x, y);
  line(w, x + 2, y, x + 2 + RUN);
  const quarry = station(w, 'quarry', x + 8, y - 1);
  const warehouse = station(w, 'warehouse', x + RUN, y - 1);
  quarry.store('stone', 40);
  w.stock.add('coal', 400);
  w.stock.add('water', 400);
  const loco = w.inventory.items.find((i) => i.defId === 'adler');
  const hopper = w.inventory.items.find((i) => i.defId === 'wood_hopper');
  if (!loco || !hopper) throw new Error(`seed ${w.seed}: no starter adler and wood hopper`);
  const train = w.fleet.create([loco.uid], [hopper.uid], [quarry.id, warehouse.id]);
  if (typeof train === 'string') throw new Error(`seed ${w.seed}: fleet.create: ${train}`);
  return { quarry, warehouse, train };
}

/** `steps` calls of fleet.tick at SIM_STEP, the clock moving with them. */
function run(w: SimWorld, steps: number) {
  for (let i = 0; i < steps; i++) {
    w.clock.time += SIM_STEP;
    w.fleet.tick(SIM_STEP, w.clock.time);
  }
}

/** The first index where two planes differ, or -1 when they are identical. */
function firstDiff(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) return Math.min(a.length, b.length);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return i;
  return -1;
}

/** Two maps compared plane by plane: size and props equal, else the first differing index. */
function planeDiffs(a: SimWorld['map'], b: SimWorld['map']) {
  return {
    size: a.w === b.w && a.h === b.h,
    terrain: firstDiff(a.terrain, b.terrain),
    biome: firstDiff(a.biome, b.biome),
    variant: firstDiff(a.variant, b.variant),
    props: JSON.stringify([...a.props]) === JSON.stringify([...b.props]),
  };
}
const SAME_PLANES = { size: true, terrain: -1, biome: -1, variant: -1, props: true };

/** What the run decides, as JSON: the trains, the stations, the stockpile and the economy. */
function state(w: SimWorld) {
  return {
    fleet: JSON.stringify(w.fleet.trains.map((t) => t.toJSON())),
    stations: JSON.stringify(w.builder.stations.map((s) => s.toJSON())),
    stock: JSON.stringify(w.stock.toJSON()),
    economy: JSON.stringify(w.economy.toJSON()),
  };
}

describe('simWorld from one seed', () => {
  it.each(SEEDS)(
    'seed %i: two worlds have the same map planes, then the same trains, stations, stock and economy after the same build and 600 fleet steps',
    (seed) => {
      const once = () => {
        const w = simWorld({ seed });
        const map = planeDiffs(w.map, generateMap(seed, mapParams(w.map.w)));
        const built = build(w);
        run(w, 600);
        return { w, map, built, state: state(w) };
      };
      const a = once();
      const b = once();
      expect(planeDiffs(a.w.map, b.w.map), `seed ${seed}: map planes`).toEqual(SAME_PLANES);
      expect(a.map, `seed ${seed}: planes against generateMap`).toEqual(SAME_PLANES);
      for (const k of ['fleet', 'stations', 'stock', 'economy'] as const)
        expect(b.state[k], `seed ${seed}: ${k} JSON`).toBe(a.state[k]);
      // Not vacuous: the train left the depot, loaded at the quarry and unloaded at the warehouse,
      // and its tanks were filled from the stockpile.
      const { quarry, warehouse, train } = a.built;
      expect(train.distance, `seed ${seed}: tiles run`).toBeGreaterThan(RUN - 8);
      expect(quarry.stored('stone'), `seed ${seed}: stone left at the quarry`).toBeLessThan(40);
      expect(warehouse.stored('stone'), `seed ${seed}: stone at the warehouse`).toBeGreaterThan(0);
      expect(a.w.stock.get('coal'), `seed ${seed}: coal left`).toBeLessThan(400);
    },
  );

  it('another seed gives another map', () => {
    const worlds = SEEDS.map((seed) => simWorld({ seed }));
    for (let i = 0; i < worlds.length; i++)
      for (let j = i + 1; j < worlds.length; j++) {
        const [a, b] = [worlds[i], worlds[j]];
        const pair = `seeds ${a.seed} and ${b.seed}`;
        expect(firstDiff(a.map.terrain, b.map.terrain), `${pair}: terrain`).not.toBe(-1);
        expect(firstDiff(a.map.variant, b.map.variant), `${pair}: variant`).not.toBe(-1);
      }
  });
});

describe('simWorld as Game builds it', () => {
  it('generates a new game map from the rules by default, and flat grass on request', () => {
    rules.mapSize = 96;
    const w = simWorld();
    expect(w.seed).toBe(SIM_WORLD_SEED);
    expect([w.map.w, w.map.h, w.map.seed]).toEqual([96, 96, SIM_WORLD_SEED]);
    // the generator's parameters come from the rules, as a new game's do
    rules.waterLevel = 0.5;
    const wet = simWorld();
    const water = (m: SimWorld['map']) => m.terrain.filter((t) => t === Terrain.Water).length;
    expect(water(wet.map)).toBeGreaterThan(water(w.map));

    const g = simWorld({ seed: 3, size: 40, terrain: 'grass' });
    expect([g.map.w, g.map.h, g.map.seed]).toEqual([40, 40, 3]);
    expect(g.map.terrain.every((t) => t === Terrain.Grass)).toBe(true);
    expect(g.map.props.size).toBe(0);
  });

  it.each(SEEDS)('seed %i: every stream starts where Game seeds it', (seed) => {
    const w = simWorld({ seed, size: 32, terrain: 'grass' });
    expect({
      weather: w.weather.rng.state,
      contracts: w.contracts.rng.state,
      gacha: w.gacha.rng.state,
      crafting: w.crafting.rng.state,
      people: w.people.toJSON(),
      trade: w.trade.seed,
    }).toEqual({
      weather: new Rng(seed ^ 0x77ea).state,
      contracts: new Rng(seed ^ 0x5eed).state,
      gacha: new Rng(seed ^ 0x9ac4a).state,
      crafting: new Rng(seed ^ 0xc4af7).state,
      people: new PeopleSim(w.map, w.builder).toJSON(),
      trade: seed,
    });
  });

  it('starts with the starter inventory known to crafting, the supply mode set and ids from 1', () => {
    resetStationIds(50);
    resetTrainIds(50);
    const w = simWorld({ size: 64, terrain: 'grass', supply: 'full' });
    expect(supplyMode()).toBe('full');
    expect(w.inventory.items.length).toBeGreaterThan(0);
    for (const item of w.inventory.items) expect(w.crafting.recipes.has(item.defId)).toBe(true);
    expect(w.clock.time).toBe(0);
    expect(w.builder.free).toBe(false);
    expect(station(w, 'depot', 10, 10).id).toBe(1);
    simWorld({ size: 32, terrain: 'grass' });
    expect(supplyMode()).toBe(DEFAULT_SUPPLY);
  });
});

describe('simWorld wiring', () => {
  /** A grass world with a regular line along row 20 and a quarry and a town beside it. */
  function served() {
    const w = simWorld({ size: 64, terrain: 'grass' });
    line(w, 5, 20, 40);
    const quarry = station(w, 'quarry', 10, 19);
    const town = station(w, 'town', 30, 19);
    return { w, quarry, town };
  }

  it('accepts every contract offer, as the default settings do, and routes its cargo', () => {
    const { w, quarry, town } = served();
    w.contracts.tick(0);
    expect(w.contracts.offers).toEqual([]);
    expect(w.contracts.active.length).toBeGreaterThan(0);
    for (const c of w.contracts.active) {
      expect([c.originId, c.destId, c.cargo]).toEqual([quarry.id, town.id, 'stone']);
      expect(w.fleet.contractDest!(c.cargo, c.originId)).toBe(c.destId);
    }
  });

  it('keeps the fleet, houses, power and rail beds in step with what the builder places', () => {
    const { w } = served();
    // a signal through the builder reaches the fleet's signals
    w.builder.free = true;
    expect(w.builder.placeDecor(25, 20, 'signal', 1)).not.toBeNull();
    expect(w.fleet.signals.postAt(25, 20)).not.toBeNull();
    // a townhouse joins the house registry
    expect(w.builder.spawnDecor(20, 24, 'townhouse', 0)).not.toBeNull();
    expect(w.houses.at(20, 24)).toBeDefined();
    // a power plant powers the tiles around it
    expect(w.power.isPowered(51, 50)).toBe(false);
    expect(w.builder.placeBuilding(50, 50, 'power_plant')).not.toBeNull();
    expect(w.power.isPowered(51, 50)).toBe(true);
    // the fleet's rail beds follow the track
    const beds = () => railProfile(w.map, w.track, (x, y) => !!w.builder.bridgeAt(x, y));
    expect(w.fleet.railBeds.size).toBeGreaterThan(0);
    expect(w.fleet.railBeds).toEqual(beds());
    line(w, 5, 30, 20);
    expect(w.fleet.railBeds).toEqual(beds());
    expect(w.fleet.stockCap('stone')).toBe(
      w.stock.cap('stone', w.builder.depotCount(), w.builder.plantCount()),
    );
  });

  it("gives a placed station its season's and biome's production", () => {
    setSeasonOffset(3);
    const w = simWorld({ size: 64, terrain: 'grass' });
    line(w, 5, 20, 20);
    const farm = station(w, 'farm', 10, 19);
    const biome = biomeDef(biomeAt(w.map, 10, 19)).production.farm ?? 1;
    // day 1 falls in winter with this offset, when farms yield half
    expect(farm.productionMul).toBeCloseTo(0.5 * biome, 12);
  });

  it('line and station name the tile and the reason when the builder refuses', () => {
    const w = simWorld({ size: 32, terrain: 'grass' });
    w.map.terrain[10 * 32 + 12] = Terrain.Rock;
    expect(() => line(w, 5, 10, 20)).toThrow(/12,10/);
    expect(w.track.has(11, 10)).toBe(true);
    expect(() => station(w, 'quarry', 25, 25)).toThrow(/quarry at 25,25/);
    expect(w.builder.free).toBe(false);
  });
});
