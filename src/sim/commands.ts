import { STR } from '../strings';
import { rules } from './rules';
import { CARGO } from './cargo';
import { inSupplyMode } from './supply';
import { locoDef, type Item } from '../gacha/items';
import type { Inventory } from '../gacha/inventory';
import { BuildLog, type BuildWorld } from './buildLog';
import { History } from './history';
import type { Fleet } from './fleet';
import type { Builder, Decor } from './build';
import type { Economy } from './economy';
import type { ResourceStore } from './stores';
import type { TradeDesk } from './trade';
import type { Town, TownRegistry } from './towns';
import type { HouseRegistry } from './houses';
import type { ContractBoard } from './contracts';
import type { ContractDispatcher } from './contractDispatch';
import type { GameClock } from './time';
import type { Station } from './stations';
import type { Train, RouteMode, StopPlan } from './trains';
import { isTrainColour } from './trainColours';

/** What a command did: applied, or refused with the reason to show the player. */
export type CommandResult = { ok: true } | { ok: false; message: string };

/** The simulation modules the commands change. */
export interface CommandDeps {
  fleet: Fleet;
  builder: Builder;
  economy: Economy;
  trade: TradeDesk;
  inventory: Inventory;
  towns: TownRegistry;
  houses: HouseRegistry;
  contracts: ContractBoard;
  contractJobs: ContractDispatcher;
  clock: GameClock;
}

/** Longest station name, in characters. */
export const STATION_NAME_MAX = 24;
/** Longest train name, in characters. */
export const TRAIN_NAME_MAX = 32;

const done = (): CommandResult => ({ ok: true });
const refuse = (message: string) => ({ ok: false as const, message });

/**
 * Every change a panel makes to trains, stations, signals, trade and fittings goes through here:
 * each command checks what it is asked, applies it and reports the outcome, and a refused command
 * changes nothing.
 */
export class Commands {
  private readonly fleet: Fleet;
  private readonly builder: Builder;
  private readonly economy: Economy;
  private readonly trade: TradeDesk;
  private readonly inventory: Inventory;
  /** what an undo reads and changes */
  private readonly buildWorld: BuildWorld;
  /** what the player can take back; belongs to this session and is never saved */
  readonly history = new History();

  constructor(deps: CommandDeps) {
    this.fleet = deps.fleet;
    this.builder = deps.builder;
    this.economy = deps.economy;
    this.trade = deps.trade;
    this.inventory = deps.inventory;
    this.buildWorld = deps;
  }

  // ------------------------------------------------------------ undo
  /**
   * One player action: all `fn` does through the builder is recorded (`BuildLog`) and, when it did
   * anything, becomes one step of the history, named after what was done. An action already open
   * takes it in. The level editor records nothing. An action that runs over many frames (an Upgrade
   * drag) calls this frame by frame with one `stroke` number, and its parts make one step.
   */
  act<T>(fn: () => T, stroke?: number): T {
    const b = this.builder;
    if (b.free || b.log) return fn();
    const log = new BuildLog(this.buildWorld);
    b.log = log;
    try {
      return fn();
    } finally {
      b.log = null;
      const step = log.close(stroke);
      if (step) this.history.push(step);
    }
  }

  // ------------------------------------------------------------ trains
  /** Switch how a train chooses its stops (see `Fleet.setMode`). */
  setTrainMode(t: Train, mode: RouteMode): CommandResult {
    return this.fleet.setMode(t, mode);
  }
  /**
   * Give a train a stop list to follow to the letter: at least two stops. A train working a
   * contract finishes the job first, then runs the new stops from the first (`Train.setProgram`).
   */
  setSchedule(t: Train, stops: readonly StopPlan[]): CommandResult {
    if (stops.length < 2) return refuse(STR.fleet.needTwoStops);
    t.mode = 'schedule';
    t.setProgram([...stops]);
    return done();
  }
  /** Rename a train: trimmed and cut to `TRAIN_NAME_MAX` characters; never empty. */
  renameTrain(t: Train, name: string): CommandResult {
    if (!this.fleet.byId(t.id)) return refuse(STR.train.gone);
    const n = name.trim().slice(0, TRAIN_NAME_MAX);
    if (!n) return refuse(STR.train.nameEmpty);
    return this.editTrain(t, STR.history.renamed(t.name, n), t.name, n, (v) => (t.name = v));
  }
  /** Give a train a colour code (`TRAIN_COLOURS`). */
  recolourTrain(t: Train, colour: number): CommandResult {
    if (!this.fleet.byId(t.id)) return refuse(STR.train.gone);
    if (!isTrainColour(colour)) return refuse(STR.train.noColour);
    const label = STR.history.recoloured(t.name, STR.train.colour[colour]);
    return this.editTrain(t, label, t.colour, colour, (v) => (t.colour = v));
  }
  /**
   * Set something the player named or marked on a train: a step of its own in the history, named
   * `label`, unless it changes nothing. The level editor records nothing, as `act` has it. A train
   * recalled since is gone for good, and its steps with it (`HistoryStep.gone`).
   */
  private editTrain<T>(
    t: Train,
    label: string,
    was: T,
    now: T,
    set: (v: T) => void,
  ): CommandResult {
    if (was === now) return done();
    set(now);
    if (this.builder.free) return done();
    const apply = (v: T): CommandResult => {
      set(v);
      return done();
    };
    this.history.push({
      label,
      undo: () => apply(was),
      redo: () => apply(now),
      gone: () => !this.fleet.byId(t.id),
    });
    return done();
  }

