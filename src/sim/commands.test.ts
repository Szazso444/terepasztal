import { describe, it, expect, beforeEach, vi } from 'vitest';
import { emptyMap } from '../world/mapgen';
import { Terrain } from '../world/tiles';
import { RegionState } from '../world/regions';
import { TrackGraph } from '../world/track';
import { Dir } from '../engine/iso';
import { Rng } from '../engine/rng';
import { Builder } from './build';
import { Stockpile } from './stockpile';
import { Economy } from './economy';
import { Station } from './stations';
import { Train, defaultStop, resetTrainIds } from './trains';
import { Fleet } from './fleet';
import { TradeDesk, BUY_MUL, SELL_MUL } from './trade';
import { cargoDef } from './cargo';
import { rules, DEFAULT_RULES } from './rules';
import { Inventory } from '../gacha/inventory';
import { Gacha, BANNERS, PULL_COST } from '../gacha/gacha';
import { locoDef, wagonDef } from '../gacha/items';
import { Commands, STATION_NAME_MAX } from './commands';
import { STR } from '../strings';

vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));
beforeEach(() => {
  Object.assign(rules, DEFAULT_RULES);
  resetTrainIds();
});

const ROW = 30;
const GDT = 0.05;

/** A grass map with one straight line along row 30 and every simulation module a command uses. */
function world() {
  const map = emptyMap(4242, 96, 96, Terrain.Grass),
    track = new TrackGraph(96, 96),
    stock = new Stockpile(),
    economy = new Economy(),
    inventory = new Inventory(),
    trade = new TradeDesk();
  const regions = new RegionState(map);
  for (let i = 0; i < regions.unlocked.length; i++) regions.own(i);
  const builder = new Builder(map, regions, track, economy, stock);
  builder.free = true;
  const fleet = new Fleet(track, builder, map, inventory, economy, stock);
  const gacha = new Gacha(new Rng(7), inventory);
  for (let x = 2; x < 90; x++) track.place(x, ROW, 'straight', 1);
  const commands = new Commands({ fleet, builder, economy, stock, trade, gacha, inventory });
  return { map, track, stock, economy, inventory, trade, builder, fleet, gacha, commands };
}
type World = ReturnType<typeof world>;

/** A station on the line: its gate on row 30 is its platform. */
function station(w: World, id: string, x: number) {
  const s = new Station(id, x, ROW - 1);
  w.builder.stations.push(s);
  return s;
}
/** A station nowhere near the rails: no platform, so no train can reach it. */
function deadStation(w: World, x: number) {
  const s = new Station('farm', x, ROW + 30);
  w.builder.stations.push(s);
  return s;
}
/** A diesel with full tanks and one hopper for stone, standing on the line facing west. */
function train(w: World, x: number) {
  const t = new Train([{ uid: 1, level: 1, def: locoDef('f7') }]);
  t.wagons = [
    { uid: 2, def: wagonDef('wood_hopper'), level: 1, cargo: null, amount: 0, origin: null },
  ];
  t.spawnAt(w.track, x, ROW, Dir.W);
  t.oil = t.oilCap;
  w.fleet.trains.push(t);
  return t;
}
const target = (t: Train) => t.route[t.routeIndex % t.route.length];
/** Run the fleet for `seconds` of game time from `from`; returns the time reached. */
function run(w: World, from: number, seconds: number) {
  let now = from;
  for (let i = 0; i < Math.round(seconds / GDT); i++) w.fleet.tick(GDT, (now += GDT));
  return now;
}
/** Run the fleet until the train stands at `s`, for at most two game minutes. */
function runTo(w: World, t: Train, s: Station, from: number) {
  let now = from;
  for (let i = 0; i < 120 / GDT && t.atStation !== s; i++) w.fleet.tick(GDT, (now += GDT));
  return t.atStation === s;
}

