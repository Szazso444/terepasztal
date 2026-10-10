// Headless world fixture: the simulation's domains built and cross-wired the way Game.init wires
// them, with no renderer, DOM, toasts or sounds, so the sim step, save round trips and soak tests
// share one world instead of each building its own subset. Plain TypeScript with no test
// framework. The simulation calls `sfx` from src/engine/audio.ts, which imports and plays as a
// no-op under Node, so a test that uses this needs no audio mock.

import { emptyMap, generateMap, type MapGenParams } from '../world/mapgen';
import { Terrain, type GameMap } from '../world/tiles';
import { RegionState } from '../world/regions';
import { TrackGraph } from '../world/track';
import { railProfile } from '../world/railProfile';
import { Rng } from '../engine/rng';
import { rules } from '../sim/rules';
import { setSupplyMode, type SupplyMode } from '../sim/supply';
import { GameClock } from '../sim/time';
import { Economy } from '../sim/economy';
import { Stockpile } from '../sim/stockpile';
import { Builder, type Decor } from '../sim/build';
import { buildingDef, type Building } from '../sim/buildings';
import { type Station, resetStationIds } from '../sim/stations';
import { resetTrainIds } from '../sim/trains';
import { TownRegistry } from '../sim/towns';
import { HouseRegistry } from '../sim/houses';
import { PowerGrid } from '../sim/power';
import { Catenary } from '../sim/catenary';
import { Weather, productionMul, seasonOf } from '../sim/weather';
import { biomeAt, biomeDef } from '../sim/biomes';
import { Fleet } from '../sim/fleet';
import { PeopleSim } from '../sim/people';
import { ContractBoard } from '../sim/contracts';
import { ContractDispatcher } from '../sim/contractDispatch';
import { TradeDesk } from '../sim/trade';
import { Notices } from '../sim/notices';
import { DEFAULT_SETTINGS, contractPolicyFor } from '../sim/save';
import { Inventory } from '../gacha/inventory';
import { Gacha } from '../gacha/gacha';
import { Crafting } from '../gacha/crafting';

/** The seed a world gets when none is asked for: the one the older local fixtures use. */
export const SIM_WORLD_SEED = 4242;

/** What simWorld may be given; every field is optional. */
export interface SimWorldOptions {
  /** the world seed: the map and every stream drawn from it (default SIM_WORLD_SEED) */
  seed?: number;
  /** side of the square map in tiles (default `rules.mapSize` at the call: a new game's size) */
  size?: number;
  /** `generated`: generateMap with a new game's parameters; `grass`: flat grass (default generated) */
  terrain?: 'generated' | 'grass';
  /** production chain, set as Game's constructor sets it (default: unset, which is simple) */
  supply?: SupplyMode;
}

/** The simulation's domains of one game, wired to each other; the names are Game's fields. */
export interface SimWorld {
  readonly seed: number;
  readonly map: GameMap;
  readonly regions: RegionState;
  readonly track: TrackGraph;
  readonly builder: Builder;
  readonly economy: Economy;
  readonly stock: Stockpile;
  readonly towns: TownRegistry;
  readonly houses: HouseRegistry;
  readonly power: PowerGrid;
  readonly catenary: Catenary;
  readonly weather: Weather;
  readonly inventory: Inventory;
  readonly fleet: Fleet;
  readonly people: PeopleSim;
  readonly contracts: ContractBoard;
  readonly gacha: Gacha;
  readonly crafting: Crafting;
  readonly contractJobs: ContractDispatcher;
  readonly trade: TradeDesk;
  readonly clock: GameClock;
  readonly notices: Notices;
}

/** The map parameters a new game of this size gets (`paramsFromRules` in src/main.ts). */
export function mapParams(size: number): MapGenParams {
  return {
    w: size,
    h: size,
    waterLevel: rules.waterLevel,
    hillLevel: rules.hillLevel,
    rockLevel: rules.rockLevel,
    forestDensity: rules.forestDensity,
  };
}

