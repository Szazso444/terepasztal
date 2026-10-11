import { describe, it, expect, beforeEach, vi } from 'vitest';
import { emptyMap } from '../world/mapgen';
import { Terrain } from '../world/tiles';
import { RegionState } from '../world/regions';
import { TrackGraph } from '../world/track';
import { content, validateContent, DEFAULT_CONTENT, type ContentBundle } from '../data/content';
import { STR } from '../strings';
import { MAX_LEVEL, levelCap, ageOfLevel } from './levels';
import { LAST_AGE, ageDef } from './ages';
import { Builder } from './build';
import { Economy } from './economy';
import { Stockpile } from './stockpile';
import {
  Station,
  STATION_DEFS,
  LEVELS,
  MAX_LEVEL as STATION_MAX_LEVEL,
  resetStationIds,
} from './stations';
import {
  BUILDING_DEFS,
  BRIDGE_MAX_LEVEL,
  buildingFrame,
  buildingFromJSON,
  buildingLevel,
  buildingRecipe,
  buildingToJSON,
  buildingUpgradeCost,
  worksMaxLevel,
  type Building,
} from './buildings';
import { bridgeCapacity } from './bridges';
import { HouseRegistry, type House } from './houses';
import { TownRegistry } from './towns';
import { rules, DEFAULT_RULES, weekSeconds } from './rules';

vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));

beforeEach(() => {
  Object.assign(rules, DEFAULT_RULES);
  // these are the levels the ages open, not the time an upgrade takes (upgrade.test.ts)
  rules.upgradeTimeMul = 0;
  resetStationIds(1);
});

/** The full name of an age, the way the upgrade reasons name it. */
const ageName = (age: number) => STR.ages.name[ageDef(age).id];

/** A flat world in play mode, in `age`, with every resource in plenty. */
function world(age = 0) {
  const map = emptyMap(4242, 64, 64, Terrain.Grass),
    stock = new Stockpile(),
    economy = new Economy();
  const builder = new Builder(map, new RegionState(map), new TrackGraph(64, 64), economy, stock);
  for (const k of ['wood', 'stone', 'iron']) stock.add(k, 1e6);
  economy.setAge(age);
  const towns = new TownRegistry(builder);
  const houses = new HouseRegistry(builder, towns, stock);
  return { map, stock, economy, builder, houses };
}

/** A works placed the way the editor places one (no price, no age lock), then back to play. */
function works(builder: Builder, id: string, x: number, y: number): Building {
  const was = builder.free;
  builder.free = true;
  const b = builder.placeBuilding(x, y, id)!;
  builder.free = was;
  expect(b, id).not.toBeNull();
  return b;
}

/** A station standing in the builder, as a level file or a save puts one there. */
function placed(w: ReturnType<typeof world>, s: Station): Station {
  w.builder.stations.push(s);
  return s;
}

/** A finished house standing at (x, y), raised the way a level file raises one. */
function house(w: ReturnType<typeof world>, x: number, y: number): House {
  const was = w.builder.free;
  w.builder.free = true;
  const d = w.builder.spawnDecor(x, y, 'townhouse', 0)!;
  w.builder.free = was;
  w.houses.sync(d, false);
  w.houses.finishAll();
  return w.houses.at(x, y)!;
}

