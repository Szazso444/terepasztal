import { LOCOS, WAGONS, itemKind, dupesNeeded, LEVEL_CAP, type Item } from './items';

/** Everything the player owns. Duplicates convert to upgrade points. */
export class Inventory {
  items: Item[] = [];
  private nextUid = 1;

  seedStarter(now: number) {
    for (const l of LOCOS) if (l.starter) this.add(l.id, now);
    for (const w of WAGONS) if (w.starter) this.add(w.id, now);
  }

  /** Add an item; if one with the same def already exists, it becomes a duplicate point instead. */
  add(defId: string, now: number): { item: Item; duplicate: boolean; leveled: boolean } {
    const existing = this.items.find((i) => i.defId === defId);
    if (existing) {
      let leveled = false;
      if (existing.level < LEVEL_CAP) {
        existing.dupes++;
        if (existing.dupes >= dupesNeeded(existing.level)) {
          existing.dupes -= dupesNeeded(existing.level);
          existing.level++;
          leveled = true;
        }
      } else existing.dupes++;
      return { item: existing, duplicate: true, leveled };
    }
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
    return { item, duplicate: false, leveled: false };
  }
  byUid(uid: number) {
    return this.items.find((i) => i.uid === uid);
  }
  free(kind: 'loco' | 'wagon') {
    return this.items.filter((i) => i.kind === kind && i.assigned === null);
  }
  toJSON() {
    return { items: this.items, nextUid: this.nextUid };
  }
  load(j: ReturnType<Inventory['toJSON']>) {
    this.items = j.items;
    this.nextUid = j.nextUid;
  }
}
