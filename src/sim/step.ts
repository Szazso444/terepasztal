// One simulation step and the starting stock, with the numbers they apply. Free of the renderer
// and the page so Node tests drive the same tick order the game runs: the game calls
// `SimStep.run` once per fixed step (`GameClock.run`) and keeps the drawing, toasts and sounds in
// the hooks it passes in.

import { rules, daySeconds } from './rules';
import { pieceCost, type TrackKind } from '../world/track';
import { tickBuildings } from './buildings';
import type { AgeSnapshot } from './ages';
import type { GameClock } from './time';
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
import type { Roads } from './roads';
import { CrossingWatch } from './crossings';
import type { ResourceStore } from './stores';
import type { RegionState } from '../world/regions';

/**
 * Production multiplier of a station or works while the crews at its store starve (`Store.famine`,
 * set by `StoreRegistry.tickUpkeep`).
 */
export const FAMINE_PRODUCTION_MUL = 0.5;
/** Speed multiplier of a hungry train (`Train.hungry`), on top of the weather's. */
export { FAMINE_SPEED_MUL } from './trains';
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
 * Starting goods for a brand-new game, before `rules.startStock` scaling. Wood, stone and
 * iron are what START_TRACK costs at the current track prices plus START_CRAFT, multiplied by
 * `rules.startingResourceScale` and rounded; START_SUPPLIES follow as they are.
 */
export function startStock(): Record<string, number> {
  const sum = (k: keyof typeof START_CRAFT) => {
    let n = 0;
    for (const [kind, count] of START_TRACK) n += (pieceCost(kind, 'branch')[k] ?? 0) * count;
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
  readonly houses: HouseRegistry;
  /** what is built, the roads and their level crossings among it (`builder.roads`) */
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
  'builder' | 'houses' | 'economy' | 'catenary' | 'regions'
>;

/** The live numbers the age goals are measured against. */
export function ageSnapshot(d: AgeDomains): AgeSnapshot {
  let wires = 0;
  for (const e of d.catenary.entries()) if (d.catenary.isLive(e.x, e.y)) wires++;
  return {
    depots: d.builder.depotsOf('regular').length,
    population: d.houses.residentsTotal(),
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

/**
 * Who eats at which store this step: the residents of every house at its town's store, the crews
 * of stations, works and services at the store that supplies their tile. A house outside every
 * town and a crew with no store in reach eat nothing (and never starve). Train crews are not
 * counted here: they owe their food and pay it at the next store they fill up at (`Train.owed`).
 */
export function eaters(houses: HouseRegistry, builder: Builder): Map<ResourceStore, number> {
  const out = new Map<ResourceStore, number>();
  const eat = (at: ResourceStore | null, n: number) => {
    if (at && n > 0) out.set(at, (out.get(at) ?? 0) + n);
  };
  const stores = builder.stores;
  for (const h of houses.houses.values()) eat(stores.townStore(h.x, h.y), h.residents);
  for (const c of builder.crewSites()) eat(stores.supplierFor(c.x, c.y), c.crew);
  return out;
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
  /**
   * The level crossings of the builder's roads and which of them are closed to walkers, kept for
   * the roads they were read from: read again when the roads or the track change (their
   * `version`s), and a new watch for new roads. Not saved; null until the first step in play mode.
   */
  private crossingState: {
    roads: Roads;
    roadsVersion: number;
    trackVersion: number;
    keys: Set<number>;
    watch: CrossingWatch;
  } | null = null;

  constructor(
    readonly d: StepDomains,
    readonly hooks: StepHooks = {},
  ) {}

  /** Which level crossings are closed to walkers, as of the last step in play mode. */
  get crossings(): CrossingWatch | null {
    return this.crossingState?.watch ?? null;
  }

  /** Move the crossing watch on by one step of `gdt` from where the trains stand now. */
  private watchCrossings(gdt: number): CrossingWatch {
    const roads = this.d.builder.roads;
    let c = this.crossingState;
    if (!c || c.roads !== roads)
      c = this.crossingState = {
        roads,
        roadsVersion: NaN,
        trackVersion: NaN,
        keys: new Set(),
        watch: new CrossingWatch(roads.w),
      };
    if (c.roadsVersion !== roads.version || c.trackVersion !== roads.track.version) {
      c.keys = roads.crossingKeys();
      c.roadsVersion = roads.version;
      c.trackVersion = roads.track.version;
    }
    c.watch.update(this.d.fleet.trains, c.keys, gdt);
    return c.watch;
  }

  /** Run one step of `gdt` game seconds; the clock already stands at the step's end. */
  run(gdt: number, ctx: StepContext): void {
    const { clock, houses, builder, fleet, people, weather, contracts, trade, economy } = this.d;
    const play = ctx.mode === 'play';
    // the stores follow the rails and the supply mode, so every dock this step is the current one
    builder.stores.follow();
    // upgrades follow game time: the works under way advance first, so the rest of the step sees
    // which buildings are closed and which have just opened at their new level
    builder.tickWorks(gdt);
    houses.tickWorks(gdt);
    const stores = builder.stores;
    stores.tickUpkeep(gdt, eaters(houses, builder));
    houses.tick(gdt, clock.time, play);
    if (clock.time >= this.nextCityCheck) {
      this.nextCityCheck = clock.time + CITY_CHECK_SECONDS;
      this.hooks.refreshCity?.();
    }
    // walkers wait at the level crossings the trains close, and walk round those only trains out
    // of fuel or power close, read where the trains stood at the end of the last step: they move
    // before the trains do
    if (play) {
      const crossings = this.watchCrossings(gdt);
      people.tick(
        gdt,
        builder.crewTotal() + houses.residentsTotal(),
        clock.dayFraction,
        crossings.size ? crossings.closed : null,
        crossings.size ? crossings : null,
      );
    }
    // a station makes less while the crews at the store that supplies it starve
    for (const s of builder.stations) {
      if (s.def.id === 'station') s.passengerPopulation = catchment(houses.houses.values(), s);
      s.tick(gdt * (stores.supplierFor(s.x, s.y)?.famine ? FAMINE_PRODUCTION_MUL : 1));
    }
    tickBuildings(builder.buildings.values(), (b) => stores.worksStore(b), gdt);
    if (ctx.weather) weather.tick(clock.time, clock.day, gdt);
    else weather.updateWind(clock.time, false);
    this.hooks.season?.();
    const speed = ctx.weather ? weather.speedFactor() : 1;
    fleet.tick(gdt, clock.time, speed);
    contracts.tick(clock.time);
    trade.tick(clock.time, stores, economy);
    if (play && clock.time >= this.nextAgeCheck) {
      this.nextAgeCheck = clock.time + daySeconds() / AGE_CHECKS_PER_DAY;
      economy.advanceAge(ageSnapshot(this.d));
    }
    if (clock.day !== this.lastDay) {
      this.lastDay = clock.day;
      builder.wear.daily();
      // a piece that failed of time closes now, not at the next train's hit
      builder.wear.flush();
      if (contracts.completedToday > 0) {
        economy.tickets += DAILY_TICKETS;
        this.hooks.dailyTicket?.();
      }
      contracts.completedToday = 0;
    }
  }
}
