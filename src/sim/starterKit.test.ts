import { describe, it, expect, beforeEach, vi } from 'vitest';
import { emptyMap } from '../world/mapgen';
import { Terrain } from '../world/tiles';
import { RegionState } from '../world/regions';
import { TrackGraph, TRACK_ITEMS, makePiece } from '../world/track';
import { Dir, DIR_DX, DIR_DY } from '../engine/iso';
import { Rng } from '../engine/rng';
import { content, type LocoDef, type WagonDef } from '../data/content';
import { Builder } from './build';
import { Economy } from './economy';
import { looseStore } from '../testing/storeFixtures';
import { Fleet } from './fleet';
import { Train, resetTrainIds } from './trains';
import {
  resetStationIds,
  stationDef,
  stationFootprint,
  stationGates,
  type Station,
} from './stations';
import {
  START_DEPOT_REACH,
  depotSiteBlocked,
  ensureStartDepot,
  grantDepot,
  startDepotCentre,
  startDepotKind,
} from './startDepot';
import { gaugeLine, gaugeOf, vehicleAccess } from './compat';
import { vehicleSpec } from './body';
import { cargoDef } from './cargo';
import type { TrackClass } from '../world/track';
import { rules, DEFAULT_RULES } from './rules';
import { startStock } from './step';
import { DEFAULT_SUPPLY, SUPPLY_MODES, dieselFuelId, setSupplyMode, supplyMode } from './supply';
import { STR } from '../strings';
import { Inventory } from '../gacha/inventory';
import { CRAFT_TIERS, Crafting, craftPool, craftResources } from '../gacha/crafting';
import { bannerPool } from '../gacha/gacha';
import { itemDef, locoDef, wagonDef } from '../gacha/items';
import { forAll, shrinkArray, shrinkInt } from '../testing/property';
import { Store, StoreRegistry } from './stores';
import { TownRegistry } from './towns';

vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));
beforeEach(() => {
  Object.assign(rules, DEFAULT_RULES);
  setSupplyMode(DEFAULT_SUPPLY);
  resetStationIds(1);
  resetTrainIds(1);
});

/**
 * The engines a new game once handed out and no longer does: Adler, John Bull and the Mk48 before
 * the Rocket start, BM-50 and Muki before the steam-only start. They stay in the game.
 */
const FORMER_KIT = ['adler', 'john_bull', 'mk48', 'bm50', 'muki'];
/** The regular-gauge wagons a new game handed out before the kit went narrow; they stay too. */
const FORMER_WAGONS = ['water_cart', 'wood_hopper', 'flatbed', 'wooden_coach'];
/** The engines the content marks as starters: what a new game hands out, whatever they are. */
const STARTER_LOCOS = content.locomotives.filter((l) => l.starter);

/** Plenty of every fuel and crafting material, for the tests that are not about the start stock. */
function plenty(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of ['coal', 'wood', 'water', 'oil', 'diesel', ...craftResources()]) out[id] = 5000;
  return out;
}

/** A store holding `amounts`, with no cap: what a depot's store fills a train from. */
function pileOf(amounts: Record<string, number>) {
  const pile = new Store('pile', 'depot', { x: 0, y: 0 }, () => Infinity);
  for (const [id, n] of Object.entries(amounts)) pile.add(id, n);
  return pile;
}

/**
 * A world the way `Game` sets one up for a new game: an inventory seeded with the starters, the
 * recipes of what it holds, and `stock` in a loose store (plenty of everything unless given),
 * which crafting draws on; the first depot's store gets it too (`stocked`): the trains built
 * there fill their tanks from it.
 */
function newGame(stock: Record<string, number> = plenty()) {
  const map = emptyMap(4242, 64, 64, Terrain.Grass),
    track = new TrackGraph(64, 64),
    store = looseStore(),
    economy = new Economy();
  const regions = new RegionState(map);
  for (let i = 0; i < regions.unlocked.length; i++) regions.own(i);
  const stores = new StoreRegistry();
  const builder = new Builder(map, regions, track, economy, stores);
  stores.attach({ builder, towns: new TownRegistry(builder), track });
  builder.free = true;
  const inventory = new Inventory();
  inventory.seedStarter(0);
  const fleet = new Fleet(track, builder, map, inventory, economy);
  const crafting = new Crafting(new Rng(1), inventory, economy);
  crafting.grantFromInventory();
  for (const [id, n] of Object.entries(stock)) store.add(id, n);
  return { map, track, stock: store, supplies: stock, builder, inventory, fleet, crafting };
}
/** The depot's store holds the world's stock, put in as given (past its cap); the depot back. */
function stocked(w: ReturnType<typeof newGame>, depot: Station) {
  const store = w.builder.stores.byKey(`st:${depot.id}`)!;
  for (const [id, n] of Object.entries(w.supplies)) store.amounts.set(id, n);
  return depot;
}
/** A narrow depot on a narrow line with two stops beside it. */
function narrowLine(w: ReturnType<typeof newGame>) {
  const ew = [0, 1].find((r) => makePiece('straight', r, 'narrow').links[0].includes(Dir.E))!;
  const depot = stocked(w, w.builder.placeStation(20, 20, 'narrow_depot', 0)!);
  for (let x = 19; x <= 50; x++) w.track.place(x, 20, 'straight', ew, 'narrow');
  const near = w.builder.placeStation(28, 21, 'quarry', 0)!;
  const far = w.builder.placeStation(46, 21, 'quarry', 0)!;
  return { depot, near, far };
}
/** A regular depot on a regular line with two stops beside it, as an older game built it. */
function regularLine(w: ReturnType<typeof newGame>) {
  const ew = [0, 1].find((r) => makePiece('straight', r, 'branch').links[0].includes(Dir.E))!;
  const depot = stocked(w, w.builder.placeStation(20, 20, 'depot', 0)!);
  for (let x = 22; x <= 50; x++) w.track.place(x, 20, 'straight', ew, 'branch');
  const near = w.builder.placeStation(28, 21, 'quarry', 0)!;
  const far = w.builder.placeStation(46, 21, 'quarry', 0)!;
  return { depot, near, far };
}

/**
 * What an engine of this type burns in the running supply mode, one entry per tank, each kept
 * going by any one of its stock ids: a steam engine fires coal or wood and fills with water, a
 * diesel burns the chain's diesel fuel, an electric draws on the wire and needs nothing.
 */
function burns(def: LocoDef): string[][] {
  if (def.type === 'steam') return [['coal', 'wood'], ['water']];
  if (def.type === 'diesel') return [[dieselFuelId()]];
  return [];
}
/** Every tank of the engine can be filled from `stock`. */
function fuelable(def: LocoDef, stock: Record<string, number>): boolean {
  return burns(def).every((tank) => tank.some((id) => (stock[id] ?? 0) > 0));
}

