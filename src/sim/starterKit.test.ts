import { describe, it, expect, beforeEach, vi } from 'vitest';
import { emptyMap } from '../world/mapgen';
import { Terrain } from '../world/tiles';
import { RegionState } from '../world/regions';
import { TrackGraph, makePiece } from '../world/track';
import { Dir } from '../engine/iso';
import { Rng } from '../engine/rng';
import { content } from '../data/content';
import { Builder } from './build';
import { Stockpile } from './stockpile';
import { Economy } from './economy';
import { Fleet } from './fleet';
import { Train, resetTrainIds } from './trains';
import { resetStationIds, type Station } from './stations';
import { gaugeOf } from './compat';
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
