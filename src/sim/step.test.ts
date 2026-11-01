import { describe, it, expect, beforeEach, vi } from 'vitest';
import { simWorld, line, station, SIM_WORLD_SEED, type SimWorld } from '../testing/simWorld';
import { forAll, shrinkArray, shrinkInt } from '../testing/property';
import type { Rng } from '../engine/rng';
import { Terrain, terrainAt } from '../world/tiles';
import { pieceCost } from '../world/track';
import { rules, DEFAULT_RULES, daySeconds, weekSeconds } from './rules';
import { setSupplyMode, DEFAULT_SUPPLY } from './supply';
import { setSeasonOffset, seasonOf, productionMul, type Season, type WeatherKind } from './weather';
import { Train, defaultStop, resetTrainIds, type TickCtx } from './trains';
import { Dir } from '../engine/iso';
import { locoDef } from '../gacha/items';
import { resetStationIds, type Station } from './stations';
import { biomeAt, biomeDef } from './biomes';
import { buildingDef, buildingRate, buildingSpan, tickBuildings, type Building } from './buildings';
import { depotWith } from '../testing/storeFixtures';
import type { ResourceStore } from './stores';
import { TOWN_RADIUS } from './towns';
import { decorDef } from './build';
import { SIM_STEP } from './time';
import { LAST_AGE } from './ages';
import {
  SimStep,
  startStock,
  ageSnapshot,
  AGE_CHECKS_PER_DAY,
  CITY_CHECK_SECONDS,
  FAMINE_PRODUCTION_MUL,
  FAMINE_SPEED_MUL,
  PASSENGER_CATCHMENT,
  START_CRAFT,
  START_SUPPLIES,
  START_TRACK,
  type StepContext,
  type StepHooks,
} from './step';

// tickBuildings is a module function the step imports: a pass-through spy lets the order and
// ledger properties see when it runs and what it changes.
vi.mock('./buildings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./buildings')>();
  return { ...actual, tickBuildings: vi.fn(actual.tickBuildings) };
});
const realTickBuildings = vi.mocked(tickBuildings).getMockImplementation()!;

beforeEach(() => {
  Object.assign(rules, DEFAULT_RULES);
  setSupplyMode(DEFAULT_SUPPLY);
  setSeasonOffset(0);
  resetTrainIds();
  resetStationIds();
  vi.mocked(tickBuildings).mockReset();
  vi.mocked(tickBuildings).mockImplementation(realTickBuildings);
});

/** Play mode with the weather setting as given. */
function context(w: SimWorld, weather: boolean): StepContext {
  return {
    mode: 'play',
    weather,
  };
}

/** `n` loop ticks at 1x, each one step of SIM_STEP through the clock as Game runs it. */
function run(w: SimWorld, step: SimStep, ctx: StepContext, n: number) {
  for (let i = 0; i < n; i++) w.clock.run((gdt) => step.run(gdt, ctx));
}

/** A flat grass world with a line along row 20 from x 10 to 30. */
function grass(): SimWorld {
  const w = simWorld({ terrain: 'grass', size: 48 });
  line(w, 10, 20, 30);
  return w;
}

describe('SimStep: famine', () => {
  /**
   * A quarry by the line (its crew eats at the depot beside it), a step at 1x with rain forced to
   * full strength, and the speed factor fleet.tick was called with. Starving: the depot's store
   * has no food and its famine already declared; fed: a full larder.
   */
  function once(starving: boolean, weather: boolean) {
    const w = grass();
    const quarry = station(w, 'quarry', 14, 19);
    const depot = depotWith(w, {}, { x: 8, y: 21 });
    if (starving) depot.famine = true;
    else depot.add('food', 1000);
    w.weather.load({ kind: 'rain', intensity: 1, nextChangeAt: 1e9, rng: w.weather.rng.state });
    const tick = vi.spyOn(w.fleet, 'tick');
    run(w, new SimStep(w), context(w, weather), 1);
    expect(tick, 'fleet.tick calls').toHaveBeenCalledTimes(1);
    return {
      famine: depot.famine,
      stone: quarry.stored('stone'),
      speed: tick.mock.calls[0][2] ?? Number.NaN,
      weatherFactor: w.weather.speedFactor(),
    };
  }

  it('halves what a station makes over a step', () => {
    const fed = once(false, true);
    const starving = once(true, true);
    expect(fed.famine, 'fed: famine').toBe(false);
    expect(starving.famine, 'starving: famine').toBe(true);
    expect(fed.stone, 'fed: stone made').toBeGreaterThan(0);
    expect(starving.stone).toBeCloseTo(fed.stone * FAMINE_PRODUCTION_MUL, 12);
  });

  it.each([true, false])(
    'leaves the speed factor fleet.tick gets to the weather, a store in famine or not (weather %s)',
    (weather) => {
      const fed = once(false, weather);
      const starving = once(true, weather);
      // rain at full strength slows trains by 12 % when the weather is on, not at all when off
      expect(fed.speed, 'fed: speed factor').toBeCloseTo(weather ? fed.weatherFactor : 1, 12);
      expect(fed.speed, 'fed: speed factor').toBeCloseTo(weather ? 0.88 : 1, 12);
      expect(starving.speed, 'starving: speed factor').toBeCloseTo(fed.speed, 12);
    },
  );

  /**
   * How fast a diesel runs free on the line after one step, its crew owing `days` days of food,
   * the store of the depot beside the line in famine or not.
   */
  function freeSpeed(days: number, famine: boolean) {
    const w = grass();
    const quarry = station(w, 'quarry', 28, 19);
    depotWith(w, {}, { x: 8, y: 21 }).famine = famine;
    const t = new Train([{ uid: 1, level: 1, def: locoDef('f7') }]);
    expect(t.spawnAt(w.track, 12, 20, Dir.W)).not.toBe(false);
    t.oil = t.oilCap;
    t.schedule = [{ ...defaultStop(quarry.id), load: 'none', unload: 'none', waitFull: false }];
    w.fleet.trains.push(t);
    expect(t.dispatch(w.track, w.builder, w.map)).toBe(true);
    t.onPathReady((w.fleet as unknown as { ctx(n: number, s: number): TickCtx }).ctx(0, 1));
    t.owed.food = t.dailyFood * days;
    run(w, new SimStep(w), context(w, false), 1);
    expect(t.state, 'running').toBe('moving');
    return { speed: t.freeSpeed, hungry: t.hungry };
  }

  it('slows a train owed more than a day of food, not one at a store in famine', () => {
    const fed = freeSpeed(0.9, false);
    const hungry = freeSpeed(1.1, false);
    const atFamine = freeSpeed(0.9, true);
    expect([fed.hungry, hungry.hungry, atFamine.hungry]).toEqual([false, true, false]);
    expect(fed.speed, 'fed: running').toBeGreaterThan(0);
    expect(hungry.speed).toBeCloseTo(fed.speed * FAMINE_SPEED_MUL, 12);
    expect(atFamine.speed, 'a store in famine does not slow it').toBeCloseTo(fed.speed, 12);
  });

  it('one town starves while the other is fed', () => {
    // Full mode: in Simple mode two towns on one line are one store
    const w = simWorld({ terrain: 'grass', size: 96, supply: 'full' });
    line(w, 2, 30, 90);
    const hallA = station(w, 'town', 20, 29);
    const hallB = station(w, 'town', 46, 29);
    const storeA = w.stores.townStore(hallA.x, hallA.y)!;
    const storeB = w.stores.townStore(hallB.x, hallB.y)!;
    w.builder.free = true;
    const kilnA = w.builder.placeBuilding(24, 25, 'kiln')!;
    const kilnB = w.builder.placeBuilding(50, 25, 'kiln')!;
    w.builder.free = false;
    for (const [x, y] of [
      [18, 33],
      [44, 33],
    ]) {
      w.houses.sync({ id: 'townhouse', x, y, rot: 0 }, false);
      Object.assign(w.houses.at(x, y)!, { progress: 1, residents: 8 });
    }
    storeA.add('food', 300);
    storeA.add('wood', 300);
    storeB.add('wood', 300);
    const step = new SimStep(w);
    const ctx = context(w, false);
    run(w, step, ctx, Math.ceil(11 / SIM_STEP));
    expect(w.clock.time, 'game time').toBeGreaterThan(11);
    expect([storeA.famine, storeB.famine], 'famine A, B').toEqual([false, true]);
    // one more step: how far each kiln comes, batches made and the batch under way together
    const progress = (b: Building) => (b.made?.coal ?? 0) + b.acc;
    const before = [progress(kilnA), progress(kilnB)];
    run(w, step, ctx, 1);
    const a = progress(kilnA) - before[0];
    const b = progress(kilnB) - before[1];
    expect(a, 'town A: full rate').toBeCloseTo(
      (buildingRate(kilnA) * rules.productionMul * SIM_STEP) / weekSeconds(),
      12,
    );
    expect(b, 'town B: famine rate').toBeCloseTo(a * FAMINE_PRODUCTION_MUL, 12);
  });
});