describe('the starter kit of a new game', () => {
  it('marks only narrow-gauge steam engines as starters', () => {
    expect(STARTER_LOCOS.length).toBeGreaterThan(0);
    for (const l of STARTER_LOCOS) {
      expect(l.type, l.id).toBe('steam');
      expect(gaugeOf(l), l.id).toBe('narrow');
    }
  });

  it('hands out steam engines only: no diesel and no electric', () => {
    const { inventory } = newGame();
    const locos = inventory.items.filter((i) => i.kind === 'loco');
    expect(locos.length).toBeGreaterThan(0);
    for (const i of locos) expect(locoDef(i.defId).type, i.defId).toBe('steam');
  });

  it('hands the Rocket out first, so the depot lists it at the top', () => {
    // the depot screen offers the free engines in inventory order
    const { inventory } = newGame();
    expect(inventory.free('loco')[0].defId).toBe('rocket');
    expect(inventory.items[0].defId).toBe('rocket');
  });

  it.each(SUPPLY_MODES)(
    'has every starter engine fuelled by the start stock (%s chain)',
    (mode) => {
      const was = supplyMode();
      setSupplyMode(mode);
      try {
        const stock = startStock();
        for (const l of STARTER_LOCOS) expect(fuelable(l, stock), l.id).toBe(true);
        // the check can fail: a diesel finds nothing to burn there
        expect(fuelable(locoDef('bm50'), stock)).toBe(false);
      } finally {
        setSupplyMode(was);
      }
    },
  );

  it.each(SUPPLY_MODES)(
    'judges an engine fuelled exactly when a train of it fills every tank it has (%s chain)',
    (mode) => {
      // the oracle for `fuelable`: a one-engine train refuelled from the stock, over every engine
      // and every stock of these ids, the stocks with fewer ids first so a failure is the smallest
      const ids = ['coal', 'wood', 'water', 'oil', 'diesel', 'power'];
      const stocks = Array.from({ length: 1 << ids.length }, (_, mask) =>
        ids.filter((_, i) => mask & (1 << i)),
      ).sort((a, b) => a.length - b.length);
      const was = supplyMode();
      setSupplyMode(mode);
      try {
        for (const held of stocks)
          for (const def of content.locomotives) {
            const stock = Object.fromEntries(held.map((id) => [id, 100]));
            const pile = pileOf(Object.fromEntries(held.map((id) => [id, 100])));
            const train = new Train([{ uid: 1, def, level: 1 }]);
            train.refuel(pile, { fuel: true, water: true });
            const tanks = [
              [train.coalCap, train.coal],
              [train.oilCap, train.oil],
              [train.waterCap, train.water],
            ];
            const filled = tanks.every(([cap, got]) => cap === 0 || got > 0);
            expect(fuelable(def, stock), `${def.id} on [${held.join(', ')}]`).toBe(filled);
          }
      } finally {
        setSupplyMode(was);
      }
    },
  );

  it('marks only narrow-gauge wagons as starters, and hands out no regular one', () => {
    const starters = content.wagons.filter((w) => w.starter);
    expect(starters.length).toBeGreaterThan(0);
    for (const w of starters) expect(gaugeOf(w), w.id).toBe('narrow');
    const { inventory } = newGame();
    const wagons = inventory.items.filter((i) => i.kind === 'wagon');
    expect(wagons.length).toBeGreaterThan(0);
    for (const i of wagons) expect(gaugeOf(itemDef(i.defId)), i.defId).toBe('narrow');
  });

  it('maintenance wagons are Steam, the narrow one starter stock, the Branch one a Steam draw', () => {
    const wagons = content.wagons.filter((w) => w.maintenance);
    expect(wagons.map((w) => [w.id, w.class, gaugeOf(w)])).toEqual([
      ['maint_wagon_narrow', 'corvette', 'narrow'],
      ['maint_wagon_branch', 'frigate', 'regular'],
    ]);
    const { inventory, crafting } = newGame();
    for (const w of wagons) expect(w.tier, w.id).toBe(0);
    // the narrow start hands out the Narrow wagon only: a regular wagon has no depot to roll out of
    const [narrow, branch] = wagons;
    expect(narrow.starter).toBe(true);
    expect(inventory.count(narrow.id)).toBe(content.crafting.starterCopies.wagon);
    expect(crafting.knows(narrow.id)).toBe(true);
    expect(branch.starter).toBeUndefined();
    expect(inventory.count(branch.id)).toBe(0);
    expect(crafting.knows(branch.id)).toBe(false);
    expect(craftPool('wagon', 0)).toContain(branch.id);
  });

  it('hands out each starter in the copies the crafting table says, and nothing else', () => {
    // the author's numbers: one of each engine, three of each wagon
    expect(content.crafting.starterCopies).toEqual({ loco: 1, wagon: 3 });
    const copies = content.crafting.starterCopies;
    const { inventory } = newGame();
    for (const l of content.locomotives)
      expect(inventory.count(l.id), l.id).toBe(l.starter ? copies.loco : 0);
    for (const w of content.wagons)
      expect(inventory.count(w.id), w.id).toBe(w.starter ? copies.wagon : 0);
  });

  it('a train with a maintenance wagon says so', () => {
    const rocket = locoDef('rocket');
    const slot = (uid: number, id: string) => ({
      uid,
      def: wagonDef(id),
      level: 1,
      cargo: null,
      amount: 0,
      origin: null,
    });
    const train = new Train([{ uid: 1, level: 1, def: rocket }]);
    expect(train.hasMaintenanceWagon).toBe(false);
    train.wagons = [slot(2, 'mine_tub')];
    expect(train.hasMaintenanceWagon).toBe(false);
    train.wagons = [slot(2, 'mine_tub'), slot(3, 'maint_wagon_narrow')];
    expect(train.hasMaintenanceWagon).toBe(true);
    // taking the wagon off takes the flag with it
    train.wagons = train.wagons.slice(0, 1);
    expect(train.hasMaintenanceWagon).toBe(false);
  });

  it('knows the recipe of each model it owns and of no other, every one narrow gauge', () => {
    const { inventory, crafting, stock } = newGame();
    expect([...crafting.recipes].sort()).toEqual(inventory.ownedDefs().sort());
    for (const id of crafting.recipes) {
      expect(gaugeOf(itemDef(id)), id).toBe('narrow');
      expect(crafting.canCraft(id, stock), id).toBe(true);
    }
  });

  it.each(STARTER_LOCOS.map((l) => l.id))(
    'rolls the %s out of a narrow depot on the start stock alone and runs it to a stop',
    (id) => {
      const w = newGame(startStock());
      const { depot } = narrowLine(w);
      const loco = w.inventory.free('loco').find((i) => i.defId === id)!;
      const wagon = w.inventory
        .free('wagon')
        .find((i) => gaugeOf(itemDef(i.defId)) === 'narrow' && itemDef(i.defId).size !== 'tiny')!;
      expect(w.fleet.modelDeployReason(locoDef(id), depot)).toBeNull();
      const t = w.fleet.create([loco.uid], [wagon.uid], []);
      expect(t).toBeInstanceOf(Train);
      const train = t as Train;
      expect(loco.assigned).toBe(train.id);
      // the tanks were filled from the start stock: a firebox and a tender, or a diesel's tank
      if (locoDef(id).type === 'steam') {
        expect(train.coal).toBeGreaterThan(0);
        expect(train.water).toBeGreaterThan(0);
      }
      if (locoDef(id).type === 'diesel') expect(train.oil).toBeGreaterThan(0);
      const reached: Station[] = [];
      w.fleet.onArrive = (_t, s) => void reached.push(s);
      for (let i = 0; i < 20000 && !reached.length; i++) w.fleet.tick(0.05, i * 0.05);
      expect(reached.length).toBeGreaterThan(0);
      expect(train.distance).toBeGreaterThan(3);
      expect(train.state).not.toBe('noFuel');
    },
  );

  it('needs a narrow depot: a regular depot builds none of the starter engines', () => {
    const w = newGame();
    const regular = w.builder.placeStation(10, 10, 'depot', 0)!;
    for (const { id } of STARTER_LOCOS) {
      const loco = w.inventory.free('loco').find((i) => i.defId === id)!;
      expect(w.fleet.modelDeployReason(locoDef(id), regular), id).not.toBeNull();
      expect(w.fleet.create([loco.uid], [], [], undefined, 'schedule', regular.id), id).toBe(
        STR.fleet.noNarrowDepot,
      );
      expect(loco.assigned).toBeNull();
    }
  });
});

/** Starter engines that wear the look of an earlier one: same body, size, gauge and paint. */
function lookAlikes(locos: LocoDef[]): string[] {
  const first = new Map<string, string>();
  const out: string[] = [];
  for (const l of locos) {
    const look = [l.body, l.size ?? 'small', gaugeOf(l), l.paint].join('|');
    const twin = first.get(look);
    if (twin) out.push(`${l.id} looks like ${twin}`);
    else first.set(look, l.id);
  }
  return out;
}
/** Tiles a full tank carries an engine, for fuel or for water; the engines that fall short. */
function shortRange(locos: LocoDef[], tank: 'fuel' | 'water', tiles: number): string[] {
  const out: string[] = [];
  for (const l of locos) {
    const cap = tank === 'fuel' ? l.fuelCap : l.waterCap;
    const per = tank === 'fuel' ? l.fuelPerTile : l.waterPerTile;
    const range = cap && per ? cap / per : 0;
    if (range < tiles) out.push(`${l.id}: ${Math.floor(range)} tiles on ${tank}`);
  }
  return out;
}
/**
 * What the copies of these steam engines hold in coal and in water when full, against the stock:
 * the tanks that do not all fit at once.
 */
function overStock(locos: LocoDef[], copies: number, stock: Record<string, number>): string[] {
  const need = { coal: 0, water: 0 };
  for (const l of locos) {
    if (l.type !== 'steam') continue;
    need.coal += copies * (l.fuelCap ?? 0);
    need.water += copies * (l.waterCap ?? 0);
  }
  return (['coal', 'water'] as const)
    .filter((id) => need[id] > (stock[id] ?? 0))
    .map((id) => `${id}: tanks hold ${need[id]} of ${stock[id] ?? 0}`);
}
/** Tonnes of a wagon loaded to capacity with the heaviest cargo it accepts. */
function loadedWeight(w: WagonDef): number {
  return w.weight + w.capacity * Math.max(0, ...(w.accepts ?? []).map((c) => cargoDef(c).weight));
}
/** The engines that cannot haul one fully loaded wagon of a type, with the first such wagon. */
function cannotHaul(locos: LocoDef[], wagons: WagonDef[]): string[] {
  const out: string[] = [];
  for (const l of locos) {
    const heavy = wagons.find((w) => loadedWeight(w) > l.power);
    if (heavy)
      out.push(`${l.id} (power ${l.power}) cannot haul ${heavy.id} at ${loadedWeight(heavy)}`);
  }
  return out;
}

