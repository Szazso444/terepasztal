import {
  Train,
  defaultStop,
  newTrip,
  type DeliveryEvent,
  type TickCtx,
  type StopPlan,
  type LocoSlot,
  type RouteMode,
} from './trains';
import type { TrackGraph, TrackClass } from '../world/track';
import { findPath } from '../world/pathfinding';
import { pieceClassFor, vehicleAccess } from './compat';

export interface GateInfo {
  x: number;
  y: number;
  cls: TrackClass | null;
  entry: number | null;
  /** tiles of usable run in front of the gate */
  run: number;
  ok: boolean;
  reason: string | null;
}
import type { Builder } from './build';
import type { GameMap } from '../world/tiles';
import type { Inventory } from '../gacha/inventory';
import { wagonDef, locoDef, levelMul, type LocoDef, type WagonDef } from '../gacha/items';
import { DIR_DX, DIR_DY, DIRS } from '../engine/iso';
import type { Economy } from './economy';
import type { Stockpile } from './stockpile';
import { cargoDef } from './cargo';
import type { Station } from './stations';
import { sfx } from '../engine/audio';
import { STR } from '../strings';
import { biomeDef, biomeAt } from './biomes';
import { rules, daySeconds } from './rules';
import { Traffic } from './traffic';

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
  onPassengers: (station: Station, n: number, boarding: boolean) => void = () => {};
  /** last clock time seen by `tick`; used to stamp trips created between ticks */
  clockTime = 0;
  /** section claims, stuck detection and statistics */
  readonly traffic: Traffic;
  stockCap: (id: string) => number = () => Infinity;

  constructor(
    readonly track: TrackGraph,
    readonly builder: Builder,
    readonly map: GameMap,
    readonly inventory: Inventory,
    readonly economy: Economy,
    readonly stock: Stockpile,
  ) {
    this.traffic = new Traffic(track, builder);
  }

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
  /** Track tiles reachable from a depot's gates (undirected walk over the rails). */
  reachableFrom(depot: Station | undefined): Set<number> {
    const out = new Set<number>();
    if (!depot) return out;
    const stack = this.builder.platformTiles(depot).map((p) => p.y * this.map.w + p.x);
    for (const k of stack) out.add(k);
    while (stack.length) {
      const k = stack.pop()!;
      const x = k % this.map.w;
      const y = Math.floor(k / this.map.w);
      for (const d of DIRS) {
        if (!this.track.connected(x, y, d)) continue;
        const nk = (y + DIR_DY[d]) * this.map.w + (x + DIR_DX[d]);
        if (!out.has(nk)) {
          out.add(nk);
          stack.push(nk);
        }
      }
    }
    return out;
  }
  /** Stations a depot's rails lead to (every station with a platform when no depot is given). */
  stationsServedBy(depot: Station | undefined): Station[] {
    const reach = depot ? this.reachableFrom(depot) : null;
    return this.builder.stations.filter((s) => {
      const plat = this.builder.platformTiles(s);
      if (!plat.length) return false;
      return !reach || plat.some((p) => reach.has(p.y * this.map.w + p.x));
    });
  }
  autoSchedule(depot: Station | undefined = this.builder.depots()[0]): StopPlan[] {
    const list = this.stationsServedBy(depot);
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

  /**
   * Put a train on a free gate of the depot from which one of its stops can be reached, facing
   * away from the shed, with its route index at that stop. Tries every free gate and both ways
   * of standing on it. Returns the gate, or the reason nothing worked.
   */
  private rollOut(t: Train, depot: Station): { x: number; y: number } | string {
    const report = this.gateReport(t, depot);
    if (!report.some((g) => g.cls !== null)) return STR.fleet.depotNoGate(depot.name);
    const usable = report.filter((g) => g.ok);
    const stops = t.schedule;
    for (let si = 0; si < stops.length; si++) {
      const st = this.builder.stationById(stops[si].stationId);
      if (!st || st === depot || !this.builder.platformTiles(st).length) continue;
      for (const g of usable) {
        const piece = this.track.get(g.x, g.y)!;
        const entries: number[] = [];
        if (g.entry !== null) entries.push(g.entry);
        for (const l of piece.links) for (const d of l) if (!entries.includes(d)) entries.push(d);
        for (const entry of entries) {
          if (!t.spawnAt(this.track, g.x, g.y, entry)) continue;
          t.routeIndex = si;
          if (t.dispatch(this.track, this.builder, this.map)) return { x: g.x, y: g.y };
        }
      }
    }
    // nothing worked: say why, gate by gate; when a route exists but the consist may not use
    // it, name the vehicle and the first tile that bars it
    const first = this.builder.stationById(
      stops.find((s) => s.stationId !== depot.id)?.stationId ?? -1,
    );
    const lines: string[] = [];
    for (const g of report) {
      if (!g.ok) {
        lines.push(g.reason ?? '');
        continue;
      }
      const blocked = first ? this.firstBlockedTile(t, g, first) : null;
      lines.push(
        blocked
          ? STR.compat.blockedAt(
              blocked.name,
              blocked.x,
              blocked.y,
              STR.toolbar.trackClass[blocked.cls],
            )
          : STR.compat.gateNoRoute(g.x, g.y, first?.name ?? '?'),
      );
    }
    return (
      lines.filter(Boolean).join(' · ') || STR.fleet.depotNoRoute(depot.name, first?.name ?? '?')
    );
  }

  /** The tile where a route from a gate to a station first uses track the consist may not. */
  private firstBlockedTile(
    t: Train,
    g: GateInfo,
    st: Station,
  ): { name: string; x: number; y: number; cls: TrackClass } | null {
    const plat = new Set(this.builder.platformTiles(st).map((p) => p.y * this.map.w + p.x));
    if (!plat.size || g.entry === null) return null;
    const path = findPath(
      this.track,
      { x: g.x, y: g.y, in: g.entry },
      (x, y) => plat.has(y * this.map.w + x),
      100000,
    );
    if (!path) return null;
    for (const s of path) {
      const p = this.track.get(s.x, s.y);
      if (!p) continue;
      const cls = pieceClassFor(p, s.in);
      if (!t.access.classes.has(cls)) {
        const who = t.access.blockedBy[cls];
        return { name: who?.name ?? t.name, x: s.x, y: s.y, cls };
      }
    }
    return null;
  }

  /**
   * Deployment check of every gate of a depot for a consist (spec §5): track present and of a
   * usable class, continuing onward for at least one more usable tile, with room for the whole
   * consist before the first blocking feature, and nobody standing on the gate.
   */
  gateReport(t: Train, depot: Station): GateInfo[] {
    const out: GateInfo[] = [];
    const need = t.length;
    for (const g of depot.gateTiles()) {
      const piece = this.track.get(g.x, g.y);
      const info: GateInfo = {
        x: g.x,
        y: g.y,
        cls: null,
        entry: null,
        run: 0,
        ok: false,
        reason: null,
      };
      out.push(info);
      if (!piece) {
        info.reason = STR.compat.gateNoTrack(g.x, g.y);
        continue;
      }
      const toStation = DIRS.find((d) => depot.covers(g.x + DIR_DX[d], g.y + DIR_DY[d]));
      const entry =
        toStation !== undefined && piece.links.some((l) => l.includes(toStation))
          ? toStation
          : piece.links[0]?.[0];
      if (entry === undefined) {
        info.reason = STR.compat.gateNoTrack(g.x, g.y);
        continue;
      }
      info.entry = entry;
      info.cls = pieceClassFor(piece, entry);
      if (!t.access.classes.has(info.cls)) {
        const who = t.access.blockedBy[info.cls];
        info.reason = STR.compat.gateClass(
          g.x,
          g.y,
          STR.toolbar.trackClass[info.cls],
          who?.name ?? t.name,
          [...t.access.classes].map((c) => STR.toolbar.trackClass[c]).join(' / ') || '?',
        );
        continue;
      }
      if (this.occupied(g.x, g.y, t.id)) {
        info.reason = STR.compat.gateBusy(g.x, g.y);
        continue;
      }
      // walk outward until the first blocking feature
      let cx = g.x;
      let cy = g.y;
      let cin = entry;
      let run = 0;
      let tiles = 0;
      for (;;) {
        const exits = this.track.exits(cx, cy, cin);
        const out2 = exits.find((e) => e === (cin + 2) % 4) ?? exits[0];
        if (out2 === undefined) break;
        run += this.track.segLength(cx, cy, cin, out2);
        tiles++;
        if (run >= need + 0.5) break;
        const nx = cx + DIR_DX[out2];
        const ny = cy + DIR_DY[out2];
        if (!this.track.connected(cx, cy, out2)) break;
        const np = this.track.get(nx, ny)!;
        if (!t.access.classes.has(pieceClassFor(np, (out2 + 2) % 4))) break;
        if (this.occupied(nx, ny, t.id)) break;
        cx = nx;
        cy = ny;
        cin = (out2 + 2) % 4;
      }
      info.run = run;
      if (tiles < 2) {
        info.reason = STR.compat.gateStub(g.x, g.y);
        continue;
      }
      if (run < need) {
        info.reason = STR.compat.gateRoom(g.x, g.y, run, need);
        continue;
      }
      info.ok = true;
    }
    return out;
  }
  /** Classes of the track at a depot's gates (for greying the picker). */
  depotClasses(depot: Station): Set<TrackClass> {
    const out = new Set<TrackClass>();
    for (const g of depot.gateTiles()) {
      const p = this.track.get(g.x, g.y);
      if (!p) continue;
      const toStation = DIRS.find((d) => depot.covers(g.x + DIR_DX[d], g.y + DIR_DY[d]));
      const entry =
        toStation !== undefined && p.links.some((l) => l.includes(toStation))
          ? toStation
          : p.links[0]?.[0];
      if (entry !== undefined) out.add(pieceClassFor(p, entry));
    }
    return out;
  }
  /** Why a model could not roll out of this depot (null when it can). */
  modelDeployReason(def: LocoDef | WagonDef, depot: Station): string | null {
    const classes = this.depotClasses(depot);
    if (!classes.size) return STR.fleet.depotNoGate(depot.name);
    let why: string | null = null;
    for (const cls of classes) {
      const r = vehicleAccess(def, cls);
      if (!r) return null;
      why = STR.compat.cannotUse(def.name, STR.toolbar.trackClass[cls], r);
    }
    return why;
  }
  /** Where a train with this consist and route would appear, or why it cannot (no side effects). */
  previewSpawn(
    locoUids: number[],
    schedule: (StopPlan | number)[],
    depotId: number | null,
  ): {
    gate: { x: number; y: number } | null;
    depot: Station | null;
    reason: string | null;
    stops: StopPlan[];
  } {
    const depot =
      (depotId !== null ? this.builder.stationById(depotId) : undefined) ??
      this.builder.depots()[0];
    if (!depot || !depot.def.depot)
      return { gate: null, depot: null, reason: STR.fleet.noDepot, stops: [] };
    let stops = schedule.map((s) => (typeof s === 'number' ? defaultStop(s) : s));
    if (stops.length < 2) stops = this.autoSchedule(depot);
    if (stops.length < 2) return { gate: null, depot, reason: STR.fleet.needTwoStops, stops };
    const items = locoUids
      .map((u) => this.inventory.byUid(u))
      .filter((l) => l && l.kind === 'loco');
    const anyLoco = this.inventory.items.find((i) => i.kind === 'loco');
    const locos: LocoSlot[] = items.length
      ? items.map((l) => ({ uid: l!.uid, def: locoDef(l!.defId), level: l!.level }))
      : [{ uid: -1, def: locoDef(anyLoco?.defId ?? 'rocket'), level: 1 }];
    const probe = new Train(locos, 'probe', -1);
    probe.schedule = stops;
    const r = this.rollOut(probe, depot);
    return typeof r === 'string'
      ? { gate: null, depot, reason: r, stops }
      : { gate: r, depot, reason: null, stops };
  }
  /** Assemble a train and roll it out of a depot gate. Returns an error string on failure. */
  create(
    locoUids: number[],
    wagonUids: number[],
    schedule: (StopPlan | number)[],
    name?: string,
    mode: RouteMode = 'schedule',
    depotId: number | null = null,
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
    const depot =
      (depotId !== null ? this.builder.stationById(depotId) : undefined) ??
      this.builder.depots()[0];
    if (!depot || !depot.def.depot) return STR.fleet.noDepot;
    let stops = schedule.map((s) => (typeof s === 'number' ? defaultStop(s) : s));
    if (stops.length < 2) stops = this.autoSchedule(depot);
    if (stops.length < 2) return STR.fleet.needTwoStops;
    t.schedule = stops;
    t.mode = mode;
    const placed = this.rollOut(t, depot);
    if (typeof placed === 'string') return placed;
    if (t.mode !== 'schedule') {
      // a roaming train starts with the stop it would pick, not the automatic loop
      const next = this.chooseNext(t);
      if (next !== null) {
        t.schedule = [defaultStop(next)];
        t.routeIndex = 0;
        t.dispatch(this.track, this.builder, this.map);
      }
    }
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
      for (const k of t.occupancyKeys(this.map.w)) {
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
      onPassengers: (s, n, b) => this.onPassengers(s, n, b),
      trainPath: (id) => this.byId(id)?.pathTileKeys(this.map.w) ?? new Set<number>(),
      claimedBy: (x, y, self) => this.traffic.claimedBy(x, y, self),
      reservedBy: (x, y, self) => {
        const id = this.reserved.get(y * this.map.w + x) ?? 0;
        return id === self ? 0 : id;
      },
      chooseNext: (t) => this.chooseNext(t),
      biomeAt: (x, y) => {
        const d = biomeDef(biomeAt(this.map, x, y));
        return { speedMul: d.speedMul, waterUseMul: d.waterUseMul };
      },
    };
  }
  /** tile key -> train id for the next stretch of every moving train's path */
  private reserved = new Map<number, number>();
  private rebuildReservations() {
    this.reserved.clear();
    for (const t of this.trains) {
      if (t.state !== 'moving') continue;
      for (const k of t.pathTileKeys(this.map.w, 8))
        if (!this.reserved.has(k)) this.reserved.set(k, t.id);
    }
  }
  /** Stations dynamic trains are currently heading for. */
  private dynamicTargets(except: number) {
    const out = new Set<number>();
    for (const t of this.trains)
      if (
        t.dynamic &&
        t.id !== except &&
        t.route.length &&
        (t.state === 'moving' || t.state === 'yielding' || t.state === 'waiting')
      )
        out.add(t.route[t.routeIndex % t.route.length]);
    return out;
  }
  /** Nearest station of a kind, by walking distance estimate. */
  private nearest(list: Station[], from: { x: number; y: number }) {
    let best: Station | null = null;
    let bd = Infinity;
    for (const s of list) {
      const d = Math.abs(s.cx - from.x) + Math.abs(s.cy - from.y);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }
  /**
   * Stops chosen on the fly. With cargo aboard: a contract's destination, else a town for
   * passengers, else the nearest depot (the only way into the stockpile). Empty, `dynamic` picks
   * the producer whose cargo the stockpile lacks most; `collect` picks the producer or warehouse
   * with the biggest load waiting, weighed against the way there and on to the nearest depot.
   * Stations other free-roaming trains are bound for are skipped, and so are stations the tanks
   * could not reach and leave again.
   */
  chooseNext(t: Train): number | null {
    const head = t.poses[0] ?? { x: 0, y: 0 };
    const dist = (s: Station) => Math.abs(s.cx - head.x) + Math.abs(s.cy - head.y);
    const between = (a: Station, b: Station) => Math.abs(a.cx - b.cx) + Math.abs(a.cy - b.cy);
    const withPlat = this.builder.stations.filter((s) => this.builder.platformTiles(s).length > 0);
    const depots = withPlat.filter((s) => s.def.pool);
    const warehouses = withPlat.filter((s) => s.def.stockpile);
    const fuelPoints = withPlat.filter((s) => s.refuelsFuel && s.refuelsWater);
    const range = t.rangeTiles;
    const now = this.clockTime;
    const ok = (s: Station) => !t.isBadTarget(s.id, now);
    // can the train get there and on to fuel afterwards?
    const reachable = (s: Station) => {
      if (range === Infinity) return true;
      const f = this.nearest(fuelPoints, { x: s.cx, y: s.cy });
      const onward = f ? between(f, s) : 0;
      return (dist(s) + onward) * 1.3 + 4 <= range;
    };
    // where a load of goods goes: production dumps into a warehouse with room (a depot when
    // none is nearer), collection only into a depot
    const origins = new Set(t.wagons.map((w) => w.origin).filter((o): o is number => o !== null));
    const dumpFor = (from: { x: number; y: number }, loadUnits: number) => {
      const okDepots = depots.filter(ok);
      if (t.mode === 'production') {
        // never back into the store the load came from
        const roomy = warehouses.filter(
          (s) => ok(s) && !origins.has(s.id) && s.room >= Math.min(loadUnits, 5),
        );
        const w = this.nearest(roomy, from);
        const d = this.nearest(okDepots, from);
        if (
          w &&
          (!d ||
            between(w, { cx: from.x, cy: from.y } as Station) <=
              between(d, { cx: from.x, cy: from.y } as Station) * 1.5)
        )
          return w;
        return d ?? w ?? null;
      }
      return (
        this.nearest(okDepots, from) ??
        this.nearest(
          warehouses.filter((s) => ok(s) && !origins.has(s.id) && s.room > 1),
          from,
        )
      );
    };
    const taken = this.dynamicTargets(t.id);
    const trainCap = t.wagons.reduce((a, w) => a + w.def.capacity * levelMul(w.level), 0) || 1;
    const loaded = t.wagons.filter((w) => w.cargo && w.amount > 0);
    if (loaded.length) {
      for (const w of loaded) {
        const c = this.contractDest?.(w.cargo!, w.origin ?? -1);
        if (c !== null && c !== undefined && !t.isBadTarget(c, now)) return c;
      }
      const wantsPeople = loaded.some((w) => cargoDef(w.cargo!).class === 'people');
      if (wantsPeople) {
        // passengers: the nearest other town station
        const origin = loaded.find((w) => w.origin !== null)?.origin ?? -1;
        const towns = withPlat.filter(
          (s) => s.accepts('passengers') && !s.def.pool && s.id !== origin && ok(s),
        );
        return (
          this.nearest(
            towns.length ? towns : withPlat.filter((s) => s.accepts('passengers') && !s.def.pool),
            head,
          )?.id ?? null
        );
      }
      const units = loaded.reduce((a, w) => a + w.amount, 0);
      const dump = dumpFor(head, units);
      // room left for the kinds already aboard (and empty wagons): top up at another source
      // before dumping, unless a dump is nearer or lies on the way there
      const kinds = new Set(loaded.map((w) => w.cargo!));
      const spare = Math.max(0, t.power - t.weight);
      let room = 0;
      for (const w of t.wagons) {
        const cap = w.def.capacity * levelMul(w.level);
        if (w.cargo) room += Math.max(0, cap - w.amount);
        else if ([...kinds].some((c) => (w.def.accepts ?? []).includes(c))) room += cap;
      }
      const roomFrac = room / Math.max(1, trainCap);
      if (roomFrac > 0.15 && spare > 1) {
        let best: { s: Station; score: number } | null = null;
        for (const s of withPlat) {
          if (s.def.pool || !ok(s) || taken.has(s.id) || !reachable(s)) continue;
          if (t.mode === 'collection' ? !s.def.stockpile : s.def.stockpile) continue;
          let top = 0;
          for (const c of kinds) {
            if (!s.availableCargo().includes(c)) continue;
            top = Math.max(top, Math.min(room, s.stored(c), spare / cargoDef(c).weight));
          }
          // worth a detour only for a real share of the room left
          if (top < Math.max(4, room * 0.25)) continue;
          if (t.mode === 'collection' && top < rules.collectMin * 0.5) continue;
          const sc = top / (12 + 0.5 * dist(s));
          if (!best || sc > best.score) best = { s, score: sc };
        }
        if (best) {
          const dDump = dump ? dist(dump) : Infinity;
          const dSrc = dist(best.s);
          const viaDump = dump ? dist(dump) + between(dump, best.s) : Infinity;
          const dumpFirst = dDump <= dSrc || viaDump <= dSrc * 1.15;
          if (!dumpFirst) return best.s.id;
        }
      }
      return dump?.id ?? null;
    }
    let best: { id: number; score: number } | null = null;
    for (const s of withPlat) {
      if (taken.has(s.id) || s.def.pool || !ok(s)) continue;
      if (!reachable(s)) continue;
      let score = -Infinity;
      if (t.mode === 'transport') {
        if (!s.accepts('passengers')) continue;
        const waiting = this.waitingAt(s.id);
        if (waiting < 1 && s.def.id !== 'town') continue;
        // people waiting per tile of travel; a town with nobody waiting is still worth a visit
        // distance counts at half weight and a town left alone climbs in priority
        score = ((waiting + 0.5) * this.neglect(s.id, now)) / (10 + 0.5 * dist(s));
      } else {
        // production takes from producers, collection from warehouses
        if (t.mode === 'collection' ? !s.def.stockpile : s.def.stockpile) continue;
        let haul = 0;
        const spare = Math.max(0, t.power - t.weight);
        let ripe = 1;
        for (const c of s.availableCargo()) {
          if (cargoDef(c).class === 'people') continue;
          // what the wagons hold and the engines can pull
          const cap = Math.min(Fleet.capacityFor(t, c), spare / cargoDef(c).weight);
          if (cap < 1) continue;
          const stored = s.stored(c);
          // a collection train lets a warehouse accumulate: nothing below the threshold, and
          // an ever stronger pull as the pile grows past it
          if (t.mode === 'collection') {
            if (stored < rules.collectMin) continue;
            ripe = Math.max(ripe, 1 + (stored - rules.collectMin) / rules.collectMin);
          }
          haul = Math.max(haul, Math.min(cap, stored) + 0.25 * stored);
        }
        // a producer that is filling up counts even before the pile is big
        if (t.mode === 'production' && haul > 0 && haul < trainCap * 0.15 && s.productionPerDay > 0)
          haul = Math.max(haul, Math.min(trainCap, s.totalStored()) + 0.25 * s.totalStored());
        if (haul < Math.min(trainCap * 0.15, 8)) continue;
        const dump = dumpFor({ x: s.cx, y: s.cy }, haul);
        const onward = dump ? between(dump, s) : 0;
        // fuller producers first: their pile stops growing when it hits the cap
        // a producer near its cap is throwing output away; distance counts at half weight so a
        // full pile far away beats a thin one next door; stations left alone climb in priority
        const fill = s.totalStored() / Math.max(1, s.capacity);
        const pressure = s.def.stockpile ? ripe : 1 + fill + (fill >= 0.8 ? 1 : 0);
        score =
          (pressure * this.neglect(s.id, now) * haul) / trainCap / (12 + 0.5 * (dist(s) + onward));
      }
      if (!best || score > best.score) best = { id: s.id, score };
    }
    if (best) return best.id;
    // nothing within reach: with the tanks below half, go and fill up at the nearest fuel point
    // rather than idle where the tanks will never refill
    if (range !== Infinity && t.rangeAt(0) < t.rangeAt(1) * 0.5) {
      const here = t.atStation;
      const fp = fuelPoints.filter((s) => ok(s) && s !== here && dist(s) * 1.2 + 2 <= range);
      const f = this.nearest(fp, head);
      if (f) return f.id;
    }
    return null;
  }
  /**
   * Somewhere out of the way for a train that idles in others' path: the nearest station with a
   * free platform whose platform tiles are not on the waiting train's path. Sends it there.
   */
  parkElsewhere(t: Train, behind: Train, ctx: TickCtx): boolean {
    const theirs = behind.pathTileKeys(this.map.w);
    const head = t.poses[0] ?? { x: 0, y: 0 };
    const spots = this.builder.stations.filter((s) => {
      if (s === t.atStation) return false;
      const plat = this.builder.platformTiles(s);
      if (!plat.length || !s.hasFreePlatform()) return false;
      return plat.some(
        (p) => !theirs.has(p.y * this.map.w + p.x) && !this.occupied(p.x, p.y, t.id),
      );
    });
    const target = this.nearest(spots, head);
    if (!target) return false;
    if (t.atStation) {
      t.atStation.occupants.delete(t.id);
      t.atStation = null;
    }
    t.schedule = [defaultStop(target.id)];
    t.routeIndex = 0;
    const wasReversed = t.reversed;
    if (!t.dispatch(this.track, this.builder, this.map, (x, y) => this.occupied(x, y, t.id))) {
      return false;
    }
    if (wasReversed !== t.reversed) t.updatePoses();
    t.lastMessage = 'moving out of the way';
    t.onPathReady(ctx);
    return true;
  }
  /** set by the game: destination station of an active contract for this cargo/origin, if any */
  contractDest: ((cargo: string, origin: number) => number | null) | null = null;
  /** game time a train last loaded at each station; stations left alone climb in priority */
  private lastServed = new Map<number, number>();
  /** 1 for a station served just now, up to 3 for one nobody has visited for two days */
  private neglect(stationId: number, now: number) {
    const last = this.lastServed.get(stationId);
    const days = last === undefined ? 2 : (now - last) / daySeconds();
    return 1 + Math.min(2, Math.max(0, days));
  }
  /** set by the game: travellers waiting at a station */
  waitingAt: (stationId: number) => number = () => 0;

  tick(gdt: number, now: number, speedFactor = 1) {
    this.clockTime = now;
    this.rebuildOccupancy();
    this.rebuildReservations();
    this.traffic.assign(this.trains, now);
    const ctx = this.ctx(now, speedFactor);
    for (const t of this.trains) {
      t.tick(gdt, ctx);
      if (t.state === 'loading' && t.atStation) this.lastServed.set(t.atStation.id, now);
    }
    this.traffic.observe(this.trains, now, gdt);
    // park early: a train held before a section whose holder will come out through the tiles it
    // stands on clears out of the way now instead of meeting it head-on later
    for (const t of this.trains) {
      if (t.claimBlocker === null || t.claimLimit > 1.5 || t.yieldUntil > now) continue;
      if (t.state !== 'moving' || t.holding) continue;
      const other = this.byId(t.claimBlocker);
      if (!other) continue;
      const theirs = other.pathTileKeys(this.map.w);
      const onTheirWay = t.occupancyKeys(this.map.w).some((k) => theirs.has(k));
      if (!onTheirWay) continue;
      t.blockedBy = other.id;
      t.blocked = true;
      if (t.retreat(ctx)) this.traffic.yielded(t, other.id, now);
    }
    // jams: follow who blocks whom; when the chain loops or ends in a train that is itself stuck,
    // the lightest train in it that can pull aside does so (one per chain per tick)
    const stuck = this.trains.filter(
      (t) =>
        t.blocked && t.blockedBy !== null && t.blockedTime >= MUTUAL_GRACE && t.yieldUntil <= now,
    );
    const handled = new Set<number>();
    for (const a of stuck) {
      if (handled.has(a.id)) continue;
      const chain: Train[] = [a];
      let cur: Train | undefined = a;
      let loops = false;
      while (cur && cur.blockedBy !== null) {
        const next = this.byId(cur.blockedBy);
        if (!next) break;
        if (chain.includes(next)) {
          loops = true;
          break;
        }
        chain.push(next);
        cur = next;
        if (chain.length > 8) break;
      }
      const tail = chain[chain.length - 1];
      // a train idling or queueing on the line with someone behind it moves aside first: it has
      // nowhere urgent to be
      if ((tail.state === 'idle' || tail.state === 'waiting') && chain.length >= 2) {
        const behind = chain[chain.length - 2];
        if (tail.yieldUntil <= now && behind.blockedTime >= MUTUAL_GRACE) {
          tail.blockedBy = behind.id;
          tail.blocked = true;
          if (tail.retreat(ctx) || this.parkElsewhere(tail, behind, ctx)) {
            this.traffic.yielded(tail, behind.id, now);
            for (const t of chain) handled.add(t.id);
            continue;
          }
          tail.blocked = false;
          tail.blockedBy = null;
        }
      }
      // a chain ending in a train that is busy at a platform clears itself; one that loops or
      // ends in a train that cannot move needs someone to make room
      const transient =
        tail.state === 'loading' || tail.state === 'waiting' || tail.state === 'idle';
      const dead =
        loops ||
        (tail.blocked && tail.blockedTime >= MUTUAL_GRACE) ||
        (tail.state !== 'moving' && !transient);
      if (!dead) continue;
      for (const t of chain) handled.add(t.id);
      // take turns: the train that has pulled aside least goes first, then the lightest
      const order = [...chain].sort(
        (p, q) => p.yieldCount - q.yieldCount || p.weight - q.weight || q.id - p.id,
      );
      let moved: Train | null = null;
      for (const t of order)
        if (t.retreat(ctx)) {
          moved = t;
          break;
        }
      if (moved) this.traffic.yielded(moved, moved.blockedBy, now);
      else if (
        loops &&
        a.blockedTime >= MUTUAL_GRACE * 4 &&
        a.blockedTime < MUTUAL_GRACE * 4 + gdt * 1.5
      )
        this.traffic.deadlock(chain, now);
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