describe('SimStep: passenger catchment', () => {
  it('counts the residents of finished houses within Chebyshev distance 7 of a passenger station', () => {
    const w = grass();
    const s = station(w, 'station', 20, 21);
    const farm = station(w, 'farm', 22, 21);
    // one bit of residents per house, so the total says which ones were counted
    const houses = [
      { dx: 7, dy: 0, progress: 1, residents: 1 }, // counted: on the edge
      { dx: 7, dy: 7, progress: 1, residents: 2 }, // counted: the corner, 9.9 tiles away
      { dx: 8, dy: 0, progress: 1, residents: 4 }, // out: 8 tiles
      { dx: 0, dy: 2, progress: 0.5, residents: 8 }, // out: still being built
      { dx: -3, dy: -8, progress: 1, residents: 16 }, // out: 8 tiles along y
    ];
    for (const h of houses) {
      const x = s.x + h.dx;
      const y = s.y + h.dy;
      w.houses.sync({ id: 'townhouse', x, y, rot: 0 }, false);
      Object.assign(w.houses.at(x, y)!, { progress: h.progress, residents: h.residents });
    }
    run(w, new SimStep(w), context(w, true), 1);
    expect(s.passengerPopulation, 'passenger station').toBe(1 + 2);
    expect(farm.passengerPopulation, 'farm').toBe(0);
    // the unfinished house is still unfinished, so the count was not luck of the step
    expect(w.houses.at(s.x, s.y + 2)!.progress).toBeLessThan(1);
  });
});

describe('startStock', () => {
  it.each([
    [3, 1],
    [1, 1],
    [2.37, 1],
    [3, 1.8],
  ])(
    'is the track pieces times their counts plus the crafting allowance, times startingResourceScale %s (track cost %s)',
    (scale, trackCost) => {
      rules.startingResourceScale = scale;
      rules.trackCostScale = trackCost;
      const craft = { wood: 40, stone: 10, iron: 30 };
      const want = (k: 'wood' | 'stone' | 'iron') =>
        Math.round(
          ((pieceCost('straight', 'branch')[k] ?? 0) * 50 +
            (pieceCost('curve', 'branch')[k] ?? 0) * 6 +
            (pieceCost('switch', 'branch')[k] ?? 0) * 1 +
            craft[k]) *
            scale,
        );
      expect(startStock()).toEqual({
        wood: want('wood'),
        stone: want('stone'),
        iron: want('iron'),
        water: 600,
        wheat: 300,
        food: 600,
        coal: 240,
      });
    },
  );

  it('is that sum for any resource and track cost scale, whatever rules.startStock is, with its keys in order', () => {
    const count = new Map(START_TRACK);
    /** Wood, stone or iron by hand: straights, curves and the switch, then the crafting, scaled. */
    const byHand = (k: 'wood' | 'stone' | 'iron', scale: number) => {
      const pieces = (kind: 'straight' | 'curve' | 'switch') =>
        (pieceCost(kind, 'branch')[k] ?? 0) * (count.get(kind) ?? 0);
      return Math.round(
        (pieces('straight') + pieces('curve') + pieces('switch') + START_CRAFT[k]) * scale,
      );
    };
    forAll(
      (rng) => ({
        scale: Math.round(rng.range(0.05, 10) * 1000) / 1000,
        trackCost: Math.round(rng.range(0.1, 4) * 1000) / 1000,
        /** two settings of rules.startStock, under which the stock must be the same */
        startStock: [rng.range(0.1, 5), rng.range(0.1, 5)].map((n) => Math.round(n * 100) / 100),
      }),
      (c) => {
        rules.startingResourceScale = c.scale;
        rules.trackCostScale = c.trackCost;
        rules.startStock = c.startStock[0];
        const got = startStock();
        expect(got, 'by hand').toEqual({
          wood: byHand('wood', c.scale),
          stone: byHand('stone', c.scale),
          iron: byHand('iron', c.scale),
          ...START_SUPPLIES,
        });
        // the order a new game puts them in the start depot
        expect(Object.keys(got), 'keys').toEqual([
          'wood',
          'stone',
          'iron',
          'water',
          'wheat',
          'food',
          'coal',
        ]);
        rules.startStock = c.startStock[1];
        expect(startStock(), `rules.startStock ${c.startStock[1]}`).toEqual(got);
      },
      {
        shrink: function* (c) {
          for (const scale of simpler(c.scale, 0.05)) yield { ...c, scale };
          for (const trackCost of simpler(c.trackCost, 0.1)) yield { ...c, trackCost };
          for (const [i, n] of c.startStock.entries())
            for (const m of simpler(n, 0.1))
              yield { ...c, startStock: c.startStock.map((v, j) => (j === i ? m : v)) };
        },
      },
    );
  });
});

/** Simpler numbers than `n` and no smaller than `min`: 1, then `n` to whole units, then to tenths. */
function* simpler(n: number, min: number): Iterable<number> {
  for (const m of new Set([1, Math.round(n), Math.round(n * 10) / 10]))
    if (m !== n && m >= min) yield m;
}

/** The first row, scanning from the top, whose tiles x0 - 1 .. x0 + 22 on rows y - 9 .. y + 9 all take buildings. */
function findSite(w: SimWorld): { x: number; y: number } {
  const ok = (x: number, y: number) => {
    const t = terrainAt(w.map, x, y);
    return t !== Terrain.Water && t !== Terrain.Rock && t !== Terrain.Mountain;
  };
  for (let y = 10; y < w.map.h - 10; y++)
    for (let x = 2; x + 24 < w.map.w; x++) {
      let fits = true;
      for (let dy = -9; dy <= 9 && fits; dy++)
        for (let dx = -1; dx <= 22 && fits; dx++) fits = ok(x + dx, y + dy);
      if (fits) return { x, y };
    }
  throw new Error(`seed ${w.seed}: no site`);
}

/**
 * A new game's stock (in the depot's store, where the train fills its tanks),
 * a depot with a line east of it, a quarry and a warehouse with a train between them, a passenger
 * station among finished and unfinished houses, and the clock 20 game seconds before the first day
 * ends with one contract completed that day.
 */
function build(w: SimWorld) {
  const { x, y } = findSite(w);
  const depot = depotWith(w, {}, { x, y });
  for (const [id, n] of Object.entries(startStock())) {
    depot.amounts.set(id, Math.round(n * rules.startStock));
  }
  line(w, x + 2, y, x + 20);
  const quarry = station(w, 'quarry', x + 8, y - 1);
  const warehouse = station(w, 'warehouse', x + 18, y - 1);
  const passengers = station(w, 'station', x + 12, y + 1);
  quarry.store('stone', 40);
  for (let i = 0; i < 6; i++) {
    const hx = x + 6 + i * 2;
    const hy = y + 3 + (i % 3) * 2;
    w.houses.sync({ id: 'townhouse', x: hx, y: hy, rot: 0 }, false);
    Object.assign(w.houses.at(hx, hy)!, { progress: i < 4 ? 1 : 0.3, residents: i < 4 ? 8 : 0 });
  }
  // the starter kit is narrow gauge: the regular line gets an Adler and a hopper of its own
  const loco = w.inventory.add('adler', 0);
  const hopper = w.inventory.add('wood_hopper', 0);
  const train = w.fleet.create([loco.uid], [hopper.uid], [quarry.id, warehouse.id]);
  if (typeof train === 'string') throw new Error(`seed ${w.seed}: fleet.create: ${train}`);
  w.clock.time = daySeconds() - 20;
  return { train, passengers };
}

/** What the steps decide, as JSON. */
function state(w: SimWorld, step: SimStep) {
  return {
    fleet: JSON.stringify(w.fleet.trains.map((t) => t.toJSON())),
    stores: JSON.stringify(w.stores.toJSON()),
    economy: JSON.stringify(w.economy.toJSON()),
    stations: JSON.stringify(w.builder.stations.map((s) => s.toJSON())),
    houses: JSON.stringify(w.houses.toJSON()),
    contracts: JSON.stringify(w.contracts.toJSON()),
    weather: JSON.stringify(w.weather.toJSON()),
    step: JSON.stringify([step.lastDay, step.nextCityCheck, step.nextAgeCheck]),
  };
}