describe('the starter engines of a new game', () => {
  const STARTER_WAGONS = content.wagons.filter((w) => w.starter);

  it('are the Rocket, the MÁV 490 and Orenstein & Koppel: weak, middling and strong', () => {
    // the author's decision (startkit-engines): a tiny field engine, the middling Rocket and the
    // strong 490; the Rocket stays first in the file, so the depot lists it first
    expect(STARTER_LOCOS.map((l) => l.id)).toEqual(['rocket', 'mav490', 'orenstein_koppel']);
    expect(content.locomotives.slice(0, 3).map((l) => l.id)).toEqual([
      'rocket',
      'mav490',
      'orenstein_koppel',
    ]);
    expect(locoDef('mav490').name).toBe('MÁV 490');
    expect(locoDef('orenstein_koppel').name).toBe('Orenstein & Koppel');
    const power = (id: string) => locoDef(id).power;
    expect(power('orenstein_koppel')).toBeLessThan(power('rocket'));
    expect(power('rocket')).toBeLessThan(power('mav490'));
    for (const l of STARTER_LOCOS) {
      expect(l.power, l.id).toBeGreaterThanOrEqual(30);
      expect(l.power, l.id).toBeLessThanOrEqual(60);
    }
    // plain small tank engines: no field of the body, so each has the Rocket's rigid body
    for (const id of ['mav490', 'orenstein_koppel']) {
      const def = locoDef(id);
      expect(def.body, id).toBe('steam_std');
      expect(def.size, id).toBe('small');
      expect(def.rarity, id).toBe('N');
      for (const field of ['plan', 'bogies', 'bogieAxles', 'pivotRatio', 'bogieStyle'])
        expect(def, `${id}.${field}`).not.toHaveProperty(field);
    }
  });

  it('hands out each of them with the inventory in the order of the file', () => {
    const { inventory } = newGame();
    expect(inventory.free('loco').map((i) => i.defId)).toEqual(STARTER_LOCOS.map((l) => l.id));
  });

  it("run on narrow track as plain rigid bodies, with the Rocket's length", () => {
    const rocket = vehicleSpec(locoDef('rocket'));
    for (const l of STARTER_LOCOS) {
      expect(vehicleAccess(l, 'narrow'), l.id).toBeNull();
      const spec = vehicleSpec(l);
      expect(spec.plan, l.id).toBe('rigid');
      expect(spec.segments.length, l.id).toBe(1);
      expect(spec.L, l.id).toBe(rocket.L);
    }
  });

  it('are told apart on screen: no two share a body and a paint', () => {
    expect(lookAlikes(STARTER_LOCOS)).toEqual([]);
  });

  it('carry at least 400 tiles on a full tank of fuel and of water', () => {
    expect(shortRange(STARTER_LOCOS, 'fuel', 400)).toEqual([]);
    expect(shortRange(STARTER_LOCOS, 'water', 400)).toEqual([]);
  });

  it('fit the start stock together: every tank of every copy can be filled at once', () => {
    expect(overStock(STARTER_LOCOS, content.crafting.starterCopies.loco, startStock())).toEqual([]);
  });

  it('are each strong enough to haul one fully loaded wagon of every starter wagon type', () => {
    expect(STARTER_WAGONS.length).toBeGreaterThan(0);
    expect(cannotHaul(STARTER_LOCOS, STARTER_WAGONS)).toEqual([]);
    // the heaviest is a tub of iron: 3 t and 10 units at 2.4 t
    expect(Math.max(...STARTER_WAGONS.map(loadedWeight))).toBeCloseTo(27);
  });

  it('are found out by the checks above when the table is wrong', () => {
    // synthetic engines and a stock of their own, so the checks are tried whatever the tuning is
    const eng = (id: string, over: Partial<LocoDef> = {}): LocoDef => ({
      ...locoDef('rocket'),
      id,
      fuelCap: 50,
      fuelPerTile: 0.1,
      waterCap: 50,
      waterPerTile: 0.1,
      power: 40,
      ...over,
    });
    const stock = { coal: 100, water: 100 };

    // tanks: two full tanks fit exactly, one more unit of coal does not, nor does a second copy
    expect(overStock([eng('a'), eng('b')], 1, stock)).toEqual([]);
    expect(overStock([eng('a'), eng('b', { fuelCap: 51 })], 1, stock)).toEqual([
      'coal: tanks hold 101 of 100',
    ]);
    expect(overStock([eng('a'), eng('b', { waterCap: 400 })], 1, stock)).toEqual([
      'water: tanks hold 450 of 100',
    ]);
    expect(overStock([eng('a'), eng('b')], 2, stock)).toHaveLength(2);

    // looks: the same body and paint twice, but not when body, paint or size differ
    const red = { body: 'steam_std', paint: 'red' };
    expect(lookAlikes([eng('a', red), eng('b', { ...red, paint: 'blue' }), eng('c', red)])).toEqual(
      ['c looks like a'],
    );
    expect(lookAlikes([eng('a', red), eng('b', { ...red, body: 'steam_early' })])).toEqual([]);
    expect(lookAlikes([eng('a', red), eng('b', { ...red, size: 'medium' })])).toEqual([]);

    // range: 400 tiles is enough, a few less is not, and a missing tank is none
    const quarter = { fuelPerTile: 0.25 };
    expect(shortRange([eng('a', { ...quarter, fuelCap: 100 })], 'fuel', 400)).toEqual([]);
    expect(shortRange([eng('a', { ...quarter, fuelCap: 99 })], 'fuel', 400)).toEqual([
      'a: 396 tiles on fuel',
    ]);
    expect(shortRange([eng('a', { waterPerTile: 1 })], 'water', 400)).toEqual([
      'a: 50 tiles on water',
    ]);
    expect(shortRange([eng('a', { fuelCap: undefined })], 'fuel', 400)).toHaveLength(1);

    // haulage: a wagon of 3 t and ten units of its heaviest cargo (iron, 2.4 t) is 27 t
    const tub: WagonDef = {
      ...STARTER_WAGONS[0],
      id: 'tub',
      weight: 3,
      capacity: 10,
      accepts: ['stone', 'iron', 'coal'],
    };
    expect(loadedWeight(tub)).toBeCloseTo(27);
    expect(cannotHaul([eng('a', { power: 27 })], [tub])).toEqual([]);
    expect(cannotHaul([eng('a', { power: 26.9 })], [tub])).toEqual([
      'a (power 26.9) cannot haul tub at 27',
    ]);
    // the first wagon of the list it cannot haul is the one named
    const light = { ...tub, id: 'light', weight: 1, capacity: 1 };
    expect(cannotHaul([eng('a', { power: 10 })], [light, tub])).toEqual([
      'a (power 10) cannot haul tub at 27',
    ]);
  });

  it('are all in the recipe draws of the first age and craftable by a new game', () => {
    const { crafting, stock } = newGame();
    const pool = craftPool('loco', 0);
    for (const l of STARTER_LOCOS) {
      expect(pool, l.id).toContain(l.id);
      expect(crafting.knows(l.id), l.id).toBe(true);
      expect(crafting.canCraft(l.id, stock), l.id).toBe(true);
    }
  });

  it('each have an era line of their own, and the 490 names no year (its first is disputed)', () => {
    const eras = content.locomotives.map((l) => l.era);
    for (const l of STARTER_LOCOS) {
      expect(l.era.trim().length, l.id).toBeGreaterThan(0);
      expect(
        eras.filter((e) => e === l.era),
        `${l.id} shares its era line`,
      ).toHaveLength(1);
    }
    // Core checked the facts: two sources give 1905 and 1906 for the 490, one gives 1899 for the
    // field engine's works number; a year in the line must be one of the checked ones
    const years = (id: string) => locoDef(id).era.match(/\b(?:1[89]|20)\d{2}\b/g) ?? [];
    expect(years('mav490')).toEqual([]);
    expect(years('orenstein_koppel')).toEqual(['1899']);
  });

  describe('as trains', () => {
    /** A train of this one engine, its tanks filled from `pile` the way a depot fills them. */
    const filled = (def: LocoDef, pile: Store, uid = 1) => {
      const train = new Train([{ uid, level: 1, def }]);
      train.refuel(pile, { fuel: true, water: true });
      return train;
    };
    /** The cargo a wagon takes that weighs most a unit, so fills it to the most tonnes. */
    const heaviestCargo = (w: WagonDef) =>
      [...w.accepts!].sort((a, b) => cargoDef(b).weight - cargoDef(a).weight)[0];

    it('fill every tank of every copy from the start stock, one train after another', () => {
      const copies = content.crafting.starterCopies.loco;
      const sumCoal = copies * STARTER_LOCOS.reduce((n, l) => n + (l.fuelCap ?? 0), 0);
      const fillAll = (coal: number) => {
        // coal and water alone: wood in the stock would make up a shortfall at half a unit each
        const pile = pileOf({ coal, water: startStock().water });
        const short: string[] = [];
        let uid = 0;
        for (let copy = 1; copy <= copies; copy++)
          for (const def of STARTER_LOCOS) {
            const t = filled(def, pile, ++uid);
            expect(t.coalCap, def.id).toBeGreaterThan(0);
            if (t.coal < t.coalCap - 1e-6) short.push(`${def.id} copy ${copy}: coal`);
            if (t.water < t.waterCap - 1e-6) short.push(`${def.id} copy ${copy}: water`);
          }
        return short;
      };
      expect(fillAll(startStock().coal)).toEqual([]);
      // the check can fail: one unit of coal short of every tank and the last one is not full
      expect(fillAll(sumCoal - 1)).toHaveLength(1);
    });

    it("carry 400 tiles or more on full tanks by the train's own count of its range", () => {
      const pile = pileOf({ coal: 1e5, water: 1e5 });
      for (const def of STARTER_LOCOS) {
        const t = filled(def, pile);
        // the content's two ratios, and the train's: the lesser of what fuel and water last for
        const byContent = Math.min(
          def.fuelCap! / def.fuelPerTile!,
          def.waterCap! / def.waterPerTile!,
        );
        expect(t.rangeTiles, def.id).toBeCloseTo(byContent, 6);
        expect(t.rangeTiles, def.id).toBeGreaterThanOrEqual(400);
      }
    });

    it('are not overweight with one wagon of any starter type full of its heaviest cargo', () => {
      for (const def of STARTER_LOCOS)
        for (const w of content.wagons.filter((x) => x.starter)) {
          const t = new Train([{ uid: 1, level: 1, def }]);
          t.wagons = [
            { uid: 2, def: w, level: 1, cargo: heaviestCargo(w), amount: w.capacity, origin: null },
          ];
          const what = `${def.id} with ${w.id} full of ${heaviestCargo(w)}`;
          // the helper the content checks use agrees with the train, and the train's own test for
          // `overweight` (weight above power) does not trip
          expect(t.weight, what).toBeCloseTo(loadedWeight(w), 6);
          expect(t.weight, what).toBeLessThanOrEqual(t.power + 1e-6);
        }
    });

    it('stand in for the narrow gauge by the inventory first and the first starter after', () => {
      const w = newGame();
      const narrowStarters = STARTER_LOCOS.filter((l) => gaugeOf(l) === 'narrow');
      // nothing owned: the first starter of the gauge, so the Rocket has to stay first in the file
      w.inventory.load({ items: [], nextUid: 1 });
      expect(w.fleet.probeLoco('narrow').def.id).toBe(narrowStarters[0].id);
      expect(narrowStarters[0].id).toBe('rocket');
      // only the last starter owned: the stand-in is the engine the player has
      const last = narrowStarters[narrowStarters.length - 1];
      w.inventory.add(last.id, 0);
      expect(w.fleet.probeLoco('narrow').def.id).toBe(last.id);
    });

    it.each(STARTER_LOCOS.map((l) => l.id))(
      'survive a save and a load with the %s running: the train comes back as it went',
      (id) => {
        const w = newGame(startStock());
        const { near, far } = narrowLine(w);
        const loco = w.inventory.free('loco').find((i) => i.defId === id)!;
        const wagon = w.inventory
          .free('wagon')
          .find((i) => gaugeOf(itemDef(i.defId)) === 'narrow' && itemDef(i.defId).size !== 'tiny')!;
        const made = w.fleet.create([loco.uid], [wagon.uid], [near.id, far.id]);
        expect(made).toBeInstanceOf(Train);
        for (let i = 0; i < 400; i++) w.fleet.tick(0.05, i * 0.05);
        const train = made as Train;
        expect(train.distance).toBeGreaterThan(0);
        const saved = JSON.parse(JSON.stringify(train.toJSON())) as ReturnType<Train['toJSON']>;
        resetTrainIds(1);
        const back = Train.fromJSON(structuredClone(saved), w.track);
        expect(back.locos.map((l) => l.def.id)).toEqual([id]);
        expect(back.toJSON()).toEqual(saved);
      },
    );
  });

  it('are left out of a game saved with the Rocket alone, and still found in its recipe draws', () => {
    // the kit before this change: the Rocket and the starter wagons, as the game saved them
    const old = newGame();
    old.inventory.load({ items: [], nextUid: 1 });
    old.inventory.add('rocket', 0);
    for (const wg of content.wagons.filter((x) => x.starter))
      for (let i = 0; i < content.crafting.starterCopies.wagon; i++) old.inventory.add(wg.id, 0);
    const saved = JSON.parse(
      JSON.stringify({
        inventory: old.inventory.toJSON(),
        crafting: { ...old.crafting.toJSON(), recipes: old.inventory.ownedDefs() },
      }),
    ) as { inventory: ReturnType<Inventory['toJSON']>; crafting: ReturnType<Crafting['toJSON']> };

    // loaded the way Game.applySave does, into a game that was seeded with the new kit first
    const w = newGame();
    w.inventory.load(structuredClone(saved.inventory));
    w.crafting.load(structuredClone(saved.crafting));
    expect(w.inventory.toJSON()).toEqual(saved.inventory);
    expect(w.inventory.free('loco').map((i) => i.defId)).toEqual(['rocket']);
    expect([...w.crafting.recipes].sort()).toEqual([...saved.crafting.recipes].sort());
    const newcomers = STARTER_LOCOS.filter((l) => l.id !== 'rocket');
    expect(newcomers.length).toBeGreaterThan(0);
    for (const { id } of newcomers) {
      expect(w.inventory.count(id), id).toBe(0);
      expect(w.crafting.knows(id), id).toBe(false);
    }

    // the recipe draws of the first age do offer them, and keeping one lets the workshop build it
    w.crafting.economy.money = 1e9;
    const offered = new Set<string>();
    for (let n = 0; n < 300 && offered.size < newcomers.length; n++) {
      const draw = w.crafting.draw('loco', 0);
      expect(draw, `draw ${n}`).not.toBeNull();
      const find = draw!.cards.find((id) => newcomers.some((l) => l.id === id) && !offered.has(id));
      if (find) offered.add(find);
      const kept = find ?? draw!.cards[0];
      expect(w.crafting.choose(kept, w.stock)?.defId, `draw ${n}`).toBe(kept);
    }
    expect([...offered].sort()).toEqual(newcomers.map((l) => l.id).sort());
    for (const { id } of newcomers) expect(w.crafting.canCraft(id, w.stock), id).toBe(true);
  });
});

