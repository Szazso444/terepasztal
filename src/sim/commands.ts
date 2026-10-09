import { STR } from '../strings';
import { rules } from './rules';
import { CARGO } from './cargo';
import { inSupplyMode } from './supply';
import { locoDef, type Item } from '../gacha/items';
import { PULL_COST, type Banner, type Gacha, type PullResult } from '../gacha/gacha';
import type { Inventory } from '../gacha/inventory';
import type { Fleet } from './fleet';
import type { Builder, Decor } from './build';
import type { Economy } from './economy';
import type { Stockpile } from './stockpile';
import type { TradeDesk } from './trade';
import type { Station } from './stations';
import type { Train, RouteMode, StopPlan } from './trains';

/** What a command did: applied, or refused with the reason to show the player. */
export type CommandResult = { ok: true } | { ok: false; message: string };
/** A pull also hands back what came out. */
export type PullCommandResult =
  { ok: true; results: PullResult[] } | { ok: false; message: string };

/** The simulation modules the commands change. */
export interface CommandDeps {
  fleet: Fleet;
  builder: Builder;
  economy: Economy;
  stock: Stockpile;
  trade: TradeDesk;
  gacha: Gacha;
  inventory: Inventory;
}

/** Longest station name, in characters. */
export const STATION_NAME_MAX = 24;

const done = (): CommandResult => ({ ok: true });
const refuse = (message: string) => ({ ok: false as const, message });

/**
 * Every change a panel makes to trains, stations, signals, trade, pulls and fittings goes through
 * here: each command checks what it is asked, applies it and reports the outcome, and a refused
 * command changes nothing.
 */
export class Commands {
  private readonly fleet: Fleet;
  private readonly builder: Builder;
  private readonly economy: Economy;
  private readonly stock: Stockpile;
  private readonly trade: TradeDesk;
  private readonly gacha: Gacha;
  private readonly inventory: Inventory;

  constructor(deps: CommandDeps) {
    this.fleet = deps.fleet;
    this.builder = deps.builder;
    this.economy = deps.economy;
    this.stock = deps.stock;
    this.trade = deps.trade;
    this.gacha = deps.gacha;
    this.inventory = deps.inventory;
  }

  // ------------------------------------------------------------ trains
  /** Switch how a train chooses its stops (see `Fleet.setMode`). */
  setTrainMode(t: Train, mode: RouteMode): CommandResult {
    return this.fleet.setMode(t, mode);
  }
  /** Give a train a stop list to follow to the letter: at least two stops. */
  setSchedule(t: Train, stops: readonly StopPlan[]): CommandResult {
    if (stops.length < 2) return refuse(STR.fleet.needTwoStops);
    t.mode = 'schedule';
    this.fleet.setSchedule(t, [...stops]);
    return done();
  }
  /** Which solid fuel a steam train takes first. */
  setFuelPreference(t: Train, pref: 'coal' | 'wood'): CommandResult {
    t.fuelPreference = pref;
    return done();
  }

  // ------------------------------------------------------------ stations and signals
  /** Rename a station: trimmed and cut to `STATION_NAME_MAX` characters; never empty. */
  renameStation(s: Station, name: string): CommandResult {
    if (!this.builder.stations.includes(s)) return refuse(STR.fleet.missingStation);
    const n = name.trim().slice(0, STATION_NAME_MAX);
    if (!n) return refuse(STR.station.rename);
    s.name = n;
    return done();
  }
  /** Turn a signal to govern the next direction of travel: north, east, south, west in turn. */
  turnSignal(d: Decor): CommandResult {
    if (d.id !== 'signal' || this.builder.decorAt(d.x, d.y) !== d)
      return refuse(STR.build.needTrackHere);
    d.rot = (d.rot + 1) % 4;
    this.builder.onDecorChanged?.(d, false);
    return done();
  }

  // ------------------------------------------------------------ roster
  /** Fit in-cab signalling to a locomotive that has none, for `rules.inCabCost`. */
  fitInCab(item: Item): CommandResult {
    if (item.kind !== 'loco' || !this.inventory.items.includes(item))
      return refuse(STR.fleet.locoUnavailable);
    if (item.inCab || locoDef(item.defId).inCab) return refuse(STR.roster.hasInCab);
    const cost = rules.inCabCost;
    // checked first: a refused spend would also post the economy's own warning
    if (!this.economy.canAfford(cost) || !this.economy.spend(cost))
      return refuse(STR.roster.noMoney);
    item.inCab = true;
    return done();
  }

  // ------------------------------------------------------------ spot market
  /**
   * Buy up to `n` units at the spot price into the stockpile: as many as fit under `cap` and the
   * money pays for.
   */
  spotBuy(cargoId: string, n: number, cap: number): CommandResult {
    if (!spotTraded(cargoId)) return refuse(STR.build.supplyLocked);
    const want = Math.floor(n);
    if (!(want >= 1)) return refuse(STR.depot.empty);
    const room = Math.floor(Math.max(0, cap - this.stock.get(cargoId)));
    if (!(room >= 1)) return refuse(STR.market.full);
    const { buy } = this.trade.spotQuote(cargoId);
    let qty = Math.min(want, room, buy > 0 ? Math.floor(this.economy.money / buy) : Infinity);
    // the division may round up past what the money covers
    if (qty >= 1 && qty * buy > this.economy.money) qty--;
    // checked first: a refused spend would also post the economy's own warning (money below
    // zero refuses even goods quoted at nothing)
    if (!(qty >= 1) || !this.economy.canAfford(qty * buy)) return refuse(STR.roster.noMoney);
    this.economy.spend(qty * buy);
    this.stock.add(cargoId, qty, cap);
    return done();
  }
  /** Sell up to `n` units from the stockpile at the spot price: as many as are on hand. */
  spotSell(cargoId: string, n: number): CommandResult {
    if (!spotTraded(cargoId)) return refuse(STR.build.supplyLocked);
    const qty = Math.min(Math.floor(n), Math.floor(this.stock.get(cargoId)));
    if (!(qty >= 1)) return refuse(STR.depot.empty);
    const { sell } = this.trade.spotQuote(cargoId);
    this.stock.take(cargoId, qty);
    this.economy.earn(qty * sell);
    return done();
  }

  // ------------------------------------------------------------ works
  /** Pull `count` times on a banner for `PULL_COST` tickets each (arguments as `Gacha.pull`). */
  pull(banner: Banner, count: 1 | 10, now: number, rotation = 0): PullCommandResult {
    const cost = PULL_COST * count;
    if (this.economy.tickets < cost) return refuse(STR.gacha.noTickets);
    this.economy.tickets -= cost;
    return { ok: true, results: this.gacha.pull(banner, count, now, rotation) };
  }
}

/** Goods the spot market deals in: cargo of this game's production chain, people excepted. */
function spotTraded(id: string) {
  return CARGO.some((c) => c.id === id && c.class !== 'people' && inSupplyMode(c));
}