describe('setTrainMode', () => {
  it('sends a schedule train stuck on dead stops to a reachable producer within one fleet tick', () => {
    const w = world();
    const quarry = station(w, 'quarry', 40);
    quarry.storage.set('stone', 40);
    const a = deadStation(w, 60),
      b = deadStation(w, 70);
    const t = train(w, 20);
    t.schedule = [defaultStop(a.id), defaultStop(b.id)];
    // left alone it keeps retrying its dead stop
    const now = run(w, 0, 10);
    expect(t.state).toBe('noRoute');
    expect(target(t)).toBe(a.id);
    expect(w.commands.setTrainMode(t, 'production')).toEqual({ ok: true });
    w.fleet.tick(GDT, now + GDT);
    expect(t.mode).toBe('production');
    expect(t.schedule.map((s) => s.stationId)).toEqual([quarry.id]);
    expect(t.state).toBe('moving');
    expect(t.pathAhead().at(-1)).toMatchObject({ x: 40, y: ROW });
    expect(runTo(w, t, quarry, now + GDT)).toBe(true);
  });

  it('refuses schedule for a roaming train with a one-stop schedule and leaves it roaming', () => {
    const w = world();
    const quarry = station(w, 'quarry', 40);
    const t = train(w, 20);
    t.mode = 'production';
    t.schedule = [defaultStop(quarry.id)];
    expect(w.commands.setTrainMode(t, 'schedule')).toEqual({
      ok: false,
      message: STR.fleet.needTwoStops,
    });
    expect(t.mode).toBe('production');
    expect(t.schedule.map((s) => s.stationId)).toEqual([quarry.id]);
  });

  it('keeps the stops of a roaming train that has two when it goes back to schedule', () => {
    const w = world();
    const a = station(w, 'quarry', 40),
      b = station(w, 'farm', 70);
    const t = train(w, 20);
    t.mode = 'collection';
    const stops = [defaultStop(a.id), defaultStop(b.id)];
    t.schedule = stops;
    expect(w.commands.setTrainMode(t, 'schedule')).toEqual({ ok: true });
    expect(t.mode).toBe('schedule');
    expect(t.schedule).toBe(stops);
  });

  it('turns a train under way toward the stop it picks', () => {
    const w = world();
    const quarry = station(w, 'quarry', 40);
    quarry.storage.set('stone', 40);
    const a = station(w, 'farm', 10),
      b = station(w, 'farm', 80);
    const t = train(w, 60);
    t.schedule = [defaultStop(a.id), defaultStop(b.id)];
    expect(t.dispatch(w.track, w.builder, w.map)).toBe(true);
    t.onPathReady({ builder: w.builder });
    expect(t.state).toBe('moving');
    expect(t.pathAhead().at(-1)?.x).toBe(10);
    w.commands.setTrainMode(t, 'production');
    expect(target(t)).toBe(quarry.id);
    expect(t.state).toBe('moving');
    expect(t.pathAhead().at(-1)).toMatchObject({ x: 40, y: ROW });
    expect(runTo(w, t, quarry, 0)).toBe(true);
  });

  it('turns a train under way round when the stop it picks lies behind it', () => {
    const w = world();
    const quarry = station(w, 'quarry', 75);
    quarry.storage.set('stone', 40);
    const a = station(w, 'farm', 10),
      b = station(w, 'farm', 20);
    const t = train(w, 50);
    t.schedule = [defaultStop(a.id), defaultStop(b.id)];
    expect(t.dispatch(w.track, w.builder, w.map)).toBe(true);
    t.onPathReady({ builder: w.builder });
    run(w, 0, 2);
    expect(t.state).toBe('moving');
    w.commands.setTrainMode(t, 'production');
    expect(target(t)).toBe(quarry.id);
    expect(t.state).toBe('moving');
    expect(t.pathAhead().at(-1)).toMatchObject({ x: 75, y: ROW });
    expect(runTo(w, t, quarry, 2)).toBe(true);
  });

  it('takes an idle train off its platform toward the stop it picks', () => {
    const w = world();
    const quarry = station(w, 'quarry', 40);
    quarry.storage.set('stone', 40);
    const yard = station(w, 'warehouse', 20);
    const t = train(w, 20);
    t.mode = 'transport';
    t.schedule = [defaultStop(yard.id)];
    t.atStation = yard;
    yard.occupants.add(t.id);
    t.state = 'idle';
    w.commands.setTrainMode(t, 'production');
    expect(target(t)).toBe(quarry.id);
    expect(t.state).toBe('moving');
    expect(t.atStation).toBeNull();
    expect(yard.occupants.has(t.id)).toBe(false);
    expect(runTo(w, t, quarry, 0)).toBe(true);
  });

  it('lets a train with no route and nothing to pick wait and choose again', () => {
    const w = world();
    const quarry = station(w, 'quarry', 40);
    const a = deadStation(w, 60),
      b = deadStation(w, 70);
    const t = train(w, 20);
    t.schedule = [defaultStop(a.id), defaultStop(b.id)];
    const now = run(w, 0, 5);
    expect(t.state).toBe('noRoute');
    expect(w.commands.setTrainMode(t, 'production')).toEqual({ ok: true });
    expect(t.state).toBe('idle');
    // stone turns up: the waiting train goes for it on its own
    quarry.storage.set('stone', 40);
    run(w, now, 12);
    expect(target(t)).toBe(quarry.id);
    expect(t.state).toBe('moving');
  });

  it('leaves a train at a platform to choose when its work there is done', () => {
    const w = world();
    const quarry = station(w, 'quarry', 40);
    quarry.storage.set('stone', 40);
    const a = station(w, 'farm', 20),
      b = station(w, 'farm', 80);
    const t = train(w, 20);
    t.schedule = [defaultStop(a.id), defaultStop(b.id)];
    t.atStation = a;
    a.occupants.add(t.id);
    t.state = 'loading';
    w.commands.setTrainMode(t, 'production');
    expect(t.state).toBe('loading');
    expect(t.atStation).toBe(a);
    expect(a.occupants.has(t.id)).toBe(true);
    expect(target(t)).toBe(quarry.id);
    expect(runTo(w, t, quarry, 0)).toBe(true);
    expect(a.occupants.has(t.id)).toBe(false);
  });

  it('keeps a contract job running and checks the set-aside program for schedule', () => {
    const w = world();
    const origin = station(w, 'quarry', 40),
      dest = station(w, 'warehouse', 70),
      home = deadStation(w, 60);
    const t = train(w, 20);
    t.mode = 'production';
    t.schedule = [defaultStop(home.id)];
    t.addJob({
      contractId: 1,
      name: 'stone',
      originId: origin.id,
      destId: dest.id,
      cargo: 'stone',
    });
    // a train with nowhere to go takes up the queued job
    run(w, 0, 5);
    expect(t.job?.contractId).toBe(1);
    const job = t.schedule;
    expect(job.map((s) => s.stationId)).toEqual([origin.id, dest.id]);
    // the job has two stops, but the program it goes back to has one
    expect(w.commands.setTrainMode(t, 'schedule')).toEqual({
      ok: false,
      message: STR.fleet.needTwoStops,
    });
    expect(t.mode).toBe('production');
    expect(w.commands.setTrainMode(t, 'collection')).toEqual({ ok: true });
    expect(t.mode).toBe('collection');
    expect(t.schedule).toBe(job);
  });
});