/** Every gate of the depot carries a straight of the depot's gauge that runs into the shed. */
function expectServed(w: ReturnType<typeof newGame>, depot: Station) {
  const cls = gaugeLine(depot.def.gauge ?? 'regular');
  for (const g of depot.gateTiles()) {
    const p = w.track.get(g.x, g.y);
    expect(p, `gate ${g.x},${g.y}`).toBeDefined();
    expect(p!.kind).toBe('straight');
    expect(p!.cls).toBe(cls);
    const toShed =
      depot.rot % 2 === 0 ? (g.x < depot.x ? Dir.E : Dir.W) : g.y < depot.y ? Dir.S : Dir.N;
    expect(p!.links.flat()).toContain(toShed);
  }
}

describe('the depot a new game starts with', () => {
  /**
   * The depot and gate track a game is granted (`grantDepot`): the kind at (20, 20) turned to
   * `rot`, a straight of the depot's gauge across each gate, as `stationGates` foresaw them.
   */
  function firstDepot(w: ReturnType<typeof newGame>, defId: string, rot: number) {
    const gates = stationGates(defId, 20, 20, rot);
    const depot = grantDepot(w.builder, defId, 20, 20, rot)!;
    expect(depot).not.toBeNull();
    stocked(w, depot);
    const cls = gaugeLine(depot.def.gauge ?? 'regular');
    return { depot, gates, cls };
  }

  it.each([
    ['narrow_depot', 0],
    ['narrow_depot', 1],
    ['narrow_depot', 2],
    ['narrow_depot', 3],
    ['depot', 0],
    ['depot', 1],
    ['depot', 2],
    ['depot', 3],
  ])('%s at rot %i: gate track at each end of every track through the shed', (defId, rot) => {
    const w = newGame();
    const { depot, gates, cls } = firstDepot(w, defId, rot);
    expect(depot.rot).toBe(rot);
    // the tiles foreseen before placing are the placed depot's own gates
    expect(depot.gateTiles()).toEqual(gates);
    expect(gates.length).toBe(2 * depot.platforms);
    for (const g of gates) {
      expect(depot.covers(g.x, g.y)).toBe(false);
      // gates lie along the shed's tracks: west and east at rot 0 and 2, north and south at 1 and 3
      const toShed =
        rot % 2 === 0 ? (g.x < depot.x ? Dir.E : Dir.W) : g.y < depot.y ? Dir.S : Dir.N;
      expect(depot.covers(g.x + DIR_DX[toShed], g.y + DIR_DY[toShed])).toBe(true);
      // and the straight laid across the gate runs into the shed
      expect(w.track.get(g.x, g.y)!.links.flat()).toContain(toShed);
    }
    expect([...w.fleet.depotClasses(depot)]).toEqual([cls]);
    expect(w.builder.platformTiles(depot)).toEqual(gates);
  });

  it('builds every model a new game owns, engines and wagons, the Rocket first', () => {
    // the kind a new game asks for under default rules
    const w = newGame();
    const { depot } = firstDepot(w, startDepotKind(), 0);
    const owned = w.inventory.ownedDefs();
    expect(owned.length).toBeGreaterThan(0);
    for (const id of owned) expect(w.fleet.modelDeployReason(itemDef(id), depot), id).toBeNull();
    const free = w.inventory.free('loco');
    const deployable = free.filter((i) => !w.fleet.modelDeployReason(locoDef(i.defId), depot));
    expect(deployable[0].defId).toBe('rocket');
  });

  // the depot's word for each model alone, borne out by trains: every starter wagon behind every
  // starter engine is accepted there (gauge, weight), rolls out and runs from one stop on to the
  // next on the start stock alone
  it.each(
    STARTER_LOCOS.flatMap((l) =>
      content.wagons.filter((wg) => wg.starter).map((wg) => [l.id, wg.id]),
    ),
  )('rolls a %s pulling a %s out of it, past two stops on the start stock', (locoId, wagonId) => {
    const w = newGame(startStock());
    const { depot, cls } = firstDepot(w, startDepotKind(), 0);
    // the player's first line, in the depot's gauge: on east from the east gate, two quarries
    const ew = [0, 1].find((r) => makePiece('straight', r, cls).links[0].includes(Dir.E))!;
    for (let x = 23; x <= 44; x++) w.track.place(x, 20, 'straight', ew, cls);
    const near = w.builder.placeStation(30, 21, 'quarry', 0)!;
    const far = w.builder.placeStation(40, 21, 'quarry', 0)!;
    const loco = w.inventory.free('loco').find((i) => i.defId === locoId)!;
    const wagon = w.inventory.free('wagon').find((i) => i.defId === wagonId)!;
    const pair = `${locoId} + ${wagonId}`;
    const t = w.fleet.create(
      [loco.uid],
      [wagon.uid],
      [near.id, far.id],
      undefined,
      'schedule',
      depot.id,
    );
    expect(t, pair).toBeInstanceOf(Train);
    const train = t as Train;
    expect([loco.assigned, wagon.assigned], pair).toEqual([train.id, train.id]);
    const reached: Station[] = [];
    w.fleet.onArrive = (_t, s) => void reached.push(s);
    for (let i = 0; i < 20000 && reached.length < 2; i++) w.fleet.tick(0.05, i * 0.05);
    // both stops, so the train left the first one again under its own power
    const stops = reached.map((s) => s.id);
    expect(stops, pair).toEqual([near.id, far.id]);
    expect(train.state, pair).not.toBe('noFuel');
  });

  it('rolls the Rocket out of its east gate once a line leads on from there', () => {
    const w = newGame();
    const { depot } = firstDepot(w, 'narrow_depot', 0);
    // the player's first line: on east from the east gate, two quarries beside it
    const ew = [0, 1].find((r) => makePiece('straight', r, 'narrow').links[0].includes(Dir.E))!;
    for (let x = 23; x <= 44; x++) w.track.place(x, 20, 'straight', ew, 'narrow');
    w.builder.placeStation(30, 21, 'quarry', 0);
    w.builder.placeStation(40, 21, 'quarry', 0);
    const rocket = w.inventory.free('loco').find((i) => i.defId === 'rocket')!;
    const spawn = w.fleet.previewSpawn([rocket.uid], [], depot.id);
    expect(spawn.reason).toBeNull();
    expect(spawn.depot).toBe(depot);
    expect(spawn.gate).toEqual({ x: 22, y: 20 });
    const t = w.fleet.create([rocket.uid], [], [], undefined, 'schedule', depot.id);
    expect(t).toBeInstanceOf(Train);
    expect((t as Train).locos.map((l) => l.def.id)).toEqual(['rocket']);
    expect(w.track.get(22, 20)!.cls).toBe('narrow');
  });

  it('is a regular depot with regular gate track when an older save gets one on load', () => {
    const w = newGame();
    const { depot, cls } = firstDepot(w, 'depot', 0);
    expect(cls).toBe('branch');
    expect(w.fleet.modelDeployReason(locoDef('adler'), depot)).toBeNull();
    expect(w.fleet.modelDeployReason(locoDef('rocket'), depot)).toBe(
      STR.fleet.wrongDepot(depot.name),
    );
  });
});