describe('SimStep from one seed', () => {
  // slow because each seed steps a world through 1200 steps, twice: 1.2 s alone
  it.each([SIM_WORLD_SEED, 8])(
    'seed %i: two worlds stepped the same game time end with the same fleet, stock and economy',
    (seed) => {
      const once = () => {
        const w = simWorld({ seed });
        const built = build(w);
        const step = new SimStep(w);
        run(w, step, context(w, true), 1200);
        return { w, built, state: state(w, step) };
      };
      const a = once();
      const b = once();
      for (const k of Object.keys(a.state) as (keyof typeof a.state)[])
        expect(b.state[k], `seed ${seed}: ${k} JSON`).toBe(a.state[k]);
      // Not vacuous: the train ran, the station saw its passengers and the day turned.
      expect(a.built.train.distance, `seed ${seed}: tiles run`).toBeGreaterThan(0);
      expect(a.built.passengers.passengerPopulation, `seed ${seed}: passengers`).toBe(32);
      expect(a.w.clock.day, `seed ${seed}: day`).toBe(2);
    },
    90_000,
  );
});

// ------------------------------------------------------------------------------------------------
// Properties over generated scenes. Each scene is plain data drawn from a seeded Rng, so forAll can
// print it, replay it alone and shrink it; `stage` builds it on a 48-tile grass world.

/** One house of a scene: anchor tile, construction progress and residents. */
interface SceneHouse {
  x: number;
  y: number;
  progress: number;
  residents: number;
}

/** A small game around one line, and how it is run. */
interface Scene {
  daySeconds: number;
  seasonOffset: number;
  /** game time the run starts at, in days */
  startDays: number;
  /** leave lastDay at a new SimStep's 1 rather than the clock's day */
  staleLastDay: boolean;
  mode: 'play' | 'editor';
  /** the weather setting */
  weather: boolean;
  sky: { kind: WeatherKind; intensity: number; changeInDays: number };
  food: number;
  famine: boolean;
  farm: boolean;
  /** a second passenger station at the far end of the line */
  second: boolean;
  houses: SceneHouse[];
  /** two more depots and a house of 1000 residents: past the diesel age's goals */
  ageUp: boolean;
  buildings: string[];
  /** a train of an Adler and a wood hopper added for it, between the quarry and the town */
  train: boolean;
  /** game seconds until a standing deal (buy stone, sell wood) first settles; null: no deal */
  tradeIn: number | null;
  /** steps, from 0, in whose fleet.tick a contract is offered, accepted and delivered in full */
  deliveries: number[];
  steps: number;
  /**
   * the player takes each offer on as it comes (Auto-accept for every rarity), on land that
   * supports `TAKEN_AT_ONCE` contracts; otherwise offers wait on the board, as by default
   */
  takeOffers: boolean;
}

/** Contracts a refresh took on at once when every offer was accepted by default. */
const TAKEN_AT_ONCE = 6;

const BUILDINGS = ['windmill', 'kiln', 'grinder'] as const;

function genScene(rng: Rng, steps: [number, number]): Scene {
  const n = rng.int(steps[0], steps[1]);
  const houses: SceneHouse[] = [];
  for (let i = rng.int(0, 10); i > 0; i--)
    houses.push({
      x: rng.int(4, 44),
      y: rng.int(23, 36),
      progress: rng.pick([0, 0.4, 0.999, 1, 1]),
      residents: rng.int(0, 8),
    });
  const deliveries: number[] = [];
  for (let i = rng.int(0, 5); i > 0; i--) deliveries.push(rng.int(0, n - 1));
  deliveries.sort((a, b) => a - b);
  const day = rng.int(6, 40);
  return {
    daySeconds: day,
    seasonOffset: rng.int(0, 3),
    startDays: Math.round(rng.range(0, 3) * 1000) / 1000,
    staleLastDay: rng.chance(0.15),
    mode: rng.chance(0.75) ? 'play' : 'editor',
    weather: rng.chance(0.7),
    sky: {
      kind: rng.pick(['clear', 'rain', 'fog'] as const),
      intensity: Math.round(rng.next() * 1000) / 1000,
      changeInDays: Math.round(rng.range(0, 2) * 1000) / 1000,
    },
    food: rng.pick([0, rng.int(1, 40), 5000]),
    famine: rng.chance(0.3),
    farm: rng.chance(0.5),
    second: rng.chance(0.5),
    houses,
    ageUp: rng.chance(0.25),
    buildings: BUILDINGS.filter(() => rng.chance(0.5)),
    train: rng.chance(0.6),
    tradeIn: rng.chance(0.5) ? Math.round(rng.range(0, 3 * day) * 100) / 100 : null,
    deliveries,
    steps: n,
    takeOffers: rng.chance(0.6),
  };
}

/** Smaller scenes than `s`: fewer steps, houses, deliveries and buildings, fewer features on. */
function* shrinkScene(s: Scene): Iterable<Scene> {
  for (const steps of shrinkInt(s.steps, 1))
    yield { ...s, steps, deliveries: s.deliveries.filter((d) => d < steps) };
  for (const houses of shrinkArray(s.houses)) yield { ...s, houses };
  for (const deliveries of shrinkArray(s.deliveries)) yield { ...s, deliveries };
  for (const buildings of shrinkArray(s.buildings)) yield { ...s, buildings };
  for (const k of [
    'train',
    'ageUp',
    'farm',
    'second',
    'famine',
    'staleLastDay',
    'takeOffers',
  ] as const)
    if (s[k]) yield { ...s, [k]: false };
  if (s.tradeIn !== null) yield { ...s, tradeIn: null };
  if (s.weather) yield { ...s, weather: false };
  if (s.mode === 'play') yield { ...s, mode: 'editor' };
}

/** Biome production factor of a station, as Game.biomeProduction reads it. */
function biomeFactor(w: SimWorld, s: Station) {
  return biomeDef(biomeAt(w.map, s.x, s.y)).production[s.def.id] ?? 1;
}

/** A built scene: the world, the step's context and the hooks Game would pass, with their log. */
interface Staged {
  w: SimWorld;
  ctx: StepContext;
  hooks: Required<StepHooks>;
  /** what the hooks saw: `city <time>`, `season <name> <time>` */
  log: string[];
  /** the lastDay a step starts the run with */
  lastDay: number;
  /** the number of the step running now, for the deliveries */
  at: { step: number };
}

/**
 * Builds a scene: a depot at (6, 20) and a line along row 20 to x 44, a quarry, a passenger
 * station and a town on it (a farm and a second passenger station when asked), the houses, the
 * buildings on row 41, a new game's stock in the depot's store (trains refuel from it, the works
 * run from it), the scene's food and famine at every store, the clock,
 * weather and season.
 * The season hook is the simulating half of Game.applySeason; the city hook logs.
 * Deliveries run inside fleet.tick, where a train's unloading would complete a contract.
 */
