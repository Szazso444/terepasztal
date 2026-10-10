import { describe, it, expect, beforeEach } from 'vitest';
import { simWorld, line, station, type SimWorld } from '../testing/simWorld';
import { forAll } from '../testing/property';
import { content } from '../data/content';
import { STR } from '../strings';
import { rules, DEFAULT_RULES, daySeconds, weekSeconds } from './rules';
import { setSeasonOffset } from './weather';
import { LEVELS, Station, type StationJSON } from './stations';
import {
  buildingDef,
  buildingFromJSON,
  buildingLevel,
  buildingToJSON,
  tickBuildings,
  type Building,
  type BuildingJSON,
} from './buildings';
import { bridgeCapacity } from './bridges';
import type { House } from './houses';
import { SimStep, type StepContext } from './step';
import { SIM_STEP } from './time';
import { SAVE_VERSION, readSaveText } from './save';
import {
  UPGRADE_HOURS,
  advanceWork,
  hoursLeft,
  startWork,
  upgradeSeconds,
  workProgress,
  type Upgraded,
  type Work,
} from './upgrade';

beforeEach(() => {
  Object.assign(rules, DEFAULT_RULES);
  setSeasonOffset(0);
});

/** Game seconds in a game hour, under the day length now. */
const hour = () => daySeconds() / 24;
/** A value as a save stores it: through JSON and back. */
const asStored = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

interface World extends SimWorld {
  /** every level rise reported by the builder and the houses, in order */
  readonly ups: Upgraded[];
}

/**
 * A flat 64-tile world in `age`, rich in wood, stone and iron unless `poor`, with a straight line
 * along row 30 and every level rise recorded. Everything here stands in the start chunk.
 */
function world(age: number, poor = false): World {
  const w = simWorld({ terrain: 'grass', size: 64 });
  w.economy.setAge(age);
  if (!poor) for (const k of ['wood', 'stone', 'iron']) w.stock.add(k, 1e6);
  line(w, 2, 30, 30);
  const ups: Upgraded[] = [];
  w.builder.onUpgraded = (e) => ups.push(e);
  w.houses.onUpgraded = (e) => ups.push(e);
  return { ...w, ups };
}

/** Runs `act` with `builder.free` set (the editor's way: no price, no lock), then plays on. */
function freely<T>(w: SimWorld, act: () => T): T {
  w.builder.free = true;
  try {
    return act();
  } finally {
    w.builder.free = false;
  }
}

/** A works placed the way the editor places one. */
function works(w: SimWorld, id: string, x: number, y: number): Building {
  const b = freely(w, () => w.builder.placeBuilding(x, y, id));
  if (!b) throw new Error(`works: no ${id} at ${x},${y}`);
  return b;
}

/** A finished house at (x, y) with its first residents, raised the way a level file raises one. */
function house(w: SimWorld, x: number, y: number): House {
  if (!freely(w, () => w.builder.spawnDecor(x, y, 'townhouse', 0)))
    throw new Error(`house: none at ${x},${y}`);
  w.houses.finishAll();
  return w.houses.at(x, y)!;
}

/** What the stockpile holds, to compare before and after. */
const holdings = (w: SimWorld) => JSON.stringify(w.stock.toJSON());

/** A farm, a windmill and a house, each one level 1. */
function three(w: SimWorld) {
  return {
    farm: station(w, 'farm', 6, 29),
    mill: works(w, 'windmill', 4, 10),
    home: house(w, 20, 25),
  };
}

/** The step the game runs, in play mode with the weather still. */
function stepper(w: SimWorld) {
  const step = new SimStep(w);
  const ctx: StepContext = {
    mode: 'play',
    weather: false,
    stockCap: (id) => w.stock.cap(id, w.builder.depotCount(), w.builder.plantCount()),
  };
  return (gdt: number) => {
    w.clock.time += gdt;
    step.run(gdt, ctx);
  };
}

