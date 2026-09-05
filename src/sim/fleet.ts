import { Train, type DeliveryEvent } from './trains';
import type { TrackGraph } from '../world/track';
import type { Builder } from './build';
import type { GameMap } from '../world/tiles';
import type { Inventory } from '../gacha/inventory';
import { wagonDef, levelMul } from '../gacha/items';
import { opposite, DIR_DX, DIR_DY, DIRS } from '../engine/iso';
import type { Economy } from './economy';

/** Owns all trains: creation from inventory items, recall, per-tick simulation. */
export class Fleet {
  trains: Train[] = [];
  onDelivery: ((e: DeliveryEvent) => void) | null = null;

  constructor(
    readonly track: TrackGraph,
    readonly builder: Builder,
    readonly map: GameMap,
    readonly inventory: Inventory,
    readonly economy: Economy,
  ) {}

  byId(id: number) {
    return this.trains.find((t) => t.id === id);
  }

  /** Assemble and spawn a train at the first route station. Returns an error string on failure. */
  create(locoUid: number, wagonUids: number[], route: number[], name?: string): Train | string {
    const loco = this.inventory.byUid(locoUid);
    if (!loco || loco.kind !== 'loco' || loco.assigned !== null) return 'Locomotive unavailable';
    const wagons = wagonUids.map((u) => this.inventory.byUid(u));
    if (wagons.some((w) => !w || w.kind !== 'wagon' || w.assigned !== null))
      return 'Wagon unavailable';
    const t = new Train(loco.uid, loco.defId, loco.level, name);
    if (wagons.length > t.locoDef.maxWagons) return `Too many wagons (max ${t.locoDef.maxWagons})`;
    t.wagons = wagons.map((w) => ({
      uid: w!.uid,
      def: wagonDef(w!.defId),
      level: w!.level,
      cargo: null,
      amount: 0,
      origin: null,
    }));
    if (t.weight > t.power * 1.5) return 'Too heavy for this locomotive';
    if (route.length < 2) return 'Route needs at least two stations';
    const first = this.builder.stationById(route[0]);
    if (!first) return 'Missing station';
    const plat = this.builder.platformTiles(first);
    if (!plat.length) return `${first.name} has no platform track`;
    const p = plat[0];
    // face away from the station: entry = the edge facing the station tile, if that link exists
    const toStation = DIRS.find((d) => p.x + DIR_DX[d] === first.x && p.y + DIR_DY[d] === first.y);
    const piece = this.track.get(p.x, p.y)!;
    let entry = piece.links[0][0];
    if (toStation !== undefined && piece.links.some((l) => l.includes(opposite(toStation))))
      entry = opposite(toStation);
    if (!t.spawnAt(this.track, p.x, p.y, entry)) return 'Could not place train';
    t.route = route;
    t.routeIndex = 0;
    loco.assigned = t.id;
    for (const w of wagons) w!.assigned = t.id;
    this.trains.push(t);
    // first stop is the spawn station itself: load, then continue
    if (t.dispatch(this.track, this.builder, this.map)) t.onPathReady({ builder: this.builder });
    else t.state = 'noRoute';
    return t;
  }

  setRoute(t: Train, route: number[]) {
    t.route = route;
    t.routeIndex = Math.min(t.routeIndex, Math.max(0, route.length - 1));
  }

  recall(t: Train) {
    t.recall();
    const i = this.trains.indexOf(t);
    if (i >= 0) this.trains.splice(i, 1);
    for (const it of this.inventory.items) if (it.assigned === t.id) it.assigned = null;
  }

  tick(gdt: number) {
    const ctx = {
      track: this.track,
      builder: this.builder,
      map: this.map,
      onDelivery: (e: DeliveryEvent) => this.onDelivery?.(e),
      spend: (v: number) => (this.economy.money -= v),
      earn: (v: number) => this.economy.earn(v),
    };
    for (const t of this.trains) t.tick(gdt, ctx);
  }

  /** Total capacity of a train for a cargo type. */
  static capacityFor(t: Train, cargo: string) {
    return t.wagons
      .filter((w) => w.def.accepts.includes(cargo))
      .reduce((a, w) => a + w.def.capacity * levelMul(w.level), 0);
  }
}
