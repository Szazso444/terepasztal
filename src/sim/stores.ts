import type { Cost } from '../data/content';
import type { TrackGraph } from '../world/track';
import type { Builder } from './build';
import { rules, weekSeconds } from './rules';
import { needsStore, type Building } from './buildings';
import type { Station } from './stations';
import type { TownRegistry } from './towns';
import { STR } from '../strings';

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
  /** Add up to the cap; returns the amount actually stored. */
  add(id: string, amount: number): number;
  take(id: string, amount: number): number;
  canAfford(cost: Cost, mul?: number): boolean;
  /** What is missing to pay `cost` (empty when affordable). */
  missing(cost: Cost, mul?: number): Cost;
  /** Pay all of `cost` or nothing. */
  spend(cost: Cost, mul?: number): boolean;
  /** Give back floor(v * mul) of each good, capped; what does not fit is lost. */
  refund(cost: Cost, mul?: number): void;
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
  abstract add(id: string, amount: number): number;
  abstract take(id: string, amount: number): number;

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

  constructor(
    public key: string,
    public kind: StoreKind,
    public anchor: { x: number; y: number },
    /** the cap per resource, read live so a level-up or a new warehouse counts at once */
    public capOf: (id: string) => number,
  ) {
    super();
  }

  get(id: string) {
    return this.amounts.get(id) ?? 0;
  }
  cap(id: string) {
    return this.capOf(id);
  }
  held() {
    return this.amounts.entries();
  }
  add(id: string, amount: number) {
    const cur = this.get(id);
    const n = Math.max(0, Math.min(amount, this.cap(id) - cur));
    this.amounts.set(id, cur + n);
    return n;
  }
  take(id: string, amount: number) {
    const cur = this.get(id);
    const n = Math.max(0, Math.min(cur, amount));
    this.amounts.set(id, cur - n);
    return n;
  }
}