/**
 * A fresh game's simulation, built as `new Game(spec, supply)` and `Game.init` build it: the
 * block from `new TrackGraph` through `contracts.onEvent`, plus `fleet.waitingAt` and
 * `fleet.contractDest`, with the same RNG seeds (weather `seed ^ 0x77ea`, contracts `^ 0x5eed`,
 * gacha `^ 0x9ac4a`, crafting `^ 0xc4af7`; walkers from the map seed) and the starter inventory.
 *
 * Defaults: seed SIM_WORLD_SEED (4242), size `rules.mapSize` read at the call (160 unless a test
 * changed the rules), terrain `generated` (generateMap with the parameters a new game gets from
 * the rules), supply unset (simple). The clock stands at 0 and nothing is placed, paid or stocked:
 * `Game.startFresh` (money, stock, the first depot, a season from the wall clock) is not run.
 *
 * Only callbacks between simulation objects are wired. Where Game wires a builder event to a
 * method that both draws and simulates, the simulating half is kept, so building through
 * `builder` changes the rest of the world as in the game: track and bridges refresh bridge
 * capacity and `fleet.railBeds` (which Game refreshes before its next step), signals rebuild the
 * fleet's signals, decor syncs houses and towns, works refresh towns, power lines, plants and
 * substations rebuild power and catenary, supply changes rebuild the catenary, and a placed
 * station gets its season and biome production multiplier. Contract offers follow
 * DEFAULT_SETTINGS (every rarity asks, so an offer waits for `contracts.accept`) and the fleet's
 * signalling level is the default. Toasts, sounds, renderer updates and the notices Game pushes
 * for the notice panel (junction alerts, a failed contract, an age-up) are left unset;
 * `builder.groundCheck` asks the renderer in the game and stays unset here, so all ground counts
 * as level.
 *
 * Building a world sets the supply mode and restarts station and train ids at 1, as a page load
 * does, so two worlds built alike match id for id. Build one world at a time: a world still being
 * added to after another was built shares those counters with it. Tests reset `rules` and the
 * season offset themselves.
 */
export function simWorld(opts: SimWorldOptions = {}): SimWorld {
  const { seed = SIM_WORLD_SEED, size = rules.mapSize, terrain = 'generated', supply } = opts;
  // new Game(spec, supply): module state and the domains that exist before init
  setSupplyMode(supply);
  resetStationIds(1);
  resetTrainIds(1);
  const clock = new GameClock();
  const economy = new Economy();
  const inventory = new Inventory();
  const stock = new Stockpile();
  const notices = new Notices();
  const trade = new TradeDesk();
  trade.seed = seed;

  // Game.init
  const map =
    terrain === 'grass'
      ? emptyMap(seed, size, size, Terrain.Grass)
      : generateMap(seed, mapParams(size));
  const regions = new RegionState(map, 0);
  const track = new TrackGraph(map.w, map.h);
  const builder = new Builder(map, regions, track, economy, stock);
  const towns = new TownRegistry(builder);
  const houses = new HouseRegistry(builder, towns, stock);
  towns.residentsAt = (x, y) => houses.residentsAt(x, y);
  builder.onIndustryPlaced = (x, y) => houses.industryPlaced(x, y);
  const power = new PowerGrid(map);
  const catenary = new Catenary(map);
  builder.catenary = catenary;
  const weather = new Weather(new Rng(seed ^ 0x77ea));
  inventory.seedStarter(0);
  const fleet = new Fleet(track, builder, map, inventory, economy, stock);

  // The simulating halves of Game's onSupplyChanged, onBuildingChanged, onTrackChanged,
  // onDecorChanged, onStationChanged, rebuildPower and refreshRails.
  const rebuildPower = () => {
    power.rebuild(builder.decor.values(), builder.buildings.values());
    catenary.rebuild(builder.buildings.values(), power);
  };
  const refreshRails = () => {
    fleet.railBeds = railProfile(map, track, (x, y) => !!builder.bridgeAt(x, y));
  };
  builder.onSupplyChanged = () => catenary.rebuild(builder.buildings.values(), power);
  builder.onBuildingChanged = (b: Building) => {
    const def = buildingDef(b.id);
    if (def.bridge) {
      builder.refreshBridgeCapacity(b.x, b.y);
      track.version++;
      refreshRails();
      return;
    }
    towns.refresh();
    if (def.power || def.substation) rebuildPower();
  };
  builder.onTrackChanged = (x, y) => {
    builder.refreshBridgeCapacity(x, y);
    refreshRails();
  };
  builder.onStationChanged = (s: Station, removed: boolean) => {
    if (removed) return;
    const biome = biomeDef(biomeAt(map, s.x, s.y)).production[s.def.id] ?? 1;
    // Game keeps the season of its last step, with weather on as in DEFAULT_SETTINGS
    s.productionMul = productionMul(s.def.id, seasonOf(clock.day)) * biome;
  };
  builder.onDecorChanged = (d: Decor, removed: boolean) => {
    if (d.id === 'signal') fleet.signals.rebuild(builder.decor.values());
    houses.sync(d, removed);
    towns.refresh();
    if (d.id === 'power_line') rebuildPower();
  };

  fleet.powered = (x, y) => catenary.isLive(x, y);
  fleet.supplyAt = (x, y) => catenary.supplyAt(x, y);
  fleet.gridFactor = (x, y) => catenary.loadFactor(x, y);
  fleet.gridDraw = (x, y, u) => catenary.addDraw(x, y, u);
  fleet.gridBegin = () => catenary.beginTick();
  fleet.signals.level = DEFAULT_SETTINGS.signalling ?? 'auto';
  fleet.onArrive = (_t, s) => houses.arrival(s, clock.time);
  fleet.stockCap = (id) => stock.cap(id, builder.depotCount(), builder.plantCount());
  const people = new PeopleSim(map, builder);
  fleet.onPassengers = (st, n, boarding) => (boarding ? people.board(st, n) : people.alight(st, n));
  const contracts = new ContractBoard(new Rng(seed ^ 0x5eed), builder, economy);
  const gacha = new Gacha(new Rng(seed ^ 0x9ac4a), inventory);
  const crafting = new Crafting(new Rng(seed ^ 0xc4af7), inventory, economy, stock);
  crafting.grantFromInventory();
  fleet.onDelivery = (e) => contracts.onDelivery(e);
  const contractJobs = new ContractDispatcher(fleet, contracts, builder, track, notices);
  contracts.onEvent = (e) => {
    contractJobs.onEvent(e);
    if (e.kind !== 'offered') return;
    const policy = contractPolicyFor(DEFAULT_SETTINGS, e.contract.rarity);
    if (policy === 'accept') contracts.accept(e.contract, clock.time);
    else if (policy === 'deny') contracts.decline(e.contract);
  };
  fleet.waitingAt = (id) => people.waitingAt(id).length;
  fleet.contractDest = (cargo, origin) => {
    const c = contracts.active.find((k) => k.cargo === cargo && k.originId === origin);
    return c ? c.destId : null;
  };

  return {
    seed,
    map,
    regions,
    track,
    builder,
    economy,
    stock,
    towns,
    houses,
    power,
    catenary,
    weather,
    inventory,
    fleet,
    people,
    contracts,
    gacha,
    crafting,
    contractJobs,
    trade,
    clock,
    notices,
  };
}

