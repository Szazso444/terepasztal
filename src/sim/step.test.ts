import { describe, it, expect, beforeEach, vi } from 'vitest';
import { simWorld, line, station, SIM_WORLD_SEED, type SimWorld } from '../testing/simWorld';
import { Terrain, terrainAt } from '../world/tiles';
import { pieceCost } from '../world/track';
import { rules, DEFAULT_RULES, daySeconds } from './rules';
import { setSupplyMode, DEFAULT_SUPPLY } from './supply';
import { setSeasonOffset } from './weather';
import { resetTrainIds } from './trains';
import { resetStationIds } from './stations';
import { SimStep, startStock, type StepContext, type StepHooks } from './step';

beforeEach(() => {
  Object.assign(rules, DEFAULT_RULES);
  setSupplyMode(DEFAULT_SUPPLY);
  setSeasonOffset(0);
  resetTrainIds();
  resetStationIds();
});

/** Play mode with the weather setting as given and Game's storage cap. */
function context(w: SimWorld, weather: boolean): StepContext {
  return {
    mode: 'play',
    weather,
    stockCap: (id) => w.stock.cap(id, w.builder.depotCount(), w.builder.plantCount()),
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
   * A quarry by the line (its crew eats), a step at 1x with rain forced to full strength, and the
   * speed factor fleet.tick was called with. Starving: no food and the famine already declared;
   * fed: a full larder.
   */
  function once(starving: boolean, weather: boolean) {
    const w = grass();
    const quarry = station(w, 'quarry', 14, 19);
    if (starving) w.stock.famine = true;
    else w.stock.add('food', 1000);
    w.weather.load({ kind: 'rain', intensity: 1, nextChangeAt: 1e9, rng: w.weather.rng.state });
    const tick = vi.spyOn(w.fleet, 'tick');
    run(w, new SimStep(w), context(w, weather), 1);
    expect(tick, 'fleet.tick calls').toHaveBeenCalledTimes(1);
    return {
      famine: w.stock.famine,
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
    expect(starving.stone).toBeCloseTo(fed.stone * 0.5, 12);
  });

  it.each([true, false])(
    'multiplies the speed factor fleet.tick gets by 0.7 (weather %s)',
    (weather) => {
      const fed = once(false, weather);
      const starving = once(true, weather);
      // rain at full strength slows trains by 12 % when the weather is on, not at all when off
      expect(fed.speed, 'fed: speed factor').toBeCloseTo(weather ? fed.weatherFactor : 1, 12);
      expect(fed.speed, 'fed: speed factor').toBeCloseTo(weather ? 0.88 : 1, 12);
      expect(starving.speed, 'starving: speed factor').toBeCloseTo(fed.speed * 0.7, 12);
    },
  );
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

describe('SimStep: daily ticket', () => {
  it('grants one ticket for each day with completed contracts, none otherwise, and resets the count', () => {
    rules.daySeconds = 30;
    const w = grass();
    // completions per day; day 4 has two and still earns one ticket
    const completions: Record<number, number> = { 1: 1, 3: 1, 4: 2, 6: 1 };
    let hookCalls = 0;
    const hooks: StepHooks = { dailyTicket: () => hookCalls++ };
    const step = new SimStep(w, hooks);
    const ctx = context(w, true);
    const tickets0 = w.economy.tickets;
    w.contracts.completedToday = completions[1];
    let day = w.clock.day;
    while (w.clock.day < 7) {
      const before = { tickets: w.economy.tickets, hooks: hookCalls };
      run(w, step, ctx, 1);
      if (w.clock.day === day) continue;
      // the day turned on this step: settle the one that ended
      const earned = completions[day] ? 1 : 0;
      expect(w.economy.tickets - before.tickets, `tickets for day ${day}`).toBe(earned);
      expect(hookCalls - before.hooks, `hook calls for day ${day}`).toBe(earned);
      expect(w.contracts.completedToday, `count after day ${day}`).toBe(0);
      expect(step.lastDay).toBe(w.clock.day);
      day = w.clock.day;
      w.contracts.completedToday = completions[day] ?? 0;
    }
    expect(w.economy.tickets - tickets0, 'tickets over six days').toBe(4);
    expect(hookCalls, 'hook calls over six days').toBe(4);
    expect(w.economy.tier, 'no age-up added tickets').toBe(0);
    expect(w.clock.time, 'six days run').toBeGreaterThan(6 * daySeconds());
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
          ((pieceCost('straight', 'regular')[k] ?? 0) * 50 +
            (pieceCost('curve', 'regular')[k] ?? 0) * 6 +
            (pieceCost('switch', 'regular')[k] ?? 0) * 1 +
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
});

describe('SimStep from one seed', () => {
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
   * A new game's stock, a depot with a line east of it, a quarry and a warehouse with a train
   * between them, a passenger station among finished and unfinished houses, and the clock 20 game
   * seconds before the first day ends with one contract completed that day.
   */
  function build(w: SimWorld) {
    const { x, y } = findSite(w);
    for (const [id, n] of Object.entries(startStock()))
      w.stock.add(id, Math.round(n * rules.startStock));
    station(w, 'depot', x, y);
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
    const loco = w.inventory.items.find((i) => i.defId === 'adler');
    const hopper = w.inventory.items.find((i) => i.defId === 'wood_hopper');
    if (!loco || !hopper) throw new Error(`seed ${w.seed}: no starter adler and wood hopper`);
    const train = w.fleet.create([loco.uid], [hopper.uid], [quarry.id, warehouse.id]);
    if (typeof train === 'string') throw new Error(`seed ${w.seed}: fleet.create: ${train}`);
    w.clock.time = daySeconds() - 20;
    w.contracts.completedToday = 1;
    return { train, passengers };
  }

  /** What the steps decide, as JSON. */
  function state(w: SimWorld, step: SimStep) {
    return {
      fleet: JSON.stringify(w.fleet.trains.map((t) => t.toJSON())),
      stock: JSON.stringify(w.stock.toJSON()),
      economy: JSON.stringify(w.economy.toJSON()),
      stations: JSON.stringify(w.builder.stations.map((s) => s.toJSON())),
      houses: JSON.stringify(w.houses.toJSON()),
      contracts: JSON.stringify(w.contracts.toJSON()),
      weather: JSON.stringify(w.weather.toJSON()),
      step: JSON.stringify([step.lastDay, step.nextCityCheck, step.nextAgeCheck]),
    };
  }

  it.each([SIM_WORLD_SEED, 7])(
    'seed %i: two worlds stepped the same game time end with the same fleet, stock and economy',
    (seed) => {
      const once = () => {
        const w = simWorld({ seed });
        const built = build(w);
        const ticketsBefore = w.economy.tickets;
        const step = new SimStep(w);
        run(w, step, context(w, true), 1200);
        return { w, built, ticketsBefore, state: state(w, step) };
      };
      const a = once();
      const b = once();
      for (const k of Object.keys(a.state) as (keyof typeof a.state)[])
        expect(b.state[k], `seed ${seed}: ${k} JSON`).toBe(a.state[k]);
      // Not vacuous: the train ran, the station saw its passengers and the day turned.
      expect(a.built.train.distance, `seed ${seed}: tiles run`).toBeGreaterThan(0);
      expect(a.built.passengers.passengerPopulation, `seed ${seed}: passengers`).toBe(32);
      expect(a.w.clock.day, `seed ${seed}: day`).toBe(2);
      expect(a.w.economy.tickets, `seed ${seed}: daily ticket`).toBe(a.ticketsBefore + 1);
    },
  );
});