describe('levels by age', () => {
  it('gives one level per age from the age a building appears in', () => {
    expect([0, 1, 2, 3, 4, 5].map((a) => levelCap(0, a))).toEqual([1, 2, 3, 4, 5, 6]);
    expect([1, 2, 3, 4, 5].map((a) => levelCap(1, a))).toEqual([1, 2, 3, 4, 5]);
    expect(levelCap(2, 5)).toBe(4);
    for (let first = 0; first <= LAST_AGE; first++)
      for (let age = -2; age <= LAST_AGE + 3; age++) {
        const cap = levelCap(first, age);
        expect(cap, `first ${first}, age ${age}`).toBeGreaterThanOrEqual(1);
        expect(cap, `first ${first}, age ${age}`).toBeLessThanOrEqual(MAX_LEVEL);
        // never falls as the ages pass
        expect(levelCap(first, age + 1)).toBeGreaterThanOrEqual(cap);
      }
    // a level opens in the age `ageOfLevel` names, and not in the age before it
    for (let first = 0; first <= LAST_AGE; first++)
      for (let level = 2; level <= MAX_LEVEL; level++) {
        const opens = ageOfLevel(first, level);
        expect(levelCap(first, opens)).toBe(level);
        expect(levelCap(first, opens - 1)).toBe(level - 1);
      }
    expect(STATION_MAX_LEVEL).toBe(MAX_LEVEL);
  });

  it('offers no upgrade in the Steam age', () => {
    const w = world(0),
      farm = placed(w, new Station('farm', 10, 10));
    const c = w.builder.canUpgrade(farm);
    expect(c.ok).toBe(false);
    expect(c.reason).toBe(STR.build.levelOpens(2, ageName(1)));
    expect(c.reason).toContain(STR.ages.name.diesel);
    const wood = w.stock.get('wood');
    expect(w.builder.upgradeStation(farm)).toBe(false);
    expect(farm.level).toBe(1);
    expect(w.stock.get('wood')).toBe(wood);

    w.economy.setAge(1);
    expect(w.builder.canUpgrade(farm).ok).toBe(true);
    expect(w.builder.upgradeStation(farm)).toBe(true);
    expect(farm.level).toBe(2);
    const next = w.builder.canUpgrade(farm);
    expect(next.ok).toBe(false);
    expect(next.reason).toBe(STR.build.levelOpens(3, ageName(2)));
    expect(next.reason).toContain(STR.ages.name.electric);
    // the panel can still show what the level will cost once it opens
    expect(next.cost).toEqual(farm.upgradeCost());
  });

  it('opens each station level in its age, whichever age the station appears in', () => {
    const w = world(0);
    for (const def of STATION_DEFS)
      for (let age = 0; age <= LAST_AGE; age++) {
        w.economy.tier = age;
        for (let level = 1; level < MAX_LEVEL; level++) {
          const s = new Station(def.id, 10, 10);
          s.level = level;
          const c = w.builder.canUpgrade(s),
            what = `${def.id} at level ${level} in age ${age}`;
          expect(s.firstAge, what).toBe(def.tier ?? 0);
          expect(c.ok, what).toBe(level < levelCap(s.firstAge, age));
          if (c.ok) continue;
          const opens = ageOfLevel(s.firstAge, level + 1);
          // a level no age opens is the station's last; otherwise the reason names its age
          expect(c.reason, what).toBe(
            opens > LAST_AGE ? STR.station.maxed : STR.build.levelOpens(level + 1, ageName(opens)),
          );
        }
      }
  });

  it('caps works and houses the same way', () => {
    const w = world(0);
    const mill = works(w.builder, 'windmill', 10, 10);
    expect(w.builder.canUpgradeBuilding(mill)).toMatchObject({
      ok: false,
      reason: STR.build.levelOpens(2, ageName(1)),
    });
    expect(w.builder.upgradeBuilding(mill)).toBe(false);
    expect(buildingLevel(mill)).toBe(1);

    // the refinery appears in the Diesel age: its second level opens with the Electric age
    const refinery = works(w.builder, 'refinery', 12, 10);
    w.economy.setAge(1);
    expect(w.builder.canUpgradeBuilding(refinery)).toMatchObject({
      ok: false,
      reason: STR.build.levelOpens(2, ageName(2)),
    });
    expect(w.builder.upgradeBuilding(mill)).toBe(true);
    expect(buildingLevel(mill)).toBe(2);
    expect(w.builder.canUpgradeBuilding(mill).reason).toBe(STR.build.levelOpens(3, ageName(2)));
    w.economy.setAge(2);
    expect(w.builder.upgradeBuilding(refinery)).toBe(true);
    expect(buildingLevel(refinery)).toBe(2);

    // every works, at every level and age, follows the age it appears in
    for (const def of BUILDING_DEFS.filter((d) => !d.bridge))
      for (let age = 0; age <= LAST_AGE; age++) {
        w.economy.tier = age;
        for (let level = 1; level < MAX_LEVEL; level++) {
          const b: Building = { id: def.id, x: 0, y: 0, acc: 0, level, active: false, rate: 0 };
          expect(w.builder.canUpgradeBuilding(b).ok, `${def.id} at ${level} in age ${age}`).toBe(
            level < levelCap(def.tier, age),
          );
        }
      }

    const h = house(w, 20, 20);
    w.economy.tier = 0;
    expect(w.houses.canUpgrade(h)).toMatchObject({
      ok: false,
      reason: STR.build.levelOpens(2, ageName(1)),
    });
    expect(w.houses.upgrade(h)).toBe(false);
    expect(h.level).toBe(1);
    w.economy.setAge(1);
    expect(w.houses.upgrade(h)).toBe(true);
    expect(h.level).toBe(2);
    expect(w.houses.canUpgrade(h).reason).toBe(STR.build.levelOpens(3, ageName(2)));
    w.economy.setAge(LAST_AGE);
    while (w.houses.upgrade(h));
    expect(h.level).toBe(MAX_LEVEL);
    expect(w.houses.canUpgrade(h)).toMatchObject({ ok: false, reason: STR.house.maxed });
  });

  it('reads a works the content editor left without an age as one of the first age', () => {
    // an override may leave `tier` out: the works then opens its levels from the Steam age, as a
    // station without one does, instead of naming no age at all
    const def = BUILDING_DEFS.find((d) => d.id === 'kiln')!;
    const tier = def.tier;
    delete (def as { tier?: number }).tier;
    try {
      const w = world(0);
      const kiln = works(w.builder, 'kiln', 10, 10);
      expect(w.builder.canUpgradeBuilding(kiln)).toMatchObject({
        ok: false,
        reason: STR.build.levelOpens(2, ageName(1)),
      });
      w.economy.setAge(1);
      expect(w.builder.canUpgradeBuilding(kiln).ok).toBe(true);
      expect(w.builder.upgradeBuilding(kiln)).toBe(true);
      expect(w.builder.canUpgradeBuilding(kiln).reason).toBe(STR.build.levelOpens(3, ageName(2)));
    } finally {
      def.tier = tier;
    }
  });

  it('keeps a level above the cap and offers no upgrade', () => {
    const w = world(0);
    // a level file and a save both bring a farm at level 3 into the Steam age
    const fromFile = Station.fromLevel({ defId: 'farm', x: 10, y: 10, level: 3, name: '' });
    const fromSave = Station.fromJSON(JSON.parse(JSON.stringify(fromFile.toJSON())));
    for (const s of [fromFile, fromSave]) {
      placed(w, s);
      expect(s.level).toBe(3);
      expect(s.productionPerWeek).toBe(LEVELS.production[2]);
      expect(s.capacity).toBe(LEVELS.capacity[2]);
      s.tick(weekSeconds());
      expect(s.stored('wheat')).toBeCloseTo(LEVELS.production[2]);
      const c = w.builder.canUpgrade(s);
      expect(c.ok).toBe(false);
      expect(c.reason).toBe(STR.build.levelOpens(4, ageName(3)));
      expect(w.builder.upgradeStation(s)).toBe(false);
      expect(s.level).toBe(3);
    }

    const mill = buildingFromJSON([10, 12, 'windmill', 0, 5]);
    w.builder.buildings.set(12 * w.map.w + 10, mill);
    expect(buildingLevel(mill)).toBe(5);
    expect(buildingRecipe(mill).out.food).toBe(13);
    expect(buildingToJSON(mill)[4]).toBe(5);
    expect(w.builder.upgradeBuilding(mill)).toBe(false);
    expect(buildingLevel(mill)).toBe(5);

    const h = house(w, 20, 20);
    w.houses.load({
      list: [{ x: 20, y: 20, level: 4, residents: 300, progress: 1 }],
      arrivals: [],
      visited: [],
    });
    expect(h.level).toBe(4);
    expect(h.residents).toBe(300);
    expect(w.houses.canUpgrade(h)).toMatchObject({
      ok: false,
      reason: STR.build.levelOpens(5, ageName(4)),
    });
    // the ages come: the next level opens
    w.economy.setAge(3);
    expect(w.builder.canUpgrade(fromFile)).toMatchObject({ ok: true });
    expect(w.houses.canUpgrade(h).ok).toBe(false);
    w.economy.setAge(4);
    expect(w.houses.canUpgrade(h).ok).toBe(true);
  });

  it('leaves the editor free and bridges at four levels', () => {
    const w = world(0);
    w.builder.free = true;
    const farm = placed(w, new Station('farm', 10, 10));
    while (w.builder.upgradeStation(farm));
    expect(farm.level).toBe(MAX_LEVEL);
    expect(w.builder.canUpgrade(farm)).toMatchObject({ ok: false, reason: STR.station.maxed });
    const mill = works(w.builder, 'windmill', 12, 10);
    while (w.builder.upgradeBuilding(mill));
    expect(buildingLevel(mill)).toBe(MAX_LEVEL);
    expect(worksMaxLevel(mill)).toBe(MAX_LEVEL);
    expect(buildingUpgradeCost(mill)).toBeNull();
    const h = house(w, 20, 20);
    while (w.houses.upgrade(h));
    expect(h.level).toBe(MAX_LEVEL);

    // a bridge is strengthened in any age, the Steam age too, and stops at four levels
    w.builder.free = false;
    const bridge = works(w.builder, 'bridge_wood', 14, 10);
    const base = bridgeCapacity(bridge)!;
    expect(w.builder.canUpgradeBuilding(bridge).ok).toBe(true);
    while (w.builder.upgradeBuilding(bridge));
    expect(buildingLevel(bridge)).toBe(BRIDGE_MAX_LEVEL);
    expect(BRIDGE_MAX_LEVEL).toBe(4);
    expect(worksMaxLevel(bridge)).toBe(4);
    expect(w.builder.canUpgradeBuilding(bridge)).toMatchObject({
      ok: false,
      reason: STR.station.maxed,
    });
    expect(bridgeCapacity(bridge)).toBeCloseTo(base * 1.75);
    // a bridge saved above four counts as four
    expect(buildingLevel({ ...bridge, level: 6 })).toBe(4);
  });

  it('draws the highest picture there is for the levels above it', () => {
    const w = world(0);
    const mill: Building = { id: 'windmill', x: 0, y: 0, acc: 0, active: false, rate: 0 };
    expect(buildingFrame(mill)).toBe('structures/windmill');
    const frames = [2, 3, 4, 5, 6].map((level) => buildingFrame({ ...mill, level }));
    expect(frames).toEqual([
      'structures/windmill_lv2',
      'structures/windmill_lv3',
      'structures/windmill_lv4',
      'structures/windmill_lv4',
      'structures/windmill_lv4',
    ]);
    const h = house(w, 20, 20);
    const houseFrames = [1, 2, 3, 4, 5, 6].map((level) => {
      h.level = level;
      return w.houses.frame(h);
    });
    expect(houseFrames).toEqual([
      'structures/townhouse',
      'structures/townhouse_2',
      'structures/townhouse_3',
      'structures/townhouse_4',
      'structures/townhouse_4',
      'structures/townhouse_4',
    ]);
    const farm = new Station('farm', 10, 10);
    const sprites = [1, 2, 3, 4, 5, 6].map((level) => {
      farm.level = level;
      return farm.spriteLevel;
    });
    expect(sprites).toEqual([1, 2, 3, 4, 5, 5]);
  });

  it('has six values in every table', () => {
    expect(LEVELS).toEqual({
      capacity: [60, 120, 200, 320, 500, 750],
      loadRate: [4, 6, 9, 13, 18, 24],
      platforms: [1, 1, 2, 2, 3, 3],
      production: [30, 50, 80, 120, 170, 230],
      crew: [2, 3, 5, 8, 12, 16],
      upgradeCostMul: [0, 0.8, 1.2, 1.8, 2.6, 3.6],
      spriteByLevel: [1, 2, 3, 4, 5, 5],
    });
    for (const v of Object.values(LEVELS)) expect(v).toHaveLength(MAX_LEVEL);
    expect(validateContent(DEFAULT_CONTENT)).toEqual([]);
    // a table one value short does not pass
    const short = structuredClone(DEFAULT_CONTENT) as ContentBundle;
    short.stations.levels.crew = short.stations.levels.crew.slice(0, -1);
    expect(validateContent(short)).toContain(`station levels: crew needs ${MAX_LEVEL} values`);

    const mill: Building = { id: 'windmill', x: 0, y: 0, acc: 0, level: 6, active: false, rate: 0 };
    expect(buildingRecipe(mill).out.food).toBe(15);

    const w = world(0);
    const h = house(w, 20, 20);
    const holds = [1, 2, 3, 4, 5, 6].map((level) => w.houses.capacity({ ...h, level }));
    expect(holds).toEqual([20, 60, 140, 300, 520, 800]);
    expect(w.houses.maxLevel).toBe(MAX_LEVEL);
    expect(content.houses.upgradeCost.slice(3)).toEqual([
      { stone: 420, iron: 180 },
      { stone: 640, iron: 320 },
    ]);
  });
});
