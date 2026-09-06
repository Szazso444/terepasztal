import {
  Train,
  defaultStop,
  newTrip,
  type DeliveryEvent,
  type TickCtx,
  type StopPlan,
  type LocoSlot,
} from './trains';
import type { TrackGraph } from '../world/track';
import type { Builder } from './build';
import type { GameMap } from '../world/tiles';
import type { Inventory } from '../gacha/inventory';
import { wagonDef, locoDef, levelMul } from '../gacha/items';
import { opposite, DIR_DX, DIR_DY, DIRS } from '../engine/iso';
import type { Economy } from './economy';
import type { Stockpile } from './stockpile';
import { cargoDef } from './cargo';
import { sfx } from '../engine/audio';
import { STR } from '../strings';

export const MAX_WAGONS = 16;
export const MAX_LOCOS = 4;

/** Owns all trains: creation from inventory items, recall, per-tick simulation. */
export class Fleet {
  trains: Train[] = [];
  onDelivery: ((e: DeliveryEvent) => number) | null = null;
  private occ = new Map<number, number[]>();
  /** set by the game each tick: is a tile inside a live power network? */
  powered: (x: number, y: number) => boolean = () => false;
  onFlow: (x: number, y: number, resource: string, delta: number) => void = () => {};
  /** last clock time seen by `tick`; used to stamp trips created between ticks */
  clockTime = 0;
  stockCap: (id: string) => number = () => Infinity;

  constructor(
    readonly track: TrackGraph,
    readonly builder: Builder,
    readonly map: GameMap,
    readonly inventory: Inventory,
    readonly economy: Economy,
    readonly stock: Stockpile,
  ) {}

  byId(id: number) {
    return this.trains.find((t) => t.id === id);
  }
  /** Crew aboard every train in service. */
  crewTotal() {
    return this.trains.reduce((a, t) => a + t.crew, 0);
  }

  /**
   * Default schedule: every station with platform track, visited in nearest-neighbour order
   * starting from the first producing station. Trains created without stops get this.
   */
  autoSchedule(): StopPlan[] {
    const list = this.builder.stations.filter((s) => this.builder.platformTiles(s).length > 0);
    if (list.length < 2) return list.map((s) => defaultStop(s.id));
    const start = list.find((s) => s.producedCargo().length > 0) ?? list[0];
    const order = [start];
    const left = list.filter((s) => s !== start);
    while (left.length) {
      const cur = order[order.length - 1];
      let bi = 0;
      let bd = Infinity;
      left.forEach((s, i) => {
        const d = Math.abs(s.x - cur.x) + Math.abs(s.y - cur.y);
        if (d < bd) {
          bd = d;
          bi = i;
        }
      });
      order.push(left.splice(bi, 1)[0]);
    }
    return order.map((s) => defaultStop(s.id));
  }