describe('setSchedule', () => {
  it('refuses fewer than two stops and changes nothing', () => {
    const w = world();
    const a = station(w, 'quarry', 40);
    const t = train(w, 20);
    t.mode = 'production';
    const before = t.schedule;
    expect(w.commands.setSchedule(t, [defaultStop(a.id)])).toEqual({
      ok: false,
      message: STR.fleet.needTwoStops,
    });
    expect(w.commands.setSchedule(t, [])).toEqual({ ok: false, message: STR.fleet.needTwoStops });
    expect(t.mode).toBe('production');
    expect(t.schedule).toBe(before);
  });

  it('puts the train on schedule with the stops given', () => {
    const w = world();
    const a = station(w, 'quarry', 40),
      b = station(w, 'farm', 70),
      c = station(w, 'farm', 80);
    const t = train(w, 20);
    t.mode = 'transport';
    t.schedule = [defaultStop(a.id), defaultStop(b.id), defaultStop(c.id)];
    t.routeIndex = 2;
    const stops = [defaultStop(c.id), { ...defaultStop(a.id), load: 'none' as const }];
    expect(w.commands.setSchedule(t, stops)).toEqual({ ok: true });
    expect(t.mode).toBe('schedule');
    expect(t.schedule).toEqual(stops);
    expect(t.routeIndex).toBe(1);
  });
});

