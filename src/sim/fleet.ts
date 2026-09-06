import { Train, type DeliveryEvent, type TickCtx } from './trains';
import { cargoDef } from './cargo';
import type { TrackGraph } from '../world/track';
import type { Builder } from './build';
import type { GameMap } from '../world/tiles';
import type { Inventory } from '../gacha/inventory';
import { wagonDef, levelMul } from '../gacha/items';
import { opposite, DIR_DX, DIR_DY, DIRS } from '../engine/iso';
import type { Economy } from './economy';
import { sfx } from '../engine/audio';

/** seconds two trains may face each other before one is let through */
const MUTUAL_GRACE = 4;

/** Owns all trains: creation from inventory items, recall, per-tick simulation. */
export class Fleet {
  trains: Train[] = [];
  onDelivery: ((e: DeliveryEvent) => number) | null = null;
  private occ = new Map<number, number[]>();

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
    this.rebuildOccupancy();
    const p = plat.find((pt) => !this.occupied(pt.x, pt.y, -1)) ?? plat[0];
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
    sfx('train.dispatch');
    // first stop is the spawn station itself: load, then continue
    if (t.dispatch(this.track, this.builder, this.map)) t.onPathReady({ builder: this.builder });
    else t.state = 'noRoute';
    return t;
  }

  setRoute(t: Train, route: number[]) {
    t.route = route;
    t.routeIndex = Math.min(t.routeIndex, Math.max(0, route.length - 1));
  }

  /** Remove a train; cargo aboard is salvaged at 40 % of base price. Returns the salvage value. */
  recall(t: Train): number {
    t.recall();
    let salvage = 0;
    for (const w of t.wagons)
      if (w.cargo && w.amount > 0) salvage += w.amount * cargoDef(w.cargo).price * 0.4;
    salvage = Math.round(salvage);
    if (salvage > 0) this.economy.earn(salvage);
    const i = this.trains.indexOf(t);
    if (i >= 0) this.trains.splice(i, 1);
    for (const it of this.inventory.items) if (it.assigned === t.id) it.assigned = null;
    return salvage;
  }

  /** Is `tile` under any train other than `self`? Rebuilt each tick from car poses. */
  occupied(x: number, y: number, self: number) {
    const list = this.occ.get(y * this.map.w + x);
    if (!list) return false;
    for (const id of list) if (id !== self) return true;
    return false;
  }
  private rebuildOccupancy() {
    this.occ.clear();
    for (const t of this.trains) {
      for (const p of t.poses) {
        const k = Math.floor(p.y + 0.5) * this.map.w + Math.floor(p.x + 0.5);
        const l = this.occ.get(k);
        if (l) {
          if (!l.includes(t.id)) l.push(t.id);
        } else this.occ.set(k, [t.id]);
      }
    }
  }
  tick(gdt: number, now: number, speedFactor = 1) {
    this.rebuildOccupancy();
    const ctx: TickCtx = {
      track: this.track,
      builder: this.builder,
      map: this.map,
      onDelivery: (e: DeliveryEvent) => this.onDelivery?.(e) ?? 0,
      spend: (v: number) => (this.economy.money -= v),
      earn: (v: number) => this.economy.earn(v),
      occupied: (x, y, self) => this.occupied(x, y, self),
      occupants: (x, y) => this.occ.get(y * this.map.w + x) ?? [],
      now,
      speedFactor,
    };
    for (const t of this.trains) t.tick(gdt, ctx);
    // head-on meetings: two trains blocking each other resolve after a short grace period
    for (const a of this.trains) {
      if (a.blockedBy === null || a.blockedTime < MUTUAL_GRACE) continue;
      const b = this.byId(a.blockedBy);
      if (!b || b.blockedBy !== a.id || b.blockedTime < MUTUAL_GRACE) continue;
      (a.id < b.id ? a : b).squeeze(now);
    }
  }

  /** Total capacity of a train for a cargo type. */
  static capacityFor(t: Train, cargo: string) {
    return t.wagons
      .filter((w) => w.def.accepts.includes(cargo))
      .reduce((a, w) => a + w.def.capacity * levelMul(w.level), 0);
  }
}
