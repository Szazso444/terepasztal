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
import { Train } from './trains';
import type { Station } from './stations';
import { gaugeOf } from './compat';
import { rules, DEFAULT_RULES } from './rules';
import { STR } from '../strings';
import { Inventory } from '../gacha/inventory';
import { Crafting, craftResources } from '../gacha/crafting';
import { isRetired, itemDef, locoDef } from '../gacha/items';

vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));
beforeEach(() => Object.assign(rules, DEFAULT_RULES));

/** What a new game hands out, one of each: the owner's narrow-gauge starter kit. */
const KIT = ['bm50', 'muki', 'rocket'];

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

describe('the starter kit of a new game', () => {
  it('is exactly one Rocket, one BM-50 and one Muki', () => {
    const { inventory } = newGame();
    const locos = inventory.items.filter((i) => i.kind === 'loco').map((i) => i.defId);
    expect([...locos].sort()).toEqual(KIT);
    for (const gone of ['adler', 'john_bull', 'mk48']) expect(inventory.count(gone)).toBe(0);
    expect(inventory.ownedDefs().filter(isRetired)).toEqual([]);
  });

  it('marks no other locomotive as a starter, and every starter is narrow gauge', () => {
    const starters = content.locomotives.filter((l) => l.starter);
    expect(starters.map((l) => l.id).sort()).toEqual(KIT);
    for (const l of starters) {
      expect(gaugeOf(l), l.id).toBe('narrow');
      expect(l.retired ?? false, l.id).toBe(false);
    }
  });

  it('comes with narrow wagons for those engines and the recipes to build each again', () => {
    const { inventory, crafting } = newGame();
    const wagons = inventory.items.filter((i) => i.kind === 'wagon');
    expect(wagons.some((i) => gaugeOf(itemDef(i.defId)) === 'narrow')).toBe(true);
    // the wagon starters are whatever the content marks, each in the copies the table says
    for (const w of content.wagons.filter((d) => d.starter && !d.retired))
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
