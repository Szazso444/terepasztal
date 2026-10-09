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
import { Station, resetStationIds } from './stations';
import { Train, defaultStop, resetTrainIds } from './trains';
import { Fleet } from './fleet';
import { TradeDesk, BUY_MUL, SELL_MUL, DRIFTING } from './trade';
import { CARGO, cargoDef } from './cargo';
import { setSupplyMode, inSupplyMode, DEFAULT_SUPPLY } from './supply';
import { rules, DEFAULT_RULES } from './rules';
import { Inventory } from '../gacha/inventory';
import { Gacha, BANNERS, PULL_COST, type PullResult } from '../gacha/gacha';
import { locoDef, wagonDef, type Item } from '../gacha/items';
import { Commands, STATION_NAME_MAX } from './commands';
import { STR } from '../strings';
import { forAll, shrinkArray } from '../testing/property';

vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));
beforeEach(() => {
  Object.assign(rules, DEFAULT_RULES);
  setSupplyMode(DEFAULT_SUPPLY);
  resetTrainIds();
  resetStationIds();
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

  it('keeps any name trimmed and cut to its length, and refuses a blank one', () => {
    const chars = ['a', 'Z', 'ő', 'Ű', ' ', '\t', '-', '7', '🚂'];
    forAll(
      (rng) => Array.from({ length: rng.int(0, 40) }, () => rng.pick(chars)).join(''),
      (name) => {
        const w = world();
        const s = station(w, 'quarry', 40);
        s.name = 'Old Quarry';
        const r = w.commands.renameStation(s, name);
        if (!name.trim()) {
          expect(r.ok).toBe(false);
          expect(s.name).toBe('Old Quarry');
          return;
        }
        expect(r).toEqual({ ok: true });
        expect(s.name).toBe(name.trim().slice(0, STATION_NAME_MAX));
        expect(s.name.length).toBeLessThanOrEqual(STATION_NAME_MAX);
        expect(s.name.trim()).not.toBe('');
      },
    );
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

  it('buys one unit fewer when the division rounds up past what the money covers', () => {
    const w = world();
    const { buy } = w.trade.spotQuote('stone');
    // a hair under 19 units' price, as float sums leave money: money / buy still comes to 19
    const money = 19 * buy - 2 ** -45;
    expect(Math.floor(money / buy)).toBe(19);
    expect(19 * buy).toBeGreaterThan(money);
    w.economy.money = money;
    expect(w.commands.spotBuy('stone', 100, 1000)).toEqual({ ok: true });
    expect(w.stock.get('stone')).toBe(18);
    expect(w.economy.money).toBe(money - 18 * buy);
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

// ------------------------------------------------------------ properties

/** Every good the commands may be asked about: all cargo, power, and an id nothing defines. */
const GOODS = [...CARGO.map((c) => c.id), 'power', 'unobtainium'];
/** What the market screen lists: cargo of the running production chain, people excepted. */
const listed = (id: string) =>
  CARGO.some((c) => c.id === id && c.class !== 'people' && inSupplyMode(c));
/** The market screen's spot price per unit, rounded to the cent. */
function quote(id: string, fuelMul: number, side: 'buy' | 'sell') {
  const drift = DRIFTING.includes(id) ? fuelMul : 1;
  const mul = side === 'buy' ? BUY_MUL : SELL_MUL;
  return Math.round(cargoDef(id).price * mul * rules.spotPriceMul * drift * 100) / 100;
}

type EconomyOp =
  | { kind: 'buy'; id: string; n: number; cap: number }
  | { kind: 'sell'; id: string; n: number }
  | { kind: 'pull'; banner: number; count: 1 | 10; rotation: number }
  | { kind: 'fit'; item: number };
interface LedgerCase {
  full: boolean;
  money: number;
  tickets: number;
  spotPriceMul: number;
  fuelMul: number;
  inCabCost: number;
  stock: [string, number][];
  ops: EconomyOp[];
}
/** What a panel may hand a command: its own 10 and 100, any count, fractions and nonsense. */
function amount(rng: Rng) {
  switch (rng.int(0, 5)) {
    case 0:
      return 10;
    case 1:
      return 100;
    case 2:
      return rng.int(1, 150);
    case 3:
      return rng.range(0, 20);
    case 4:
      return rng.pick([0, -5, NaN]);
    default:
      return 1;
  }
}
function economyOp(rng: Rng): EconomyOp {
  switch (rng.int(0, 3)) {
    case 0: {
      const cap = [1000, rng.int(0, 400), rng.range(0, 400), NaN, 0][rng.int(0, 4)];
      return { kind: 'buy', id: rng.pick(GOODS), n: amount(rng), cap };
    }
    case 1:
      return { kind: 'sell', id: rng.pick(GOODS), n: amount(rng) };
    case 2:
      return {
        kind: 'pull',
        banner: rng.int(0, BANNERS.length - 1),
        count: rng.chance(0.5) ? 1 : 10,
        rotation: rng.int(0, 3),
      };
    default:
      return { kind: 'fit', item: rng.int(0, 4) };
  }
}
function ledgerCase(rng: Rng): LedgerCase {
  const m = rng.int(0, 4);
  return {
    full: rng.chance(0.3),
    money: [0, rng.int(0, 300), rng.range(0, 5000), rng.range(0, 60000), -rng.range(0, 200)][m],
    tickets: rng.int(0, 25),
    spotPriceMul: rng.chance(0.15) ? 0 : Math.round(rng.range(0.1, 5) * 10) / 10,
    fuelMul: rng.range(0.6, 1.4),
    // the In-cab signalling fit-out slider: 0 to 50 000 in steps of 500
    inCabCost: rng.int(0, 100) * 500,
    stock: GOODS.filter(() => rng.chance(0.5)).map((id): [string, number] => [
      id,
      rng.chance(0.5) ? rng.int(0, 300) : rng.range(0, 300),
    ]),
    ops: Array.from({ length: rng.int(1, 30) }, () => economyOp(rng)),
  };
}
/** Plainer stand-ins for one command: stone, one unit, a round cap. */
function* shrinkOp(op: EconomyOp): Iterable<EconomyOp> {
  if (op.kind === 'buy' || op.kind === 'sell') {
    if (op.id !== 'stone') yield { ...op, id: 'stone' };
    if (op.n !== 1) yield { ...op, n: 1 };
  }
  if (op.kind === 'buy' && op.cap !== 1000) yield { ...op, cap: 1000 };
}
function* shrinkLedger(c: LedgerCase): Iterable<LedgerCase> {
  for (const ops of shrinkArray(c.ops, shrinkOp)) if (ops.length) yield { ...c, ops };
  for (const stock of shrinkArray(c.stock)) yield { ...c, stock };
  for (const money of [0, Math.sign(c.money), Math.trunc(c.money)])
    if (money !== c.money) yield { ...c, money };
  if (c.full) yield { ...c, full: false };
  if (c.fuelMul !== 1) yield { ...c, fuelMul: 1 };
  if (c.tickets !== 0) yield { ...c, tickets: 0 };
  if (c.inCabCost !== 0) yield { ...c, inCabCost: 0 };
}
/** Pull results as the player sees them. */
const shown = (rs: PullResult[]) =>
  rs.map((r) => ({
    defId: r.defId,
    rarity: r.rarity,
    featured: r.featured,
    forced: r.forced,
    duplicate: r.duplicate,
  }));

/**
 * Run a case's commands against the books kept by hand: every command is refused, changing
 * nothing, or moves money, tickets, stock and fittings by exactly its quoted amount; nothing ends
 * below zero that did not start there. Returns the economy's own warnings posted on the way.
 */
function keepBooks(c: LedgerCase) {
  setSupplyMode(c.full ? 'full' : 'simple');
  rules.spotPriceMul = c.spotPriceMul;
  rules.inCabCost = c.inCabCost;
  const w = world();
  w.trade.fuelMul = c.fuelMul;
  w.economy.money = c.money;
  w.economy.tickets = c.tickets;
  for (const [id, v] of c.stock) w.stock.amounts.set(id, v);
  // a plain locomotive, one built with in-cab signalling, a wagon, a locomotive the player
  // does not own and a second plain one
  const items: Item[] = [
    w.inventory.add('f7', 0),
    w.inventory.add('tgv', 0),
    w.inventory.add('flatbed', 0),
    new Inventory().add('f7', 0),
    w.inventory.add('f7', 0),
  ];
  // the slow obvious model: the books kept by hand, and a twin gacha on the same seed
  const twinInventory = new Inventory();
  for (const id of ['f7', 'tgv', 'flatbed', 'f7']) twinInventory.add(id, 0);
  const twin = new Gacha(new Rng(7), twinInventory);
  const books = {
    money: c.money,
    tickets: c.tickets,
    earned: 0,
    stock: new Map(w.stock.amounts),
    fitted: items.map((i) => !!i.inCab),
    owned: w.inventory.items.length,
  };
  const posted = vi.fn();
  w.economy.onMessage = posted;

  for (const [i, op] of c.ops.entries()) {
    const at = `op ${i} (${op.kind})`;
    const wasMoney = w.economy.money;
    let want: { ok: boolean; message?: string };
    let result: { ok: boolean; message?: string };
    if (op.kind === 'buy') {
      const have = books.stock.get(op.id) ?? 0;
      const room = Math.floor(Math.max(0, op.cap - have));
      if (!listed(op.id) || !(Math.floor(op.n) >= 1)) want = { ok: false };
      else if (!(room >= 1)) want = { ok: false, message: STR.market.full };
      else {
        const price = quote(op.id, c.fuelMul, 'buy');
        const most = Math.min(Math.floor(op.n), room);
        // the largest count the money pays for, counted up one at a time
        let qty = 0;
        while (qty < most && (qty + 1) * price <= books.money) qty++;
        if (qty < 1) want = { ok: false, message: STR.roster.noMoney };
        else {
          want = { ok: true };
          books.money -= qty * price;
          books.stock.set(op.id, have + qty);
        }
      }
      result = w.commands.spotBuy(op.id, op.n, op.cap);
    } else if (op.kind === 'sell') {
      const have = books.stock.get(op.id) ?? 0;
      const qty = Math.min(Math.floor(op.n), Math.floor(have));
      if (!listed(op.id) || !(qty >= 1)) want = { ok: false };
      else {
        want = { ok: true };
        const v = qty * quote(op.id, c.fuelMul, 'sell');
        books.money += v;
        if (v > 0) books.earned += v;
        books.stock.set(op.id, have - qty);
      }
      result = w.commands.spotSell(op.id, op.n);
    } else if (op.kind === 'pull') {
      const banner = BANNERS[op.banner];
      const cost = PULL_COST * op.count;
      if (books.tickets < cost) want = { ok: false, message: STR.gacha.noTickets };
      else {
        want = { ok: true };
        books.tickets -= cost;
        books.owned += op.count;
      }
      const r = w.commands.pull(banner, op.count, i, op.rotation);
      result = r;
      if (want.ok && r.ok)
        expect(shown(r.results), at).toEqual(shown(twin.pull(banner, op.count, i, op.rotation)));
    } else {
      const item = items[op.item];
      const def = item.kind === 'loco' ? locoDef(item.defId) : null;
      const owned = w.inventory.items.includes(item);
      if (!def || !owned || books.fitted[op.item] || def.inCab) want = { ok: false };
      else if (books.money < rules.inCabCost) want = { ok: false, message: STR.roster.noMoney };
      else {
        want = { ok: true };
        books.money -= rules.inCabCost;
        books.fitted[op.item] = true;
      }
      result = w.commands.fitInCab(item);
    }

    expect(result.ok, at).toBe(want.ok);
    if (!result.ok) {
      expect(result.message, at).toBeTruthy();
      if (want.message) expect(result.message, at).toBe(want.message);
    }
    expect(w.economy.money, `${at}: money`).toBe(books.money);
    expect(w.economy.earned, `${at}: earned`).toBe(books.earned);
    expect(w.economy.tickets, `${at}: tickets`).toBe(books.tickets);
    expect(new Map(w.stock.amounts), `${at}: stock`).toEqual(books.stock);
    expect(
      items.map((it) => !!it.inCab),
      `${at}: fittings`,
    ).toEqual(books.fitted);
    expect(w.inventory.items.length, `${at}: items owned`).toBe(books.owned);
    expect(w.gacha.toJSON(), `${at}: gacha`).toEqual(twin.toJSON());
    if (wasMoney >= 0) expect(w.economy.money, `${at}: money`).toBeGreaterThanOrEqual(0);
    expect(w.economy.tickets, `${at}: tickets`).toBeGreaterThanOrEqual(0);
    for (const [id, v] of w.stock.amounts) expect(v, `${at}: ${id}`).toBeGreaterThanOrEqual(0);
  }
  return posted;
}

describe('economy commands', () => {
  it('move money, tickets, stock and fittings only by the quoted amounts, never below zero', () => {
    forAll(ledgerCase, (c) => void keepBooks(c), { shrink: shrinkLedger });
  });

  it('say why they refuse themselves, without the economy posting its own warning too', () => {
    forAll(ledgerCase, (c) => expect(keepBooks(c)).not.toHaveBeenCalled(), {
      shrink: shrinkLedger,
    });
  });

  it('a buy then a sell of what was bought costs exactly the spread and leaves the stock', () => {
    forAll(
      (rng) => ({
        full: rng.chance(0.3),
        spotPriceMul: Math.round(rng.range(0, 5) * 10) / 10,
        fuelMul: rng.range(0.6, 1.4),
        pick: rng.next(),
        n: rng.int(1, 150),
        money: rng.range(0, 20000),
        stock: rng.range(0, 200),
      }),
      (c) => {
        setSupplyMode(c.full ? 'full' : 'simple');
        rules.spotPriceMul = c.spotPriceMul;
        const ids = GOODS.filter(listed);
        const id = ids[Math.floor(c.pick * ids.length)];
        const w = world();
        w.trade.fuelMul = c.fuelMul;
        w.economy.money = c.money;
        w.stock.amounts.set(id, c.stock);
        const { buy, sell } = w.trade.spotQuote(id);
        if (!w.commands.spotBuy(id, c.n, 1000).ok) return;
        const qty = w.stock.get(id) - c.stock;
        expect(Number.isInteger(qty) && qty >= 1 && qty <= c.n, `bought ${qty}`).toBe(true);
        expect(w.commands.spotSell(id, qty)).toEqual({ ok: true });
        expect(w.stock.get(id)).toBe(c.stock);
        expect(w.economy.money - c.money).toBeCloseTo(qty * (sell - buy), 6);
        expect(w.economy.money).toBeLessThanOrEqual(c.money + 1e-9);
      },
    );
  });
});

// ------------------------------------------------------------ contract jobs and the program

/**
 * A production train whose own program is one stop nowhere near the rails takes up a contract
 * from a stocked quarry to a warehouse, as a train with nowhere to go does.
 */
function onContract() {
  const w = world();
  const quarry = station(w, 'quarry', 40),
    warehouse = station(w, 'warehouse', 70),
    home = deadStation(w, 60);
  quarry.storage.set('stone', 40);
  const t = train(w, 20);
  t.mode = 'production';
  t.schedule = [defaultStop(home.id)];
  t.addJob({
    contractId: 1,
    name: 'stone',
    originId: quarry.id,
    destId: warehouse.id,
    cargo: 'stone',
  });
  let now = 0;
  const until = (done: () => boolean, seconds: number) => {
    for (let i = 0; i < seconds / GDT && !done(); i++) w.fleet.tick(GDT, (now += GDT));
    return done();
  };
  expect(until(() => t.job !== null && t.state === 'moving', 10)).toBe(true);
  return { w, t, quarry, warehouse, home, until };
}

describe('setTrainMode after a contract job closes', () => {
  it('refuses schedule at the platform where the job ended, its own program having one stop', () => {
    const { w, t, warehouse, until } = onContract();
    expect(until(() => t.atStation === warehouse && t.state === 'loading', 200)).toBe(true);
    // the delivery closed the contract (ContractDispatch.release) with the train still there
    t.dropJob(1);
    expect(w.commands.setTrainMode(t, 'schedule')).toEqual({
      ok: false,
      message: STR.fleet.needTwoStops,
    });
    expect(t.mode).toBe('production');
  });

  it('refuses schedule under way, its own program having one stop', () => {
    const { w, t } = onContract();
    // the contract ended while the train was on its way to it
    t.dropJob(1);
    expect(w.commands.setTrainMode(t, 'schedule')).toEqual({
      ok: false,
      message: STR.fleet.needTwoStops,
    });
    expect(t.mode).toBe('production');
  });

  it('switched to production under way, heads for its pick instead of its dead stop', () => {
    const { w, t, quarry, until } = onContract();
    t.dropJob(1);
    expect(w.commands.setTrainMode(t, 'production')).toEqual({ ok: true });
    expect(target(t)).toBe(quarry.id);
    until(() => t.atStation === quarry, 120);
    expect(t.state).not.toBe('noRoute');
    expect(t.atStation).toBe(quarry);
  });
});

/** The train runs its own program again: nothing is set aside for a contract any more. */
const onProgram = (t: Train) => t.program === t.schedule;

describe('a roaming train whose contract closes under way', () => {
  it('chooses again rather than head for the stop it had before the job', () => {
    const { t, quarry, home, until } = onContract();
    t.dropJob(1);
    // the next fleet tick takes the program up again
    expect(until(() => onProgram(t), 1)).toBe(true);
    expect(t.mode).toBe('production');
    expect(target(t)).toBe(quarry.id);
    expect(target(t)).not.toBe(home.id);
    expect(t.state).toBe('moving');
    until(() => t.atStation === quarry, 120);
    expect(t.atStation).toBe(quarry);
  });

  it('with no way to its stop, marks the stop bad and waits to choose again', () => {
    const { w, t, home, until } = onContract();
    // a contract train picks nothing of its own: it is left with the dead stop it had
    expect(w.commands.setTrainMode(t, 'contract')).toEqual({ ok: true });
    expect(t.job?.contractId).toBe(1);
    t.dropJob(1);
    expect(until(() => onProgram(t), 1)).toBe(true);
    expect(target(t)).toBe(home.id);
    expect(t.state).toBe('idle');
    expect(t.isBadTarget(home.id, w.fleet.clockTime)).toBe(true);
  });
});

/** Three stations away from the job's two, for a schedule given while the train works it. */
function program(w: World) {
  return [
    defaultStop(station(w, 'farm', 10).id),
    defaultStop(station(w, 'farm', 85).id),
    defaultStop(station(w, 'farm', 55).id),
  ];
}

describe('setSchedule during a contract job', () => {
  it('lets the job finish first, then runs the stops given from the first', () => {
    const { w, t, quarry, warehouse, until } = onContract();
    const stops = program(w);
    const job = t.schedule;
    expect(w.commands.setSchedule(t, stops)).toEqual({ ok: true });
    expect(t.mode).toBe('schedule');
    // the job keeps its two stops
    expect(t.job?.contractId).toBe(1);
    expect(t.schedule).toBe(job);
    expect(t.route).toEqual([quarry.id, warehouse.id]);
    expect(t.program).toEqual(stops);
    // the contract closes under way
    t.dropJob(1);
    expect(until(() => onProgram(t), 1)).toBe(true);
    expect(t.route).toEqual(stops.map((s) => s.stationId));
    expect(target(t)).toBe(stops[0].stationId);
  });

  it('starts the stops given from the first when the job ends at a platform', () => {
    const { w, t, warehouse, until } = onContract();
    const stops = program(w);
    expect(w.commands.setSchedule(t, stops)).toEqual({ ok: true });
    expect(until(() => t.atStation === warehouse && t.state === 'loading', 200)).toBe(true);
    // the delivery closed the contract with the train still at the platform
    t.dropJob(1);
    expect(until(() => onProgram(t), 120)).toBe(true);
    expect(t.job).toBeNull();
    expect(t.mode).toBe('schedule');
    expect(t.route).toEqual(stops.map((s) => s.stationId));
    expect(target(t)).toBe(stops[0].stationId);
  });

  it('takes the stops given at once when no job runs, as recording a route does', () => {
    const w = world();
    const stops = program(w);
    const t = train(w, 20);
    t.mode = 'production';
    expect(w.commands.setSchedule(t, stops)).toEqual({ ok: true });
    expect(t.schedule).toEqual(stops);
    expect(onProgram(t)).toBe(true);
  });
});
