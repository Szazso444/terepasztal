// One simulation step and the starting stock, with the numbers they apply. Free of the renderer
// and the page so Node tests drive the same tick order the game runs: the game calls
// `SimStep.run` once per fixed step (`GameClock.run`) and keeps the drawing, toasts and sounds in
// the hooks it passes in.

import { rules, daySeconds } from './rules';
import { pieceCost, type TrackKind } from '../world/track';
import { tickBuildings } from './buildings';
import type { AgeSnapshot } from './ages';
import type { GameClock } from './time';
import type { Stockpile } from './stockpile';
import type { House, HouseRegistry } from './houses';
import type { Builder } from './build';
import type { Station } from './stations';
import type { Fleet } from './fleet';
import type { PeopleSim } from './people';
import type { Weather } from './weather';
import type { ContractBoard } from './contracts';
import type { TradeDesk } from './trade';
import type { Economy } from './economy';
import type { Catenary } from './catenary';
import type { RegionState } from '../world/regions';

/** Production multiplier of every station while the crews starve (`Stockpile.famine`). */
export const FAMINE_PRODUCTION_MUL = 0.5;
/** Speed multiplier of every train while the crews starve, on top of the weather's. */
export const FAMINE_SPEED_MUL = 0.7;
/**
 * Reach of a passenger station in tiles, as Chebyshev distance from its anchor tile: the residents
 * of finished houses (`progress >= 1`) this close are its passengers.
 */
export const PASSENGER_CATCHMENT = 7;
/** Game seconds between two calls of the city hook (the game redraws its town tiles). */
export const CITY_CHECK_SECONDS = 10;
/** Checks of the next age's goals per in-game day, in play mode only: once an in-game hour. */
export const AGE_CHECKS_PER_DAY = 24;
/** Tickets granted when a day ends on which at least one contract was completed. */
export const DAILY_TICKETS = 1;

/**
 * Track pieces of the regular class the starting wood, stone and iron pay for (spec §16): about
 * fifty straights, a handful of curves and a switch. The order is the order they are summed in.
 */
export const START_TRACK: readonly (readonly [TrackKind, number])[] = [
  ['straight', 50],
  ['curve', 6],
  ['switch', 1],
];
/** Wood, stone and iron on top of the track for crafting one locomotive and four wagons. */
export const START_CRAFT = { wood: 40, stone: 10, iron: 30 } as const;
/** Supplies a new game starts with, not scaled by `rules.startingResourceScale`. */
export const START_SUPPLIES = { water: 600, wheat: 300, food: 600, coal: 240 } as const;

/**
 * Starting stockpile for a brand-new game, before `rules.startStock` scaling. Wood, stone and
 * iron are what START_TRACK costs at the current track prices plus START_CRAFT, multiplied by
 * `rules.startingResourceScale` and rounded; START_SUPPLIES follow as they are.
 */
export function startStock(): Record<string, number> {
  const sum = (k: keyof typeof START_CRAFT) => {
    let n = 0;
    for (const [kind, count] of START_TRACK) n += (pieceCost(kind, 'regular')[k] ?? 0) * count;
    return n + START_CRAFT[k];
  };
  const s = rules.startingResourceScale;
  return {
    wood: Math.round(sum('wood') * s),
    stone: Math.round(sum('stone') * s),
    iron: Math.round(sum('iron') * s),
    ...START_SUPPLIES,
  };
}

/**
 * The domains one step reads and changes. The names are Game's fields (and the fixture's in
 * src/testing/simWorld.ts), so either can be passed as it is.
 */
export interface StepDomains {
  readonly clock: GameClock;
  readonly stock: Stockpile;
  readonly houses: HouseRegistry;
  readonly builder: Builder;
  readonly fleet: Fleet;
  readonly people: PeopleSim;
  readonly weather: Weather;
  readonly contracts: ContractBoard;
  readonly trade: TradeDesk;
  readonly economy: Economy;
  readonly catenary: Catenary;
  /** chunk ownership, read by the age goals only */
  readonly regions: RegionState;
}

/** The domains the age goals are measured in. */
export type AgeDomains = Pick<
  StepDomains,
  'builder' | 'stock' | 'economy' | 'catenary' | 'regions'
>;