function stage(s: Scene): Staged {
  rules.daySeconds = s.daySeconds;
  setSeasonOffset(s.seasonOffset);
  const w = simWorld({ terrain: 'grass', size: 48 });
  const depot = station(w, 'depot', 6, 20);
  line(w, 8, 20, 44);
  const quarry = station(w, 'quarry', 12, 19);
  station(w, 'station', 18, 21);
  if (s.farm) station(w, 'farm', 24, 21);
  const town = station(w, 'town', 30, 19);
  if (s.second) station(w, 'station', 40, 21);
  quarry.store('stone', 30);
  const houses = [...s.houses];
  if (s.ageUp) {
    station(w, 'depot', 30, 34);
    station(w, 'depot', 36, 34);
    houses.push({ x: 46, y: 46, progress: 1, residents: 1000 });
  }
  for (const h of houses) {
    w.houses.sync({ id: 'townhouse', x: h.x, y: h.y, rot: 0 }, false);
    Object.assign(w.houses.at(h.x, h.y)!, { progress: h.progress, residents: h.residents });
  }
  w.builder.free = true;
  for (const [i, id] of s.buildings.entries())
    if (!w.builder.placeBuilding(10 + i * 8, 41, id)) throw new Error(`no ${id}`);
  w.builder.free = false;
  // the stock first: a new train fills its tanks from it
  const depotStore = w.stores.byKey(`st:${depot.id}`)!;
  for (const [id, n] of Object.entries(startStock())) {
    depotStore.amounts.set(id, Math.round(n * rules.startStock));
  }
  if (s.train) {
    const loco = w.inventory.add('adler', 0);
    const hopper = w.inventory.add('wood_hopper', 0);
    const t = w.fleet.create([loco.uid], [hopper.uid], [quarry.id, town.id]);
    if (typeof t === 'string') throw new Error(`fleet.create: ${t}`);
  }
  for (const st of w.stores.all()) {
    if (st.kind === 'grid') continue;
    st.amounts.set('food', s.food);
    st.famine = s.famine;
  }
  w.clock.time = s.startDays * s.daySeconds;
  w.weather.load({
    kind: s.sky.kind,
    intensity: s.sky.intensity,
    nextChangeAt: w.clock.time + s.sky.changeInDays * s.daySeconds,
    rng: w.weather.rng.state,
  });
  if (s.tradeIn !== null)
    w.trade.load({ deals: { stone: 5, wood: -3 }, nextAt: w.clock.time + s.tradeIn });
  // set on every call, as daySeconds is: the scene alone decides it, whatever ran before it
  rules.contractOfferCount = s.takeOffers ? TAKEN_AT_ONCE : DEFAULT_RULES.contractOfferCount;
  if (s.takeOffers) {
    const answer = w.contracts.onEvent;
    w.contracts.onEvent = (e) => {
      answer?.(e);
      if (e.kind === 'offered' && e.contract.status === 'offer')
        w.contracts.accept(e.contract, w.clock.time);
    };
  }

  const log: string[] = [];
  let season: Season | null = null;
  const applySeason = (force = false) => {
    const now = s.weather ? seasonOf(w.clock.day) : 'spring';
    if (now === season && !force) return;
    season = now;
    log.push(`season ${now} ${w.clock.time}`);
    for (const st of w.builder.stations)
      st.productionMul = productionMul(st.def.id, now) * biomeFactor(w, st);
  };
  applySeason(true);
  const hooks: Required<StepHooks> = {
    refreshCity: () => log.push(`city ${w.clock.time}`),
    season: () => applySeason(),
  };
  const ctx: StepContext = {
    mode: s.mode,
    weather: s.weather,
  };
  const at = { step: 0 };
  const due = new Map<number, number>();
  for (const d of s.deliveries) due.set(d, (due.get(d) ?? 0) + 1);
  const fleetTick = w.fleet.tick.bind(w.fleet);
  w.fleet.tick = (gdt, now, factor) => {
    fleetTick(gdt, now, factor);
    for (let k = due.get(at.step) ?? 0; k > 0; k--) deliverContract(w);
  };
  return { w, ctx, hooks, log, lastDay: s.staleLastDay ? 1 : w.clock.day, at };
}

/**
 * A contract delivered in full through fleet.onDelivery, as a train unloading at its destination
 * would: one offered and accepted at once (by the player, as an offer waits for them by default),
 * or the active one due first when the land holds no more contracts.
 */
function deliverContract(w: SimWorld) {
  const fresh = w.contracts.generate(w.clock.time, true);
  if (fresh?.status === 'offer') w.contracts.accept(fresh, w.clock.time);
  const c =
    fresh?.status === 'active'
      ? fresh
      : w.contracts.active.sort((a, b) => a.expires - b.expires || a.id - b.id)[0];
  if (!c) return;
  const dest = w.builder.stationById(c.destId);
  if (!dest) return;
  const train = undefined as unknown as Train; // the board does not read it
  w.fleet.onDelivery?.({
    cargo: c.cargo,
    amount: c.amount,
    origin: c.originId,
    station: dest,
    train,
  });
}

/** Everything a step can change in a staged world, one JSON string per domain. */
function fullState(w: SimWorld, clocks: [number, number, number], log: string[]) {
  return {
    clock: JSON.stringify([w.clock.time, w.clock.day]),
    fleet: JSON.stringify(w.fleet.trains.map((t) => t.toJSON())),
    stores: JSON.stringify(w.stores.toJSON()),
    economy: JSON.stringify(w.economy.toJSON()),
    stations: JSON.stringify(
      w.builder.stations.map((s) => [s.toJSON(), s.productionMul, s.passengerPopulation]),
    ),
    buildings: JSON.stringify([...w.builder.buildings.values()]),
    houses: JSON.stringify(w.houses.toJSON()),
    people: JSON.stringify(w.people.toJSON()),
    contracts: JSON.stringify(w.contracts.toJSON()),
    weather: JSON.stringify([w.weather.toJSON(), w.weather.visible]),
    trade: JSON.stringify(w.trade.toJSON()),
    step: JSON.stringify(clocks),
    hooks: JSON.stringify(log),
  };
}
type FullState = ReturnType<typeof fullState>;

/** The first domain in which two states differ, or null. */
function firstDifference(a: FullState, b: FullState): string | null {
  for (const k of Object.keys(a) as (keyof FullState)[]) if (a[k] !== b[k]) return k;
  return null;
}

describe('the named constants', () => {
  it('keep the values the step applies', () => {
    expect(FAMINE_PRODUCTION_MUL, 'FAMINE_PRODUCTION_MUL').toBe(0.5);
    expect(FAMINE_SPEED_MUL, 'FAMINE_SPEED_MUL').toBe(0.7);
    expect(PASSENGER_CATCHMENT, 'PASSENGER_CATCHMENT').toBe(7);
    expect(CITY_CHECK_SECONDS, 'CITY_CHECK_SECONDS').toBe(10);
    expect(AGE_CHECKS_PER_DAY, 'AGE_CHECKS_PER_DAY').toBe(24);
  });
});

// ---------------------------------------------------------------- one step, watched

/** Wraps `f` so that each call is logged under `name` and checked before it runs. */
function watched<A extends unknown[], R>(
  calls: string[],
  name: string,
  f: (...a: A) => R,
  check: (...a: A) => void,
): (...a: A) => R {
  return (...a: A): R => {
    calls.push(name);
    check(...a);
    return f(...a);
  };
}

