import { describe, it, expect, beforeEach } from 'vitest';
import { simWorld, line, station, type SimWorld } from '../testing/simWorld';
import { forAll, shrinkArray, shrinkInt } from '../testing/property';
import type { Rng } from '../engine/rng';
import { content } from '../data/content';
import { STR } from '../strings';
import { rules, DEFAULT_RULES, daySeconds, weekSeconds } from './rules';
import { setSeasonOffset } from './weather';
import { LEVELS, MAX_LEVEL, STATION_DEFS, Station, type StationJSON } from './stations';
import {
  BUILDING_DEFS,
  buildingDef,
  buildingFromJSON,
  buildingLevel,
  buildingToJSON,
  tickBuildings,
  worksMaxLevel,
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

// ------------------------------------------------------------------------------------ properties

/** Game hours of an upgrade to levels 2 to 6, as the design sets them: the oracle's own table. */
const HOURS = [6, 9, 12, 18, 24];

/** What an upgrade raises, named as `Upgraded.kind` names it. */
type Kind = Upgraded['kind'];
/** In the order a step finishes them: the builder's stations, its works, then the houses. */
const KINDS: readonly Kind[] = ['station', 'works', 'house'];
/** Where `site` puts the farm, the windmill and the house, and their footprints. */
const AT: Record<Kind, { x: number; y: number; w: number; h: number }> = {
  station: { x: 6, y: 29, w: 1, h: 1 },
  works: { x: 4, y: 10, w: 1, h: 1 },
  house: { x: 20, y: 25, w: 1, h: 1 },
};
/** A value for each kind. */
const perKind = <T>(f: (k: Kind) => T) =>
  ({ station: f('station'), works: f('works'), house: f('house') }) as Record<Kind, T>;

/** The farm, the windmill and the house of a world, found where they stand (a load makes anew). */
const farmOf = (w: SimWorld) => w.builder.stations.find((s) => s.def.id === 'farm')!;
const millOf = (w: SimWorld) => w.builder.buildingAt(AT.works.x, AT.works.y)!;
const homeOf = (w: SimWorld) => w.houses.at(AT.house.x, AT.house.y)!;
function levelOf(w: SimWorld, k: Kind): number {
  if (k === 'station') return farmOf(w).level;
  return k === 'works' ? buildingLevel(millOf(w)) : homeOf(w).level;
}
function closedOf(w: SimWorld, k: Kind): boolean {
  if (k === 'station') return farmOf(w).closed;
  return !!(k === 'works' ? millOf(w).work : homeOf(w).work);
}
/** Puts the next level's cost of `k` in the stockpile, then presses Upgrade; true if it started. */
function press(w: SimWorld, k: Kind): boolean {
  const check =
    k === 'station'
      ? w.builder.canUpgrade(farmOf(w))
      : k === 'works'
        ? w.builder.canUpgradeBuilding(millOf(w))
        : w.houses.canUpgrade(homeOf(w));
  for (const [id, n] of Object.entries(check.cost)) w.stock.add(id, n);
  if (k === 'station') return w.builder.upgradeStation(farmOf(w));
  return k === 'works' ? w.builder.upgradeBuilding(millOf(w)) : w.houses.upgrade(homeOf(w));
}

/**
 * A Hyper age world (every level open) with a farm, a windmill and a house at `AT`, each raised
 * in the editor to its level in `from`, and the rises that took recorded nowhere.
 */
function site(from: Record<Kind, number>): World {
  const w = world(5);
  station(w, 'farm', AT.station.x, AT.station.y);
  works(w, 'windmill', AT.works.x, AT.works.y);
  house(w, AT.house.x, AT.house.y);
  freely(w, () => {
    for (const k of KINDS)
      while (levelOf(w, k) < from[k])
        if (!press(w, k)) throw new Error(`site: ${k} stuck at ${levelOf(w, k)}`);
  });
  w.ups.length = 0;
  return w;
}

/**
 * The game saved and loaded again: the farm, the works and the house written as a save writes
 * them, read back through `readSaveText` and loaded into a new world in `applySave`'s order
 * (stations, the decor and the houses, then the works). The new world records its own rises.
 */
function reload(w: World): World {
  const text = JSON.stringify({
    version: SAVE_VERSION,
    savedAt: 0,
    seed: 1,
    clock: { time: w.clock.time, speedIndex: 1 },
    economy: { money: 0, tickets: 0, tier: 5, granted: [] },
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
  if (!('save' in read)) throw new Error(`reload: the save was refused as ${read.error}`);
  const { save } = read;
  const v = world(5);
  v.clock.time = save.clock.time;
  for (const sj of save.stations) {
    const s = Station.fromJSON(sj as StationJSON);
    v.builder.stations.push(s);
    v.builder.onStationChanged?.(s, false);
  }
  house(v, AT.house.x, AT.house.y);
  v.houses.load(save.houses);
  for (const bj of save.buildings!) {
    const b = buildingFromJSON(bj as BuildingJSON);
    v.builder.buildings.set(b.y * v.map.w + b.x, b);
    v.builder.onBuildingChanged?.(b, false);
  }
  return v;
}

describe('upgrade time, for any steps', () => {
  it('ends on the first step of SIM_STEP that reaches it, at any level, day and multiplier', () => {
    // The game steps SIM_STEP (1/20) game seconds at a time. A work of H hours under a day of D
    // seconds and a multiplier of c hundredths takes H·D/24·c/100 s, that is H·D·c/120 steps,
    // counted in whole numbers here. It must end on the first whole step at or past that: never
    // a step early, and never a step late because thousands of float steps did not quite add up.
    // Half the cases sit on the Day length and Upgrade time sliders (tens of seconds, tenths);
    // the rest take any whole second and hundredth, as rules from a save may, which brings the
    // time of a work as close as 1/120 of a step to a step's end.
    forAll(
      (rng) => {
        const on = rng.chance(0.5);
        const day = on ? 10 * rng.int(3, 120) : rng.int(30, 1200);
        return { from: rng.int(1, 5), day, hundredths: on ? 10 * rng.int(1, 40) : rng.int(1, 400) };
      },
      ({ from, day, hundredths }) => {
        rules.daySeconds = day;
        rules.upgradeTimeMul = hundredths / 100;
        const w = site(perKind(() => from));
        for (const k of KINDS) expect(press(w, k), `press ${k}`).toBe(true);
        const due = Math.ceil((HOURS[from - 1] * day * hundredths) / 120);
        const endedAt: Partial<Record<Kind, number>> = {};
        for (let n = 1; n <= due + 1 && w.ups.length < KINDS.length; n++) {
          w.builder.tickWorks(SIM_STEP);
          w.houses.tickWorks(SIM_STEP);
          for (const e of w.ups) endedAt[e.kind] ??= n;
        }
        expect(endedAt, `the step each work ended on, of ${due}`).toEqual(perKind(() => due));
        expect(w.ups.map((e) => e.level)).toEqual(KINDS.map(() => from + 1));
      },
      {
        shrink: function* (c) {
          for (const from of shrinkInt(c.from, 1)) yield { ...c, from };
          for (const day of shrinkInt(c.day, 30)) yield { ...c, day };
          for (const hundredths of shrinkInt(c.hundredths, 1)) yield { ...c, hundredths };
        },
      },
    );
  }, 30_000);

  /** A game run: upgrades pressed between steps of any size, maybe a save and load on the way. */
  interface Run {
    /** each one's level before its upgrade */
    from: Record<Kind, number>;
    day: number;
    mul: number;
    /** the step before which each upgrade is pressed; past the last step, after them all */
    at: Record<Kind, number>;
    /**
     * game seconds of each step, in whole eighths so every sum is exact (0 is a paused frame), or
     * `rest`: exactly the time the first work to end has left by the oracle's count, or nothing
     * when no work runs
     */
    steps: (number | 'rest')[];
    /** the step before which the game is saved and loaded again, or never */
    saveAt: number | null;
  }
  function genRun(rng: Rng): Run {
    const steps = Array.from({ length: rng.int(1, 30) }, (): number | 'rest' => {
      switch (rng.int(0, 5)) {
        case 0:
          return 0;
        case 1:
          return rng.int(1, 8) / 8;
        case 2:
          return rng.int(1, 120);
        case 3:
          return rng.int(1, 4800) / 8;
        default:
          return 'rest';
      }
    });
    return {
      from: perKind(() => rng.int(1, 5)),
      // whole game seconds an hour, and multipliers in quarters: the work times are exact too
      day: rng.pick([120, 240, 360, 480, 720]),
      mul: rng.pick([0.25, 0.5, 0.75, 1, 1.5, 2, 4]),
      at: perKind(() => rng.int(0, steps.length)),
      steps,
      saveAt: rng.chance(0.5) ? rng.int(0, steps.length) : null,
    };
  }
  function* shrinkRun(r: Run): Iterable<Run> {
    if (r.saveAt !== null) yield { ...r, saveAt: null };
    const eighths = (s: number | 'rest') =>
      s === 'rest' ? [0] : [...shrinkInt(s * 8, 0)].map((n) => n / 8);
    for (const steps of shrinkArray(r.steps, eighths)) if (steps.length) yield { ...r, steps };
    for (const k of KINDS) {
      for (const v of shrinkInt(r.at[k], 0)) yield { ...r, at: { ...r.at, [k]: v } };
      for (const v of shrinkInt(r.from[k], 1)) yield { ...r, from: { ...r.from, [k]: v } };
    }
    if (r.saveAt !== null) for (const saveAt of shrinkInt(r.saveAt, 0)) yield { ...r, saveAt };
  }

  it('raises the level on the step its game time is reached, through the step and a save', () => {
    // The oracle sums the game time of the steps since each press, exactly (whole eighths of a
    // second against work times that are whole quarters, and steps that land on a work's end):
    // the building is closed and at its old level until the step at which the sum reaches the
    // work's time, then open one level up, and onUpgraded reports it once, on that step. Until
    // then `works()` lists it with that sum over its time as its progress, so a step of no time
    // moves nothing. A save and load anywhere changes none of it.
    forAll(
      genRun,
      (run) => {
        rules.daySeconds = run.day;
        rules.upgradeTimeMul = run.mul;
        const last = run.steps.length;
        const at = perKind((k) => Math.min(run.at[k], last));
        const time = perKind((k) => HOURS[run.from[k] - 1] * (run.day / 24) * run.mul);
        // the oracle: game seconds of every step, and the step on which each work ends
        const due = perKind(() => Infinity);
        const sum = perKind(() => 0);
        const dts = run.steps.map((s, j) => {
          const running = KINDS.filter((k) => at[k] <= j && due[k] === Infinity);
          const left = running.map((k) => time[k] - sum[k]);
          const dt = s !== 'rest' ? s : left.length ? Math.min(...left) : 0;
          for (const k of running) if ((sum[k] += dt) >= time[k]) due[k] = j;
          return dt;
        });
        const stepped = perKind(() => 0);
        let w = site(run.from);
        let step = stepper(w);
        const rises: (Omit<Upgraded, 'name'> & { step: number })[] = [];
        for (let j = 0; j <= last; j++) {
          for (const k of KINDS) {
            if (at[k] !== j) continue;
            expect(press(w, k), `press ${k} before step ${j}`).toBe(true);
            expect(closedOf(w, k), `${k} closed once pressed`).toBe(true);
          }
          if (run.saveAt === j) {
            w = reload(w);
            step = stepper(w);
          }
          if (j === last) break;
          step(dts[j]);
          for (const { kind, x, y, w: wide, h: deep, level } of w.ups.splice(0))
            rises.push({ kind, x, y, w: wide, h: deep, level, step: j });
          for (const k of KINDS) {
            if (at[k] <= j) stepped[k] += dts[j];
            const done = due[k] <= j;
            expect([levelOf(w, k), closedOf(w, k)], `${k} after step ${j}`).toEqual([
              run.from[k] + (done ? 1 : 0),
              at[k] <= j && !done,
            ]);
          }
          const sites = [...w.builder.works(), ...w.houses.works()];
          const running = KINDS.filter((k) => at[k] <= j && due[k] > j);
          expect(
            sites.map(({ progress: _, ...where }) => where),
            `the works under way after step ${j}`,
          ).toEqual(running.map((k) => AT[k]));
          running.forEach((k, i) =>
            expect(sites[i].progress, `${k}'s progress after step ${j}`).toBeCloseTo(
              stepped[k] / time[k],
              12,
            ),
          );
        }
        const expected = KINDS.filter((k) => due[k] <= last)
          .map((k) => ({ kind: k, ...AT[k], level: run.from[k] + 1, step: due[k] }))
          .sort((a, b) => a.step - b.step || KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind));
        expect(rises, 'the rises onUpgraded reported, with their steps').toEqual(expected);
      },
      { shrink: shrinkRun },
    );
  }, 60_000);
});

describe('a work in a save', () => {
  /** A work a save could hold for a building at `level`, well formed or not, as JSON reads it. */
  function genWork(rng: Rng, level: number): unknown {
    const total = rng.pick([1, 60, rng.range(0.001, 5000)]);
    const work: Record<string, unknown> = { to: level + 1, left: rng.range(0, total), total };
    if (rng.chance(0.2)) work.left = rng.pick([0, total]);
    switch (rng.int(0, 9)) {
      case 0:
        work.to = level + rng.pick([-1, 0, 2]);
        break;
      case 1:
        work.left = rng.pick([-5, total + 3, Number.NaN, Infinity, '7', null]);
        break;
      case 2:
        work.total = rng.pick([0, -60, Number.NaN, Infinity, '60', null]);
        break;
      case 3:
        delete work[rng.pick(['to', 'left', 'total'])];
        break;
      case 4:
        return rng.pick([null, 7, 'work', [], {}]);
      default:
      // well formed
    }
    return asStored(work);
  }
  /** Whether `v` is a work the game could have started on a building at `level` below `top`. */
  const startable = (v: unknown, level: number, top: number): v is Work => {
    if (!v || typeof v !== 'object') return false;
    const { to, left, total } = v as Record<string, unknown>;
    if (typeof to !== 'number' || typeof left !== 'number' || typeof total !== 'number')
      return false;
    return (
      to === level + 1 && to <= top && total > 0 && total < Infinity && left >= 0 && left <= total
    );
  };
  const STATION_IDS = ['farm', 'lumber', 'quarry', 'pump', 'town', 'warehouse', 'station'];
  const WORKS_IDS = BUILDING_DEFS.map((d) => d.id);

  it('keeps only a work the building could have started, and every such work as it was', () => {
    // A loaded work brings the level one above the one the building loads at, no higher than its
    // top level, with its time left within its time; so when it ends the level rises by one, as
    // onUpgraded says. Anything else is dropped, and a work the game could have written is kept
    // exactly. The house loads onto a house standing in a world, as a save's houses do.
    const w = world(5);
    house(w, AT.house.x, AT.house.y);
    forAll(
      (rng) => {
        const kind = rng.pick(KINDS);
        const id =
          kind === 'station'
            ? rng.pick(STATION_IDS)
            : kind === 'works'
              ? rng.pick(WORKS_IDS)
              : 'townhouse';
        const top =
          kind === 'station'
            ? MAX_LEVEL
            : kind === 'works'
              ? worksMaxLevel({ id } as Building)
              : w.houses.maxLevel;
        const level = rng.chance(0.3) ? top : rng.int(1, top);
        return { kind, id, level, work: genWork(rng, level) };
      },
      ({ kind, id, level, work }) => {
        let loaded: { level: number; top: number; work: Work | null };
        if (kind === 'station') {
          const sj = { id: 1, defId: id, name: 'S', x: 1, y: 1, level, storage: {}, work };
          const s = Station.fromJSON(asStored(sj) as StationJSON);
          loaded = { level: s.level, top: MAX_LEVEL, work: s.work };
        } else if (kind === 'works') {
          const b = buildingFromJSON(asStored([1, 1, id, 0, level, work]) as BuildingJSON);
          loaded = { level: buildingLevel(b), top: worksMaxLevel(b), work: b.work ?? null };
        } else {
          const hj = { ...AT.house, level, residents: 0, progress: 1, work };
          w.houses.load(asStored({ list: [hj], arrivals: [], visited: [] }) as never);
          const h = homeOf(w);
          loaded = { level: h.level, top: w.houses.maxLevel, work: h.work ?? null };
        }
        expect(loaded.level, 'the level it loads at').toBe(level);
        if (loaded.work)
          expect(
            startable(loaded.work, loaded.level, loaded.top),
            `kept ${JSON.stringify(loaded.work)} at level ${loaded.level} of ${loaded.top}`,
          ).toBe(true);
        if (startable(work, level, loaded.top)) expect(loaded.work, 'kept as it was').toEqual(work);
      },
    );
  });

  it('ends a loaded work one level up, at the level it names, whatever level the save gives', () => {
    // A save may give any level: below 1, above the top, a fraction, or none for a works. Loaded
    // and run to its end through the builder and the houses, a kept work ends with the level one
    // above the level the building loaded at, which is the work's own `to` and at most the top,
    // and onUpgraded reports that level once. A building whose work was dropped stays as it
    // loaded and reports nothing. A works the game does not know loads, and the step runs on it.
    const w = world(5);
    house(w, AT.house.x, AT.house.y);
    const tops = (kind: Kind, id: string) =>
      kind === 'station'
        ? MAX_LEVEL
        : kind === 'works'
          ? WORKS_IDS.includes(id)
            ? worksMaxLevel({ id } as Building)
            : MAX_LEVEL
          : w.houses.maxLevel;
    forAll(
      (rng) => {
        const kind = rng.pick(KINDS);
        const id =
          kind === 'station'
            ? rng.pick(STATION_IDS)
            : kind === 'works'
              ? rng.pick([...WORKS_IDS, 'sawmill'])
              : 'townhouse';
        const top = tops(kind, id);
        const odd: (number | null)[] = [0, -1, top, top + 1, top + 3, 2.5];
        if (kind === 'works') odd.push(null);
        const level = rng.chance(0.5) ? rng.int(1, top) : rng.pick(odd);
        // the work names the level after the saved one, or after the one it may load at
        const clamped = Math.max(1, Math.min(top, level ?? 1));
        const base = rng.chance(0.5) ? (level ?? 1) : rng.pick([clamped, Math.round(clamped)]);
        return { kind, id, level, work: genWork(rng, base) };
      },
      ({ kind, id, level, work }) => {
        w.ups.length = 0;
        let now: () => number;
        let kept: Work | null;
        let unload: () => void;
        if (kind === 'station') {
          const sj = { id: 1, defId: id, name: 'S', x: 1, y: 1, level, storage: {}, work };
          const s = Station.fromJSON(asStored(sj) as StationJSON);
          w.builder.stations.push(s);
          unload = () => w.builder.stations.splice(w.builder.stations.indexOf(s), 1);
          now = () => s.level;
          kept = s.work;
        } else if (kind === 'works') {
          const b = buildingFromJSON(asStored([1, 1, id, 0, level, work]) as BuildingJSON);
          const key = b.y * w.map.w + b.x;
          w.builder.buildings.set(key, b);
          unload = () => w.builder.buildings.delete(key);
          now = () => (WORKS_IDS.includes(id) ? buildingLevel(b) : (b.level ?? 1));
          kept = b.work ?? null;
        } else {
          const hj = { ...AT.house, level, residents: 0, progress: 1, work };
          w.houses.load(asStored({ list: [hj], arrivals: [], visited: [] }) as never);
          const h = homeOf(w);
          unload = () => {};
          now = () => h.level;
          kept = h.work ?? null;
        }
        try {
          const at = now();
          const top = tops(kind, id);
          const to = kept?.to;
          w.builder.tickWorks(kept ? kept.total : 1);
          w.houses.tickWorks(kept ? kept.total : 1);
          const rises = w.ups.map((e) => ({ kind: e.kind, level: e.level }));
          if (to !== undefined) {
            expect(to, `the level the work brings, loaded at ${at}`).toBe(at + 1);
            expect(to, `the level the work brings, of ${top}`).toBeLessThanOrEqual(top);
            expect(rises, 'what onUpgraded reports').toEqual([{ kind, level: to }]);
            expect(now(), 'the level once the work is done').toBe(to);
          } else {
            expect(rises, 'what onUpgraded reports').toEqual([]);
            expect(now(), 'the level with no work').toBe(at);
          }
        } finally {
          unload();
        }
      },
      {
        seeds: Array.from({ length: 400 }, (_, i) => i + 1),
        shrink: function* (c) {
          // toward level 1, then 0, then none, each simpler than the one before
          const simpler: (number | null)[] = [1, 0, null];
          const rank = simpler.includes(c.level) ? simpler.indexOf(c.level) : simpler.length;
          for (const level of simpler.slice(0, rank))
            if (level !== null || c.kind === 'works') yield { ...c, level };
          if (c.work && typeof c.work === 'object' && !Array.isArray(c.work)) {
            const v = c.work as Record<string, unknown>;
            if (v.left !== 0) yield { ...c, work: { ...v, left: 0 } };
            if (v.total !== 1) yield { ...c, work: { ...v, left: 0, total: 1 } };
          }
        },
      },
    );
  });
});

describe('a station being upgraded, of every kind', () => {
  it('makes nothing, takes nothing in, has no crew, and gives out what it holds as if open', () => {
    // Every kind of station but the depot (whose upgrade is instant), at every level a work can
    // start from, holding any goods: closed, it accepts no cargo, has no room, stores nothing and
    // makes nothing however long it ticks, and feeds no crew. What it holds goes out as from the
    // same station open: the same cargo on offer, the same free platform, the same amounts taken.
    const kinds = STATION_DEFS.filter((d) => !d.depot).map((d) => d.id);
    const cargos = [
      ...new Set(STATION_DEFS.flatMap((d) => [...d.accepts, ...d.produces.map((p) => p.cargo)])),
    ];
    forAll(
      (rng) => ({
        id: rng.pick(kinds),
        level: rng.int(1, MAX_LEVEL - 1),
        held: cargos.filter(() => rng.chance(0.3)).map((c) => [c, rng.int(0, 60)] as const),
        cargo: rng.pick(cargos),
        amount: rng.int(1, 100),
        dt: rng.pick([SIM_STEP, daySeconds(), weekSeconds()]),
      }),
      ({ id, level, held, cargo, amount, dt }) => {
        const make = (closed: boolean) => {
          const s = new Station(id, 1, 1);
          s.level = level;
          for (const [c, n] of held) if (n > 0) s.storage.set(c, n);
          if (closed) s.work = { to: level + 1, left: 60, total: 60 };
          return s;
        };
        const shut = make(true);
        const open = make(false);
        expect([shut.closed, open.closed]).toEqual([true, false]);
        expect([shut.crew, shut.room], 'crew and room').toEqual([0, 0]);
        expect(open.crew, 'crew when open').toBe(LEVELS.crew[level - 1]);
        expect(cargos.filter((c) => shut.accepts(c))).toEqual([]);
        expect(cargos.filter((c) => open.accepts(c))).toEqual(
          cargos.filter((c) => open.def.accepts.includes(c)),
        );
        const holds = () => JSON.stringify([...shut.storage]);
        const before = holds();
        expect(shut.store(cargo, amount), `store ${amount} ${cargo}`).toBe(0);
        shut.tick(dt);
        expect(holds(), `after a tick of ${dt} s`).toBe(before);
        expect(shut.availableCargo()).toEqual(open.availableCargo());
        expect(shut.hasFreePlatform()).toBe(open.hasFreePlatform());
        expect(shut.take(cargo, amount), `take ${amount} ${cargo}`).toBe(open.take(cargo, amount));
        expect(holds()).toBe(JSON.stringify([...open.storage]));
      },
      {
        shrink: function* (c) {
          for (const held of shrinkArray(c.held)) yield { ...c, held };
          for (const level of shrinkInt(c.level, 1)) yield { ...c, level };
          for (const amount of shrinkInt(c.amount, 1)) yield { ...c, amount };
        },
      },
    );
  });
});