  /** Assemble and spawn a train at the first stop. Returns an error string on failure. */
  create(
    locoUids: number[],
    wagonUids: number[],
    schedule: (StopPlan | number)[],
    name?: string,
  ): Train | string {
    if (!locoUids.length) return STR.fleet.needLoco;
    if (locoUids.length > MAX_LOCOS) return STR.fleet.tooManyLocos(MAX_LOCOS);
    if (wagonUids.length > MAX_WAGONS) return STR.fleet.tooManyWagons(MAX_WAGONS);
    const locoItems = locoUids.map((u) => this.inventory.byUid(u));
    if (locoItems.some((l) => !l || l.kind !== 'loco' || l.assigned !== null))
      return STR.fleet.locoUnavailable;
    const wagons = wagonUids.map((u) => this.inventory.byUid(u));
    if (wagons.some((w) => !w || w.kind !== 'wagon' || w.assigned !== null))
      return STR.fleet.wagonUnavailable;
    const locos: LocoSlot[] = locoItems.map((l) => ({
      uid: l!.uid,
      def: locoDef(l!.defId),
      level: l!.level,
    }));
    const t = new Train(locos, name);
    t.wagons = wagons.map((w) => ({
      uid: w!.uid,
      def: wagonDef(w!.defId),
      level: w!.level,
      cargo: null,
      amount: 0,
      origin: null,
    }));
    if (t.emptyWeight > t.power)
      return STR.fleet.tooHeavy(Math.round(t.emptyWeight), Math.round(t.power));
    let stops = schedule.map((s) => (typeof s === 'number' ? defaultStop(s) : s));
    if (stops.length < 2) stops = this.autoSchedule();
    if (stops.length < 2) return STR.fleet.needTwoStops;
    const first = this.builder.stationById(stops[0].stationId);
    if (!first) return STR.fleet.missingStation;
    const plat = this.builder.platformTiles(first);
    if (!plat.length) return STR.fleet.noPlatform(first.name);
    // prefer a platform tile with no train on it
    const p = plat.find((pt) => !this.occupied(pt.x, pt.y, -1)) ?? plat[0];
    const toStation = DIRS.find((d) => p.x + DIR_DX[d] === first.x && p.y + DIR_DY[d] === first.y);
    const piece = this.track.get(p.x, p.y)!;
    let entry = piece.links[0][0];
    if (toStation !== undefined && piece.links.some((l) => l.includes(opposite(toStation))))
      entry = opposite(toStation);
    if (!t.spawnAt(this.track, p.x, p.y, entry)) return STR.fleet.cannotPlace;
    t.schedule = stops;
    t.routeIndex = 0;
    t.trip = newTrip(this.clockTime);
    for (const l of locoItems) l!.assigned = t.id;
    for (const w of wagons) w!.assigned = t.id;
    this.trains.push(t);
    // tanks start with whatever the stockpile can spare
    t.refuel(this.stock, { fuel: true, water: true });
    sfx('train.dispatch');
    this.rebuildOccupancy();
    if (t.dispatch(this.track, this.builder, this.map)) t.onPathReady(this.ctx(0, 1));
    else t.state = 'noRoute';
    return t;
  }

  setSchedule(t: Train, schedule: StopPlan[]) {
    t.schedule = schedule;
    t.routeIndex = Math.min(t.routeIndex, Math.max(0, schedule.length - 1));
  }

  /** Remove a train; cargo aboard is salvaged at 40 % of base price, tank contents return to the stockpile. */
  recall(t: Train): number {
    t.recall();
    let salvage = 0;
    for (const w of t.wagons)
      if (w.cargo && w.amount > 0) salvage += w.amount * cargoDef(w.cargo).price * 0.4;
    salvage = Math.round(salvage);
    if (salvage > 0) this.economy.earn(salvage);
    t.drainTo(this.stock);
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
  private ctx(now: number, speedFactor: number): TickCtx {
    return {
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
      stockpile: this.stock,
      stockCap: (id) => this.stockCap(id),
      powered: (x, y) => this.powered(x, y),
      onFlow: (x, y, r, d) => this.onFlow(x, y, r, d),
    };
  }
  tick(gdt: number, now: number, speedFactor = 1) {
    this.clockTime = now;
    this.rebuildOccupancy();
    const ctx = this.ctx(now, speedFactor);
    for (const t of this.trains) t.tick(gdt, ctx);
    // head-on meetings: two trains blocked by each other resolve quickly
    for (const a of this.trains) {
      if (!a.blocked || a.blockedBy === null || a.blockedTime < MUTUAL_GRACE) continue;
      const b = this.byId(a.blockedBy);
      if (!b || b.blockedBy !== a.id || b.blockedTime < MUTUAL_GRACE) continue;
      const first = a.id < b.id ? a : b;
      first.squeeze(now);
    }
  }
  /** Total capacity of a train for a cargo type. */
  static capacityFor(t: Train, cargo: string) {
    return t.wagons
      .filter((w) => (w.def.accepts ?? []).includes(cargo))
      .reduce((a, w) => a + w.def.capacity * levelMul(w.level), 0);
  }
}
const MUTUAL_GRACE = 4;
