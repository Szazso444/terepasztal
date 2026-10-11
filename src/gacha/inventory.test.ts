import { describe, it, expect } from 'vitest';
import type { Rng } from '../engine/rng';
import { content } from '../data/content';
import { forAll, shrinkArray, shrinkInt } from '../testing/property';
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

/** The content's starter flags and copies, as text: what each kit below must put back. */
const starterTable = () =>
  JSON.stringify({
    flags: [...LOCOS, ...WAGONS].filter((d) => 'starter' in d).map((d) => `${d.id}:${d.starter}`),
    copies: content.crafting.starterCopies,
  });
/** The shipped content's, taken before any test runs. */
const SHIPPED_STARTERS = starterTable();

/** Which models a content marks as starters, and the copies of each its crafting table hands out. */
interface Kit {
  locos: string[];
  wagons: string[];
  copies: { loco: number; wagon: number };
}
/** Any kit: engines and wagons of any type and gauge, none to several copies of each. */
function genKit(rng: Rng): Kit {
  return {
    locos: LOCOS.filter(() => rng.chance(0.15)).map((l) => l.id),
    wagons: WAGONS.filter(() => rng.chance(0.15)).map((w) => w.id),
    copies: { loco: rng.int(0, 4), wagon: rng.int(0, 4) },
  };
}
function* shrinkKit(k: Kit): Iterable<Kit> {
  for (const locos of shrinkArray(k.locos)) yield { ...k, locos };
  for (const wagons of shrinkArray(k.wagons)) yield { ...k, wagons };
  for (const loco of shrinkInt(k.copies.loco)) yield { ...k, copies: { ...k.copies, loco } };
  for (const wagon of shrinkInt(k.copies.wagon)) yield { ...k, copies: { ...k.copies, wagon } };
}
/** Seeds a fresh inventory under a content that marks `k`, then puts the content back as it was. */
function seededWith(k: Kit, now: number): Inventory {
  const defs = [...LOCOS, ...WAGONS];
  const flags = defs.map((d) => ('starter' in d ? d.starter : null));
  const copies = content.crafting.starterCopies;
  try {
    for (const l of LOCOS) l.starter = k.locos.includes(l.id);
    for (const w of WAGONS) w.starter = k.wagons.includes(w.id);
    content.crafting.starterCopies = { ...k.copies };
    const inv = new Inventory();
    inv.seedStarter(now);
    return inv;
  } finally {
    defs.forEach((d, i) => {
      if (flags[i] === null) delete d.starter;
      else d.starter = flags[i];
    });
    content.crafting.starterCopies = copies;
  }
}

describe('Inventory.seedStarter', () => {
  it("seeds the table's copies of each model marked starter, engines first, and no other", () => {
    forAll(
      genKit,
      (k) => {
        const inv = seededWith(k, 7);
        expect(starterTable(), 'the content put back').toBe(SHIPPED_STARTERS);
        // the slow obvious kit: the marked engines in content order, then the marked wagons
        const kit = [
          ...LOCOS.filter((l) => k.locos.includes(l.id)).flatMap((l) =>
            Array<string>(k.copies.loco).fill(l.id),
          ),
          ...WAGONS.filter((w) => k.wagons.includes(w.id)).flatMap((w) =>
            Array<string>(k.copies.wagon).fill(w.id),
          ),
        ];
        expect(inv.items.map((i) => i.defId)).toEqual(kit);
        for (const id of SHIPPED)
          expect(inv.count(id), id).toBe(
            k.locos.includes(id) ? k.copies.loco : k.wagons.includes(id) ? k.copies.wagon : 0,
          );
        // each copy new and the player's own: its own uid, level 1, in the depot, from `now`
        expect(inv.items.map((i) => i.uid)).toEqual(kit.map((_, i) => i + 1));
        expect(inv.toJSON().nextUid).toBe(kit.length + 1);
        for (const i of inv.items) {
          expect(i.kind, i.defId).toBe(LOCOS.some((l) => l.id === i.defId) ? 'loco' : 'wagon');
          expect([i.level, i.assigned, i.dupes, i.obtainedAt], i.defId).toEqual([1, null, 0, 7]);
        }
      },
      { shrink: shrinkKit },
    );
  });
});