describe('how long an upgrade takes', () => {
  it('takes 6, 9, 12, 18 and 24 game hours', () => {
    expect(UPGRADE_HOURS).toEqual([6, 9, 12, 18, 24]);
    const levels = [2, 3, 4, 5, 6];
    expect(levels.map((l) => upgradeSeconds(l))).toEqual([6, 9, 12, 18, 24].map((h) => h * hour()));
    // a game day is four minutes at normal speed: one minute to level 2 .. four to level 6
    expect(levels.map((l) => upgradeSeconds(l) / 60)).toEqual([1, 1.5, 2, 3, 4]);
    // hours of the game day whatever its length, times the tuning value
    rules.daySeconds = 600;
    rules.upgradeTimeMul = 1.5;
    for (const [i, l] of levels.entries()) {
      expect(upgradeSeconds(l), `to level ${l}`).toBeCloseTo(UPGRADE_HOURS[i] * 25 * 1.5);
      const w = startWork(l)!;
      expect(w).toEqual({ to: l, left: upgradeSeconds(l), total: upgradeSeconds(l) });
      expect(workProgress(w)).toBe(0);
      expect(hoursLeft(w)).toBeCloseTo(UPGRADE_HOURS[i] * 1.5);
    }
    // there is nothing to wait for below level 2
    expect(upgradeSeconds(1)).toBe(0);
  });

  it('is instant when the rules say so', () => {
    rules.upgradeTimeMul = 0;
    for (const l of [2, 3, 4, 5, 6]) {
      expect(upgradeSeconds(l)).toBe(0);
      expect(startWork(l)).toBeNull();
    }
    const w = world(1);
    const { farm, mill, home } = three(w);
    expect(w.builder.upgradeStation(farm)).toBe(true);
    expect(w.builder.upgradeBuilding(mill)).toBe(true);
    expect(w.houses.upgrade(home)).toBe(true);
    expect([farm.level, buildingLevel(mill), home.level]).toEqual([2, 2, 2]);
    expect([farm.work, mill.work, home.work]).toEqual([null, undefined, undefined]);
    expect([...w.builder.works(), ...w.houses.works()]).toEqual([]);
    expect(w.ups.map((e) => [e.kind, e.level])).toEqual([
      ['station', 2],
      ['works', 2],
      ['house', 2],
    ]);
  });

  it('raises the level when the time is up, not before', () => {
    const w = world(1);
    const { farm, mill, home } = three(w);
    const log: string[] = [];
    const { onStationChanged, onBuildingChanged } = w.builder;
    w.builder.onStationChanged = (s, removed) => {
      log.push(`changed ${s.def.id} at ${s.level}`);
      onStationChanged?.(s, removed);
    };
    w.builder.onBuildingChanged = (b, removed) => {
      log.push(`changed ${b.id} at ${buildingLevel(b)}`);
      onBuildingChanged?.(b, removed);
    };
    w.houses.onChanged = (h) => log.push(`changed house at ${h.level}`);
    w.builder.onUpgraded = w.houses.onUpgraded = (e) => {
      log.push(`upgraded ${e.kind} to ${e.level}`);
      w.ups.push(e);
    };

    const t = upgradeSeconds(2);
    expect(w.builder.upgradeStation(farm)).toBe(true);
    expect(w.builder.upgradeBuilding(mill)).toBe(true);
    expect(w.houses.upgrade(home)).toBe(true);
    // each one starts closed and redrawn, at its old level
    expect(log).toEqual(['changed farm at 1', 'changed windmill at 1', 'changed house at 1']);
    for (const work of [farm.work, mill.work, home.work])
      expect(work).toEqual({ to: 2, left: t, total: t });

    log.length = 0;
    w.builder.tickWorks(t / 2);
    w.houses.tickWorks(t / 2);
    expect([farm.level, buildingLevel(mill), home.level]).toEqual([1, 1, 1]);
    expect(farm.closed).toBe(true);
    expect([...w.builder.works(), ...w.houses.works()]).toEqual([
      { x: 6, y: 29, w: 1, h: 1, progress: 0.5 },
      { x: 4, y: 10, w: 1, h: 1, progress: 0.5 },
      { x: 20, y: 25, w: 1, h: 1, progress: 0.5 },
    ]);
    expect(log).toEqual([]);

    w.builder.tickWorks(t / 2);
    w.houses.tickWorks(t / 2);
    expect([farm.level, buildingLevel(mill), home.level]).toEqual([2, 2, 2]);
    expect([farm.work, farm.closed, mill.work, home.work]).toEqual([
      null,
      false,
      undefined,
      undefined,
    ]);
    // redrawn at the new level first, then reported once each
    expect(log).toEqual([
      'changed farm at 2',
      'upgraded station to 2',
      'changed windmill at 2',
      'upgraded works to 2',
      'changed house at 2',
      'upgraded house to 2',
    ]);
    expect(w.ups).toEqual([
      { kind: 'station', x: 6, y: 29, w: 1, h: 1, name: farm.name, level: 2 },
      { kind: 'works', x: 4, y: 10, w: 1, h: 1, name: buildingDef('windmill').name, level: 2 },
      { kind: 'house', x: 20, y: 25, w: 1, h: 1, name: 'House', level: 2 },
    ]);

    w.builder.tickWorks(t * 10);
    w.houses.tickWorks(t * 10);
    expect(w.ups).toHaveLength(3);
    expect([farm.level, buildingLevel(mill), home.level]).toEqual([2, 2, 2]);
    expect([...w.builder.works(), ...w.houses.works()]).toEqual([]);
  });

  it('follows game time', () => {
    const w = world(1);
    const { farm, mill, home } = three(w);
    const run = stepper(w);
    w.builder.upgradeStation(farm);
    w.builder.upgradeBuilding(mill);
    w.houses.upgrade(home);
    const t = upgradeSeconds(2);
    // a paused clock steps nothing
    run(0);
    for (const work of [farm.work, mill.work, home.work]) expect(work!.left).toBe(t);
    run(t / 3);
    run(t / 3);
    expect([farm.level, buildingLevel(mill), home.level]).toEqual([1, 1, 1]);
    run(t / 3);
    expect([farm.level, buildingLevel(mill), home.level]).toEqual([2, 2, 2]);
    expect(w.ups).toHaveLength(3);
  });

  it('is done the moment the game time stepped reaches its time, whatever the step sizes', () => {
    // The oracle is the sum of the steps: a work is done exactly when the game time stepped since
    // it started reaches its total, and stays done. Steps of nothing (a paused clock), of one
    // frame at any speed, and of long stretches are mixed freely.
    forAll(
      (rng) => {
        const level = rng.int(2, 6);
        const mul = rng.pick([0.05, 0.5, 1, 1.3, 4]);
        const steps: number[] = [];
        for (let n = rng.int(1, 80); n > 0; n--)
          steps.push(
            rng.pick([0, SIM_STEP, SIM_STEP * rng.int(2, 16), rng.range(0, 5), rng.range(0, 900)]),
          );
        return { level, mul, steps };
      },
      ({ level, mul, steps }) => {
        rules.upgradeTimeMul = mul;
        const w = startWork(level)!;
        const total = w.total;
        let stepped = 0;
        let was = 0;
        for (const [i, dt] of steps.entries()) {
          const done = advanceWork(w, dt);
          stepped += dt;
          expect(done, `step ${i}: ${stepped} of ${total} s`).toBe(stepped >= total - 1e-6);
          expect(workProgress(w)).toBeCloseTo(Math.min(1, stepped / total), 6);
          expect(workProgress(w)).toBeGreaterThanOrEqual(was);
          was = workProgress(w);
        }
      },
    );
  });
});