/** Is track of line `cls` in the gauge of depot `defId`: Narrow Gauge, or a standard line? */
const inDepotGauge = (defId: string, cls: TrackClass) =>
  (cls === 'narrow') === (stationDef(defId).gauge === 'narrow');

describe('the site a game is granted its depot on', () => {
  /** Ground the hill allows only on `ok` tiles: elsewhere neither a shed nor a straight stands. */
  function onlyOn(w: ReturnType<typeof newGame>, ok: (x: number, y: number) => boolean) {
    w.builder.groundCheck = (x, y) => ok(x, y);
  }

  it('is the middle of the start chunk when the ground there takes it', () => {
    const w = newGame();
    const c = startDepotCentre(w.map);
    const d = ensureStartDepot(w.builder, 'narrow_depot')!;
    expect([d.x, d.y, d.rot]).toEqual([c.x - 1, c.y - 1, 0]);
    expectServed(w, d);
  });

  it.each(['narrow_depot', 'depot'])(
    '%s: a first site on sloping ground is skipped and the search goes on',
    (defId) => {
      const w = newGame();
      const c = startDepotCentre(w.map);
      // a tile of the first site in both turns, where a straight could climb but a shed not stand
      const slope = { x: c.x - 1, y: c.y - 1 };
      w.builder.groundCheck = (x, y, need) => need !== 'level' || x !== slope.x || y !== slope.y;
      for (const rot of [0, 1])
        expect(depotSiteBlocked(w.builder, defId, slope.x, slope.y, rot)).toBe(STR.build.notLevel);
      const d = ensureStartDepot(w.builder, defId);
      expect(d).not.toBeNull();
      expect(w.builder.depots()).toEqual([d]);
      expect(d!.covers(slope.x, slope.y)).toBe(false);
      expectServed(w, d!);
    },
  );

  it.each(['narrow_depot', 'depot'])(
    '%s: a site counts only when every gate takes its straight',
    (defId) => {
      const w = newGame();
      const c = startDepotCentre(w.map);
      const x = c.x - 1,
        y = c.y - 1;
      // the first gate of the first site is too steep for any rail
      const steep = stationGates(defId, x, y, 0)[0];
      onlyOn(w, (tx, ty) => tx !== steep.x || ty !== steep.y);
      expect(depotSiteBlocked(w.builder, defId, x, y, 0)).toBe(STR.build.tooSteep);
      const d = ensureStartDepot(w.builder, defId)!;
      expect(w.builder.depots()).toEqual([d]);
      expect(w.track.has(steep.x, steep.y)).toBe(false);
      expectServed(w, d);
      // the next try is the same corner turned, its gates north and south, clear of the steep tile
      expect([d.x, d.y, d.rot]).toEqual([x, y, 1]);
    },
  );

  it('takes the one site that works at the edge of its reach, and none beyond it', () => {
    // level ground for exactly one narrow depot and its two gates, `reach` tiles east
    const island = (reach: number) => {
      const w = newGame();
      const c = startDepotCentre(w.map);
      const x = c.x + reach - 1,
        y = c.y - 1;
      onlyOn(w, (tx, ty) => ty === y && tx >= x - 1 && tx <= x + 2);
      return { w, x, y, d: ensureStartDepot(w.builder, 'narrow_depot') };
    };
    const edge = island(START_DEPOT_REACH);
    expect(edge.d).not.toBeNull();
    expect([edge.d!.x, edge.d!.y, edge.d!.rot]).toEqual([edge.x, edge.y, 0]);
    expect(edge.w.builder.depots()).toEqual([edge.d]);
    expectServed(edge.w, edge.d!);

    // one tile further no site works: nothing is granted and nothing is left behind
    const beyond = island(START_DEPOT_REACH + 1);
    expect(beyond.d).toBeNull();
    expect(beyond.w.builder.stations).toEqual([]);
    expect(beyond.w.track.pieces.size).toBe(0);
  });

  it.each([
    ['narrow_depot', 'branch'],
    ['narrow_depot', 'main'],
    ['depot', 'narrow'],
  ] as const)(
    '%s: a %s straight on a gate of the first site gets the site skipped, and stays as it was',
    (defId, wrong) => {
      const w = newGame();
      const c = startDepotCentre(w.map);
      const x = c.x - 1,
        y = c.y - 1;
      const gate = stationGates(defId, x, y, 0)[0];
      const ew = [0, 1].find((r) => makePiece('straight', r, wrong).links[0].includes(Dir.E))!;
      w.track.place(gate.x, gate.y, 'straight', ew, wrong);
      const piece = w.track.get(gate.x, gate.y);
      expect(depotSiteBlocked(w.builder, defId, x, y, 0)).toBe(STR.build.gaugeBreak);
      const d = ensureStartDepot(w.builder, defId)!;
      expect(d).not.toBeNull();
      expect(w.builder.depots()).toEqual([d]);
      // the next try is the same corner turned, its gates clear of the piece
      expect([d.x, d.y, d.rot]).toEqual([x, y, 1]);
      expect(w.track.get(gate.x, gate.y)).toBe(piece);
      const classes = [...w.fleet.depotClasses(d)];
      expect(classes.length).toBeGreaterThan(0);
      for (const cls of classes) expect(inDepotGauge(defId, cls), cls).toBe(true);
    },
  );

  it.each([
    ['narrow_depot', 'narrow'],
    ['depot', 'branch'],
    ['depot', 'main'],
  ] as const)(
    '%s: a %s straight already on a gate is kept as it is, and the site is taken',
    (defId, own) => {
      const w = newGame();
      const c = startDepotCentre(w.map);
      const x = c.x - 1,
        y = c.y - 1;
      const gate = stationGates(defId, x, y, 0)[0];
      const ew = [0, 1].find((r) => makePiece('straight', r, own).links[0].includes(Dir.E))!;
      w.track.place(gate.x, gate.y, 'straight', ew, own);
      const piece = w.track.get(gate.x, gate.y);
      expect(depotSiteBlocked(w.builder, defId, x, y, 0)).toBeNull();
      const d = ensureStartDepot(w.builder, defId)!;
      expect([d.x, d.y, d.rot]).toEqual([x, y, 0]);
      expect(w.track.get(gate.x, gate.y)).toBe(piece);
      // every other gate was bare and took the gate straight, of the depot's line
      const line = gaugeLine(d.def.gauge ?? 'regular');
      for (const g of d.gateTiles()) {
        if (g.x === gate.x && g.y === gate.y) continue;
        expect([w.track.get(g.x, g.y)!.kind, w.track.get(g.x, g.y)!.cls]).toEqual([
          'straight',
          line,
        ]);
      }
      expect(w.track.pieces.size).toBe(d.gateTiles().length);
    },
  );

  it.each(['narrow_depot', 'depot'])(
    '%s: a crossing on a gate counts by the axis that runs into the shed, not by its other axis',
    (defId) => {
      // the mixed crossings of the build list, and one of two standard lines laid straight into the
      // graph (no piece of the list carries Main Line yet)
      const mixed = [
        ...TRACK_ITEMS.filter((i) => i.kind === 'crossing' && i.cls !== i.cls2),
        { kind: 'crossing', cls: 'branch', cls2: 'main' } as const,
      ];
      // each class pair in both orders: which axis is which is the crossing's turn to settle
      const pairs = mixed.flatMap((i) => [
        [i.cls, i.cls2!],
        [i.cls2!, i.cls],
      ]) as [TrackClass, TrackClass][];
      expect(pairs.length).toBeGreaterThan(2);
      const verdicts = new Set<boolean>();
      for (const siteRot of [0, 1])
        for (const crossRot of [0, 1])
          for (const [cls, cls2] of pairs) {
            const label = `${defId} r${siteRot} with a ${cls}/${cls2} crossing at r${crossRot}`;
            const gate = stationGates(defId, 20, 20, siteRot)[0];
            // a crossing at r0 runs its first class north-south and its second east-west; at r1 the
            // other way round. A shed at r0 is entered east-west, at r1 north-south
            const eastWest = siteRot % 2 === 0;
            const into = (eastWest ? crossRot === 0 : crossRot === 1) ? cls2 : cls;
            const accepted = inDepotGauge(defId, into);
            verdicts.add(accepted);

            // the class of that gate as a shed standing there reads it
            const probe = newGame();
            probe.track.place(gate.x, gate.y, 'crossing', crossRot, cls, cls2);
            const shed = probe.builder.placeStation(20, 20, defId, siteRot)!;
            expect([...probe.fleet.depotClasses(shed)], label).toEqual([into]);

            const w = newGame();
            w.track.place(gate.x, gate.y, 'crossing', crossRot, cls, cls2);
            const crossing = w.track.get(gate.x, gate.y);
            const why = depotSiteBlocked(w.builder, defId, 20, 20, siteRot);
            expect(why, label).toBe(accepted ? null : STR.build.gaugeBreak);
            const d = grantDepot(w.builder, defId, 20, 20, siteRot);
            expect(!!d, label).toBe(accepted);
            expect(w.track.get(gate.x, gate.y), `${label}: the crossing is as it was`).toBe(
              crossing,
            );
            if (d) {
              for (const k of w.fleet.depotClasses(d))
                expect(inDepotGauge(defId, k), label).toBe(true);
            } else {
              expect(w.builder.stations, label).toEqual([]);
              expect(w.track.pieces.size, label).toBe(1);
            }
          }
      // the same crossings are taken one way and refused the other
      expect([...verdicts].sort()).toEqual([false, true]);
    },
  );

  it.each(['branch', 'main'] as const)(
    'narrow_depot: the unused tile of a %s curve on a gate is other-gauge track',
    (cls) => {
      let tried = 0;
      for (let rot = 0; rot < 4; rot++) {
        const probe = new TrackGraph(64, 64);
        const tiles = probe.place(20, 20, 'curve', rot, cls);
        // the 2x2 piece's one tile that links nowhere
        const idle = tiles.find((t) => probe.get(t.x, t.y)!.links.length === 0)!;
        expect(idle, `r${rot}`).toBeDefined();
        // sheds with that tile for a gate: its east or west gate at r0, its north or south at r1
        const sites = [
          [idle.x + 1, idle.y, 0],
          [idle.x - 2, idle.y, 0],
          [idle.x, idle.y + 1, 1],
          [idle.x, idle.y - 2, 1],
        ];
        for (const [x, y, siteRot] of sites) {
          const shed = stationFootprint('narrow_depot', x, y, siteRot);
          if (shed.some((t) => tiles.some((m) => m.x === t.x && m.y === t.y))) continue;
          const label = `${cls} curve r${rot}, shed at ${x},${y} r${siteRot}`;
          const w = newGame();
          // without the curve the site is clear
          expect(depotSiteBlocked(w.builder, 'narrow_depot', x, y, siteRot), label).toBeNull();
          w.track.place(20, 20, 'curve', rot, cls);
          const gates = stationGates('narrow_depot', x, y, siteRot);
          expect(
            gates.some((g) => g.x === idle.x && g.y === idle.y),
            label,
          ).toBe(true);
          expect(depotSiteBlocked(w.builder, 'narrow_depot', x, y, siteRot), label).toBe(
            STR.build.gaugeBreak,
          );
          expect(grantDepot(w.builder, 'narrow_depot', x, y, siteRot), label).toBeNull();
          expect(w.builder.stations, label).toEqual([]);
          expect(w.track.pieces.size, label).toBe(tiles.length);
          tried++;
        }
      }
      // among them the curve at r0 anchored two tiles west of the shed, its unused tile on the gate
      expect(tried).toBeGreaterThanOrEqual(4);
    },
  );

  it.each([
    ['narrow_depot', 'branch'],
    ['depot', 'narrow'],
  ] as const)(
    '%s: finds no site when the only one in reach has a %s straight on a gate, and leaves nothing',
    (defId, wrong) => {
      // level ground for exactly one depot and its gates, `reach` tiles east: a narrow shed on one
      // row, a regular one on two
      const rows = defId === 'narrow_depot' ? 1 : 2;
      const island = (laid: boolean) => {
        const w = newGame();
        w.builder.free = false;
        const c = startDepotCentre(w.map);
        const x = c.x + START_DEPOT_REACH - 1,
          y = c.y - 1;
        onlyOn(w, (tx, ty) => ty >= y && ty < y + rows && tx >= x - 1 && tx <= x + 2);
        const ew = [0, 1].find((r) => makePiece('straight', r, wrong).links[0].includes(Dir.E))!;
        if (laid) w.track.place(x - 1, y, 'straight', ew, wrong);
        return { w, x, y, d: ensureStartDepot(w.builder, defId) };
      };
      // without the wrong piece the site works, so the island is the one site
      const open = island(false);
      expect([open.d?.x, open.d?.y, open.d?.rot]).toEqual([open.x, open.y, 0]);
      expect(open.w.builder.free).toBe(false);

      const shut = island(true);
      expect(shut.d).toBeNull();
      expect(shut.w.builder.stations).toEqual([]);
      expect(shut.w.track.pieces.size).toBe(1);
      expect(shut.w.track.get(shut.x - 1, shut.y)!.cls).toBe(wrong);
      expect(shut.w.builder.free).toBe(false);
    },
  );

  it('stands only on ground the player owns, though granting lifts the chunk lock', () => {
    const w = newGame();
    w.builder.free = false;
    // own the start chunk alone, where the ground takes nothing; the level chunks beside it are
    // within reach but not the player's
    w.builder.regions.unlocked = w.builder.regions.unlocked.map((_, i) => i === 0);
    onlyOn(w, (x, y) => !w.builder.regions.isTileUnlocked(x, y));
    expect(ensureStartDepot(w.builder, 'narrow_depot')).toBeNull();
    expect(w.builder.stations).toEqual([]);
    expect(w.track.pieces.size).toBe(0);
    expect(w.builder.free).toBe(false);
  });

  it.each([
    [1, 'narrow_depot', 'narrow', stationDef('narrow_depot').name],
    [0, 'depot', 'regular', STR.station.depotName],
  ])(
    'is what a new game asks for: narrowUnlocked %i gives a %s with %s gate track',
    (narrow, kind, gauge, name) => {
      rules.narrowUnlocked = narrow;
      const w = newGame();
      w.builder.free = false;
      expect(startDepotKind()).toBe(kind);
      const d = ensureStartDepot(w.builder, startDepotKind())!;
      expect(d.def.id).toBe(kind);
      expect(d.def.gauge ?? 'regular').toBe(gauge);
      expect(d.name).toBe(name);
      expectServed(w, d);
      expect(w.builder.free).toBe(false);
    },
  );

  it('is a regular depot for an older save without one, and a game that has one keeps it', () => {
    const w = newGame();
    const d = ensureStartDepot(w.builder, 'depot')!;
    expect(d.def.id).toBe('depot');
    expect(d.name).toBe(STR.station.depotName);
    expectServed(w, d);
    const track = w.track.pieces.size;
    expect(ensureStartDepot(w.builder, 'narrow_depot')).toBe(d);
    expect(w.builder.depots()).toEqual([d]);
    expect(w.track.pieces.size).toBe(track);
  });
});