/** Runs `act` with `builder.free` set (no cost, no region or age lock), then restores it. */
function freely<T>(w: SimWorld, act: () => T): T {
  const was = w.builder.free;
  w.builder.free = true;
  try {
    return act();
  } finally {
    w.builder.free = was;
  }
}

/**
 * Lays straight regular track along row `y` from `x0` to `x1` (either way round, both ends
 * included) through the builder with `builder.free` set, so every builder event fires as in the
 * game. A tile that already holds the same straight is left as it is. Throws naming the first
 * tile that cannot take the piece and the builder's reason.
 */
export function line(w: SimWorld, x0: number, y: number, x1: number): void {
  const item = { kind: 'straight', cls: 'regular', cls2: 'regular' } as const;
  freely(w, () => {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
      const p = w.track.get(x, y);
      // placeTrack refuses a piece identical to the one already there
      if (p?.kind === 'straight' && p.rot === 1 && (p.cls2 ?? p.cls) === 'regular') continue;
      if (w.builder.placeTrack(x, y, item, 1)) continue;
      const why = w.builder.checkTrack(x, y, item, 1).reason ?? 'refused';
      throw new Error(`line: no straight at ${x},${y}: ${why}`);
    }
  });
}

/**
 * Places a station of `defId` with its anchor at (x, y), turned by `rot`, through the builder with
 * `builder.free` set. Throws with the builder's reason when it cannot stand there.
 */
export function station(w: SimWorld, defId: string, x: number, y: number, rot = 0): Station {
  return freely(w, () => {
    const s = w.builder.placeStation(x, y, defId, rot);
    if (s) return s;
    const why = w.builder.checkStation(x, y, defId, rot).reason ?? 'refused';
    throw new Error(`station: no ${defId} at ${x},${y}: ${why}`);
  });
}
