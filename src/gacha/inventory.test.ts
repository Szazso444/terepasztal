import { describe, it, expect } from 'vitest';
import type { Rng } from '../engine/rng';
import { forAll, shrinkArray } from '../testing/property';
import { Inventory } from './inventory';
import { LOCOS, WAGONS, itemDef, type Item } from './items';

// A save's inventory may name models the content no longer defines (removed in an update, or
// hidden by a content override). Inventory.load leaves those copies out, the way Crafting.load
// leaves out unknown recipes, so every lookup of a loaded copy succeeds.

type InventoryJSON = ReturnType<Inventory['toJSON']>;

const SHIPPED = [...LOCOS, ...WAGONS].map((d) => d.id);
/** Models no table defines. */
const NEVER = ['puffer', 'gone_wagon', 'old_coach'];

/** A saved inventory: shipped and removed models, in service or in the depot, in any order. */
function genInventory(rng: Rng): InventoryJSON {
  const items = Array.from({ length: rng.int(0, 12) }, (_, i): Item => {
    const defId = rng.chance(0.25) ? rng.pick(NEVER) : rng.pick(SHIPPED);
    return {
      uid: i + 1,
      defId,
      kind: LOCOS.some((l) => l.id === defId) ? 'loco' : 'wagon',
      level: rng.int(1, 5),
      assigned: rng.chance(0.3) ? rng.int(1, 4) : null,
      dupes: rng.int(0, 3),
      obtainedAt: rng.int(0, 1000),
    };
  });
  return { items, nextUid: items.length + 1 + rng.int(0, 5) };
}
function* shrinkInventory(j: InventoryJSON): Iterable<InventoryJSON> {
  for (const items of shrinkArray(j.items)) yield { ...j, items };
}

describe('Inventory.load', () => {
  it('keeps exactly the copies of models the content defines, in order and as they were', () => {
    forAll(
      genInventory,
      (j) => {
        const given = JSON.parse(JSON.stringify(j)) as InventoryJSON;
        const inv = new Inventory();
        inv.load(j);
        expect(inv.items).toStrictEqual(given.items.filter((i) => SHIPPED.includes(i.defId)));
        expect(inv.toJSON().nextUid, 'the next uid is kept, so no uid is handed out twice').toBe(
          given.nextUid,
        );
        for (const i of inv.items) itemDef(i.defId);
        for (const id of NEVER) expect(inv.count(id), id).toBe(0);
      },
      { shrink: shrinkInventory },
    );
  });

  it('loads what it saved unchanged when every model is shipped', () => {
    const inv = new Inventory();
    inv.seedStarter(0);
    for (const id of SHIPPED) inv.add(id, 1);
    const saved = JSON.parse(JSON.stringify(inv.toJSON())) as InventoryJSON;
    const back = new Inventory();
    back.load(JSON.parse(JSON.stringify(saved)) as InventoryJSON);
    expect(back.toJSON()).toStrictEqual(saved);
  });
});