describe('setFuelPreference', () => {
  it('sets the solid fuel a steam train takes first', () => {
    const w = world();
    const t = train(w, 20);
    expect(w.commands.setFuelPreference(t, 'wood')).toEqual({ ok: true });
    expect(t.fuelPreference).toBe('wood');
    expect(w.commands.setFuelPreference(t, 'coal')).toEqual({ ok: true });
    expect(t.fuelPreference).toBe('coal');
  });
});

describe('renameStation', () => {
  it('trims the name and cuts it to the longest a station may carry', () => {
    const w = world();
    const s = station(w, 'quarry', 40);
    expect(w.commands.renameStation(s, '  North Yard  ')).toEqual({ ok: true });
    expect(s.name).toBe('North Yard');
    const long = 'Upper Bellwether Junction Sidings';
    expect(w.commands.renameStation(s, long)).toEqual({ ok: true });
    expect(s.name).toBe(long.slice(0, STATION_NAME_MAX));
    expect(s.name).toHaveLength(24);
  });

  it('refuses an empty name, or a station that is gone, and keeps the old name', () => {
    const w = world();
    const s = station(w, 'quarry', 40);
    s.name = 'Old Quarry';
    expect(w.commands.renameStation(s, '   ')).toEqual({ ok: false, message: STR.station.rename });
    expect(w.commands.renameStation(s, '')).toEqual({ ok: false, message: STR.station.rename });
    expect(s.name).toBe('Old Quarry');
    const gone = new Station('farm', 10, 10);
    gone.name = 'Gone';
    expect(w.commands.renameStation(gone, 'Back')).toEqual({
      ok: false,
      message: STR.fleet.missingStation,
    });
    expect(gone.name).toBe('Gone');
  });
});

describe('turnSignal', () => {
  it('turns a signal a quarter at a time and reports the change', () => {
    const w = world();
    const changed = vi.fn();
    const d = w.builder.placeDecor(40, ROW, 'signal', 0)!;
    expect(d).not.toBeNull();
    w.builder.onDecorChanged = changed;
    for (const rot of [1, 2, 3, 0]) {
      expect(w.commands.turnSignal(d)).toEqual({ ok: true });
      expect(d.rot).toBe(rot);
    }
    expect(changed).toHaveBeenCalledTimes(4);
    expect(changed).toHaveBeenLastCalledWith(d, false);
  });

  it('refuses decor that is not a signal on the map', () => {
    const w = world();
    const changed = vi.fn();
    const tower = w.builder.placeDecor(40, ROW - 1, 'water_tower', 0)!;
    const loose = { id: 'signal', x: 50, y: ROW, rot: 0 };
    w.builder.onDecorChanged = changed;
    expect(w.commands.turnSignal(tower).ok).toBe(false);
    expect(w.commands.turnSignal(loose).ok).toBe(false);
    expect(tower.rot).toBe(0);
    expect(loose.rot).toBe(0);
    expect(changed).not.toHaveBeenCalled();
  });
});