/**
 * Stores that act as one: their goods and caps add up, goods go in and out member by member in
 * order. A pool of one is a store (what Full mode uses); Simple mode will pool a rail network.
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
  held() {
    const out = new Map<string, number>();
    for (const m of this.members)
      for (const [id, n] of m.amounts) out.set(id, (out.get(id) ?? 0) + n);
    return out.entries();
  }
  add(id: string, amount: number) {
    let put = 0;
    for (const m of this.members) put += m.add(id, amount - put);
    return put;
  }
  take(id: string, amount: number) {
    let got = 0;
    for (const m of this.members) got += m.take(id, amount - got);
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
  held() {
    const out = new Map<string, number>(this.base ? [...this.base.held()] : []);
    out.set('power', this.grid.get('power'));
    return out.entries();
  }
  add(id: string, amount: number) {
    return this.of(id)?.add(id, amount) ?? 0;
  }
  take(id: string, amount: number) {
    return this.of(id)?.take(id, amount) ?? 0;
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
  /** the store the player looks at; the UI sets it */
  selected: ResourceStore | null = null;
  /** a store's famine begins or ends (`tickUpkeep`) */
  onMessage: ((msg: string, kind: 'info' | 'warn' | 'good') => void) | null = null;
  private deps: StoreDeps | null = null;
  private stores = new Map<string, Store>();
  private pools = new Map<string, StorePool>();
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

  constructor() {
    this.grid = new Store('grid', 'grid', { x: 0, y: 0 }, (id) =>
      id === 'power' ? rules.powerCap + 100 * this.plants : 0,
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
   * Re-derive the stores from the stations and towns, caps included. A store that survives keeps its goods; the
   * goods of one that is gone (its anchor removed, or a warehouse that joined a town) go to the
   * store that now covers its anchor, else the nearest in reach, up to the cap. The rest is lost.
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
      } else next.set(w.key, new Store(w.key, w.kind, w.anchor, w.capOf));
    }
    this.stores = next;
    for (const key of [...this.pools.keys()]) if (!next.has(key)) this.pools.delete(key);
    for (const key of [...this.short.keys()]) if (!next.has(key)) this.short.delete(key);
    this.townAtTile.clear();
    this.supplierAtTile.clear();
    this.fuelAtTile.clear();
    this.worksOf.clear();

    for (const [key, gone] of old) {
      if (next.has(key)) continue;
      const heir =
        this.townStore(gone.anchor.x, gone.anchor.y) ??
        this.nearest(gone.anchor.x, gone.anchor.y)[0];
      if (!heir) continue;
      for (const [id, n] of gone.amounts) if (n > 0) heir.add(id, n);
    }
    // the stations learn where they dock, and a harvester in a town where its workers carry to
    for (const s of builder.stations) {
      s.dock = this.dockOf(s);
      s.outlet = s.def.terrain ? this.townStore(s.x, s.y) : null;
    }
  }

  /** Every store, the grid first. */
  all(): Store[] {
    return [...this.stores.values()];
  }
  byKey(key: string): Store | undefined {
    return this.stores.get(key);
  }
  /** What a caller works on in place of the store itself: a pool, here always of the store alone. */
  poolOf(s: Store): ResourceStore {
    let p = this.pools.get(s.key);
    if (!p || p.members[0] !== s) {
      p = new StorePool([s]);
      this.pools.set(s.key, p);
    }
    return p;
  }

  /**
   * The store of the town whose reach covers the tile (the nearest Townhouse when reaches overlap).
   * A whole tile's answer is kept until the next refresh.
   */
  townStore(x: number, y: number): ResourceStore | null {
    const k = tileKey(x, y);
    const have = this.townAtTile.get(k);
    if (have !== undefined) return have;
    const t = this.d.towns.townAt(x, y);
    const s = t && this.stores.get(`town:${t.id}`);
    const out = s ? this.poolOf(s) : null;
    if (k >= 0) this.townAtTile.set(k, out);
    return out;
  }
  /** Where a station's goods go in and out: a depot or warehouse, a warehouse in a town as the town. */
  dockOf(st: Station): ResourceStore | null {
    if (st.def.depot) return this.storeOf(stationKey(st));
    if (st.def.stockpile) return this.townStore(st.x, st.y) ?? this.storeOf(stationKey(st));
    return null;
  }
  /** Stores within `range` tiles (Chebyshev) of the tile, nearest first; the grid is no place to build from. */
  nearest(x: number, y: number, range = rules.buildReach): ResourceStore[] {
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
    const base = this.supplierFor(b.x, b.y);
    if (!base) return needsStore(b) ? null : this.gridWorks;
    let w = this.worksOf.get(base);
    if (!w) {
      w = new WorksStore(base, this.gridWorks.grid);
      this.worksOf.set(base, w);
    }
    return w;
  }

  /**
   * Food for one step of `gameDt` game seconds: the eaters at each pool (residents and crews, as
   * the caller counts them) eat `rules.wheatPerCrew` a week each from it. A pool short for more
   * than FAMINE_AFTER seconds has every member in famine; fed again, or with nobody left to eat
   * there, it is out of it. Both are told through `onMessage`, under the pool's name.
   */
  tickUpkeep(gameDt: number, eaters: Map<ResourceStore, number>) {
    const done = new Set<string>();
    for (const [pool, n] of eaters) {
      done.add(pool.key);
      this.feed(pool, n, gameDt);
    }
    for (const s of this.stores.values()) {
      const pool = this.poolOf(s);
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
      this.onMessage?.(STR.stores.famine(this.label(pool)), 'warn');
      return;
    }
    this.short.delete(pool.key);
    if (!pool.famine) return;
    for (const m of membersOf(pool)) m.famine = false;
    this.onMessage?.(STR.stores.fed(this.label(pool)), 'good');
  }
  /** The nearest store in reach that holds the whole cost. */
  payerFor(cost: Cost, x: number, y: number): ResourceStore | null {
    return this.nearest(x, y).find((s) => s.canAfford(cost)) ?? null;
  }

  /** Goods in every store together. */
  totals(): Map<string, number> {
    const out = new Map<string, number>();
    for (const s of this.stores.values())
      for (const [id, n] of s.amounts) if (n > 0) out.set(id, (out.get(id) ?? 0) + n);
    return out;
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
   * Restore goods and famine. Call it once the stations and towns are loaded: the stores are
   * derived from them first, and a saved key with no store is dropped.
   */
  load(list: StoreJSON[]) {
    this.refresh();
    for (const s of this.stores.values()) {
      s.amounts.clear();
      s.famine = false;
    }
    for (const j of list) {
      const s = this.stores.get(j.key);
      if (!s) continue;
      for (const [id, n] of Object.entries(j.amounts))
        if (Number.isFinite(n) && n > 0) s.amounts.set(id, n);
      s.famine = !!j.famine;
    }
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

function stationKey(s: Station) {
  return `st:${s.id}`;
}

/** A whole tile on the map as one number; -1 for anything else, which is then not kept. */
function tileKey(x: number, y: number) {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < 65536
    ? y * 65536 + x
    : -1;
}