describe('SimStep: one step', () => {
  // slow because 100 seeded scenes of up to 400 steps each run with every domain hooked: 2 s alone
  it(
    'calls the domains in order, with the values of the rules it names',
    { timeout: 90_000 },
    () => {
      const seen = {
        famine: 0,
        city: 0,
        age: 0,
        turn: 0,
        editor: 0,
        weatherOff: 0,
      };
      forAll(
        (rng) => ({
          scene: genScene(rng, [1, 400]),
          gdt: rng.chance(0.5) ? SIM_STEP : Math.round(rng.range(0.001, 3) * 1000) / 1000,
        }),
        ({ scene, gdt }) => {
          const { w, ctx, hooks, lastDay, at } = stage(scene);
          const calls: string[] = [];
          const step = new SimStep(w, {
            refreshCity: () => calls.push('refreshCity'),
            season: () => {
              calls.push('season');
              hooks.season();
            },
          });
          step.lastDay = lastDay;
          for (at.step = 0; at.step < scene.steps - 1; at.step++)
            w.clock.run((g) => step.run(g, ctx));
          at.step = -1; // no delivery in the watched step

          const {
            stores,
            houses,
            builder,
            fleet,
            people,
            weather,
            contracts,
            trade,
            economy,
            clock,
          } = w;
          const play = ctx.mode === 'play';
          // the works under way advance once a step, by the step's game time, before anything else
          builder.tickWorks = watched(
            calls,
            'builder.tickWorks',
            builder.tickWorks.bind(builder),
            (dt) => {
              expect(dt, 'builder.tickWorks: gdt').toBe(gdt);
            },
          );
          houses.tickWorks = watched(
            calls,
            'houses.tickWorks',
            houses.tickWorks.bind(houses),
            (dt) => {
              expect(dt, 'houses.tickWorks: gdt').toBe(gdt);
            },
          );
          stores.tickUpkeep = watched(
            calls,
            'stores.tickUpkeep',
            stores.tickUpkeep.bind(stores),
            (dt, eaters) => {
              expect(dt, 'stores.tickUpkeep: gdt').toBe(gdt);
              expect(eatersOf(eaters), 'stores.tickUpkeep: eaters').toEqual(eatersByHand(w));
            },
          );
          houses.tick = watched(
            calls,
            'houses.tick',
            houses.tick.bind(houses),
            (dt, now, spawn) => {
              expect([dt, now, spawn], 'houses.tick').toEqual([gdt, clock.time, play]);
            },
          );
          people.tick = watched(calls, 'people.tick', people.tick.bind(people), (dt, pop, frac) => {
            const want = builder.crewTotal() + houses.residentsTotal();
            expect([dt, pop, frac], 'people.tick').toEqual([gdt, want, clock.dayFraction]);
          });
          for (const s of builder.stations)
            s.tick = watched(calls, `station ${s.id}`, s.tick.bind(s), (dt) => {
              const mul = stores.supplierFor(s.x, s.y)?.famine ? FAMINE_PRODUCTION_MUL : 1;
              expect(dt, `station ${s.id} (${s.def.id}): gdt`).toBe(gdt * mul);
              if (s.def.id === 'station')
                expect(s.passengerPopulation, `station ${s.id}: catchment`).toBe(
                  catchmentByHand(w, s),
                );
            });
          vi.mocked(tickBuildings).mockImplementation((bs, storeOf, dt) => {
            calls.push('tickBuildings');
            const list = [...bs];
            expect(list, 'tickBuildings: buildings').toEqual([...builder.buildings.values()]);
            for (const b of list)
              expect(storeOf(b) === stores.worksStore(b), `tickBuildings: store of ${b.id}`).toBe(
                true,
              );
            expect(dt, 'tickBuildings: gdt').toBe(gdt);
            realTickBuildings(list, storeOf, dt);
          });
          weather.tick = watched(
            calls,
            'weather.tick',
            weather.tick.bind(weather),
            (now, day, dt) => {
              expect([now, day, dt], 'weather.tick').toEqual([clock.time, clock.day, gdt]);
            },
          );
          fleet.tick = watched(calls, 'fleet.tick', fleet.tick.bind(fleet), (dt, now, factor) => {
            const want = ctx.weather ? weather.speedFactor() : 1;
            expect([dt, now, factor], 'fleet.tick').toEqual([gdt, clock.time, want]);
          });
          contracts.tick = watched(
            calls,
            'contracts.tick',
            contracts.tick.bind(contracts),
            (now) => {
              expect(now, 'contracts.tick').toBe(clock.time);
            },
          );
          const tradeTick = trade.tick.bind(trade);
          trade.tick = (now, st, econ) => {
            calls.push('trade.tick');
            expect(now, 'trade.tick: time').toBe(clock.time);
            expect(st === stores && econ === economy, 'trade.tick: stores and economy').toBe(true);
            tradeTick(now, st, econ);
          };
          economy.advanceAge = watched(
            calls,
            'advanceAge',
            economy.advanceAge.bind(economy),
            (snap) => {
              expect(snap, 'advanceAge: ageSnapshot').toEqual(ageSnapshot(w));
            },
          );

          clock.time += gdt;
          const before = { ...step };
          const cityDue = clock.time >= before.nextCityCheck;
          const ageDue = play && clock.time >= before.nextAgeCheck;
          const turns = clock.day !== before.lastDay;
          calls.length = 0;
          try {
            step.run(gdt, ctx);
          } finally {
            vi.mocked(tickBuildings).mockImplementation(realTickBuildings);
          }

          expect(calls, 'calls').toEqual([
            'builder.tickWorks',
            'houses.tickWorks',
            'stores.tickUpkeep',
            'houses.tick',
            ...(cityDue ? ['refreshCity'] : []),
            ...(play ? ['people.tick'] : []),
            ...builder.stations.map((s) => `station ${s.id}`),
            'tickBuildings',
            ...(ctx.weather ? ['weather.tick'] : []),
            'season',
            'fleet.tick',
            'contracts.tick',
            'trade.tick',
            ...(ageDue ? ['advanceAge'] : []),
          ]);
          expect(step.lastDay, 'lastDay').toBe(clock.day);
          expect(step.nextCityCheck, 'nextCityCheck').toBe(
            cityDue ? clock.time + CITY_CHECK_SECONDS : before.nextCityCheck,
          );
          expect(step.nextAgeCheck, 'nextAgeCheck').toBe(
            ageDue ? clock.time + daySeconds() / AGE_CHECKS_PER_DAY : before.nextAgeCheck,
          );
          if (stores.all().some((st) => st.famine)) seen.famine++;
          if (cityDue) seen.city++;
          if (ageDue) seen.age++;
          if (turns) seen.turn++;
          if (!play) seen.editor++;
          if (!ctx.weather) seen.weatherOff++;
        },
        { seeds: Array.from({ length: 80 }, (_, i) => i + 1) },
      );
      for (const [k, n] of Object.entries(seen)) expect(n, `steps with ${k}`).toBeGreaterThan(0);
    },
  );
});

/** Eaters a step counted, by store key, in key order. */
function eatersOf(eaters: Map<ResourceStore, number>): [string, number][] {
  return [...eaters].map(([st, n]): [string, number] => [st.key, n]).sort(byKey);
}
const byKey = (a: [string, number], b: [string, number]) => (a[0] < b[0] ? -1 : 1);

/**
 * Who eats where, by store key, counted from the world: every house's residents at the store of
 * the town whose Townhouse is nearest within its reach, every station's, service's and open works'
 * crew at that town's store, else at the nearest store within reach of its anchor tile (ties to
 * the lower key). Nobody eats where no store is.
 */
function eatersByHand(w: SimWorld): [string, number][] {
  const out = new Map<string, number>();
  const eat = (key: string | null, n: number) => {
    if (key !== null && n > 0) out.set(key, (out.get(key) ?? 0) + n);
  };
  const town = (x: number, y: number) => {
    let best: string | null = null;
    let bd = Infinity;
    for (const t of w.towns.towns) {
      const hall = w.builder.stationById(t.stationId)!;
      const d = hall.distTo(x, y);
      if (d <= TOWN_RADIUS && d < bd) [best, bd] = [`town:${t.id}`, d];
    }
    return best;
  };
  const near = (x: number, y: number) => {
    let best: string | null = null;
    let bd = Infinity;
    for (const st of w.stores.all()) {
      if (st.kind === 'grid') continue;
      const d = Math.max(Math.abs(st.anchor.x - x), Math.abs(st.anchor.y - y));
      if (d <= rules.buildReach && (d < bd || (d === bd && st.key < best!)))
        [best, bd] = [st.key, d];
    }
    return best;
  };
  for (const h of w.houses.houses.values()) eat(town(h.x, h.y), h.residents);
  const crew = (x: number, y: number, n: number) => eat(town(x, y) ?? near(x, y), n);
  for (const s of w.builder.stations) crew(s.x, s.y, s.crew);
  for (const d of w.builder.decor.values()) crew(d.x, d.y, decorDef(d.id).crew);
  for (const b of w.builder.buildings.values()) if (!b.work) crew(b.x, b.y, buildingDef(b.id).crew);
  return [...out].sort(byKey);
}

/** Residents of finished houses on the 15 x 15 tiles centred on the station, tile by tile. */
function catchmentByHand(w: SimWorld, s: Station) {
  let n = 0;
  for (let dy = -7; dy <= 7; dy++)
    for (let dx = -7; dx <= 7; dx++) {
      const h = w.houses.at(s.x + dx, s.y + dy);
      if (h && h.progress >= 1) n += h.residents;
    }
  return n;
}

describe('SimStep: passenger catchment against a count tile by tile', () => {
  it(
    'every passenger station counts the finished houses within 7 tiles; other stations keep theirs',
    { timeout: 90_000 },
    () => {
      let counted = 0;
      forAll(
        (rng) => {
          const xs = rng.shuffle([10, 13, 16, 19, 22, 25, 28, 31, 34, 37]);
          const houses: SceneHouse[] = [];
          for (let i = rng.int(0, 30); i > 0; i--)
            houses.push({
              x: rng.int(0, 47),
              y: rng.int(0, 47),
              progress: rng.pick([0, 0.5, 0.999, 1, 1, 1]),
              residents: rng.int(0, 20),
            });
          return {
            passengers: xs.slice(0, rng.int(1, 3)).map((x) => ({ x, y: rng.pick([19, 21]) })),
            quarry: { x: xs[3], y: rng.pick([19, 21]) },
            houses,
          };
        },
        (c) => {
          const w = simWorld({ terrain: 'grass', size: 48 });
          line(w, 8, 20, 40);
          const stations = c.passengers.map((p) => station(w, 'station', p.x, p.y));
          const quarry = station(w, 'quarry', c.quarry.x, c.quarry.y);
          quarry.passengerPopulation = 4242;
          for (const h of c.houses) {
            w.houses.sync({ id: 'townhouse', x: h.x, y: h.y, rot: 0 }, false);
            Object.assign(w.houses.at(h.x, h.y)!, { progress: h.progress, residents: h.residents });
          }
          run(w, new SimStep(w), context(w, true), 1);
          for (const s of stations) {
            expect(s.passengerPopulation, `station at ${s.x},${s.y}`).toBe(catchmentByHand(w, s));
            if (s.passengerPopulation > 0) counted++;
          }
          expect(quarry.passengerPopulation, 'quarry').toBe(4242);
        },
        { shrink: (c) => [...shrinkArray(c.houses)].map((houses) => ({ ...c, houses })) },
      );
      expect(counted, 'stations that counted someone').toBeGreaterThan(0);
    },
  );
});

// ---------------------------------------------------------------- cadence

/**
 * Calls at game times `calls` over a run whose steps ended at `times`, due first at `first` and
 * then `period` after the previous call: the first is at the first step at or after `first`,
 * each next one at least `period` and less than `period` plus a step after the one before, the
 * run ends before another is due, and `next` is when that is.
 */