describe('a depot granted at any of the four turns', () => {
  /** Tiles near a site, as offsets from its corner: the shed's and its gates' tiles, and around. */
  type Near = [dx: number, dy: number];
  /** A piece of track already laid, at an offset from the site's corner. */
  interface Laid {
    dx: number;
    dy: number;
    kind: 'straight' | 'crossing';
    rot: number;
    cls: TrackClass;
    /** a crossing's second axis */
    cls2?: TrackClass;
  }
  /** A depot site and what lies around it. */
  interface Site {
    defId: string;
    x: number;
    y: number;
    rot: number;
    /** too steep for anything */
    steep: Near[];
    /** too steep for a shed, level enough for a straight */
    slope: Near[];
    water: Near[];
    /** track already laid: straights of any class, crossings with a class per axis */
    rails: Laid[];
  }
  const CLASSES: TrackClass[] = ['narrow', 'branch', 'main'];
  const CROSSINGS = TRACK_ITEMS.filter((i) => i.kind === 'crossing');
  function genSite(rng: Rng): Site {
    const near = (): Near => [rng.int(-2, 3), rng.int(-2, 3)];
    const some = <T>(max: number, make: () => T) =>
      Array.from({ length: rng.chance(0.3) ? 0 : rng.int(1, max) }, make);
    const defId = rng.pick(['depot', 'narrow_depot']);
    const x = rng.int(18, 22),
      y = rng.int(18, 22),
      rot = rng.int(0, 3);
    const gates = stationGates(defId, x, y, rot);
    const laid = (): Laid => {
      // half of the pieces lie on a gate: those are the tiles a depot's gauge is judged on
      let at = near();
      if (rng.chance(0.5)) {
        const g = rng.pick(gates);
        at = [g.x - x, g.y - y];
      }
      if (rng.chance(0.3)) {
        const item = rng.pick(CROSSINGS);
        const swap = rng.chance(0.5);
        const [cls, cls2] = [item.cls, item.cls2 ?? item.cls];
        return {
          dx: at[0],
          dy: at[1],
          kind: 'crossing',
          rot: rng.int(0, 1),
          cls: swap ? cls2 : cls,
          cls2: swap ? cls : cls2,
        };
      }
      return {
        dx: at[0],
        dy: at[1],
        kind: 'straight',
        rot: rng.int(0, 1),
        cls: rng.pick(CLASSES),
      };
    };
    return {
      defId,
      x,
      y,
      rot,
      steep: some(2, near),
      slope: some(2, near),
      water: some(2, near),
      rails: some(3, laid),
    };
  }
  function* shrinkSite(s: Site): Iterable<Site> {
    for (const key of ['steep', 'slope', 'water', 'rails'] as const)
      for (const shorter of shrinkArray<unknown>(s[key])) yield { ...s, [key]: shorter };
    for (const rot of shrinkInt(s.rot)) yield { ...s, rot };
  }
  /** A new game with the site's surroundings made, the same way each time it is asked for. */
  function siteWorld(s: Site) {
    const w = newGame();
    const at = (list: Near[], x: number, y: number) =>
      list.some(([dx, dy]) => s.x + dx === x && s.y + dy === y);
    w.builder.groundCheck = (x, y, need) =>
      !at(s.steep, x, y) && (need !== 'level' || !at(s.slope, x, y));
    for (const [dx, dy] of s.water) w.map.terrain[(s.y + dy) * w.map.w + s.x + dx] = Terrain.Water;
    for (const r of s.rails) w.track.place(s.x + r.dx, s.y + r.dy, r.kind, r.rot, r.cls, r.cls2);
    return w;
  }
  /** Every piece of track in a world, as text in tile order. */
  const pieces = (w: ReturnType<typeof newGame>) =>
    [...w.track.pieces.entries()]
      .sort(([a], [b]) => a - b)
      .map(([k, p]) => `${k}:${p.kind}/${p.rot}/${p.cls}/${p.cls2 ?? '-'}`);

  it('is judged, built and given gate track as a half turn on, along the same axis', () => {
    // what the generator's sites come to, so the property cannot pass by never meeting the cases
    const seen = { gaugeBreak: 0, onGate: 0, keptOwn: 0, bare: 0 };
    forAll(
      genSite,
      (s) => {
        const other = (s.rot + 2) % 4;
        const a = siteWorld(s);
        const b = siteWorld(s);
        const before = pieces(a);
        // the very pieces that stood before: nothing may replace or alter them
        const standing = new Map(a.track.pieces);
        const blocked = depotSiteBlocked(a.builder, s.defId, s.x, s.y, s.rot);
        expect(depotSiteBlocked(a.builder, s.defId, s.x, s.y, other), 'the site').toBe(blocked);
        const da = grantDepot(a.builder, s.defId, s.x, s.y, s.rot);
        const db = grantDepot(b.builder, s.defId, s.x, s.y, other);
        expect(!!da, `granted as judged (${blocked ?? 'clear'})`).toBe(blocked === null);
        expect(!!db, `granted at r${other} as at r${s.rot}`).toBe(!!da);
        if (blocked === STR.build.gaugeBreak) seen.gaugeBreak++;
        // the gauge rule alone, on the pieces that lie on a gate (nothing off the gates, so no
        // neighbour can refuse the straight laid across a bare one): the site is refused for the
        // gauge exactly when a shed standing there meets a class of the other one, as the fleet
        // reads it
        const gates = stationGates(s.defId, s.x, s.y, s.rot);
        const onGates = {
          ...s,
          rails: s.rails.filter((r) => gates.some((g) => g.x === s.x + r.dx && g.y === s.y + r.dy)),
        };
        const alone = siteWorld(onGates);
        const why = depotSiteBlocked(alone.builder, s.defId, s.x, s.y, s.rot);
        if (why === null || why === STR.build.gaugeBreak) {
          const stood = alone.builder.placeStation(s.x, s.y, s.defId, s.rot);
          expect(stood, 'the shed of a site judged on its gauge stands').not.toBeNull();
          const classes = [...alone.fleet.depotClasses(stood!)];
          const wrong = classes.some((k) => !inDepotGauge(s.defId, k));
          expect(why === STR.build.gaugeBreak, `refused as gate classes [${classes}] say`).toBe(
            wrong,
          );
          if (wrong) seen.onGate++;
        }
        // nothing of the track that stood is replaced or altered, granted or not
        for (const [k, p] of standing) expect(a.track.pieces.get(k), `tile ${k}`).toBe(p);
        if (!da || !db) {
          // nothing left behind
          expect(a.builder.stations).toEqual([]);
          expect(pieces(a)).toEqual(before);
          return;
        }
        expect([da.rot, db.rot], 'the turns kept').toEqual([s.rot, other]);
        expect(db.footprint()).toEqual(da.footprint());
        expect(db.gateTiles()).toEqual(da.gateTiles());
        expect(pieces(b), 'the same track laid').toEqual(pieces(a));
        // every gate rolls trains of the depot's gauge out: the class a train meets, read by the
        // fleet itself, is never of the other gauge
        const classes = [...a.fleet.depotClasses(da)];
        expect(classes.length, 'a gate to roll out of').toBeGreaterThan(0);
        for (const k of classes) expect(inDepotGauge(s.defId, k), `gate class ${k}`).toBe(true);
        // a gate with track already keeps that piece; a bare one has a straight of the shed's
        // gauge running into the shed
        const hadTrack = (g: { x: number; y: number }) => standing.has(a.track.key(g.x, g.y));
        const had = da.gateTiles().filter(hadTrack);
        for (const g of da.gateTiles()) {
          if (hadTrack(g)) continue;
          const p = a.track.get(g.x, g.y);
          expect(p?.kind, `gate ${g.x},${g.y}`).toBe('straight');
          expect(p!.cls, `gate ${g.x},${g.y}`).toBe(gaugeLine(da.def.gauge ?? 'regular'));
          const toShed =
            s.rot % 2 === 0 ? (g.x < da.x ? Dir.E : Dir.W) : g.y < da.y ? Dir.S : Dir.N;
          expect(p!.links.flat(), `gate ${g.x},${g.y} runs into the shed`).toContain(toShed);
        }
        if (had.length) seen.keptOwn++;
        else seen.bare++;
      },
      { shrink: shrinkSite },
    );
    expect(seen.gaugeBreak, 'sites refused with the gauge reason').toBeGreaterThan(0);
    expect(seen.onGate, 'sites refused for the other gauge on a gate').toBeGreaterThan(0);
    expect(seen.keptOwn, 'sites granted over track of its own gauge on a gate').toBeGreaterThan(0);
    expect(seen.bare, 'sites granted with every gate bare').toBeGreaterThan(0);
  });
});

