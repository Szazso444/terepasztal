import { railGrade, type RailBed } from '../world/railProfile';
import { blockingGroups, blockingCycles } from './recovery';
import {
  Train,
  defaultStop,
  newTrip,
  type DeliveryEvent,
  type TickCtx,
  type StopPlan,
  type LocoSlotInit,
  type RouteMode,
} from './trains';
import type { TrackGraph, TrackClass, TrackPiece } from '../world/track';
import { findPath } from '../world/pathfinding';
import { pieceClassFor, vehicleAccess, consistGauge, gaugeOf } from './compat';
import { content, type Gauge } from '../data/content';

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
import { DIR_DX, DIR_DY, DIRS, type Dir } from '../engine/iso';
import type { Economy } from './economy';
import type { Stockpile } from './stockpile';
import { cargoDef } from './cargo';
import type { Station } from './stations';
import { sfx } from '../engine/audio';
import { STR } from '../strings';
import { biomeDef, biomeAt } from './biomes';
import { rules, daySeconds } from './rules';
import { Traffic } from './traffic';
import { Junctions } from './junctions';
import { Signals, HEADWAY } from './signals';
import type { SupplyKind } from './catenary';

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
  /** Height profile of the straight rail lines, kept current by the game on track changes. */
  railBeds: ReadonlyMap<number, RailBed> = new Map();
  readonly traffic: Traffic;
  /** junction clustering and congestion notifications (observes only) */
  readonly junctions: Junctions;
  /** block signals and token working */
  readonly signals: Signals;
  supplyAt: (x: number, y: number) => SupplyKind | null = () => null;
  gridFactor: (x: number, y: number) => number = () => 1;
  gridDraw: (x: number, y: number, u: number) => void = () => {};
  gridBegin: () => void = () => {};
  stockCap: (id: string) => number = () => Infinity;
  /** a train entered or left service */
  onChanged: (() => void) | null = null;

  constructor(
    readonly track: TrackGraph,
    readonly builder: Builder,
    readonly map: GameMap,
    readonly inventory: Inventory,
    readonly economy: Economy,
    readonly stock: Stockpile,
  ) {
    this.traffic = new Traffic(track, builder);
    this.signals = new Signals(track);
    this.junctions = new Junctions(track);
    this.traffic.junctionReport = () => this.junctions.report();
  }

  refuelAll(trains: Train[]) {
    const valid = [...new Set(trains)].filter((t) => this.trains.includes(t));
    const preview = new (this.stock.constructor as typeof Stockpile)();
    preview.amounts = new Map(this.stock.amounts);
    const clones = valid.map((t) => {
      const c = Object.create(Object.getPrototypeOf(t)) as Train;
      Object.assign(c, t);
      return c;
    });
    for (const t of clones) {
      t.refuel(preview, { fuel: true, water: true }, 2);
      if (
        t.coal < t.coalCap - 1e-6 ||
        t.oil < t.oilCap - 1e-6 ||
        t.water < t.waterCap - 1e-6 ||
        t.battery < t.batteryCap - 1e-6
      )
        return false;
    }
    for (const t of valid) t.refuel(this.stock, { fuel: true, water: true }, 2);
    return true;
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
    if (!depot) return new Set();
    return this.reachableTiles(
      this.builder.platformTiles(depot).map((p) => p.y * this.map.w + p.x),
    );
  }
  /** Track tiles reachable from the given tile keys (undirected walk over the rails). */
  reachableTiles(seeds: number[]): Set<number> {
    return this.track.reach(seeds);
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
    // each gauge has its own sheds
    if (gaugeOf(def) !== (depot.def.gauge ?? 'regular')) return STR.fleet.wrongDepot(depot.name);
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
  /**
   * The depot a consist rolls out of. The consist's gauge decides: the depot asked for when it is
   * of that gauge, else the first one that is (a narrow train finds its narrow depot by itself).
   * With no engine chosen yet, the depot asked for sets the gauge. A mixed consist, or no depot of
   * the gauge, gives the reason instead.
   */
  depotFor(gauge: ReturnType<typeof consistGauge>, depotId: number | null): Station | string {
    if (gauge === 'mixed') return STR.fleet.mixedGauge;
    const st = depotId !== null ? this.builder.stationById(depotId) : undefined;
    const asked = st?.def.depot ? st : undefined;
    const own = gauge ?? asked?.def.gauge ?? 'regular';
    const depot =
      asked && (asked.def.gauge ?? 'regular') === own ? asked : this.builder.depotsOf(own)[0];
    if (!depot) return own === 'narrow' ? STR.fleet.noNarrowDepot : STR.fleet.noDepot;
    return depot;
  }
  /** A stand-in engine of a gauge for previews: one the player owns, else a starter. */
  probeLoco(gauge: Gauge): LocoSlotInit {
    const owned = this.inventory.items.find(
      (i) => i.kind === 'loco' && gaugeOf(locoDef(i.defId)) === gauge,
    );
    const def = owned
      ? locoDef(owned.defId)
      : (content.locomotives.find((l) => l.starter && gaugeOf(l) === gauge) ??
        content.locomotives.find((l) => gaugeOf(l) === gauge)!);
    return { uid: -1, def, level: 1 };
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
    const gauge = consistGauge(
      locoUids.map((u) => this.inventory.byUid(u)).flatMap((l) => (l ? [locoDef(l.defId)] : [])),
    );
    const depot = this.depotFor(gauge, depotId);
    if (typeof depot === 'string') return { gate: null, depot: null, reason: depot, stops: [] };
    let stops = schedule.map((s) => (typeof s === 'number' ? defaultStop(s) : s));
    if (stops.length < 2) stops = this.autoSchedule(depot);
    if (stops.length < 2) return { gate: null, depot, reason: STR.fleet.needTwoStops, stops };
    const items = locoUids
      .map((u) => this.inventory.byUid(u))
      .filter((l) => l && l.kind === 'loco');
    const locos: LocoSlotInit[] = items.length
      ? items.map((l) => ({
          uid: l!.uid,
          def: locoDef(l!.defId),
          level: l!.level,
          inCab: l!.inCab,
        }))
      : [this.probeLoco(depot.def.gauge ?? 'regular')];
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
    const locos: LocoSlotInit[] = locoItems.map((l) => ({
      uid: l!.uid,
      def: locoDef(l!.defId),
      level: l!.level,
      inCab: l!.inCab,
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
    const gauge = consistGauge([...locos.map((l) => l.def), ...t.wagons.map((w) => w.def)]);
    const depot = this.depotFor(gauge, depotId);
    if (typeof depot === 'string') return depot;
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
    this.onChanged?.();
    return t;
  }

  setSchedule(t: Train, schedule: StopPlan[]) {
    t.schedule = schedule;
    t.routeIndex = Math.min(t.routeIndex, Math.max(0, schedule.length - 1));
  }

  /**
   * Switch a train's routing mode. `schedule` keeps the stops the train runs and is refused with
   * fewer than two, the mode left as it was. A roaming mode re-plans the train the way `create`
   * does: the stop it would pick becomes a one-stop schedule. A train standing without a route,
   * idling or running a plain leg heads there at once; one at a platform, in a yield, backing off
   * or stopped for fuel, power or weight goes when that wait ends. With nothing worth picking, a
   * train without a route idles and asks again, as a roaming train does. A contract job keeps its
   * two stops: the new mode takes over when the train goes back to its own program. The program
   * `schedule` checks is the one the train goes back to (`Train.program`), also after a job
   * closed and before the train has taken its program up again.
   */
  setMode(t: Train, mode: RouteMode): { ok: true } | { ok: false; message: string } {
    if (mode === 'schedule') {
      if (t.program.length < 2) return { ok: false, message: STR.fleet.needTwoStops };
      t.mode = mode;
      return { ok: true };
    }
    t.mode = mode;
    if (!t.job) this.replan(t);
    return { ok: true };
  }
  /** Point a roaming train at the stop it would pick now (see `setMode`). */
  private replan(t: Train) {
    const next = this.chooseNext(t);
    if (next === null) {
      // rather than retry a dead stop, wait and choose again later
      if (t.state === 'noRoute') this.idle(t);
      return;
    }
    const was = { schedule: t.schedule, routeIndex: t.routeIndex };
    t.schedule = [defaultStop(next)];
    t.routeIndex = 0;
    // the train's own logic heads for the new stop once the platform work, yield or back-off ends
    if (t.state === 'loading' || t.state === 'waiting' || t.state === 'yielding' || t.holding)
      return;
    // an idle train may stand on a platform: it leaves it when it sets off
    const st = t.atStation;
    st?.occupants.delete(t.id);
    t.atStation = null;
    if (t.dispatch(this.track, this.builder, this.map)) {
      // stopped for fuel, power or weight: it rolls onto the new path when that clears
      if (t.state === 'moving' || t.state === 'noRoute' || t.state === 'idle')
        t.onPathReady(this.ctx(this.clockTime, 1));
      return;
    }
    // no way there from where it stands: it stays at the station it stood at (an idle train
    // holding no platform there)
    t.atStation = st;
    if (st && t.state !== 'idle') st.occupants.add(t.id);
    if (t.state === 'noRoute') this.idle(t);
    else if (t.state !== 'idle') {
      // under way or stopped on the line: carry on with what it was doing and choose at the stop
      t.schedule = was.schedule;
      t.routeIndex = was.routeIndex;
    }
  }
  /** A roaming train with nowhere to go waits where it stands and chooses again shortly. */
  private idle(t: Train) {
    t.idle();
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
    this.onChanged?.();
    // its tiles are free at once: a train built right after (clock paused) must see the gate clear
    this.rebuildOccupancy();
    return salvage;
  }

  /** Token working: a plain section may hold one train; another must wait outside it. */
  tokenBlocked(x: number, y: number, self: number) {
    if (this.signals.level !== 'token') return false;
    const id = this.traffic.sectionOf(x, y);
    if (id <= 0) return false;
    for (const k of this.traffic.tilesOfSection(id)) {
      const l = this.occ.get(k);
      if (l && l.some((t) => t !== self)) return true;
    }
    return false;
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
      supplyAt: (x, y) => this.supplyAt(x, y),
      gridFactor: (x, y) => this.gridFactor(x, y),
      gridDraw: (x, y, u) => this.gridDraw(x, y, u),
      signals: this.signals.count === 0 || this.signals.level === 'token' ? null : this.signals,
      tokenBlocked: (x, y, self) => this.tokenBlocked(x, y, self),
      headway: (t) => {
        const level = this.signals.level;
        if (level === 'in_cab' && !t.locos.some((l) => l.inCab || l.def.inCab))
          return HEADWAY.absolute_block;
        return HEADWAY[level];
      },
      onFlow: (x, y, r, d) => this.onFlow(x, y, r, d),
      onPassengers: (s, n, b) => this.onPassengers(s, n, b),
      trainPath: (id) => this.byId(id)?.pathTileKeys(this.map.w) ?? new Set<number>(),
      claimedBy: (x, y, self) => this.traffic.claimedBy(x, y, self),
      recoveryOwner: (x, y, self) => this.traffic.recoveries.ownerAt(y * this.map.w + x, self),
      reserveRecovery: (t, path, group) =>
        this.traffic.reserveRecovery(t, path, group, this.trains, now),
      reservedBy: (x, y, self) => {
        const id = this.reserved.get(y * this.map.w + x) ?? 0;
        return id === self ? 0 : id;
      },
      chooseNext: (t) => this.chooseNext(t),
      biomeAt: (x, y) => {
        const d = biomeDef(biomeAt(this.map, x, y));
        return { speedMul: d.speedMul, waterUseMul: d.waterUseMul };
      },
      gradeAt: (s) => railGrade(this.railBeds, this.map.w, s.x, s.y, s.in, s.out),
      framed: this.framed,
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
        !t.makingWay &&
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
    // only stations the rails under the train actually lead to: a nearer station on a
    // disconnected line would be picked, found unreachable and leave the train parked in the way
    const ht = t.headTile;
    const reach = ht ? this.reachableTiles([ht.y * this.map.w + ht.x]) : null;
    const withPlat = this.builder.stations.filter((s) => {
      const plat = this.builder.platformTiles(s);
      if (!plat.length) return false;
      return !reach || plat.some((p) => reach.has(p.y * this.map.w + p.x));
    });
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
        // Passengers travel to the nearest other passenger Station.
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
      if (t.mode === 'contract') return null;
      if (t.mode === 'transport') {
        if (!s.accepts('passengers')) continue;
        const waiting = this.waitingAt(s.id);
        if (waiting < 1 && s.passengerPopulation <= 0) continue;
        // People waiting per tile of travel; a populated catchment can supply the next coach.
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
        if (
          t.mode === 'production' &&
          haul > 0 &&
          haul < trainCap * 0.15 &&
          s.productionPerWeek > 0
        )
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
  parkElsewhere(t: Train, behind: Train, ctx: TickCtx, force = false): boolean {
    const theirs = behind.pathTileKeys(this.map.w);
    const head = t.poses[0] ?? { x: 0, y: 0 };
    // only spots the rails under the train lead to: a nearer station on another line would be
    // chosen, found unreachable and leave the train parked where it stands with a dead route
    const ht = t.headTile;
    const reach = ht ? this.reachableTiles([ht.y * this.map.w + ht.x]) : null;
    const spots = this.builder.stations.filter((s) => {
      if (s === t.atStation) return false;
      const plat = this.builder.platformTiles(s);
      if (!plat.length || !s.hasFreePlatform()) return false;
      return plat.some(
        (p) =>
          !theirs.has(p.y * this.map.w + p.x) &&
          !this.occupied(p.x, p.y, t.id) &&
          (!reach || reach.has(p.y * this.map.w + p.x)),
      );
    });
    const dist = (s: Station) => Math.abs(s.cx - head.x) + Math.abs(s.cy - head.y);
    spots.sort((a, b) => dist(a) - dist(b));
    const was = { schedule: t.schedule, routeIndex: t.routeIndex, atStation: t.atStation };
    const wasReversed = t.reversed;
    // nearest first; the first spot with a path clear of standing trains wins. When forced
    // (the queue behind has waited long enough) a path through the queue will do: the train
    // then meets the others head-on and the usual give-way rules move the queue back for it
    const tries = spots.slice(0, 4);
    for (const plain of force ? [false, true] : [false])
      for (const target of tries) {
        t.atStation = null;
        t.schedule = [defaultStop(target.id)];
        t.routeIndex = 0;
        const avoid = plain ? undefined : (x: number, y: number) => this.occupied(x, y, t.id);
        if (!t.dispatch(this.track, this.builder, this.map, avoid)) continue;
        if (was.atStation) was.atStation.occupants.delete(t.id);
        if (wasReversed !== t.reversed) t.updatePoses();
        t.lastMessage = 'moving out of the way';
        t.onPathReady(ctx);
        return true;
      }
    // nowhere to go: keep the route and the platform it had
    t.schedule = was.schedule;
    t.routeIndex = was.routeIndex;
    t.atStation = was.atStation;
    return false;
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
  /** fired once each time a train pulls into a station (passing through does not count) */
  onArrive: ((t: Train, s: Station) => void) | null = null;

  /** set by the first `beginFrame`: from then on the loop tick, not each step, captures poses */
  private framed = false;
  /**
   * Call once per loop tick, before its simulation steps: every train's poses become the ones the
   * renderer interpolates from, and until the next call no `tick` overwrites them, so the
   * interpolation spans all the steps the loop tick runs. Without it each `tick` captures them.
   */
  beginFrame() {
    this.framed = true;
    for (const t of this.trains) t.capturePoses();
  }

  tick(gdt: number, now: number, speedFactor = 1) {
    this.clockTime = now;
    this.rebuildOccupancy();
    this.rebuildReservations();
    this.gridBegin();
    this.traffic.assign(this.trains, now);
    const ctx = this.ctx(now, speedFactor);
    for (const t of this.trains) {
      const before = t.atStation;
      t.tick(gdt, ctx);
      if (t.atStation && t.atStation !== before) this.onArrive?.(t, t.atStation);
      if (t.state === 'loading' && t.atStation) this.lastServed.set(t.atStation.id, now);
    }
    this.traffic.observe(this.trains, now, gdt);
    this.junctions.tick(this.trains, now, gdt);
    // Build the complete wait-for graph once, including queues feeding other queues. A
    // group's chosen train owns its escape corridor before any other group can plan a move.
    this.rebuildOccupancy();
    this.makeWay(ctx, now);
    const groups = blockingGroups(this.trains).sort(
      (a, b) => Math.max(...b.map((t) => t.blockedTime)) - Math.max(...a.map((t) => t.blockedTime)),
    );
    for (const group of groups) {
      if (!group.some((t) => t.blockedTime >= MUTUAL_GRACE)) continue;
      if (!this.traffic.canRecover(group, now)) continue;
      const ids = group.map((t) => t.id);
      const parked = (t: Train) =>
        t.state === 'idle' || t.state === 'waiting' || (t.state === 'loading' && t.waitingForCargo);
      // Don't interrupt useful platform work or a train making progress at the front of a queue.
      const blockedIds = new Set(group.filter((t) => t.blocked).map((t) => t.id));
      const tail = group.find((t) => !blockedIds.has(t.id) && t.claimBlocker === null);
      if (tail && !parked(tail) && (tail.state === 'moving' || tail.state === 'loading')) continue;
      const order = [...group].sort(
        (a, b) =>
          Number(parked(b)) - Number(parked(a)) ||
          a.yieldCount - b.yieldCount ||
          a.length - b.length ||
          a.weight - b.weight ||
          a.id - b.id,
      );
      const candidates = [];
      for (const t of order) {
        if (t.holding || t.yieldUntil > now) continue;
        const previous = t.blockedBy;
        const other =
          previous ??
          t.claimBlocker ??
          group.find((o) => o.blockedBy === t.id || o.claimBlocker === t.id)?.id;
        if (other === undefined || other === null) continue;
        t.blockedBy = other;
        const plan = t.planRetreat(ctx, ids);
        t.blockedBy = previous;
        if (plan) candidates.push({ train: t, other, plan });
      }
      const cycle = blockingCycles(group);
      candidates.sort(
        (a, b) =>
          Number(cycle.has(b.train.id)) - Number(cycle.has(a.train.id)) ||
          a.train.yieldCount - b.train.yieldCount ||
          a.plan.distance - b.plan.distance ||
          a.train.id - b.train.id,
      );
      let moved = false;
      for (const { train: t, other, plan } of candidates) {
        if (t.retreat(ctx, ids, plan)) {
          this.traffic.yielded(t, other, now);
          this.rebuildOccupancy();
          this.rebuildReservations();
          moved = true;
          break;
        }
      }
      if (!moved && group.some((t) => t.blockedTime >= MUTUAL_GRACE * 4))
        this.traffic.deadlock(group, now);
    }
  }

  /** game time from which each idle train may look again for a way aside */
  private asideRetry = new Map<number, number>();
  /** game time of the next look at whether an idle train stands in another train's way */
  private wayCheckAt = -Infinity;
  /**
   * Idle trains make way. An idle train standing on a tile another train's route crosses (the
   * path it runs, or the one it waits on a siding to take) moves aside to the nearest place off
   * every train's route that holds it, a siding first (`Train.planAside`), reserved as an escape
   * is, so the trains it makes way for hold back until it has passed, and idles where it parks.
   * When those trains stand in the way out, it shows them the way it would take
   * (`Train.wantAside`), so the jam resolution backs one of them off once it has to wait; with no
   * way out at all it stands and says so. Runs after the trains have moved, so the claims of the
   * next tick hold the others back before any train moves again.
   */
  private makeWay(ctx: TickCtx, now: number) {
    // a few looks a second (and one at once should the clock have been set back)
    if (now < this.wayCheckAt && this.wayCheckAt - now <= WAY_CHECK) return;
    this.wayCheckAt = now + WAY_CHECK;
    for (const id of this.asideRetry.keys()) if (!this.byId(id)) this.asideRetry.delete(id);
    const idle = this.trains.filter((t) => t.state === 'idle' && !t.holding);
    if (!idle.length) return;
    const w = this.map.w;
    const notes: string[] = [STR.traffic.waitAside, STR.traffic.noWayAside, STR.traffic.replan];
    const routes = new Map(this.trains.map((t) => [t.id, t.pathTileKeys(w)]));
    let sidings: Set<number> | null = null;
    for (const t of idle) {
      const mine = t.occupancyKeys(w);
      const group = this.trains.filter(
        (o) => o !== t && mine.some((k) => routes.get(o.id)!.has(k)),
      );
      if (!group.length) {
        // nobody needs its tiles (any more): it wants nothing and has nothing to say about it
        t.wantAside(null, w);
        if (notes.includes(t.lastMessage)) t.lastMessage = '';
        continue;
      }
      if ((this.asideRetry.get(t.id) ?? -Infinity) > now) continue;
      this.asideRetry.set(t.id, now + ASIDE_RETRY);
      // off every other train's route, and off the platforms of every station another train
      // is bound for
      const theirs = new Set<number>();
      const stops = new Set<number>();
      for (const o of this.trains) {
        if (o === t) continue;
        for (const k of routes.get(o.id)!) theirs.add(k);
        for (const s of [...o.schedule, ...o.program]) stops.add(s.stationId);
        for (const j of o.job ? [o.job, ...o.jobs] : o.jobs) stops.add(j.originId).add(j.destId);
      }
      const bound = new Set<number>();
      for (const id of stops) {
        const s = this.builder.stationById(id);
        if (s) for (const p of this.builder.platformTiles(s)) bound.add(p.y * w + p.x);
      }
      sidings ??= this.sidingTiles();
      const ids = group.map((o) => o.id);
      const plan = t.planAside(ctx, ids, { theirs, bound, sidings });
      if (plan && t.retreat(ctx, ids, plan)) {
        this.traffic.yielded(t, ids[0], now);
        this.rebuildOccupancy();
        this.rebuildReservations();
        routes.set(t.id, t.pathTileKeys(w));
        continue;
      }
      // the way out is taken by the trains it is in the way of, or there is none. The way it would
      // take were they to back off ends off their lines too: not under them, nor on the line
      // behind them, which they would back over and cross again
      const lines = new Set(theirs);
      for (const o of group)
        for (const k of [...o.occupancyKeys(w), ...o.lineBehind(this.track)]) lines.add(k);
      const wanted = t.planAside(ctx, ids, { theirs: lines, bound, sidings }, true);
      t.wantAside(wanted?.path ?? null, w);
      routes.set(t.id, t.pathTileKeys(w));
      t.lastMessage = wanted ? STR.traffic.waitAside : STR.traffic.noWayAside;
    }
  }
  /**
   * Tile keys of the sidings: runs of plain track from a switch to a dead end with no platform on
   * them. No train runs through one, so a train parked there is in nobody's way.
   */
  private sidingTiles(): Set<number> {
    const w = this.map.w;
    const track = this.track;
    const platforms = new Set<number>();
    for (const s of this.builder.stations)
      for (const p of this.builder.platformTiles(s)) platforms.add(p.y * w + p.x);
    const plain = (p: TrackPiece | undefined): p is TrackPiece =>
      !!p && p.links.length === 1 && !(p.unit && p.kind !== 'curve');
    const out = new Set<number>();
    for (const { x: tx, y: ty, piece } of track.tiles()) {
      if (!plain(piece)) continue;
      const [a, b] = piece.links[0];
      // walk from a dead end towards the switch the run hangs off
      const openA = track.connected(tx, ty, a);
      if (openA === track.connected(tx, ty, b)) continue;
      const run = [ty * w + tx];
      let x = tx;
      let y = ty;
      let dir = openA ? a : b;
      let switched = false;
      for (let i = 0; i < w * this.map.h && track.connected(x, y, dir); i++) {
        x += DIR_DX[dir];
        y += DIR_DY[dir];
        const next = track.get(x, y);
        if (!plain(next)) {
          switched = true;
          break;
        }
        run.push(y * w + x);
        const exits = track.exits(x, y, ((dir + 2) % 4) as Dir);
        if (exits.length !== 1) break;
        dir = exits[0];
      }
      if (switched && run.every((k) => !platforms.has(k))) for (const k of run) out.add(k);
    }
    return out;
  }

  /** Total capacity of a train for a cargo type. */
  static capacityFor(t: Train, cargo: string) {
    return t.wagons
      .filter((w) => (w.def.accepts ?? []).includes(cargo))
      .reduce((a, w) => a + w.def.capacity * levelMul(w.level), 0);
  }
}
const MUTUAL_GRACE = 4;
/** seconds an idle train in another train's way waits before looking again for a way aside */
const ASIDE_RETRY = 2;
/** seconds between looks at whether an idle train stands in another train's way */
const WAY_CHECK = 0.25;