  // ------------------------------------------------------------ stations and signals
  /** Rename a station: trimmed and cut to `STATION_NAME_MAX` characters; never empty. */
  renameStation(s: Station, name: string): CommandResult {
    if (!this.builder.stations.includes(s)) return refuse(STR.fleet.missingStation);
    const n = name.trim().slice(0, STATION_NAME_MAX);
    if (!n) return refuse(STR.station.nameEmpty);
    // the name on screen typed again: a default name stays the default it is
    if (n === s.name) return done();
    this.act(() => {
      this.builder.log?.name(s, n);
      s.name = n;
    });
    return done();
  }
  /**
   * Rename a town, and with it the stations that carry its name: a step of its own in the history,
   * as a station's. The level editor records nothing, as `act` has it.
   */
  renameTown(t: Town, name: string): CommandResult {
    const towns = this.buildWorld.towns;
    if (!towns.towns.includes(t)) return refuse(STR.town.gone);
    if (!name.trim()) return refuse(STR.town.nameEmpty);
    const was = { name: t.name, custom: t.custom };
    towns.rename(t, name);
    if (t.name === was.name) return done();
    if (this.builder.free) return done();
    const now = { name: t.name, custom: t.custom };
    const set = (v: typeof was): CommandResult => {
      t.name = v.name;
      t.custom = v.custom;
      towns.refresh();
      return done();
    };
    this.history.push({
      label: STR.history.renamed(was.name, now.name),
      undo: () => set(was),
      redo: () => set(now),
      gone: () => !towns.towns.includes(t),
    });
    return done();
  }
  /** Turn a signal to govern the next direction of travel: north, east, south, west in turn. */
  turnSignal(d: Decor): CommandResult {
    if (d.id !== 'signal' || this.builder.decorAt(d.x, d.y) !== d) return refuse(STR.signals.gone);
    d.rot = (d.rot + 1) % 4;
    this.builder.onDecorChanged?.(d, false);
    return done();
  }

  // ------------------------------------------------------------ roster
  /** Fit in-cab signalling to a locomotive that has none, for `rules.inCabCost`. */
  fitInCab(item: Item): CommandResult {
    if (item.kind !== 'loco' || !this.inventory.items.includes(item))
      return refuse(STR.fleet.locoUnavailable);
    if (item.inCab || locoDef(item.defId).inCab) return refuse(STR.roster.alreadyFitted);
    const cost = rules.inCabCost;
    // checked first: a refused spend would also post the economy's own warning
    if (!this.economy.canAfford(cost) || !this.economy.spend(cost))
      return refuse(STR.roster.noMoney);
    item.inCab = true;
    return done();
  }

  // ------------------------------------------------------------ spot market
  /**
   * Buy up to `n` units at the spot price into `store`: as many as fit under its cap and the money
   * pays for.
   */
  spotBuy(cargoId: string, n: number, store: ResourceStore): CommandResult {
    if (!spotTraded(cargoId)) return refuse(STR.build.supplyLocked);
    const want = Math.floor(n);
    if (!(want >= 1)) return refuse(STR.market.nothingToBuy);
    const room = Math.floor(Math.max(0, store.cap(cargoId) - store.get(cargoId)));
    if (!(room >= 1)) return refuse(STR.market.full);
    const { buy } = this.trade.spotQuote(cargoId);
    let qty = Math.min(want, room, buy > 0 ? Math.floor(this.economy.money / buy) : Infinity);
    // the division may round up past what the money covers
    if (qty >= 1 && qty * buy > this.economy.money) qty--;
    // checked first: a refused spend would also post the economy's own warning (money below
    // zero refuses even goods quoted at nothing)
    if (!(qty >= 1) || !this.economy.canAfford(qty * buy)) return refuse(STR.roster.noMoney);
    this.economy.spend(qty * buy);
    store.add(cargoId, qty);
    return done();
  }
  /** Sell up to `n` units from `store` at the spot price: as many as it holds. */
  spotSell(cargoId: string, n: number, store: ResourceStore): CommandResult {
    if (!spotTraded(cargoId)) return refuse(STR.build.supplyLocked);
    const qty = Math.min(Math.floor(n), Math.floor(store.get(cargoId)));
    if (!(qty >= 1)) return refuse(STR.market.nothingToSell);
    const { sell } = this.trade.spotQuote(cargoId);
    store.take(cargoId, qty);
    this.economy.earn(qty * sell);
    return done();
  }
}

/** Goods the spot market deals in: cargo of this game's production chain, people excepted. */
function spotTraded(id: string) {
  return CARGO.some((c) => c.id === id && c.class !== 'people' && inSupplyMode(c));
}