describe('fitInCab', () => {
  it('fits a locomotive without in-cab signalling and pays for it', () => {
    const w = world();
    const it = w.inventory.add('f7', 0);
    w.economy.money = rules.inCabCost + 5;
    expect(w.commands.fitInCab(it)).toEqual({ ok: true });
    expect(it.inCab).toBe(true);
    expect(w.economy.money).toBe(5);
    // a second fitting is refused and costs nothing
    expect(w.commands.fitInCab(it)).toEqual({ ok: false, message: STR.roster.hasInCab });
    expect(w.economy.money).toBe(5);
  });

  it('changes nothing when the money is short', () => {
    const w = world();
    const it = w.inventory.add('f7', 0);
    const warn = vi.fn();
    w.economy.onMessage = warn;
    w.economy.money = rules.inCabCost - 1;
    expect(w.commands.fitInCab(it)).toEqual({ ok: false, message: STR.roster.noMoney });
    expect(it.inCab).toBeFalsy();
    expect(w.economy.money).toBe(rules.inCabCost - 1);
    expect(warn).not.toHaveBeenCalled();
  });

  it('refuses a model built with it, a wagon and an item not owned', () => {
    const w = world();
    w.economy.money = rules.inCabCost * 10;
    const tgv = w.inventory.add('tgv', 0);
    expect(locoDef('tgv').inCab).toBe(true);
    expect(w.commands.fitInCab(tgv)).toEqual({ ok: false, message: STR.roster.hasInCab });
    const wagon = w.inventory.add('flatbed', 0);
    expect(w.commands.fitInCab(wagon)).toEqual({ ok: false, message: STR.fleet.locoUnavailable });
    const stray = new Inventory().add('f7', 0);
    expect(w.commands.fitInCab(stray)).toEqual({
      ok: false,
      message: STR.fleet.locoUnavailable,
    });
    expect(w.economy.money).toBe(rules.inCabCost * 10);
    expect(wagon.inCab).toBeUndefined();
    expect(stray.inCab).toBeUndefined();
  });
});

describe('spotBuy', () => {
  it('quotes the market formula, drift included, to the cent', () => {
    const w = world();
    rules.spotPriceMul = 1.37;
    w.trade.fuelMul = 1.23;
    for (const id of ['stone', 'oil']) {
      const drift = id === 'oil' ? 1.23 : 1;
      const price = cargoDef(id).price;
      expect(w.trade.spotQuote(id)).toEqual({
        buy: Math.round(price * BUY_MUL * 1.37 * drift * 100) / 100,
        sell: Math.round(price * SELL_MUL * 1.37 * drift * 100) / 100,
      });
    }
  });

  it('buys at the quoted price into the stockpile', () => {
    const w = world();
    const { buy } = w.trade.spotQuote('stone');
    w.economy.money = 10000;
    expect(w.commands.spotBuy('stone', 10, 1000)).toEqual({ ok: true });
    expect(w.stock.get('stone')).toBe(10);
    expect(w.economy.money).toBeCloseTo(10000 - 10 * buy, 9);
  });

  it('buys only what fits under the cap, and nothing when full', () => {
    const w = world();
    const { buy } = w.trade.spotQuote('stone');
    w.economy.money = 10000;
    w.stock.add('stone', 995);
    expect(w.commands.spotBuy('stone', 100, 1000)).toEqual({ ok: true });
    expect(w.stock.get('stone')).toBe(1000);
    expect(w.economy.money).toBeCloseTo(10000 - 5 * buy, 9);
    const money = w.economy.money;
    expect(w.commands.spotBuy('stone', 10, 1000)).toEqual({
      ok: false,
      message: STR.market.full,
    });
    expect(w.commands.spotBuy('stone', 10, NaN)).toEqual({ ok: false, message: STR.market.full });
    expect(w.stock.get('stone')).toBe(1000);
    expect(w.economy.money).toBe(money);
  });

  it('buys only what the money pays for and never goes below zero', () => {
    const w = world();
    const { buy } = w.trade.spotQuote('stone');
    w.economy.money = buy * 3.5;
    expect(w.commands.spotBuy('stone', 100, 1000)).toEqual({ ok: true });
    expect(w.stock.get('stone')).toBe(3);
    expect(w.economy.money).toBeGreaterThanOrEqual(0);
    expect(w.economy.money).toBeCloseTo(buy * 0.5, 9);
    w.economy.money = buy - 0.01;
    expect(w.commands.spotBuy('stone', 1, 1000)).toEqual({
      ok: false,
      message: STR.roster.noMoney,
    });
    expect(w.stock.get('stone')).toBe(3);
    expect(w.economy.money).toBe(buy - 0.01);
  });

  it('refuses what the market does not trade and quantities under one', () => {
    const w = world();
    w.economy.money = 10000;
    expect(w.commands.spotBuy('passengers', 10, 1000).ok).toBe(false);
    expect(w.commands.spotBuy('stone', 0, 1000).ok).toBe(false);
    expect(w.commands.spotBuy('stone', -5, 1000).ok).toBe(false);
    expect(w.commands.spotBuy('stone', NaN, 1000).ok).toBe(false);
    expect(w.stock.get('passengers')).toBe(0);
    expect(w.stock.get('stone')).toBe(0);
    expect(w.economy.money).toBe(10000);
  });
});

