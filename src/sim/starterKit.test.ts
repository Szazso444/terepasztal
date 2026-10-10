import { describe, it, expect, beforeEach, vi } from 'vitest';
import { emptyMap } from '../world/mapgen';
import { Terrain } from '../world/tiles';
import { RegionState } from '../world/regions';
import { TrackGraph, makePiece } from '../world/track';
import { Dir, DIR_DX, DIR_DY } from '../engine/iso';
import { Rng } from '../engine/rng';
import { content } from '../data/content';
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
import { STR } from '../strings';
import { Inventory } from '../gacha/inventory';
import { Crafting, craftPool, craftResources } from '../gacha/crafting';
import { itemDef, locoDef } from '../gacha/items';

vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));
beforeEach(() => {
  Object.assign(rules, DEFAULT_RULES);
  resetStationIds(1);
  resetTrainIds(1);
});

/** What a new game hands out, one of each: the owner's narrow-gauge starter kit. */
const KIT = ['bm50', 'muki', 'rocket'];
/** The engines a new game handed out before the Rocket start; they stay in the game. */
const FORMER_KIT = ['adler', 'john_bull', 'mk48'];

/** A world the way `Game` sets one up for a new game: an inventory seeded with the starters. */
function newGame() {
  const map = emptyMap(4242, 64, 64, Terrain.Grass),
    track = new TrackGraph(64, 64),
    stock = new Stockpile(),
    economy = new Economy();
  const regions = new RegionState(map);
  for (let i = 0; i < regions.unlocked.length; i++) regions.own(i);
  const builder = new Builder(map, regions, track, economy, stock);
  builder.free = true;
  const inventory = new Inventory();
  inventory.seedStarter(0);
  const fleet = new Fleet(track, builder, map, inventory, economy, stock);
  const crafting = new Crafting(new Rng(1), inventory, economy, stock);
  crafting.grantFromInventory();
  for (const id of ['coal', 'wood', 'water', 'oil', 'diesel', ...craftResources()])
    stock.add(id, 5000);
  return { map, track, stock, builder, inventory, fleet, crafting };
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

describe('the starter kit of a new game', () => {
  it('is exactly one Rocket, one BM-50 and one Muki', () => {
    const { inventory } = newGame();
    const locos = inventory.items.filter((i) => i.kind === 'loco').map((i) => i.defId);
    expect([...locos].sort()).toEqual(KIT);
    for (const gone of FORMER_KIT) expect(inventory.count(gone)).toBe(0);
  });

  it('hands the Rocket out first, so the depot lists it at the top', () => {
    // the depot screen offers the free engines in inventory order
    const { inventory } = newGame();
    expect(inventory.free('loco')[0].defId).toBe('rocket');
    expect(inventory.items[0].defId).toBe('rocket');
  });

  it('marks no other locomotive as a starter, and every starter is narrow gauge', () => {
    const starters = content.locomotives.filter((l) => l.starter);
    expect(starters.map((l) => l.id).sort()).toEqual(KIT);
    for (const l of starters) expect(gaugeOf(l), l.id).toBe('narrow');
  });

  it('comes with narrow wagons for those engines and the recipes to build each again', () => {
    const { inventory, crafting } = newGame();
    const wagons = inventory.items.filter((i) => i.kind === 'wagon');
    expect(wagons.some((i) => gaugeOf(itemDef(i.defId)) === 'narrow')).toBe(true);
    // the wagon starters are whatever the content marks, each in the copies the table says
    for (const w of content.wagons.filter((d) => d.starter))
      expect(inventory.count(w.id), w.id).toBe(content.crafting.starterCopies.wagon);
    for (const id of KIT) {
      expect(crafting.knows(id), id).toBe(true);
      expect(crafting.canCraft(id), id).toBe(true);
    }
  });

  it.each(KIT)('rolls the %s out of a narrow depot and runs it to a stop', (id) => {
    const w = newGame();
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
    const reached: Station[] = [];
    w.fleet.onArrive = (_t, s) => void reached.push(s);
    for (let i = 0; i < 20000 && !reached.length; i++) w.fleet.tick(0.05, i * 0.05);
    expect(reached.length).toBeGreaterThan(0);
    expect(train.distance).toBeGreaterThan(3);
    expect(train.state).not.toBe('noFuel');
  });

  it('needs a narrow depot: a regular depot builds none of the starter engines', () => {
    const w = newGame();
    const regular = w.builder.placeStation(10, 10, 'depot', 0)!;
    for (const id of KIT) {
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
      depot.rot === 0 ? (g.x < depot.x ? Dir.E : Dir.W) : g.y < depot.y ? Dir.S : Dir.N;
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
    ['depot', 0],
    ['depot', 1],
  ])('%s at rot %i: gate track at each end of every track through the shed', (defId, rot) => {
    const w = newGame();
    const { depot, gates, cls } = firstDepot(w, defId, rot);
    // the tiles foreseen before placing are the placed depot's own gates
    expect(depot.gateTiles()).toEqual(gates);
    expect(gates.length).toBe(2 * depot.platforms);
    for (const g of gates) {
      expect(depot.covers(g.x, g.y)).toBe(false);
      // gates lie along the shed's tracks: west and east at rot 0, north and south at rot 1
      const toShed = rot === 0 ? (g.x < depot.x ? Dir.E : Dir.W) : g.y < depot.y ? Dir.S : Dir.N;
      expect(depot.covers(g.x + DIR_DX[toShed], g.y + DIR_DY[toShed])).toBe(true);
      // and the straight laid across the gate runs into the shed
      expect(w.track.get(g.x, g.y)!.links.flat()).toContain(toShed);
    }
    expect([...w.fleet.depotClasses(depot)]).toEqual([cls]);
    expect(w.builder.platformTiles(depot)).toEqual(gates);
  });

  it('builds the Rocket first: the first free engine its gate track takes', () => {
    const w = newGame();
    const { depot } = firstDepot(w, 'narrow_depot', 0);
    const free = w.inventory.free('loco');
    const deployable = free.filter((i) => !w.fleet.modelDeployReason(locoDef(i.defId), depot));
    expect(deployable.map((i) => i.defId)).toEqual(free.map((i) => i.defId));
    expect(deployable[0].defId).toBe('rocket');
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

describe('the engines the kit no longer hands out', () => {
  it('stay in the game: in a steam banner and in the recipe pool of their age', () => {
    const steam = content.gacha.banners.filter((b) => b.tier === 0).flatMap((b) => b.pool);
    const defined = content.locomotives.map((l) => l.id);
    for (const id of FORMER_KIT) expect(defined, id).toContain(id);
    for (const id of ['adler', 'john_bull']) {
      expect(steam, id).toContain(id);
      expect(craftPool('loco', 0), id).toContain(id);
    }
  });

  it('leave a game saved before the Rocket start with the roster, recipes and trains it saved', () => {
    // the older game: the former kit and its wagons, with an Adler running on a regular line
    const old = newGame();
    old.inventory.load({ items: [], nextUid: 1 });
    for (const id of FORMER_KIT) old.inventory.add(id, 0);
    for (const d of content.wagons.filter((w) => w.starter)) old.inventory.add(d.id, 0);
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
    for (const id of KIT) expect(w.inventory.count(id), id).toBe(0);
    expect([...w.crafting.recipes].sort()).toEqual([...saved.crafting.recipes].sort());
    expect(trains.map((tr) => tr.toJSON())).toEqual(saved.trains);
    expect(trains[0].locos.map((l) => l.def.id)).toEqual(['adler']);
  });
});