describe('a building being upgraded', () => {
  it('closes a station while it is upgraded', () => {
    const w = world(1);
    const farm = station(w, 'farm', 6, 29);
    const crew = w.builder.crewTotal();
    w.builder.upgradeStation(farm);
    expect(farm.crew).toBe(0);
    expect(w.builder.crewTotal()).toBe(crew - LEVELS.crew[0]);
    farm.tick(weekSeconds());
    expect(farm.totalStored()).toBe(0);
    // the step makes nothing there either, and counts no crew to feed
    const run = stepper(w);
    run(upgradeSeconds(2) / 2);
    expect(farm.totalStored()).toBe(0);
    expect(w.stock.workforce).toBe(crew - LEVELS.crew[0]);

    run(upgradeSeconds(2) / 2);
    expect(farm.closed).toBe(false);
    expect(farm.crew).toBe(LEVELS.crew[1]);
    expect(w.stock.workforce).toBe(crew - LEVELS.crew[0] + LEVELS.crew[1]);
    farm.tick(weekSeconds());
    expect(farm.stored('wheat')).toBeGreaterThan(0);
  });

  it('gives out what it holds and takes nothing in', () => {
    const w = world(1);
    station(w, 'farm', 6, 29);
    const store = station(w, 'warehouse', 10, 29);
    const town = station(w, 'town', 20, 29);
    /** What contracts could bring to the town. */
    const toTown = () =>
      w.contracts
        .pairs()
        .filter((p) => p.to === town)
        .map((p) => p.cargo);
    expect(store.store('wood', 50)).toBe(50);
    expect([store.accepts('wood'), town.accepts('wheat')]).toEqual([true, true]);
    expect(toTown()).toEqual(['wheat']);
    w.builder.upgradeStation(store);
    w.builder.upgradeStation(town);
    expect([store.closed, town.closed]).toEqual([true, true]);
    // trains still stop and load what it holds
    expect(store.hasFreePlatform()).toBe(true);
    expect(store.availableCargo()).toEqual(['wood']);
    expect(store.take('wood', 20)).toBe(20);
    expect(store.stored('wood')).toBe(30);
    // but nothing is delivered, and no contract is offered to bring it any
    expect([store.accepts('wood'), town.accepts('wheat')]).toEqual([false, false]);
    expect(store.room).toBe(0);
    expect(store.store('stone', 10)).toBe(0);
    expect(store.stored('stone')).toBe(0);
    expect(toTown()).toEqual([]);

    w.builder.tickWorks(upgradeSeconds(2));
    expect([store.accepts('wood'), town.accepts('wheat')]).toEqual([true, true]);
    expect(toTown()).toEqual(['wheat']);
    expect(store.room).toBe(store.capacity - 30);
    expect(store.store('stone', 10)).toBe(10);
  });

  it('closes a works: no inputs, no output, no crew, no power, no wire', () => {
    const w = world(3);
    w.stock.add('wheat', 100);
    const mill = works(w, 'windmill', 4, 10);
    const plant = works(w, 'power_plant', 10, 10);
    const sub = works(w, 'substation', 11, 10);
    line(w, 6, 12, 16);
    freely(w, () => w.builder.placeSupply(11, 12, 'catenary'));
    expect(w.catenary.isLive(11, 12)).toBe(true);
    const crew = w.builder.crewTotal();
    const changed: string[] = [];
    const { onBuildingChanged } = w.builder;
    w.builder.onBuildingChanged = (b, removed) => {
      changed.push(`${b.id} ${b.work ? 'closed' : 'open'}`);
      onBuildingChanged?.(b, removed);
    };
    const millTick = () =>
      tickBuildings([mill], w.stock, weekSeconds(), false, w.builder.plantCount(), 0);

    w.builder.upgradeBuilding(mill);
    w.builder.upgradeBuilding(sub);
    // the start fires the change, so the power is rebuilt
    expect(changed).toEqual(['windmill closed', 'substation closed']);
    const before = holdings(w);
    millTick();
    expect(holdings(w)).toBe(before);
    expect([mill.acc, mill.reason, mill.active]).toEqual([0, 'upgrading', false]);
    expect(w.builder.crewTotal()).toBe(
      crew - buildingDef('windmill').crew - buildingDef('substation').crew,
    );
    // the plant still runs, but the closed substation feeds no wire
    expect([w.builder.plantCount(), w.power.plants]).toEqual([1, 1]);
    expect(w.catenary.isLive(11, 12)).toBe(false);
    expect(w.catenary.substations.filter((s) => s.powered)).toEqual([]);

    w.builder.tickWorks(upgradeSeconds(2));
    expect(changed.slice(2)).toEqual(['windmill open', 'substation open']);
    millTick();
    expect([mill.reason, mill.active]).toEqual(['', true]);
    expect(w.stock.get('food')).toBeGreaterThan(0);
    expect(w.builder.crewTotal()).toBe(crew);
    expect(w.catenary.isLive(11, 12)).toBe(true);

    // a power plant being upgraded gives no power and is not reported as cut off
    w.builder.upgradeBuilding(plant);
    expect([w.builder.plantCount(), w.power.plants]).toEqual([0, 0]);
    expect(w.power.isPowered(10, 10)).toBe(false);
    expect(w.catenary.isLive(11, 12)).toBe(false);
    w.notices.refresh({ trains: [], builder: w.builder, stock: w.stock, power: w.power });
    expect(w.notices.list.filter((n) => n.key.startsWith('b10,10'))).toEqual([]);
    w.builder.tickWorks(upgradeSeconds(2));
    expect([w.builder.plantCount(), w.power.plants]).toEqual([1, 1]);
    expect(w.catenary.isLive(11, 12)).toBe(true);
  });

  it('strengthens a bridge only when its work is done', () => {
    const w = world(0);
    const bridge = works(w, 'bridge_wood', 26, 10);
    const base = bridgeCapacity(bridge);
    expect(w.builder.upgradeBuilding(bridge)).toBe(true);
    expect(bridge.work).toBeDefined();
    expect(bridgeCapacity(bridge)).toBe(base);
    w.builder.tickWorks(upgradeSeconds(2));
    expect(buildingLevel(bridge)).toBe(2);
    expect(bridgeCapacity(bridge)).toBeGreaterThan(base!);
  });

  it("keeps a house's people and lets nobody in", () => {
    const w = world(1);
    w.stock.add('food', 1000);
    station(w, 'town', 20, 29);
    const home = house(w, 20, 25);
    const town = w.towns.townAt(20, 25)!;
    expect(town).not.toBeNull();
    const people = home.residents;
    expect(people).toBeLessThan(w.houses.capacity(home));
    w.houses.upgrade(home);
    for (let d = 1; d <= 5; d++) w.houses.tick(daySeconds(), d * daySeconds());
    expect(home.residents).toBe(people);
    expect(w.houses.residentsTotal()).toBe(people);
    expect(w.houses.growthDaysLeft(home)).toBeNull();
    expect(w.houses.townHousing(town).growthPerDay).toBe(0);
    // newcomers find no open house
    w.houses.industryPlaced(20, 25);
    expect(home.residents).toBe(people);

    w.houses.tickWorks(upgradeSeconds(2));
    expect(home.level).toBe(2);
    w.houses.industryPlaced(20, 25);
    expect(home.residents).toBe(people + content.houses.bonusIndustry);
    w.houses.tick(daySeconds(), 6 * daySeconds());
    expect(home.residents).toBeGreaterThan(people + content.houses.bonusIndustry);
  });
});