describe('spotSell', () => {
  it('a buy then a sell of the same quantity costs exactly the spread and leaves the stock', () => {
    const w = world();
    w.trade.fuelMul = 1.17;
    for (const id of ['stone', 'oil', 'iron']) {
      const { buy, sell } = w.trade.spotQuote(id);
      w.stock.add(id, 7);
      const stock = w.stock.get(id);
      const money = (w.economy.money = 50000);
      expect(w.commands.spotBuy(id, 40, 1000)).toEqual({ ok: true });
      expect(w.commands.spotSell(id, 40)).toEqual({ ok: true });
      expect(w.stock.get(id)).toBe(stock);
      expect(w.economy.money - money).toBeCloseTo(40 * (sell - buy), 9);
    }
  });

  it('sells only what is on hand at the quoted price', () => {
    const w = world();
    const { sell } = w.trade.spotQuote('stone');
    w.economy.money = 0;
    w.stock.add('stone', 4.7);
    expect(w.commands.spotSell('stone', 10)).toEqual({ ok: true });
    expect(w.stock.get('stone')).toBeCloseTo(0.7, 9);
    expect(w.economy.money).toBeCloseTo(4 * sell, 9);
    expect(w.economy.earned).toBeCloseTo(4 * sell, 9);
  });

  it('refuses with nothing to sell, and what the market does not trade', () => {
    const w = world();
    w.economy.money = 100;
    w.stock.add('stone', 0.9);
    w.stock.add('passengers', 50);
    expect(w.commands.spotSell('stone', 10)).toEqual({ ok: false, message: STR.depot.empty });
    expect(w.commands.spotSell('passengers', 10).ok).toBe(false);
    expect(w.commands.spotSell('stone', -3).ok).toBe(false);
    expect(w.stock.get('stone')).toBe(0.9);
    expect(w.stock.get('passengers')).toBe(50);
    expect(w.economy.money).toBe(100);
  });
});

describe('pull', () => {
  it('takes the tickets and returns what came out', () => {
    const w = world();
    w.economy.tickets = PULL_COST * 10 + 2;
    const items = w.inventory.items.length;
    const r = w.commands.pull(BANNERS[0], 10, 5);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.results).toHaveLength(10);
    expect(w.economy.tickets).toBe(2);
    expect(w.inventory.items.length).toBe(items + 10);
    expect(w.gacha.totalPulls).toBe(10);
  });

  it('changes nothing with too few tickets', () => {
    const w = world();
    w.economy.tickets = PULL_COST * 10 - 1;
    const before = {
      tickets: w.economy.tickets,
      items: w.inventory.items.length,
      gacha: JSON.stringify(w.gacha.toJSON()),
    };
    expect(w.commands.pull(BANNERS[0], 10, 5)).toEqual({
      ok: false,
      message: STR.gacha.noTickets,
    });
    expect(w.economy.tickets).toBe(before.tickets);
    expect(w.inventory.items.length).toBe(before.items);
    expect(JSON.stringify(w.gacha.toJSON())).toBe(before.gacha);
  });
});