function expectCadence(
  what: string,
  calls: number[],
  times: number[],
  first: number,
  period: number,
  next: number,
) {
  const i0 = times.findIndex((t) => t >= first);
  if (i0 < 0) {
    expect(calls, `${what}: calls before the first is due`).toEqual([]);
    expect(next, `${what}: next`).toBe(first);
    return;
  }
  expect(calls[0], `${what}: first call`).toBe(times[i0]);
  for (let i = 1; i < calls.length; i++) {
    const gap = calls[i] - calls[i - 1];
    expect(gap, `${what}: gap ${i}`).toBeGreaterThanOrEqual(period - 1e-9);
    expect(gap, `${what}: gap ${i}`).toBeLessThan(period + SIM_STEP + 1e-9);
  }
  const last = calls[calls.length - 1];
  expect(times[times.length - 1], `${what}: run ends before the next`).toBeLessThan(last + period);
  expect(next, `${what}: next`).toBe(last + period);
}

describe('SimStep: cadence', () => {
  it(
    'calls the city hook every 10 game seconds, checks the ages hourly in play only, walks people in play only',
    { timeout: 90_000 },
    () => {
      forAll(
        (rng) => ({
          daySeconds: rng.int(6, 240),
          startDays: Math.round(rng.range(0, 3) * 1000) / 1000,
          cityIn: rng.chance(0.4) ? null : Math.round(rng.range(-5, 25) * 100) / 100,
          ageIn: rng.chance(0.4) ? null : Math.round(rng.range(-5, 25) * 100) / 100,
          mode: rng.chance(0.7) ? ('play' as const) : ('editor' as const),
          steps: rng.int(1, 2500),
        }),
        (c) => {
          rules.daySeconds = c.daySeconds;
          const w = simWorld({ terrain: 'grass', size: 16 });
          w.clock.time = c.startDays * c.daySeconds;
          const city: number[] = [];
          const ages: number[] = [];
          let walks = 0;
          const step = new SimStep(w, { refreshCity: () => city.push(w.clock.time) });
          // a new session (both checks due at 0), or check times carried over from an earlier run
          const firstCity = c.cityIn === null ? 0 : w.clock.time + c.cityIn;
          const firstAge = c.ageIn === null ? 0 : w.clock.time + c.ageIn;
          step.nextCityCheck = firstCity;
          step.nextAgeCheck = firstAge;
          const advanceAge = w.economy.advanceAge.bind(w.economy);
          w.economy.advanceAge = (snap) => {
            ages.push(w.clock.time);
            advanceAge(snap);
          };
          const walk = w.people.tick.bind(w.people);
          w.people.tick = (...a) => {
            walks++;
            walk(...a);
          };
          const ctx: StepContext = { ...context(w, true), mode: c.mode };
          const times: number[] = [];
          for (let i = 0; i < c.steps; i++) {
            w.clock.run((gdt) => step.run(gdt, ctx));
            times.push(w.clock.time);
          }
          expectCadence('city', city, times, firstCity, CITY_CHECK_SECONDS, step.nextCityCheck);
          if (c.mode === 'play') {
            const hour = daySeconds() / AGE_CHECKS_PER_DAY;
            expectCadence('age check', ages, times, firstAge, hour, step.nextAgeCheck);
          } else {
            expect(ages, 'editor: age checks').toEqual([]);
            expect(step.nextAgeCheck, 'editor: nextAgeCheck').toBe(firstAge);
          }
          expect(walks, 'people.tick calls').toBe(c.mode === 'play' ? c.steps : 0);
        },
        { shrink: (c) => [...shrinkInt(c.steps, 1)].map((steps) => ({ ...c, steps })) },
      );
    },
  );
});

// ---------------------------------------------------------------- the economy's ledger