/** The live numbers the age goals are measured against. */
export function ageSnapshot(d: AgeDomains): AgeSnapshot {
  let wires = 0;
  for (const e of d.catenary.entries()) if (d.catenary.isLive(e.x, e.y)) wires++;
  return {
    depots: d.builder.depotsOf('regular').length,
    population: d.stock.population,
    earned: d.economy.earned,
    substations: d.catenary.substations.filter((s) => s.powered).length,
    wires,
    chunks: d.regions.ownedCount(),
  };
}

/** What the game decides outside the simulation, read at every step. */
export interface StepContext {
  /** people walk and the age goals are checked in play mode only */
  readonly mode: 'play' | 'editor';
  /** the weather setting: off keeps the weather still and its speed factor at 1 */
  readonly weather: boolean;
  /** storage cap of one resource now (`Game.stockCap`), for the trade desk */
  readonly stockCap: (id: string) => number;
}

/** The game's side of a step: drawing, toasts and sounds. Each one is optional. */
export interface StepHooks {
  /** every CITY_CHECK_SECONDS of game time, after the houses moved on */
  refreshCity?: () => void;
  /** every step after the weather: the game re-tints and sets production when the season turns */
  season?: () => void;
  /** a day ended with completed contracts and DAILY_TICKETS were granted for it */
  dailyTicket?: () => void;
}

/** Residents of finished houses within PASSENGER_CATCHMENT of the station's anchor. */
function catchment(houses: Iterable<House>, s: Station): number {
  let n = 0;
  for (const h of houses)
    if (
      h.progress >= 1 &&
      Math.max(Math.abs(h.x - s.x), Math.abs(h.y - s.y)) <= PASSENGER_CATCHMENT
    )
      n += h.residents;
  return n;
}

/**
 * One simulation step over every domain, in the order the game has always run them. It holds the
 * step's own clocks: `lastDay` travels with the save, the two check times start at 0 in a new
 * session.
 */
export class SimStep {
  /** the day the last step ran in; a step in another day settles the daily ticket */
  lastDay = 1;
  /** game time at or after which the next step calls the city hook */
  nextCityCheck = 0;
  /** game time at or after which the next step in play mode checks the age goals */
  nextAgeCheck = 0;

  constructor(
    readonly d: StepDomains,
    readonly hooks: StepHooks = {},
  ) {}

  /** Run one step of `gdt` game seconds; the clock already stands at the step's end. */
  run(gdt: number, ctx: StepContext): void {
    const { clock, stock, houses, builder, fleet, people, weather, contracts, trade, economy } =
      this.d;
    const play = ctx.mode === 'play';
    // upgrades follow game time: the works under way advance first, so the rest of the step sees
    // which buildings are closed and which have just opened at their new level
    builder.tickWorks(gdt);
    houses.tickWorks(gdt);
    stock.population = houses.residentsTotal();
    stock.workforce = builder.crewTotal() + fleet.crewTotal();
    stock.tick(gdt);
    houses.tick(gdt, clock.time, play);
    if (clock.time >= this.nextCityCheck) {
      this.nextCityCheck = clock.time + CITY_CHECK_SECONDS;
      this.hooks.refreshCity?.();
    }
    if (play) people.tick(gdt, builder.crewTotal() + houses.residentsTotal(), clock.dayFraction);
    const famineMul = stock.famine ? FAMINE_PRODUCTION_MUL : 1;
    for (const s of builder.stations) {
      if (s.def.id === 'station') s.passengerPopulation = catchment(houses.houses.values(), s);
      s.tick(gdt * famineMul);
    }
    tickBuildings(
      builder.buildings.values(),
      stock,
      gdt,
      stock.famine,
      builder.plantCount(),
      builder.depotCount(),
    );
    if (ctx.weather) weather.tick(clock.time, clock.day, gdt);
    this.hooks.season?.();
    const speed = (ctx.weather ? weather.speedFactor() : 1) * (stock.famine ? FAMINE_SPEED_MUL : 1);
    fleet.tick(gdt, clock.time, speed);
    contracts.tick(clock.time);
    trade.tick(clock.time, stock, economy, ctx.stockCap);
    if (play && clock.time >= this.nextAgeCheck) {
      this.nextAgeCheck = clock.time + daySeconds() / AGE_CHECKS_PER_DAY;
      economy.advanceAge(ageSnapshot(this.d));
    }
    if (clock.day !== this.lastDay) {
      this.lastDay = clock.day;
      if (contracts.completedToday > 0) {
        economy.tickets += DAILY_TICKETS;
        this.hooks.dailyTicket?.();
      }
      contracts.completedToday = 0;
    }
  }
}