describe('the engines the kit no longer hands out', () => {
  /** Withdrawn from the game (decision retire-adler-john-bull): owned copies keep running. */
  const RETIRED_KIT = ['adler', 'john_bull'];
  /**
   * Kept as Diesel-age recipe finds only, in no banner (decision startkit-diesels, "Keep them,
   * Diesel-age crafting only"). Putting one in a banner is a change to that decision.
   */
  const DIESEL_FINDS = ['bm50', 'muki', 'mk48'];
  /** Every banner pool as shipped, and as a pull reads it. */
  const pools = () =>
    content.gacha.banners.flatMap((b) => [
      { banner: b.id, pool: b.pool },
      { banner: `${b.id} (as pulled)`, pool: bannerPool(b) },
    ]);

  it('stay in the game, and a new game hands out none of them', () => {
    const defined = content.locomotives.map((l) => l.id);
    const { inventory } = newGame();
    for (const id of FORMER_KIT) {
      expect(defined, id).toContain(id);
      expect(locoDef(id).id, id).toBe(id);
      expect(inventory.count(id), id).toBe(0);
    }
  });

  it('retire Adler and John Bull: flagged, in no banner pool and in no recipe pool', () => {
    for (const id of RETIRED_KIT) {
      expect(locoDef(id).retired, id).toBe(true);
      for (const { banner, pool } of pools()) expect(pool, `${banner}: ${id}`).not.toContain(id);
      for (const t of CRAFT_TIERS)
        expect(craftPool('loco', t), `age ${t}: ${id}`).not.toContain(id);
    }
  });

  it('keep BM-50, Muki and the Mk48 as Diesel-age recipe finds in no banner (startkit-diesels)', () => {
    for (const id of DIESEL_FINDS) {
      expect(locoDef(id).type, id).toBe('diesel');
      expect(locoDef(id).retired, id).toBeUndefined();
      expect(craftPool('loco', 1), id).toContain(id);
      for (const { banner, pool } of pools()) expect(pool, `${banner}: ${id}`).not.toContain(id);
    }
    // the guards drop a model for its flag alone: every diesel without it can be drawn
    for (const l of content.locomotives)
      if (l.type === 'diesel' && !l.retired) expect(craftPool('loco', 1), l.id).toContain(l.id);
  });

  it('let a Diesel-age recipe draw offer BM-50 and Muki, and the workshop build them', () => {
    const w = newGame();
    w.crafting.economy.money = 1e9;
    const finds = ['bm50', 'muki'];
    const offered = new Set<string>();
    for (let n = 0; n < 300 && offered.size < finds.length; n++) {
      const draw = w.crafting.draw('loco', 1);
      expect(draw, `draw ${n}`).not.toBeNull();
      const find = draw!.cards.find((id) => finds.includes(id) && !offered.has(id));
      if (find) offered.add(find);
      const kept = find ?? draw!.cards[0];
      expect(w.crafting.choose(kept, w.stock)?.defId, `draw ${n}`).toBe(kept);
      expect(w.crafting.knows(kept), kept).toBe(true);
    }
    expect([...offered].sort()).toEqual([...finds].sort());
    for (const id of finds) {
      const before = w.inventory.count(id);
      let built = 0;
      for (let n = 0; n < 20 && !built; n++) {
        const r = w.crafting.craft(id, w.stock, 0);
        expect(r, id).not.toBeNull();
        if (r!.ok) built++;
      }
      expect(built, id).toBe(1);
      expect(w.inventory.count(id), id).toBe(before + 1);
    }
  });

  it('leave an older game that holds them its roster and trains, and its recipes less the retired', () => {
    // the older game: the engines earlier kits handed out and the four regular wagons, named here
    // rather than read from the starter flag, with an Adler running on a regular line
    const old = newGame();
    old.inventory.load({ items: [], nextUid: 1 });
    for (const id of [...FORMER_KIT, ...FORMER_WAGONS]) old.inventory.add(id, 0);
    old.crafting.load(undefined);
    const line = regularLine(old);
    const adler = old.inventory.free('loco').find((i) => i.defId === 'adler')!;
    const hopper = old.inventory.free('wagon').find((i) => i.defId === 'wood_hopper')!;
    const t = old.fleet.create([adler.uid], [hopper.uid], [line.near.id, line.far.id]);
    expect(t).toBeInstanceOf(Train);
    const saved = JSON.parse(
      JSON.stringify({
        inventory: old.inventory.toJSON(),
        // saved before the retirement, when the workshop knew every model the game owned
        crafting: { ...old.crafting.toJSON(), recipes: old.inventory.ownedDefs() },
        trains: old.fleet.trains.map((tr) => tr.toJSON()),
      }),
    ) as {
      inventory: ReturnType<Inventory['toJSON']>;
      crafting: ReturnType<Crafting['toJSON']>;
      trains: ReturnType<Train['toJSON']>[];
    };

    // loaded the way Game.applySave does, into a game that was seeded with the new kit first
    resetStationIds(1);
    const w = newGame();
    regularLine(w);
    w.inventory.load(structuredClone(saved.inventory));
    w.crafting.load(structuredClone(saved.crafting));
    resetTrainIds(1);
    const trains = saved.trains.map((tj) => Train.fromJSON(structuredClone(tj), w.track));

    expect(w.inventory.toJSON()).toEqual(saved.inventory);
    for (const id of [...FORMER_KIT, ...FORMER_WAGONS]) expect(w.inventory.count(id), id).toBe(1);
    // nothing of the kit the new game was seeded with is left over
    for (const { id } of STARTER_LOCOS) expect(w.inventory.count(id), id).toBe(0);
    expect([...w.crafting.recipes].sort()).toEqual(
      saved.crafting.recipes.filter((id) => !RETIRED_KIT.includes(id)).sort(),
    );
    for (const id of [...FORMER_KIT, ...FORMER_WAGONS])
      expect(w.crafting.knows(id), id).toBe(!RETIRED_KIT.includes(id));
    expect(trains.map((tr) => tr.toJSON())).toEqual(saved.trains);
    expect(trains[0].locos.map((l) => l.def.id)).toEqual(['adler']);
  });
});

describe('the wagons the kit no longer hands out', () => {
  it('stay in the game: in a steam banner and in the recipe pool of their age', () => {
    const steam = content.gacha.banners.filter((b) => b.tier === 0).flatMap((b) => b.pool);
    const { inventory } = newGame();
    for (const id of FORMER_WAGONS) {
      expect(wagonDef(id).id, id).toBe(id);
      expect(steam, id).toContain(id);
      expect(craftPool('wagon', 0), id).toContain(id);
      expect(inventory.count(id), id).toBe(0);
    }
  });
});
