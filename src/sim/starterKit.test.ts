import { describe, it, expect, beforeEach, vi } from 'vitest';
import { emptyMap } from '../world/mapgen';
import { Terrain } from '../world/tiles';
import { RegionState } from '../world/regions';
import { TrackGraph, makePiece } from '../world/track';
import { Dir, DIR_DX, DIR_DY } from '../engine/iso';
import { Rng } from '../engine/rng';
import { content, type LocoDef } from '../data/content';
import { Builder } from './build';
import { Stockpile } from './stockpile';
import { Economy } from './economy';
import { Fleet } from './fleet';
import { Train, resetTrainIds } from './trains';
import { resetStationIds, stationDef, stationGates, type Station } from './stations';
import {
  START_DEPOT_REACH,
  depotSiteBlocked,
  ensureStartDepot,
  grantDepot,
  startDepotCentre,
  startDepotKind,
} from './startDepot';
import { gaugeOf } from './compat';
import type { TrackClass } from '../world/track';
import { rules, DEFAULT_RULES } from './rules';
import { startStock } from './step';
import { DEFAULT_SUPPLY, SUPPLY_MODES, dieselFuelId, setSupplyMode, supplyMode } from './supply';
import { STR } from '../strings';
import { Inventory } from '../gacha/inventory';
import { Crafting, craftPool, craftResources } from '../gacha/crafting';
import { itemDef, locoDef, wagonDef } from '../gacha/items';
import { forAll, shrinkArray, shrinkInt } from '../testing/property';

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

/**
 * A world the way `Game` sets one up for a new game: an inventory seeded with the starters, the
 * recipes of what it holds, and `stock` in the stockpile (plenty of everything unless given).
 */
