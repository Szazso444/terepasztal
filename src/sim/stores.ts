import type { Cost } from '../data/content';
import type { TrackGraph } from '../world/track';
import type { Builder } from './build';
import { rules, weekSeconds } from './rules';
import { supplyMode, type SupplyMode } from './supply';
import { needsStore, type Building } from './buildings';
import type { Station } from './stations';
import type { TownRegistry } from './towns';
import { CARGO } from './cargo';
import { STR } from '../strings';

/** Resource ids that can be kept: every cargo plus stored power. */
export const RESOURCE_IDS: string[] = [
  ...CARGO.filter((c) => c.class !== 'people').map((c) => c.id),
  'power',
];

/** "30 wood, 10 stone" */
export function fmtCost(cost: Cost, mul = 1): string {
  const parts = Object.entries(cost)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${Math.ceil(v * mul)} ${k}`);
  return parts.length ? parts.join(', ') : STR.build.free;
}
export function scaleCost(cost: Cost, mul: number): Cost {
  const out: Cost = {};
  for (const [k, v] of Object.entries(cost)) out[k] = Math.ceil(v * mul);
  return out;
}

/**
 * Where goods are kept. Replaces the one global stockpile: every town, every depot, every
 * warehouse outside a town and the power grid holds its own goods, and building, upkeep and trains
 * work on the store nearest to them. The callers (works, houses, trains, the Builder) move goods in
 * and out; the registry itself only settles the food of crews and residents (`tickUpkeep`).
 */

/** What a caller needs of a place that keeps goods; one store, or a pool of stores that act as one. */
export interface ResourceStore {
  /** the pool's first member's key */
  readonly key: string;
  readonly anchor: { x: number; y: number };
  readonly famine: boolean;
  get(id: string): number;
  cap(id: string): number;
  /** Every good held and how much of it. */
  held(): Iterable<[string, number]>;
  /**
   * Add up to the cap; returns the amount actually stored. `haul` marks goods a train brings in
   * (see `weeklyFlow`).
   */
  add(id: string, amount: number, haul?: boolean): number;
  /** Take up to `amount`; `haul` marks goods a train carries off. */
  take(id: string, amount: number, haul?: boolean): number;
  /**
   * Actual units received and spent in the last seven days; the goods a game began with are not.
   * Goods a train hauls (`haul`) count as received or spent only by their net: what is hauled
   * between the stores of one pool (Simple mode's rail network) leaves the pool's flow as it was,
   * what is hauled in from outside it shows as received, what is hauled out as spent.
   */
  weeklyFlow(id: string): Flow;
  canAfford(cost: Cost, mul?: number): boolean;
  /** What is missing to pay `cost` (empty when affordable). */
  missing(cost: Cost, mul?: number): Cost;
  /** Pay all of `cost` or nothing. */
  spend(cost: Cost, mul?: number): boolean;
  /** Give back floor(v * mul) of each good, capped; what does not fit is lost. */
  refund(cost: Cost, mul?: number): void;
}

/** Units received and spent over the last seven days. */
export interface Flow {
  produced: number;
  consumed: number;
}

/** What a store's log holds for a good: made and used up there, and hauled in and out by train. */
interface RawFlow extends Flow {
  hauledIn: number;
  hauledOut: number;
}

/** The flow a reader sees: hauls count by their net, so a haul between pool members cancels. */
function netFlow(raw: RawFlow): Flow {
  const haul = raw.hauledIn - raw.hauledOut;
  return {
    produced: raw.produced + Math.max(0, haul),
    consumed: raw.consumed + Math.max(0, -haul),
  };
}

/** The game time the stores' flows are told by; the registry owns it and moves it on every step. */
interface FlowClock {
  time: number;
  /** off until the start goods are in or a save is loaded, so those do not count as received */
  tracking: boolean;
}

/** Quarter-day buckets keep the rolling history bounded even for continuous upkeep. */
const BUCKETS_PER_WEEK = 28;

/** What one store received and spent, in quarter-day buckets over the last week. */
class FlowLog {
  private flows = new Map<string, ({ at: number } & RawFlow)[]>();

  constructor(private clock: FlowClock | null) {}

  record(id: string, amount: number, kind: keyof RawFlow) {
    if (!this.clock?.tracking || amount <= 0) return;
    const buckets = this.flows.get(id) ?? [];
    const at = Math.floor(this.clock.time / (weekSeconds() / BUCKETS_PER_WEEK));
    let bucket = buckets[buckets.length - 1];
    if (!bucket || bucket.at !== at) {
      bucket = { at, produced: 0, consumed: 0, hauledIn: 0, hauledOut: 0 };
      buckets.push(bucket);
    }
    bucket[kind] += amount;
    while (buckets.length && buckets[0].at <= at - BUCKETS_PER_WEEK) buckets.shift();
    this.flows.set(id, buckets);
  }
  weekly(id: string): RawFlow {
    const total = { produced: 0, consumed: 0, hauledIn: 0, hauledOut: 0 };
    if (!this.clock) return total;
    const now = Math.floor(this.clock.time / (weekSeconds() / BUCKETS_PER_WEEK));
    for (const b of this.flows.get(id) ?? [])
      if (b.at > now - BUCKETS_PER_WEEK) {
        total.produced += b.produced;
        total.consumed += b.consumed;
        total.hauledIn += b.hauledIn;
        total.hauledOut += b.hauledOut;
      }
    return total;
  }
  clear() {
    this.flows.clear();
  }
}

export type StoreKind = 'town' | 'depot' | 'warehouse' | 'grid';

export interface StoreJSON {
  key: string;
  amounts: Record<string, number>;
  famine: boolean;
}

/** The arithmetic every store shares, over whatever `get`, `cap`, `add` and `take` hold. */
abstract class Ledger {
  abstract get(id: string): number;
  abstract add(id: string, amount: number, haul?: boolean): number;
  abstract take(id: string, amount: number, haul?: boolean): number;

  canAfford(cost: Cost, mul = 1) {
    return Object.entries(cost).every(([k, v]) => this.get(k) >= v * mul);
  }
  missing(cost: Cost, mul = 1): Cost {
    const out: Cost = {};
    for (const [k, v] of Object.entries(cost))
      if (this.get(k) < v * mul) out[k] = Math.ceil(v * mul - this.get(k));
    return out;
  }
  spend(cost: Cost, mul = 1) {
    if (!this.canAfford(cost, mul)) return false;
    for (const [k, v] of Object.entries(cost)) this.take(k, v * mul);
    return true;
  }
  refund(cost: Cost, mul = 1) {
    for (const [k, v] of Object.entries(cost)) this.add(k, Math.floor(v * mul));
  }
}

/** One place that keeps goods: a town, a depot, a warehouse outside every town, or the grid. */
export class Store extends Ledger implements ResourceStore {
  amounts = new Map<string, number>();
  famine = false;
  private log: FlowLog;

  constructor(
    public key: string,
    public kind: StoreKind,
    public anchor: { x: number; y: number },
    /** the cap per resource, read live so a level-up or a new warehouse counts at once */
    public capOf: (id: string) => number,
    /** the registry's clock; a store built on its own (a try-out copy) keeps no flows */
    clock: FlowClock | null = null,
  ) {
    super();
    this.log = new FlowLog(clock);
  }

  get(id: string) {
    return this.amounts.get(id) ?? 0;
  }
  cap(id: string) {
    return this.capOf(id);
  }
  weeklyFlow(id: string) {
    return netFlow(this.log.weekly(id));
  }
  /** the log as it is, hauls apart: a pool nets them over its members */
  rawFlow(id: string) {
    return this.log.weekly(id);
  }
  clearFlows() {
    this.log.clear();
  }
  held() {
    return this.amounts.entries();
  }
  add(id: string, amount: number, haul = false) {
    const cur = this.get(id);
    const n = Math.max(0, Math.min(amount, this.cap(id) - cur));
    this.amounts.set(id, cur + n);
    this.log.record(id, n, haul ? 'hauledIn' : 'produced');
    return n;
  }
  take(id: string, amount: number, haul = false) {
    const cur = this.get(id);
    const n = Math.max(0, Math.min(cur, amount));
    this.amounts.set(id, cur - n);
    this.log.record(id, n, haul ? 'hauledOut' : 'consumed');
    return n;
  }
}

/**
 * Stores that act as one: their goods and caps add up, goods go in and out member by member in
 * order, so the first member is the one a caller stands at: it is taken from and filled first, the
 * rest nearest first. A pool of one is a store (what Full mode uses); Simple mode pools the stores
 * of a rail network, each seen from its own place (`StoreRegistry.poolOf`).
 */
export class StorePool extends Ledger implements ResourceStore {
  constructor(readonly members: Store[]) {
    super();
  }
  get key() {
    return this.members[0].key;
  }
  get anchor() {
    return this.members[0].anchor;
  }
  get famine() {
    return this.members.some((m) => m.famine);
  }
  get(id: string) {
    let n = 0;
    for (const m of this.members) n += m.get(id);
    return n;
  }
  cap(id: string) {
    let n = 0;
    for (const m of this.members) n += m.cap(id);
    return n;
  }
  weeklyFlow(id: string) {
    const total = { produced: 0, consumed: 0, hauledIn: 0, hauledOut: 0 };
    for (const m of this.members) {
      const f = m.rawFlow(id);
      total.produced += f.produced;
      total.consumed += f.consumed;
      total.hauledIn += f.hauledIn;
      total.hauledOut += f.hauledOut;
    }
    return netFlow(total);
  }
  held() {
    const out = new Map<string, number>();
    for (const m of this.members)
      for (const [id, n] of m.amounts) out.set(id, (out.get(id) ?? 0) + n);
    return out.entries();
  }
  add(id: string, amount: number, haul = false) {
    let put = 0;
    for (const m of this.members) {
      if (put >= amount) break;
      put += m.add(id, amount - put, haul);
    }
    return put;
  }
  take(id: string, amount: number, haul = false) {
    let got = 0;
    for (const m of this.members) {
      if (got >= amount) break;
      got += m.take(id, amount - got, haul);
    }
    return got;
  }
}

/**
 * What a works runs from: its supplier for every good but power, which comes from and goes to the
 * grid. With no supplier it holds power alone (a hydro plant, a bridge, a substation). Its famine
 * is its supplier's.
 */
class WorksStore extends Ledger implements ResourceStore {
  constructor(
    readonly base: ResourceStore | null,
    readonly grid: ResourceStore,
  ) {
    super();
  }
  private of(id: string) {
    return id === 'power' ? this.grid : this.base;
  }
  get key() {
    return (this.base ?? this.grid).key;
  }
  get anchor() {
    return (this.base ?? this.grid).anchor;
  }
  get famine() {
    return this.base?.famine ?? false;
  }
  get(id: string) {
    return this.of(id)?.get(id) ?? 0;
  }
  cap(id: string) {
    return this.of(id)?.cap(id) ?? 0;
  }
  weeklyFlow(id: string) {
    return this.of(id)?.weeklyFlow(id) ?? { produced: 0, consumed: 0 };
  }
  held() {
    const out = new Map<string, number>(this.base ? [...this.base.held()] : []);
    out.set('power', this.grid.get('power'));
    return out.entries();
  }
  add(id: string, amount: number, haul = false) {
    return this.of(id)?.add(id, amount, haul) ?? 0;
  }
  take(id: string, amount: number, haul = false) {
    return this.of(id)?.take(id, amount, haul) ?? 0;
  }
}

/** The stores a store or pool stands for: the members of a pool, a store itself. */
function membersOf(r: ResourceStore): Store[] {
  if (r instanceof StorePool) return r.members;
  return r instanceof Store ? [r] : [];
}

/**
 * A detached copy of what a store or pool holds, with its caps read live from it: takes and adds
 * on the copy are tried out without touching the store (`Fleet.refuelAll` previews on one).
 */
export function previewOf(r: ResourceStore): Store {
  const copy = new Store(r.key, membersOf(r)[0]?.kind ?? 'depot', r.anchor, (id) => r.cap(id));
  for (const [id, n] of r.held()) copy.amounts.set(id, n);
  return copy;
}

/** Game seconds the eaters at a store may go short before its famine is declared. */
const FAMINE_AFTER = 10;

/** What a registry reads: the placed stations, the towns they belong to, and the rails. */
interface StoreDeps {
  builder: Builder;
  towns: TownRegistry;
  track: TrackGraph;
}

/** A store the stations and towns call for. */
interface StoreSpec {
  key: string;
  kind: StoreKind;
  anchor: { x: number; y: number };
  capOf: (id: string) => number;
}

/**
 * Every store of a game, derived from the stations and towns by `refresh`. Keys: `town:<townId>`,
 * `st:<stationId>` (a depot, or a warehouse outside every town) and `grid`.
 */
export class StoreRegistry {
  /** power only: the battery cap rises with every plant */
  readonly grid: Store;
  /** a store's famine begins or ends (`tickUpkeep`) */
  onMessage: ((msg: string, kind: 'info' | 'warn' | 'good') => void) | null = null;
  private deps: StoreDeps | null = null;
  private clock: FlowClock = { time: 0, tracking: false };
  private stores = new Map<string, Store>();
  private pools = new Map<string, StorePool>();
  /**
   * The stores that share a rail network (Simple mode), in registry order, by each member's key; a
   * store alone on its network has no entry. Worked out by `groupByRails`.
   */
  private nets = new Map<string, string[]>();
  /** the supply mode and the rails (`TrackGraph.version`) `nets` was worked out for */
  private labelledMode: SupplyMode | null = null;
  private labelledRails = -1;
  /** power plants at work, counted by the last refresh */
  private plants = 0;
  /**
   * What the last refresh makes of a tile, worked out once and kept until the next (`townStore`,
   * `supplierFor`, `fuelSupplierFor`), and what each supplier's works run from (`worksStore`): the step asks them
   * for every house, crew and works.
   */
  private townAtTile = new Map<number, ResourceStore | null>();
  private supplierAtTile = new Map<number, ResourceStore | null>();
  private fuelAtTile = new Map<number, ResourceStore | null>();
  private worksOf = new Map<ResourceStore, WorksStore>();
  private readonly gridWorks: WorksStore;
  /** game seconds the eaters at each pool have gone short, by the pool's key; not saved */
  private short = new Map<string, number>();
  /** the key of the store the player picked (`selected`); null for the start depot's */
  private selectedKey: string | null = null;

  constructor() {
    this.grid = new Store(
      'grid',
      'grid',
      { x: 0, y: 0 },
      (id) => (id === 'power' ? rules.powerCap + 100 * this.plants : 0),
      this.clock,
    );
    this.stores.set(this.grid.key, this.grid);
    this.gridWorks = new WorksStore(null, this.poolOf(this.grid));
  }

  private get d(): StoreDeps {
    if (!this.deps) throw new Error('StoreRegistry: attach() the builder and towns first');
    return this.deps;
  }

  attach(d: StoreDeps) {
    this.deps = d;
  }

  /**
   * Re-derive the stores from the stations and towns, caps included. A store that survives keeps
   * its goods; the goods of one that is gone (its anchor removed, or a warehouse that joined a
   * town) go whole to its heir (`heirAt`), past the heir's cap too. They are lost only with no
   * store left but the grid.
   */
  refresh() {
    const { builder, towns } = this.d;
    const want: StoreSpec[] = [];
    // what the caps derive from the stations is counted here once; a level-up or a new warehouse
    // takes effect at the next refresh
    this.plants = builder.plantCount();
    const levels = this.townWarehouseLevels();
    for (const t of towns.towns) {
      const hall = towns.station(t);
      if (!hall) continue;
      const townCap = rules.townStoreCap + rules.warehouseCap * (levels.get(t.id) ?? 0);
      want.push({
        key: `town:${t.id}`,
        kind: 'town',
        anchor: { x: hall.x, y: hall.y },
        capOf: (id) => (id === 'power' ? 0 : townCap),
      });
    }
    for (const s of builder.stations) {
      const anchor = { x: s.x, y: s.y };
      if (s.def.depot)
        want.push({
          key: stationKey(s),
          kind: 'depot',
          anchor,
          capOf: (id) => (id === 'power' ? 0 : rules.depotCap),
        });
      else if (s.def.stockpile && !towns.townAt(s.x, s.y)) {
        const level = s.level;
        want.push({
          key: stationKey(s),
          kind: 'warehouse',
          anchor,
          capOf: (id) => (id === 'power' ? 0 : rules.warehouseCap * level),
        });
      }
    }

    const old = this.stores;
    const next = new Map<string, Store>([[this.grid.key, this.grid]]);
    for (const w of want) {
      const have = old.get(w.key);
      if (have) {
        have.kind = w.kind;
        have.anchor = w.anchor;
        have.capOf = w.capOf;
        next.set(w.key, have);
      } else next.set(w.key, new Store(w.key, w.kind, w.anchor, w.capOf, this.clock));
    }
    this.stores = next;
    for (const key of [...this.short.keys()]) if (!next.has(key)) this.short.delete(key);
    this.groupByRails();

    // goods handed to an heir are put in as they are, not received: no flow counts them
    for (const [key, gone] of old) {
      if (next.has(key)) continue;
      const heir = this.heirAt(gone.anchor);
      if (heir)
        for (const [id, n] of gone.amounts) if (n > 0) heir.amounts.set(id, heir.get(id) + n);
    }
    this.bindStations();
  }

  /**
   * Group the stores by rail network and drop what was cached of the old grouping: the pools and
   * the tiles' answers. In Simple mode a town store sits on its Townhouse's platform tiles (and
   * those of the warehouses in its reach), a depot or a warehouse outside every town on its own,
   * and stores whose rails connect are one network; a store with no track is alone, and so is the
   * grid. In Full mode every store is alone. One flood per network: `refresh` and `follow` run it,
   * never a lookup.
   */
  private groupByRails() {
    this.labelledMode = supplyMode();
    this.labelledRails = this.d.track.version;
    this.nets.clear();
    this.townAtTile.clear();
    this.supplierAtTile.clear();
    this.fuelAtTile.clear();
    this.worksOf.clear();
    if (this.labelledMode === 'simple') this.joinByRails();
    // a shortage timer belongs to its network's first store, which may have changed
    const carried = new Map<string, number>();
    for (const [key, t] of this.short) {
      const lead = this.nets.get(key)?.[0] ?? key;
      if (this.stores.has(key)) carried.set(lead, Math.max(t, carried.get(lead) ?? 0));
    }
    this.short = carried;
    // a store on its own keeps its pool; the pools of a network are made again
    for (const [key, p] of [...this.pools])
      if (this.nets.has(key) || p.members.length > 1 || p.members[0] !== this.stores.get(key))
        this.pools.delete(key);
  }
  /** Fill `nets`: the stores whose platforms lie on one network of rails. */
  private joinByRails() {
    const { builder, towns, track } = this.d;
    const seeds = new Map<string, number[]>();
    const seed = (key: string, st: Station) => {
      if (!this.stores.has(key)) return;
      const from = seeds.get(key) ?? [];
      for (const p of builder.platformTiles(st)) from.push(p.y * track.w + p.x);
      seeds.set(key, from);
    };
    for (const t of towns.towns) {
      const hall = towns.station(t);
      if (hall) seed(`town:${t.id}`, hall);
    }
    for (const st of builder.stations) {
      if (st.def.depot) seed(stationKey(st), st);
      else if (st.def.stockpile) {
        const t = towns.townAt(st.x, st.y);
        seed(t ? `town:${t.id}` : stationKey(st), st);
      }
    }
    // a network is what the rails of its stores reach; a store joins the one its platforms lie
    // on, and one that lies on several joins them
    let comps: { tiles: Set<number>; keys: string[] }[] = [];
    for (const key of this.stores.keys()) {
      const from = seeds.get(key);
      if (!from?.length) continue;
      const hit = comps.filter((c) => from.some((k) => c.tiles.has(k)));
      const into = hit[0] ?? { tiles: new Set<number>(), keys: [] };
      if (!hit.length) comps.push(into);
      for (const c of hit.slice(1)) {
        for (const k of c.tiles) into.tiles.add(k);
        into.keys.push(...c.keys);
      }
      comps = comps.filter((c) => c === into || !hit.includes(c));
      // the platforms the network does not reach yet lead on to more of it
      const fresh = from.filter((k) => !into.tiles.has(k));
      if (fresh.length) for (const k of track.reach(fresh)) into.tiles.add(k);
      into.keys.push(key);
    }
    const order = new Map([...this.stores.keys()].map((k, i) => [k, i]));
    for (const c of comps) {
      if (c.keys.length < 2) continue;
      c.keys.sort((a, b) => order.get(a)! - order.get(b)!);
      for (const key of c.keys) this.nets.set(key, c.keys);
    }
  }
  /**
   * The rails and the supply mode change outside `refresh` (a stroke of track, a loaded save): each
   * lookup checks them first, and the step before it runs, and groups the stores again when they
   * moved. One comparison when nothing did.
   */
  follow() {
    if (!this.deps) return;
    const mode = supplyMode();
    if (
      this.labelledMode !== mode ||
      (mode === 'simple' && this.labelledRails !== this.deps.track.version)
    ) {
      this.groupByRails();
      this.bindStations();
    }
  }
  /** The stations learn where they dock, and a harvester in a town where its workers carry to. */
  private bindStations() {
    for (const s of this.d.builder.stations) {
      s.dock = this.dockOf(s);
      s.outlet = s.def.terrain ? this.townStore(s.x, s.y) : null;
    }
  }

  /**
   * The store the player looks at, which the top bar shows and crafting, the market and the trade
   * desk use: the store the player picked last (a click on a town, a depot or a warehouse, or the
   * top bar's button); while that store is gone, or none was picked, the start depot's; with no
   * depot, the first store there is. Always its network's pool (`networkPool`), so a network in
   * Simple mode is one store under one name however it was picked. Null when there is no store but
   * the grid.
   */
  get selected(): ResourceStore | null {
    const picked = this.selectedKey !== null ? this.stores.get(this.selectedKey) : undefined;
    const s =
      picked ?? this.startDepot() ?? [...this.stores.values()].find((m) => m.kind !== 'grid');
    return s ? this.networkPool(this.poolOf(s)) : null;
  }
  set selected(r: ResourceStore | null) {
    this.selectedKey = r?.key ?? null;
  }
  /**
   * The stores the top bar steps through, one for each place goods are kept, in label order: in
   * Simple mode one for each rail network (`networkPool`). The grid is not one of them.
   */
  choices(): ResourceStore[] {
    const seen = new Map<string, ResourceStore>();
    for (const s of this.stores.values()) {
      if (s.kind === 'grid') continue;
      const pool = this.networkPool(this.poolOf(s));
      if (!seen.has(pool.key)) seen.set(pool.key, pool);
    }
    return [...seen.values()].sort((a, b) => this.label(a).localeCompare(this.label(b)));
  }
  /**
   * What a store holds with the grid's power beside it, as a works sees it (`worksStore`): the
   * top bar shows the selected store so, its power cell the grid's.
   */
  withGrid(base: ResourceStore): ResourceStore {
    this.follow();
    let w = this.worksOf.get(base);
    if (!w) {
      w = new WorksStore(base, this.gridWorks.grid);
      this.worksOf.set(base, w);
    }
    return w;
  }

  /** Every store, the grid first. */
  all(): Store[] {
    return [...this.stores.values()];
  }
  byKey(key: string): Store | undefined {
    return this.stores.get(key);
  }
  /**
   * What a caller works on in place of the store itself: a pool with the store first, then the
   * other stores of its rail network (Simple mode) nearest first; the store alone in Full mode or
   * with no track. The same object until the next refresh or change of the rails.
   */
  poolOf(s: Store): ResourceStore {
    this.follow();
    let p = this.pools.get(s.key);
    if (!p || p.members[0] !== s) {
      p = new StorePool(this.networkFrom(s));
      this.pools.set(s.key, p);
    }
    return p;
  }
  /** The stores on `s`'s network: `s`, then the rest nearest to it first (ties by key). */
  private networkFrom(s: Store): Store[] {
    const keys = this.nets.get(s.key);
    if (!keys) return [s];
    const dist = (o: Store) =>
      Math.max(Math.abs(o.anchor.x - s.anchor.x), Math.abs(o.anchor.y - s.anchor.y));
    const rest = keys
      .filter((k) => k !== s.key)
      .map((k) => this.stores.get(k)!)
      .sort((a, b) => dist(a) - dist(b) || (a.key < b.key ? -1 : 1));
    return [s, ...rest];
  }
  /**
   * The pool that stands for a whole network where it counts as one place (food, famine, a try-out
   * of what the network can pay): the pool of the network's first store in registry order, which is
   * a town's when the network has one (towns come first). The same object for any pool or store of
   * the network until it is regrouped. A store on no network is left as it is.
   */
  networkPool(r: ResourceStore): ResourceStore {
    const first = this.nets.get(r.key)?.[0];
    const s = first ? this.stores.get(first) : undefined;
    return s ? this.poolOf(s) : r;
  }

  /**
   * The store of the town whose reach covers the tile (the nearest Townhouse when reaches overlap).
   * A whole tile's answer is kept until the next refresh.
   */
  townStore(x: number, y: number): ResourceStore | null {
    this.follow();
    const k = tileKey(x, y);
    const have = this.townAtTile.get(k);
    if (have !== undefined) return have;
    const t = this.d.towns.townAt(x, y);
    const s = t && this.stores.get(`town:${t.id}`);
    const out = s ? this.poolOf(s) : null;
    if (k >= 0) this.townAtTile.set(k, out);
    return out;
  }
  /**
   * Where a station's goods go in and out: a depot's and a warehouse's own store; a Townhouse's,
   * and a warehouse's in a town, the town's. No other station has one.
   */
  dockOf(st: Station): ResourceStore | null {
    if (st.def.depot) return this.storeOf(stationKey(st));
    // a Townhouse stands at the heart of its own town's reach
    if (st.def.id === 'town') return this.townStore(st.x, st.y);
    if (st.def.stockpile) return this.townStore(st.x, st.y) ?? this.storeOf(stationKey(st));
    return null;
  }
  /** Stores within `range` tiles (Chebyshev) of the tile, nearest first; the grid is no place to build from. */
  nearest(x: number, y: number, range = rules.buildReach): ResourceStore[] {
    this.follow();
    const found: { s: Store; d: number }[] = [];
    for (const s of this.stores.values()) {
      if (s.kind === 'grid') continue;
      const d = Math.max(Math.abs(s.anchor.x - x), Math.abs(s.anchor.y - y));
      if (d <= range) found.push({ s, d });
    }
    found.sort((a, b) => a.d - b.d || (a.s.key < b.s.key ? -1 : 1));
    return found.map((f) => this.poolOf(f.s));
  }
  /**
   * Where a works or a crew at the tile gets its goods and food: its town's store, else the nearest
   * in reach. A whole tile's answer is kept until the next refresh.
   */
  supplierFor(x: number, y: number): ResourceStore | null {
    this.follow();
    const k = tileKey(x, y);
    const have = this.supplierAtTile.get(k);
    if (have !== undefined) return have;
    const out = this.townStore(x, y) ?? this.nearest(x, y)[0] ?? null;
    if (k >= 0) this.supplierAtTile.set(k, out);
    return out;
  }
  /**
   * The tank of a coaling stage, a water tower or a supplied station at the tile, one that is no
   * depot or warehouse: its town's store, else the nearest store within `rules.fuelReach` tiles
   * (each store measured, also one in a pool); else none, and it fills nothing. A whole tile's
   * answer is kept until the next refresh.
   */
  fuelSupplierFor(x: number, y: number): ResourceStore | null {
    this.follow();
    const k = tileKey(x, y);
    const have = this.fuelAtTile.get(k);
    if (have !== undefined) return have;
    const out = this.townStore(x, y) ?? this.nearest(x, y, rules.fuelReach)[0] ?? null;
    if (k >= 0) this.fuelAtTile.set(k, out);
    return out;
  }
  /**
   * What a works runs from (`tickBuildings`): its supplier (`supplierFor` its corner tile), with
   * power going to the grid. None when it has no supplier and moves goods other than power; one
   * that moves none (a hydro plant, a bridge) runs on the grid alone.
   */
  worksStore(b: Building): ResourceStore | null {
    this.follow();
    const base = this.supplierFor(b.x, b.y);
    if (!base) return needsStore(b) ? null : this.gridWorks;
    return this.withGrid(base);
  }

  /**
   * Food for one step of `gameDt` game seconds: the eaters at each pool (residents and crews, as
   * the caller counts them; those of every store on one rail network together) eat
   * `rules.wheatPerCrew` a week each from it. A pool short for more than FAMINE_AFTER seconds has
   * every member in famine; fed again, or with nobody left to eat there, it is out of it. Both are
   * told through `onMessage`, under the pool's name.
   */
  tickUpkeep(gameDt: number, eaters: Map<ResourceStore, number>) {
    this.follow();
    this.clock.time += gameDt;
    this.clock.tracking ||= gameDt > 0;
    // the eaters of every store on a network eat from it together
    const together = new Map<ResourceStore, number>();
    for (const [pool, n] of eaters) {
      const at = this.networkPool(pool);
      together.set(at, (together.get(at) ?? 0) + n);
    }
    const done = new Set<string>();
    for (const [pool, n] of together) {
      done.add(pool.key);
      this.feed(pool, n, gameDt);
    }
    for (const s of this.stores.values()) {
      const pool = this.networkPool(this.poolOf(s));
      if (done.has(pool.key)) continue;
      done.add(pool.key);
      if (pool.famine || this.short.has(pool.key)) this.feed(pool, 0, gameDt);
    }
  }
  private feed(pool: ResourceStore, eaters: number, gameDt: number) {
    const need = (eaters * rules.wheatPerCrew * gameDt) / weekSeconds();
    const got = pool.take('food', need);
    if (need > 0 && got < need * 0.999) {
      const short = (this.short.get(pool.key) ?? 0) + gameDt;
      this.short.set(pool.key, short);
      if (pool.famine || short <= FAMINE_AFTER) return;
      for (const m of membersOf(pool)) m.famine = true;
      this.onMessage?.(STR.stores.famine(this.networkLabel(pool)), 'warn');
      return;
    }
    this.short.delete(pool.key);
    if (!pool.famine) return;
    for (const m of membersOf(pool)) m.famine = false;
    this.onMessage?.(STR.stores.fed(this.networkLabel(pool)), 'good');
  }
  /** The nearest store in reach that holds the whole cost. */
  payerFor(cost: Cost, x: number, y: number): ResourceStore | null {
    return this.nearest(x, y).find((s) => s.canAfford(cost)) ?? null;
  }

  /**
   * Begin the weekly flows over, once the start goods are in or a save is loaded (the goods a game
   * begins with are not received), including construction that was paused when it was saved.
   */
  beginFlowHistory() {
    for (const s of this.stores.values()) s.clearFlows();
    this.clock.time = 0;
    this.clock.tracking = true;
  }

  /** Goods in every store together. */
  totals(): Map<string, number> {
    const out = new Map<string, number>();
    for (const s of this.stores.values())
      for (const [id, n] of s.amounts) if (n > 0) out.set(id, (out.get(id) ?? 0) + n);
    return out;
  }
  /** Who a network's food and famine are told under: its towns by name, else its first store. */
  private networkLabel(pool: ResourceStore): string {
    const towns = membersOf(pool).filter((m) => m.kind === 'town');
    return towns.length > 1 ? towns.map((m) => this.label(m)).join(', ') : this.label(pool);
  }
  /** The town's name or the station's. */
  label(r: ResourceStore): string {
    const { towns, builder } = this.d;
    if (r.key === this.grid.key) return STR.stores.grid;
    const id = Number(r.key.slice(r.key.indexOf(':') + 1));
    if (r.key.startsWith('town:')) return towns.byId(id)?.name ?? r.key;
    return builder.stationById(id)?.name ?? r.key;
  }

  toJSON(): StoreJSON[] {
    return this.all().map((s) => ({
      key: s.key,
      amounts: Object.fromEntries(s.amounts),
      famine: s.famine,
    }));
  }
  /**
   * Restore goods and famine, in place of whatever the stores held. Call it once the stations and
   * towns are loaded: the stores are derived from them first. A saved store with no place of its
   * own now (a warehouse a town took in, a station that went, the stockpile the step from v20 found
   * no place for) hands its goods and famine to its heir (`heirAt` its place). A load keeps every
   * good it brings, past the caps too.
   */
  load(list: StoreJSON[]) {
    this.refresh();
    for (const s of this.stores.values()) {
      s.amounts.clear();
      s.famine = false;
    }
    const homeless: StoreJSON[] = [];
    for (const j of list) {
      // an entry that is no store, in a file no version wrote, is passed over
      if (typeof j?.key !== 'string') continue;
      const s = this.stores.get(j.key);
      if (!s) homeless.push(j);
      else {
        for (const [id, n] of savedGoods(j)) s.amounts.set(id, n);
        s.famine = !!j.famine;
      }
    }
    for (const j of homeless) {
      const heir = this.heirAt(this.placeOf(j.key));
      if (!heir) continue;
      for (const [id, n] of savedGoods(j)) heir.amounts.set(id, heir.get(id) + n);
      if (j.famine) heir.famine = true;
    }
  }
  /**
   * Forget every store, what each held, the grid's goods and every famine and shortage, so that a
   * load starts from nothing, whatever game ran before it. The stations bring their stores back at
   * the next `refresh` (`load` runs one).
   */
  clear() {
    this.stores = new Map([[this.grid.key, this.grid]]);
    this.grid.amounts.clear();
    this.grid.clearFlows();
    this.grid.famine = false;
    this.clock.time = 0;
    this.clock.tracking = false;
    this.selectedKey = null;
    this.short.clear();
    this.nets.clear();
    for (const key of [...this.pools.keys()]) if (key !== this.grid.key) this.pools.delete(key);
    this.townAtTile.clear();
    this.supplierAtTile.clear();
    this.fuelAtTile.clear();
    this.worksOf.clear();
    // the next lookup groups the stores again
    this.labelledMode = null;
    this.labelledRails = -1;
    this.plants = 0;
  }
  /**
   * The store that takes the goods of a store with no place of its own any more (`refresh`,
   * `load`), so that none are lost: the town store that covers its place, else the nearest store
   * in reach, else the nearest at any distance; a store of no place at all (a station that went,
   * a key of no place) the start depot's, else the first store there is. Undefined only with no
   * store but the grid.
   */
  private heirAt(at: { x: number; y: number } | null): Store | undefined {
    // the nearest at any distance is the nearest in reach when there is one
    const near = at && (this.townStore(at.x, at.y) ?? this.nearest(at.x, at.y, Infinity)[0]);
    if (near) return membersOf(near)[0];
    return this.startDepot() ?? [...this.stores.values()].find((s) => s.kind !== 'grid');
  }
  /** The start depot's store: the first depot store in registry order. */
  private startDepot(): Store | undefined {
    return [...this.stores.values()].find((s) => s.kind === 'depot');
  }
  /** Where the station or the Townhouse a store key names stands; null for a key of no place. */
  private placeOf(key: string): { x: number; y: number } | null {
    const { builder, towns } = this.d;
    const id = Number(key.slice(key.indexOf(':') + 1));
    if (key.startsWith('st:')) return builder.stationById(id) ?? null;
    const t = key.startsWith('town:') ? towns.byId(id) : undefined;
    return (t && towns.station(t)) ?? null;
  }

  private storeOf(key: string): ResourceStore | null {
    const s = this.stores.get(key);
    return s ? this.poolOf(s) : null;
  }
  /** Warehouse levels in each town's reach (town id to sum): they raise its cap. */
  private townWarehouseLevels() {
    const { builder, towns } = this.d;
    const out = new Map<number, number>();
    for (const s of builder.stations) {
      const t = s.def.stockpile ? towns.townAt(s.x, s.y) : null;
      if (t) out.set(t.id, (out.get(t.id) ?? 0) + s.level);
    }
    return out;
  }
}

/** The goods a saved store holds: every finite amount above nothing. */
function savedGoods(j: StoreJSON): [string, number][] {
  const amounts: unknown = j.amounts;
  if (typeof amounts !== 'object' || amounts === null) return [];
  return Object.entries(amounts).filter(
    (e): e is [string, number] => typeof e[1] === 'number' && Number.isFinite(e[1]) && e[1] > 0,
  );
}

function stationKey(s: Station) {
  return `st:${s.id}`;
}

/** A whole tile on the map as one number; -1 for anything else, which is then not kept. */
function tileKey(x: number, y: number) {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < 65536
    ? y * 65536 + x
    : -1;
}