describe('what may be upgraded', () => {
  it('upgrades the depot at once and for nothing', () => {
    rules.upgradeTimeMul = 4;
    const w = world(1);
    const depot = station(w, 'depot', 24, 20);
    const before = holdings(w);
    expect(w.builder.canUpgrade(depot)).toEqual({ ok: true, cost: {} });
    expect(w.builder.upgradeStation(depot)).toBe(true);
    expect([depot.level, depot.work, depot.closed]).toEqual([2, null, false]);
    expect(holdings(w)).toBe(before);
    expect(w.ups).toEqual([
      { kind: 'station', x: 24, y: 20, w: 2, h: 2, name: depot.name, level: 2 },
    ]);
  });

  it('starts no second upgrade while one runs', () => {
    const w = world(2);
    const { farm, mill, home } = three(w);
    w.builder.upgradeStation(farm);
    w.builder.upgradeBuilding(mill);
    w.houses.upgrade(home);
    const works = asStored([farm.work, mill.work, home.work]);
    const before = holdings(w);
    const busy = { ok: false, cost: {}, reason: STR.build.upgradingNow };
    expect(w.builder.canUpgrade(farm)).toEqual(busy);
    expect(w.builder.canUpgradeBuilding(mill)).toEqual(busy);
    expect(w.houses.canUpgrade(home)).toEqual(busy);
    expect(w.builder.upgradeStation(farm)).toBe(false);
    expect(w.builder.upgradeBuilding(mill)).toBe(false);
    expect(w.houses.upgrade(home)).toBe(false);
    // the editor does not jump the work either
    freely(w, () => {
      expect(w.builder.upgradeStation(farm)).toBe(false);
      expect(w.builder.upgradeBuilding(mill)).toBe(false);
      expect(w.houses.upgrade(home)).toBe(false);
    });
    expect([farm.work, mill.work, home.work]).toEqual(works);
    expect(holdings(w)).toBe(before);

    // once it is done the next level may be paid for
    w.builder.tickWorks(upgradeSeconds(2));
    w.houses.tickWorks(upgradeSeconds(2));
    expect(w.builder.canUpgrade(farm).ok).toBe(true);
    expect(w.builder.canUpgradeBuilding(mill).ok).toBe(true);
    expect(w.houses.canUpgrade(home).ok).toBe(true);
  });

  it('changes nothing when the upgrade cannot be paid for', () => {
    const w = world(1, true);
    const { farm, mill, home } = three(w);
    let changes = 0;
    w.builder.onStationChanged = w.builder.onBuildingChanged = () => changes++;
    w.houses.onChanged = () => changes++;
    const before = holdings(w);
    for (const c of [
      w.builder.canUpgrade(farm),
      w.builder.canUpgradeBuilding(mill),
      w.houses.canUpgrade(home),
    ]) {
      expect(c.ok).toBe(false);
      expect(c.reason).toMatch(/^Need /);
    }
    expect(w.builder.upgradeStation(farm)).toBe(false);
    expect(w.builder.upgradeBuilding(mill)).toBe(false);
    expect(w.houses.upgrade(home)).toBe(false);
    expect([farm.work, mill.work, home.work]).toEqual([null, undefined, undefined]);
    expect([farm.level, buildingLevel(mill), home.level]).toEqual([1, 1, 1]);
    expect(holdings(w)).toBe(before);
    expect(changes).toBe(0);
    expect([...w.builder.works(), ...w.houses.works(), ...w.ups]).toEqual([]);
  });

  it('forgets the work of a building that was removed', () => {
    const w = world(1);
    const { farm, mill, home } = three(w);
    w.builder.upgradeStation(farm);
    w.builder.upgradeBuilding(mill);
    w.houses.upgrade(home);
    const t = upgradeSeconds(2);
    w.builder.tickWorks(t / 2);
    w.houses.tickWorks(t / 2);
    expect(w.builder.removeStation(farm)).toBe(true);
    expect(w.builder.removeBuilding(4, 10)).toBe(true);
    expect(w.builder.removeDecor(20, 25)).toBe(true);
    expect([...w.builder.works(), ...w.houses.works()]).toEqual([]);

    // what is built on the same tiles starts afresh, and the old works never finish
    const next = three(w);
    w.builder.tickWorks(t * 2);
    w.houses.tickWorks(t * 2);
    expect([farm.level, buildingLevel(mill), home.level]).toEqual([1, 1, 1]);
    expect([next.farm.level, buildingLevel(next.mill), next.home.level]).toEqual([1, 1, 1]);
    expect([next.farm.closed, next.mill.work, next.home.work]).toEqual([
      false,
      undefined,
      undefined,
    ]);
    expect(w.ups).toEqual([]);
    // and what is gone cannot be upgraded
    expect(w.builder.upgradeStation(farm)).toBe(false);
    expect(w.builder.upgradeBuilding(mill)).toBe(false);
    expect(w.houses.upgrade(home)).toBe(false);
  });

  it('carries a work under way through a save', () => {
    const w = world(1);
    const { farm, mill, home } = three(w);
    w.builder.upgradeStation(farm);
    w.builder.upgradeBuilding(mill);
    w.houses.upgrade(home);
    const t = upgradeSeconds(2);
    w.builder.tickWorks(t / 3);
    w.houses.tickWorks(t / 3);
    const work: Work = { to: 2, left: t - t / 3, total: t };

    // the parts a save holds of them, written and read back as the game reads a save
    const text = JSON.stringify({
      version: SAVE_VERSION,
      savedAt: 0,
      seed: 1,
      clock: { time: 0, speedIndex: 1 },
      economy: { money: 0, tickets: 0, tier: 1, granted: [] },
      track: [],
      stations: w.builder.stations.map((s) => s.toJSON()),
      trains: [],
      contracts: {},
      inventory: {},
      gacha: {},
      camera: { x: 0, y: 0, zoomIndex: 0 },
      lastDay: 1,
      buildings: [...w.builder.buildings.values()].map(buildingToJSON),
      houses: w.houses.toJSON(),
    });
    const read = readSaveText(text);
    if (!('save' in read)) throw new Error(`the save was refused as ${read.error}`);
    const { save } = read;
    expect(save.stations[0].work).toEqual(work);
    expect(save.buildings![0][5]).toEqual(work);
    expect(save.houses!.list[0].work).toEqual(work);

    // loaded into a new world the way the game loads one
    const v = world(1);
    for (const sj of save.stations) v.builder.stations.push(Station.fromJSON(sj as StationJSON));
    for (const bj of save.buildings!) {
      const b = buildingFromJSON(bj as BuildingJSON);
      v.builder.buildings.set(b.y * v.map.w + b.x, b);
    }
    house(v, 20, 25);
    v.houses.load(save.houses);
    const farm2 = v.builder.stations[0];
    const mill2 = v.builder.buildingAt(4, 10)!;
    const home2 = v.houses.at(20, 25)!;
    expect([farm2.work, mill2.work, home2.work]).toEqual([work, work, work]);
    expect([farm2.closed, farm2.level, buildingLevel(mill2), home2.level]).toEqual([true, 1, 1, 1]);
    tickBuildings([mill2], v.stock, SIM_STEP, false, 0, 0);
    expect(mill2.reason).toBe('upgrading');

    // and it finishes when the rest of its time has passed, not before
    v.builder.tickWorks(t / 3);
    v.houses.tickWorks(t / 3);
    expect([farm2.level, buildingLevel(mill2), home2.level]).toEqual([1, 1, 1]);
    v.builder.tickWorks(t / 3);
    v.houses.tickWorks(t / 3);
    expect([farm2.level, buildingLevel(mill2), home2.level]).toEqual([2, 2, 2]);
    expect(v.ups.map((e) => e.kind)).toEqual(['station', 'works', 'house']);
  });
});