describe('SimStep: money and stock', () => {
  /**
   * Scenes without a train, where fares, refuelling and access charges cannot move money or
   * stock: every change is then a contract completed or failed, a trade settled, an age reached,
   * the crews' food or a building's batch.
   */
  // slow because 100 seeded scenes of 200 to 1500 steps each run with every stock movement logged:
  // 2.5 s alone
  it('change only through the named rules', { timeout: 90_000 }, () => {
    const seen = {
      completions: 0,
      failures: 0,
      settlements: 0,
      ageUps: 0,
      upkeep: 0,
      batches: 0,
      harvest: 0,
    };
    forAll(
      (rng) => ({ ...genScene(rng, [200, 1500]), train: false }),
      (s) => {
        const { w, ctx, hooks, lastDay, at } = stage(s);
        // what the domains report
        let completed: number[] = [];
        let fines: number[] = [];
        let settled: { units: number; money: number; resource: string }[] = [];
        let ages: number[] = [];
        const onEvent = w.contracts.onEvent;
        w.contracts.onEvent = (e) => {
          if (e.kind === 'completed') completed.push(e.contract.payout);
          if (e.kind === 'failed') fines.push(w.contracts.failFine(e.contract));
          if (e.kind === 'cancelled') throw new Error('a step cancelled a contract');
          onEvent?.(e);
        };
        w.trade.onSettled = (out) => settled.push(...out);
        w.economy.onAgeUp = (tier) => ages.push(tier);
        // every movement of each store (its key), and the domain call it happened in
        let phase = 'the step';
        const flows: { phase: string; where: string; id: string; n: number }[] = [];
        const within =
          <A extends unknown[], R>(name: string, f: (...a: A) => R) =>
          (...a: A): R => {
            const was = phase;
            phase = name;
            try {
              return f(...a);
            } finally {
              phase = was;
            }
          };
        for (const st of w.stores.all()) {
          const storeAdd = st.add.bind(st);
          const storeTake = st.take.bind(st);
          st.add = (id, amount) => {
            const n = storeAdd(id, amount);
            flows.push({ phase, where: st.key, id, n });
            return n;
          };
          st.take = (id, amount) => {
            const n = storeTake(id, amount);
            flows.push({ phase, where: st.key, id, n: -n });
            return n;
          };
        }
        w.stores.tickUpkeep = within('upkeep', w.stores.tickUpkeep.bind(w.stores));
        for (const st of w.builder.stations) st.tick = within('stations', st.tick.bind(st));
        w.trade.tick = within('trade', w.trade.tick.bind(w.trade));
        vi.mocked(tickBuildings).mockImplementation(within('buildings', realTickBuildings));

        const step = new SimStep(w, hooks);
        step.lastDay = lastDay;
        for (at.step = 0; at.step < s.steps; at.step++) {
          const before = {
            money: w.economy.money,
            earned: w.economy.earned,
            stores: new Map(w.stores.all().map((st) => [st.key, new Map(st.amounts)])),
          };
          completed = [];
          fines = [];
          settled = [];
          ages = [];
          flows.length = 0;
          w.clock.run((gdt) => step.run(gdt, ctx));
          const where = `step ${at.step} at ${w.clock.time}`;

          const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
          expect(step.lastDay, `${where}: lastDay`).toBe(w.clock.day);

          const payouts = sum(completed);
          const trade = sum(settled.map((t) => t.money));
          const sales = sum(settled.map((t) => Math.max(0, t.money)));
          const money = w.economy.money - before.money;
          expect(money, `${where}: money`).toBeCloseTo(payouts - sum(fines) + trade, 6);
          const earned = w.economy.earned - before.earned;
          expect(earned, `${where}: earned`).toBeCloseTo(payouts + sales, 6);

          const holders: [string, Map<string, number>, Map<string, number>][] = [
            ...w.stores
              .all()
              .map((st): [string, Map<string, number>, Map<string, number>] => [
                st.key,
                before.stores.get(st.key) ?? new Map(),
                st.amounts,
              ]),
          ];
          for (const [at, was, now] of holders)
            for (const id of new Set([...was.keys(), ...now.keys()])) {
              const moved = sum(flows.filter((f) => f.where === at && f.id === id).map((f) => f.n));
              const change = (now.get(id) ?? 0) - (was.get(id) ?? 0);
              expect(change, `${where}: ${at} ${id} against its recorded moves`).toBeCloseTo(
                moved,
                9,
              );
            }
          for (const f of flows) {
            const named = f.phase === 'buildings' || f.phase === 'trade';
            const food = f.phase === 'upkeep' && f.id === 'food' && f.n <= 0;
            // a harvester in a town's reach makes into the town's store
            const made = f.phase === 'stations' && f.where.startsWith('town:') && f.n >= 0;
            if (!named && !food && !made)
              throw new Error(`${where}: ${f.id} ${f.n} moved in ${f.phase} at ${f.where}`);
            if (f.phase === 'upkeep' && f.n < 0) seen.upkeep++;
            if (f.phase === 'buildings' && f.n !== 0) seen.batches++;
            if (made && f.n > 0) seen.harvest++;
          }
          seen.completions += completed.length;
          seen.failures += fines.length;
          seen.settlements += settled.length;
          seen.ageUps += ages.length;
        }
        vi.mocked(tickBuildings).mockImplementation(realTickBuildings);
      },
      { shrink: shrinkScene, seeds: Array.from({ length: 30 }, (_, i) => i + 1) },
    );
    for (const [k, n] of Object.entries(seen)) expect(n, `runs with ${k}`).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------- the age snapshot

interface Site {
  x: number;
  y: number;
  /** tiles along x and y when it covers more than one (the plant, a battery) */
  w?: number;
  h?: number;
}

/** A world for the age snapshot: what stands where, and the numbers it holds. */
interface AgeCase {
  depots: number;
  narrow: number;
  plant: boolean;
  substations: Site[];
  poles: Site[];
  /** the wired tiles of the line, x from .. to on WIRE_ROW */
  wires: { from: number; to: number };
  population: number;
  earned: number;
  /** chunks bought besides the start chunk (0) of the 2 x 2 grid */
  bought: number[];
}

/** The power plant's site, when a case has one: it covers 3 x 2 tiles from this corner. */
const PLANT: Site = { x: 10, y: 24, w: 3, h: 2 };
/** The row the line and its wire run along. */
const WIRE_ROW = 20;
/**
 * Substation (Battery) sites, each covering its footprint from its corner (one tile since the 3D
 * models, 2026-10-27): two within two tiles of the plant's footprint, (30, 24) at the end of the
 * power line and (40, 26) out of every node's reach.
 */
const SUBSTATIONS: readonly Site[] = [
  { x: 14, y: 24 },
  { x: 10, y: 27 },
  { x: 30, y: 24 },
  { x: 40, y: 26 },
].map((s) => ({ ...s, ...buildingSpan(buildingDef('substation'), 0) }));
/**
 * Pole sites: a power line from the plant to the substation site at (30, 24), each pole within two
 * tiles of the one before, running along row 21 beside the wired row from x 14 to 28.
 */
const POLES: readonly Site[] = [
  { x: 12, y: 22 },
  ...Array.from({ length: 8 }, (_, i) => ({ x: 14 + 2 * i, y: 21 })),
  { x: 30, y: 22 },
];

/** The gap between two sites' footprints, Chebyshev: 1 beside each other, 0 where they touch. */
const chebyshev = (a: Site, b: Site) =>
  Math.max(
    0,
    a.x - (b.x + (b.w ?? 1) - 1),
    b.x - (a.x + (a.w ?? 1) - 1),
    a.y - (b.y + (b.h ?? 1) - 1),
    b.y - (a.y + (a.h ?? 1) - 1),
  );

/**
 * The snapshot of a case counted from its own sites, by the rules of PowerGrid.rebuild and
 * Catenary.rebuild and isLive. The plant, the poles and the substations are the grid's nodes; two
 * within Chebyshev distance 2 of each other are joined, and every node joined to the plant, however
 * many hops away, is live and powers the tiles within 1 of it. A substation is powered when it is
 * live. With a substation anywhere, a wire tile is live when a powered one stands within the
 * substation's radius; with none at all, when the grid powers the tile. `gridOnly` counts the wire
 * tiles the grid powers that are dead all the same.
 */
function ageByHand(c: AgeCase) {
  const radius = buildingDef('substation').substation?.radius ?? Number.NaN;
  const nodes = [...(c.plant ? [PLANT] : []), ...c.poles, ...c.substations];
  const live = new Set<number>();
  const todo = c.plant ? [0] : [];
  for (let i = todo.pop(); i !== undefined; i = todo.pop()) {
    if (live.has(i)) continue;
    live.add(i);
    nodes.forEach((n, j) => {
      if (!live.has(j) && chebyshev(nodes[i], n) <= 2) todo.push(j);
    });
  }
  const first = nodes.length - c.substations.length;
  const powered = c.substations.filter((_, i) => live.has(first + i));
  let wires = 0;
  let gridOnly = 0;
  for (let x = c.wires.from; x <= c.wires.to; x++) {
    const tile = { x, y: WIRE_ROW };
    const gridPowers = [...live].some((i) => chebyshev(nodes[i], tile) <= 1);
    const isLive =
      c.substations.length > 0 ? powered.some((s) => chebyshev(s, tile) <= radius) : gridPowers;
    if (isLive) wires++;
    else if (gridPowers) gridOnly++;
  }
  const snap = {
    depots: c.depots,
    population: c.population,
    earned: c.earned,
    substations: powered.length,
    wires,
    chunks: 1 + c.bought.length,
  };
  return { snap, gridOnly };
}

/** Smaller worlds than `c`: fewer substations, poles, wired tiles, depots and chunks; no plant. */
function* shrinkAgeCase(c: AgeCase): Iterable<AgeCase> {
  for (const substations of shrinkArray(c.substations)) yield { ...c, substations };
  for (const poles of shrinkArray(c.poles)) yield { ...c, poles };
  if (c.plant) yield { ...c, plant: false };
  for (const to of shrinkInt(c.wires.to, c.wires.from)) yield { ...c, wires: { ...c.wires, to } };
  for (const from of shrinkInt(c.wires.from, c.wires.to))
    yield { ...c, wires: { ...c.wires, from } };
  for (const depots of shrinkInt(c.depots)) yield { ...c, depots };
  for (const narrow of shrinkInt(c.narrow)) yield { ...c, narrow };
  for (const bought of shrinkArray(c.bought)) yield { ...c, bought };
}

describe('ageSnapshot against a count by hand', () => {
  it(
    'measures regular depots, population, earnings, powered substations, live wires and owned chunks',
    { timeout: 90_000 },
    () => {
      const seen = {
        narrow: 0,
        powered: 0,
        unpowered: 0,
        /** a substation powered through the power line, out of the plant's own reach */
        relayed: 0,
        live: 0,
        dead: 0,
        /** wire tiles the grid powers, dead because no powered substation reaches them */
        gridOnly: 0,
        /** no substation anywhere */
        legacy: 0,
        legacyLive: 0,
        legacyDead: 0,
        bought: 0,
      };
      forAll(
        (rng): AgeCase => {
          const from = rng.int(2, 30);
          return {
            depots: rng.int(0, 3),
            narrow: rng.int(0, 2),
            plant: rng.chance(0.7),
            substations: rng.chance(0.25) ? [] : SUBSTATIONS.filter(() => rng.chance(0.5)),
            poles: rng.chance(0.3) ? [] : POLES.filter(() => rng.chance(0.9)),
            wires: { from, to: rng.int(from, 46) },
            population: rng.int(0, 5000),
            earned: rng.int(0, 200000),
            bought: [1, 2, 3].filter(() => rng.chance(0.5)),
          };
        },
        (c) => {
          const w = simWorld({ terrain: 'grass', size: 48 });
          line(w, 2, WIRE_ROW, 46);
          for (let i = 0; i < c.depots; i++) station(w, 'depot', 4 + 5 * i, 30);
          for (let i = 0; i < c.narrow; i++) station(w, 'narrow_depot', 4 + 5 * i, 38);
          w.builder.free = true;
          if (c.plant && !w.builder.placeBuilding(PLANT.x, PLANT.y, 'power_plant'))
            throw new Error('plant');
          for (const s of c.substations)
            if (!w.builder.placeBuilding(s.x, s.y, 'substation'))
              throw new Error(`substation at ${s.x},${s.y}`);
          for (const p of c.poles)
            if (!w.builder.placeDecor(p.x, p.y, 'power_line', 0))
              throw new Error(`pole at ${p.x},${p.y}`);
          for (let x = c.wires.from; x <= c.wires.to; x++)
            if (!w.builder.placeSupply(x, WIRE_ROW, 'catenary')) throw new Error(`wire at ${x}`);
          w.builder.free = false;
          w.houses.residentsTotal = () => c.population;
          w.economy.earned = c.earned;
          for (const i of c.bought) if (!w.regions.own(i)) throw new Error(`chunk ${i}`);

          const { snap, gridOnly } = ageByHand(c);
          expect(ageSnapshot(w)).toEqual(snap);
          const wired = c.wires.to - c.wires.from + 1;
          const plantReach = c.substations.filter((s) => c.plant && chebyshev(s, PLANT) <= 2);
          if (c.bought.length) seen.bought++;
          if (c.narrow) seen.narrow++;
          if (snap.substations) seen.powered++;
          if (snap.substations < c.substations.length) seen.unpowered++;
          if (snap.substations > plantReach.length) seen.relayed++;
          if (snap.wires) seen.live++;
          if (snap.wires < wired) seen.dead++;
          if (gridOnly && c.substations.length) seen.gridOnly++;
          if (!c.substations.length) {
            seen.legacy++;
            if (snap.wires) seen.legacyLive++;
            if (snap.wires < wired) seen.legacyDead++;
          }
        },
        { shrink: shrinkAgeCase },
      );
      for (const [k, n] of Object.entries(seen)) expect(n, `cases with ${k}`).toBeGreaterThan(0);
    },
  );
});

describe('SimStep: the age check', () => {
  /**
   * A grass world of 3 x 3 chunks with two depots and only the start chunk owned, nobody housed,
   * and its economy loaded from a save made in age `tier`. An in-game hour is one game second.
   */
  function saved(tier: number) {
    rules.daySeconds = AGE_CHECKS_PER_DAY;
    const w = simWorld({ terrain: 'grass', size: 96 });
    station(w, 'depot', 40, 40);
    station(w, 'depot', 46, 40);
    w.economy.setAge(tier);
    w.economy.load(JSON.parse(JSON.stringify(w.economy.toJSON())));
    return w;
  }

  it('moves a Steam-age save up on the first check after it owns nine chunks', () => {
    const w = saved(0);
    const step = new SimStep(w);
    const ctx = context(w, false);
    run(w, step, ctx, 1);
    expect(w.economy.tier, 'two depots and the start chunk').toBe(0);
    expect(w.regions.applyTier(1), 'the ring around the start chunk').toHaveLength(8);
    const due = step.nextAgeCheck;
    for (let n = 0; step.nextAgeCheck === due; n++) {
      expect(w.economy.tier, `step ${n}, before the next check`).toBe(0);
      if (n > 1000) throw new Error('no age check');
      run(w, step, ctx, 1);
    }
    expect(w.economy.tier, 'on the next check').toBe(1);
  });

  it('leaves a save past the Diesel age where it is, short of the Diesel goal', () => {
    for (let tier = 1; tier <= LAST_AGE; tier++) {
      const w = saved(tier);
      const step = new SimStep(w);
      run(w, step, context(w, false), 100);
      expect(step.nextAgeCheck, 'checked more than once').toBeGreaterThan(2);
      expect(ageSnapshot(w).chunks).toBe(1);
      expect(w.economy.tier, `a save in age ${tier}`).toBe(tier);
    }
  });
});

// ---------------------------------------------------------------- determinism over seeds

/** A generated world, how it is built and run, and when the run changes speed or session. */
interface SeedCase {
  seed: number;
  daySeconds: number;
  mode: 'play' | 'editor';
  weather: boolean;
  steps: number;
  /** loop-tick speeds (0 to 3) the second run cycles through */
  speeds: number[];
  /** the step before which the second run carries its state into a new SimStep */
  sessionBreak: number;
  deliveries: number[];
}

/**
 * Builds the seed's world as `build` does, then runs it `c.steps` steps: at 1x in one SimStep,
 * or at the case's changing speeds with a new SimStep from `c.sessionBreak` that is given the old
 * one's lastDay, nextCityCheck and nextAgeCheck. Returns the state and the world.
 */
function seedRun(c: SeedCase, varied: boolean) {
  rules.daySeconds = c.daySeconds;
  const w = simWorld({ seed: c.seed });
  const { train } = build(w);
  const log: string[] = [];
  let season: Season | null = null;
  const hooks: Required<StepHooks> = {
    refreshCity: () => log.push(`city ${w.clock.time}`),
    season: () => {
      const now = c.weather ? seasonOf(w.clock.day) : 'spring';
      if (now === season) return;
      season = now;
      log.push(`season ${now} ${w.clock.time}`);
      for (const st of w.builder.stations)
        st.productionMul = productionMul(st.def.id, now) * biomeFactor(w, st);
    },
  };
  const ctx: StepContext = {
    mode: c.mode,
    weather: c.weather,
  };
  let done = 0;
  const fleetTick = w.fleet.tick.bind(w.fleet);
  w.fleet.tick = (gdt, now, factor) => {
    fleetTick(gdt, now, factor);
    for (const d of c.deliveries) if (d === done) deliverContract(w);
  };
  let step = new SimStep(w, hooks);
  const one = (gdt: number) => {
    if (varied && done === c.sessionBreak) {
      const next = new SimStep(w, hooks);
      next.lastDay = step.lastDay;
      next.nextCityCheck = step.nextCityCheck;
      next.nextAgeCheck = step.nextAgeCheck;
      step = next;
    }
    step.run(gdt, ctx);
    done++;
  };
  for (let tick = 0; done < c.steps; tick++) {
    w.clock.setSpeed(varied ? Math.min(c.speeds[tick % c.speeds.length], c.steps - done) : 1);
    w.clock.run(one);
  }
  const clocks: [number, number, number] = [step.lastDay, step.nextCityCheck, step.nextAgeCheck];
  return { w, train, state: fullState(w, clocks, log) };
}

describe('SimStep over a seed list', () => {
  // slow because each of 8 seeded games of 300 to 900 steps runs twice, with another world between
  // the runs: 1.1 s alone
  it(
    'runs the same world the same way at any speeds, across a new session, after another world ran',
    { timeout: 90_000 },
    () => {
      forAll(
        (rng): SeedCase => {
          const steps = rng.int(300, 900);
          const deliveries: number[] = [];
          for (let i = rng.int(0, 4); i > 0; i--) deliveries.push(rng.int(0, steps - 1));
          return {
            seed: rng.int(1, 2 ** 31 - 2),
            daySeconds: rng.chance(0.5) ? 240 : rng.int(20, 120),
            mode: rng.chance(0.75) ? 'play' : 'editor',
            weather: rng.chance(0.7),
            steps,
            speeds: Array.from({ length: rng.int(1, 12) }, () => rng.int(0, 3)).concat([1]),
            sessionBreak: rng.int(0, steps - 1),
            deliveries,
          };
        },
        (c) => {
          const a = seedRun(c, false);
          // another world in between: whatever it leaves in module state must not matter
          const other = simWorld({ seed: c.seed ^ 0x5a5a, terrain: 'grass', size: 32 });
          line(other, 4, 10, 28);
          station(other, 'quarry', 8, 9);
          station(other, 'station', 16, 11);
          run(other, new SimStep(other), context(other, true), 60);
          const b = seedRun(c, true);
          const k = firstDifference(a.state, b.state);
          if (k) throw new Error(`seed ${c.seed}: ${k} differs`);
          expect(a.train.distance, `seed ${c.seed}: the train ran`).toBeGreaterThan(0);
        },
        {
          // case 2 draws a world with no room for findSite's site
          seeds: [1, 3, 4, 5, 6, 7, 8, 9],
          shrink: (c) =>
            [...shrinkInt(c.steps, 1)].map((steps) => ({
              ...c,
              steps,
              sessionBreak: Math.min(c.sessionBreak, steps - 1),
            })),
        },
      );
    },
  );
});

describe('SimStep: the stores record what they receive and spend', () => {
  it('shows the crews eating at the depot after real steps, the clock moved by the step', () => {
    const w = grass();
    const depot = depotWith(w, { food: 500 }, { x: 8, y: 20 });
    station(w, 'quarry', 12, 19);
    w.stores.beginFlowHistory();
    const pool = w.stores.poolOf(depot);
    expect(pool.weeklyFlow('food')).toEqual({ produced: 0, consumed: 0 });
    run(w, new SimStep(w), context(w, false), 120);
    const ate = 500 - depot.get('food');
    expect(ate).toBeGreaterThan(0);
    expect(pool.weeklyFlow('food').consumed).toBeCloseTo(ate, 9);
    expect(pool.weeklyFlow('food').produced).toBe(0);
  });
});

describe('ageSnapshot population of real houses', () => {
  it('is the residents of the houses the world holds, with nothing stubbed', () => {
    const w = simWorld({ terrain: 'grass', size: 96 });
    line(w, 2, 30, 90);
    const hall = station(w, 'town', 36, 29);
    const store = w.stores.townStore(hall.x, hall.y)!;
    w.builder.free = true;
    w.builder.spawnDecor(40, 29, 'townhouse', 0);
    w.builder.spawnDecor(32, 29, 'townhouse', 0);
    w.houses.finishAll();
    store.add('food', 300);
    for (let i = 0; i < 100; i++) w.houses.tick(daySeconds(), i * daySeconds());
    let residents = 0;
    for (const h of w.houses.houses.values()) residents += h.residents;
    expect(residents).toBeGreaterThan(0);
    expect(ageSnapshot(w).population).toBe(residents);
    expect(ageSnapshot(w).population).toBe(w.houses.residentsTotal());
  });
});