function newGame(stock: Record<string, number> = plenty()) {
  const map = emptyMap(4242, 64, 64, Terrain.Grass),
    track = new TrackGraph(64, 64),
    stockpile = new Stockpile(),
    economy = new Economy();
  const regions = new RegionState(map);
  for (let i = 0; i < regions.unlocked.length; i++) regions.own(i);
  const builder = new Builder(map, regions, track, economy, stockpile);
  builder.free = true;
  const inventory = new Inventory();
  inventory.seedStarter(0);
  const fleet = new Fleet(track, builder, map, inventory, economy, stockpile);
  const crafting = new Crafting(new Rng(1), inventory, economy, stockpile);
  crafting.grantFromInventory();
  for (const [id, n] of Object.entries(stock)) stockpile.add(id, n);
  return { map, track, stock: stockpile, builder, inventory, fleet, crafting };
}
/** A narrow depot on a narrow line with two stops beside it. */
function narrowLine(w: ReturnType<typeof newGame>) {
  const ew = [0, 1].find((r) => makePiece('straight', r, 'narrow').links[0].includes(Dir.E))!;
  const depot = w.builder.placeStation(20, 20, 'narrow_depot', 0)!;
  for (let x = 19; x <= 50; x++) w.track.place(x, 20, 'straight', ew, 'narrow');
  const near = w.builder.placeStation(28, 21, 'quarry', 0)!;
  const far = w.builder.placeStation(46, 21, 'quarry', 0)!;
  return { depot, near, far };
}
/** A regular depot on a regular line with two stops beside it, as an older game built it. */
function regularLine(w: ReturnType<typeof newGame>) {
  const ew = [0, 1].find((r) => makePiece('straight', r, 'regular').links[0].includes(Dir.E))!;
  const depot = w.builder.placeStation(20, 20, 'depot', 0)!;
  for (let x = 22; x <= 50; x++) w.track.place(x, 20, 'straight', ew, 'regular');
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
            const pile = new Stockpile();
            for (const id of held) pile.add(id, 100);
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

  it('knows the recipe of each model it owns and of no other, every one narrow gauge', () => {
    const { inventory, crafting } = newGame();
    expect([...crafting.recipes].sort()).toEqual(inventory.ownedDefs().sort());
    for (const id of crafting.recipes) {
      expect(gaugeOf(itemDef(id)), id).toBe('narrow');
      expect(crafting.canCraft(id), id).toBe(true);
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

/** Every gate of the depot carries a straight of the depot's gauge that runs into the shed. */
function expectServed(w: ReturnType<typeof newGame>, depot: Station) {
  const cls: TrackClass = depot.def.gauge ?? 'regular';
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
    const cls: TrackClass = depot.def.gauge ?? 'regular';
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
    expect(cls).toBe('regular');
    expect(w.fleet.modelDeployReason(locoDef('adler'), depot)).toBeNull();
    expect(w.fleet.modelDeployReason(locoDef('rocket'), depot)).toBe(
      STR.fleet.wrongDepot(depot.name),
    );
  });
});

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
    /** straights already laid, at either turn and of either gauge */
    rails: [dx: number, dy: number, rot: number, cls: TrackClass][];
  }
  function genSite(rng: Rng): Site {
    const near = (): Near => [rng.int(-2, 3), rng.int(-2, 3)];
    const some = <T>(max: number, make: () => T) =>
      Array.from({ length: rng.chance(0.3) ? 0 : rng.int(1, max) }, make);
    return {
      defId: rng.pick(['depot', 'narrow_depot']),
      x: rng.int(18, 22),
      y: rng.int(18, 22),
      rot: rng.int(0, 3),
      steep: some(2, near),
      slope: some(2, near),
      water: some(2, near),
      rails: some(3, () => [...near(), rng.int(0, 1), rng.pick<TrackClass>(['narrow', 'regular'])]),
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
    for (const [dx, dy, rot, cls] of s.rails)
      w.track.place(s.x + dx, s.y + dy, 'straight', rot, cls);
    return w;
  }
  /** Every piece of track in a world, as text in tile order. */
  const pieces = (w: ReturnType<typeof newGame>) =>
    [...w.track.pieces.entries()]
      .sort(([a], [b]) => a - b)
      .map(([k, p]) => `${k}:${p.kind}/${p.rot}/${p.cls}/${p.cls2 ?? '-'}`);

  it('is judged, built and given gate track as a half turn on, along the same axis', () => {
    forAll(
      genSite,
      (s) => {
        const other = (s.rot + 2) % 4;
        const a = siteWorld(s);
        const b = siteWorld(s);
        const before = pieces(a);
        const blocked = depotSiteBlocked(a.builder, s.defId, s.x, s.y, s.rot);
        expect(depotSiteBlocked(a.builder, s.defId, s.x, s.y, other), 'the site').toBe(blocked);
        const da = grantDepot(a.builder, s.defId, s.x, s.y, s.rot);
        const db = grantDepot(b.builder, s.defId, s.x, s.y, other);
        expect(!!da, `granted as judged (${blocked ?? 'clear'})`).toBe(blocked === null);
        expect(!!db, `granted at r${other} as at r${s.rot}`).toBe(!!da);
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
        // each gate the grant laid track on has a straight of the shed's gauge running into it
        // (a gate with track already keeps what it had, whatever that is)
        const had = new Set(s.rails.map(([dx, dy]) => `${s.x + dx},${s.y + dy}`));
        for (const g of da.gateTiles()) {
          if (had.has(`${g.x},${g.y}`)) continue;
          const p = a.track.get(g.x, g.y);
          expect(p?.kind, `gate ${g.x},${g.y}`).toBe('straight');
          expect(p!.cls, `gate ${g.x},${g.y}`).toBe(da.def.gauge ?? 'regular');
          const toShed =
            s.rot % 2 === 0 ? (g.x < da.x ? Dir.E : Dir.W) : g.y < da.y ? Dir.S : Dir.N;
          expect(p!.links.flat(), `gate ${g.x},${g.y} runs into the shed`).toContain(toShed);
        }
      },
      { shrink: shrinkSite },
    );
  });
});

describe('the engines the kit no longer hands out', () => {
  it('stay in the game, and a new game hands out none of them', () => {
    const defined = content.locomotives.map((l) => l.id);
    const { inventory } = newGame();
    for (const id of FORMER_KIT) {
      expect(defined, id).toContain(id);
      expect(locoDef(id).id, id).toBe(id);
      expect(inventory.count(id), id).toBe(0);
    }
  });

  it('keep Adler and John Bull in a steam banner and in the recipe pool of their age', () => {
    const steam = content.gacha.banners.filter((b) => b.tier === 0).flatMap((b) => b.pool);
    for (const id of ['adler', 'john_bull']) {
      expect(steam, id).toContain(id);
      expect(craftPool('loco', 0), id).toContain(id);
    }
  });

  it('leave an older game that holds them with the roster, recipes and trains it saved', () => {
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
        crafting: old.crafting.toJSON(),
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
    expect([...w.crafting.recipes].sort()).toEqual([...saved.crafting.recipes].sort());
    for (const id of [...FORMER_KIT, ...FORMER_WAGONS]) expect(w.crafting.knows(id), id).toBe(true);
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
