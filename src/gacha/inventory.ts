import { content } from '../data/content';
import { LOCOS, WAGONS, itemKind, LEVEL_CAP, type Item } from './items';

/** Everything the player owns. Any number of copies of a model may sit side by side. */
export class Inventory {
  items: Item[] = [];
  private nextUid = 1;

  /** A fresh game starts with the starter models, as many copies as the crafting table says. */
  seedStarter(now: number) {
    const copies = content.crafting.starterCopies;
    for (const l of LOCOS) if (l.starter) for (let i = 0; i < copies.loco; i++) this.add(l.id, now);
    for (const w of WAGONS)
      if (w.starter) for (let i = 0; i < copies.wagon; i++) this.add(w.id, now);
  }

  /** Add a new copy of a model; copies never merge. */
  add(defId: string, now: number): Item {
    const item: Item = {
      uid: this.nextUid++,
      defId,
      kind: itemKind(defId),
      level: 1,
      assigned: null,
      dupes: 0,
      obtainedAt: now,
    };
    this.items.push(item);
    return item;
  }
  byUid(uid: number) {
    return this.items.find((i) => i.uid === uid);
  }
  free(kind: 'loco' | 'wagon') {
    return this.items.filter((i) => i.kind === kind && i.assigned === null);
  }
  /** copies of a model the player holds */
  count(defId: string) {
    return this.items.filter((i) => i.defId === defId).length;
  }
  /** every model the player holds at least one copy of */
  ownedDefs(): string[] {
    return [...new Set(this.items.map((i) => i.defId))];
  }
  /** Unassigned copies of the same model that could be fed into `it`. */
  spares(it: Item): Item[] {
    return this.items.filter(
      (i) => i.uid !== it.uid && i.defId === it.defId && i.assigned === null,
    );
  }
  /**
   * Consume one spare copy of the same model to raise `it` one level. Returns false when there
   * is no spare or the item sits at the cap.
   */
  consumeForLevel(it: Item): boolean {
    if (it.level >= LEVEL_CAP) return false;
    const spare = this.spares(it)[0];
    if (!spare) return false;
    this.items.splice(this.items.indexOf(spare), 1);
    it.level++;
    return true;
  }
  toJSON() {
    return { items: this.items, nextUid: this.nextUid };
  }
  load(j: ReturnType<Inventory['toJSON']>) {
    this.items = j.items;
    this.nextUid = j.nextUid;
  }
}
