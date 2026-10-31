import { STR } from '../strings';
import { footprintOf, type TrackClass, type TrackGraph, type TrackPiece } from '../world/track';
import type { ReclassDir } from '../world/reclass';
import { decorDef, type Builder, type Decor } from './build';
import { buildingDef, buildingFootprint, buildingLevel, type Building } from './buildings';
import type { SupplyKind } from './catenary';
import type { CommandResult } from './commands';
import type { Fleet } from './fleet';
import type { HistoryStep } from './history';
import type { House, HouseRegistry } from './houses';
import type { Station } from './stations';
import { fmtCost, type GoodsMove, type Holdings } from './stores';
import type { Town, TownRegistry } from './towns';
import type { Work } from './upgrade';

/**
 * Undo and redo of what the player builds. While a transaction is open (`Commands.act`) the builder
 * tells a `BuildLog` each thing it is about to do, as a low-level operation that holds what its
 * inverse needs. Closing the log makes one `BuildStep`, which the history keeps.
 *
 * A step goes back or forward as a whole: it checks everything first and changes nothing if it is
 * refused. Goods are not kept with the operations: an action's own costs, refunds and hand-overs to
 * an heir store all land in one difference of what each store holds, so a step gives back and takes
 * back exactly what happened, store by store, whatever a cap or a network did to it.
 */

type Tile = { x: number; y: number };

/** The parts of the game a step reads and changes. */
export interface BuildWorld {
  builder: Builder;
  fleet: Fleet;
  towns: TownRegistry;
  houses: HouseRegistry;
}

/** A track piece as `TrackGraph.place` lays it, without where. */
export type PieceSpec = Pick<TrackPiece, 'kind' | 'rot' | 'cls' | 'cls2' | 'form'>;

/** A station's level and the upgrade under way. */
interface StationLevel {
  level: number;
  work: Work | null;
}
/** A works' level and the upgrade under way. */
interface WorksLevel {
  level: number | undefined;
  work: Work | undefined;
}

/** A piece laid, replaced, lifted or moved to another line; `tiles` are all it covers. */
interface TrackOp {
  op: 'track';
  x: number;
  y: number;
  tiles: Tile[];
  was: PieceSpec | null;
  now: PieceSpec | null;
  /** which way an Upgrade or Downgrade moved it */
  reclass?: ReclassDir;
}
/**
 * A station's, decor's or works' `built` says which way the action went. What leaves the world
 * keeps here what leaving takes from it, in whichever direction it leaves.
 */
interface StationOp {
  op: 'station';
  station: Station;
  built: boolean;
  /** its place in the builder's list */
  index: number;
  work: Work | null;
  /** the town of a Townhouse, and its place in the registry's list */
  town: { town: Town; index: number } | null;
}
interface DecorOp {
  op: 'decor';
  decor: Decor;
  built: boolean;
  /** what the house registry held for it */
  house: House | null;
}
interface BuildingOp {
  op: 'building';
  building: Building;
  built: boolean;
  work: Work | undefined;
}

export type BuildOp =
  | TrackOp
  | StationOp
  | DecorOp
  | BuildingOp
  | { op: 'supply'; x: number; y: number; was: SupplyKind | null; now: SupplyKind | null }
  /** `spur`: a road the game laid to a door by itself */
  | { op: 'road'; x: number; y: number; laid: boolean; spur: boolean }
  | { op: 'stationLevel'; station: Station; was: StationLevel; now: StationLevel }
  | { op: 'worksLevel'; building: Building; was: WorksLevel; now: WorksLevel }
  | { op: 'name'; station: Station; was: string; now: string };

/** Residents a house gained or lost in an action (`HouseRegistry.industryPlaced`). */
interface PeopleMove {
  x: number;
  y: number;
  n: number;
}

/**
 * What stands on a tile, in the terms an undo cares about: the track, road, wire, station, works
 * and decor there. Levels, a signal's turn or a switch's form are not in it: they change without
 * anything new having been built.
 */
function tileState(b: Builder, x: number, y: number): string {
  const p = b.track.get(x, y);
  return [
    p ? `${p.kind} ${p.rot} ${p.cls} ${p.cls2 ?? ''} ${p.unit?.ax ?? ''} ${p.unit?.ay ?? ''}` : '',
    b.roads.has(x, y) ? 'road' : '',
    b.catenary?.supplyAt(x, y) ?? '',
    b.stationAt(x, y)?.id ?? '',
    b.buildingAt(x, y)?.id ?? '',
    b.decorAt(x, y)?.id ?? '',
  ].join('|');
}

function pieceSpec(p: PieceSpec): PieceSpec {
  const { kind, rot, cls, cls2, form } = p;
  return { kind, rot, cls, cls2, form };
}
function pieceAt(track: TrackGraph, x: number, y: number): PieceSpec | null {
  const p = track.get(x, y);
  return p ? pieceSpec(p) : null;
}
const stationLevelOf = (s: Station): StationLevel => ({ level: s.level, work: s.work });
const worksLevelOf = (b: Building): WorksLevel => ({ level: b.level, work: b.work });

/** What moved in each store between two looks at them: a good left alone differs by nothing. */
function goodsMoved(before: Holdings, after: Holdings): GoodsMove[] {
  const out: GoodsMove[] = [];
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const was = before.get(key);
    const now = after.get(key);
    for (const id of new Set([...(was?.keys() ?? []), ...(now?.keys() ?? [])])) {
      const n = (now?.get(id) ?? 0) - (was?.get(id) ?? 0);
      if (n) out.push({ key, id, n });
    }
  }
  return out;
}

/** What an action does, told by the builder before it does it. */
export class BuildLog {
  private readonly ops: BuildOp[] = [];
  /** each tile the action touches, as it stood before the first touch */
  private readonly before = new Map<number, string>();
  private readonly goods: Holdings;
  private readonly people = new Map<House, number>();

  constructor(private readonly w: BuildWorld) {
    this.goods = w.builder.stores.holdings();
    for (const h of w.houses.houses.values()) this.people.set(h, h.residents);
  }

  private touch(tiles: readonly Tile[]) {
    const b = this.w.builder;
    for (const t of tiles) {
      const k = t.y * b.map.w + t.x;
      if (!this.before.has(k)) this.before.set(k, tileState(b, t.x, t.y));
    }
  }

  /** The piece anchored at (x, y) is replaced by `now`, or lifted (null). */
  track(x: number, y: number, now: PieceSpec | null, reclass?: ReclassDir) {
    const { track } = this.w.builder;
    const was = pieceAt(track, x, y);
    const tiles = now ? footprintOf(x, y, now.kind, now.rot, now.cls) : track.unitTiles(x, y);
    this.touch(tiles);
    this.ops.push({
      op: 'track',
      x,
      y,
      tiles,
      was,
      now: now && pieceSpec(now),
      reclass,
    });
  }
  supply(x: number, y: number, now: SupplyKind | null) {
    this.touch([{ x, y }]);
    const was = this.w.builder.catenary?.supplyAt(x, y) ?? null;
    this.ops.push({ op: 'supply', x, y, was, now });
  }
  road(x: number, y: number, laid: boolean, spur = false) {
    this.touch([{ x, y }]);
    this.ops.push({ op: 'road', x, y, laid, spur });
  }
  station(s: Station, built: boolean) {
    this.touch(s.footprint());
    const op: StationOp = {
      op: 'station',
      station: s,
      built,
      index: this.w.builder.stations.length,
      work: null,
      town: null,
    };
    if (!built) keepStation(this.w, op);
    this.ops.push(op);
  }
  decor(d: Decor, built: boolean) {
    this.touch([d]);
    const op: DecorOp = { op: 'decor', decor: d, built, house: null };
    if (!built) keepHouse(this.w, op);
    this.ops.push(op);
  }
  building(b: Building, built: boolean) {
    this.touch(buildingFootprint(b.id, b.x, b.y, b.rot ?? 0));
    this.ops.push({ op: 'building', building: b, built, work: built ? undefined : b.work });
  }
  /** Before a station's level or upgrade changes. */
  stationLevel(s: Station) {
    this.touch(s.footprint());
    const was = stationLevelOf(s);
    this.ops.push({ op: 'stationLevel', station: s, was, now: was });
  }
  /** Before a works' level or upgrade changes. */
  worksLevel(b: Building) {
    this.touch(buildingFootprint(b.id, b.x, b.y, b.rot ?? 0));
    const was = worksLevelOf(b);
    this.ops.push({ op: 'worksLevel', building: b, was, now: was });
  }
  /** Before a station takes the name `now`. */
  name(s: Station, now: string) {
    if (s.name === now) return;
    this.touch(s.footprint());
    this.ops.push({ op: 'name', station: s, was: s.name, now });
  }

  /** The action is over: the step it makes, or null when it did nothing. */
  close(stroke?: number): BuildStep | null {
    if (!this.ops.length) return null;
    const b = this.w.builder;
    const after = new Map<number, string>();
    for (const k of this.before.keys())
      after.set(k, tileState(b, k % b.map.w, Math.floor(k / b.map.w)));
    for (const op of this.ops) {
      if (op.op === 'stationLevel') op.now = stationLevelOf(op.station);
      else if (op.op === 'worksLevel') op.now = worksLevelOf(op.building);
    }
    const people: PeopleMove[] = [];
    for (const [h, was] of this.people)
      if (h.residents !== was) people.push({ x: h.x, y: h.y, n: h.residents - was });
    const goods = goodsMoved(this.goods, b.stores.holdings());
    return new BuildStep(this.w, this.ops, this.before, after, goods, people, stroke);
  }
}

/** A station is leaving: what leaving takes from it. */
function keepStation(w: BuildWorld, op: StationOp) {
  const s = op.station;
  const town = w.towns.byStation(s.id);
  op.index = w.builder.stations.indexOf(s);
  op.work = s.work;
  op.town = town ? { town, index: w.towns.towns.indexOf(town) } : null;
}
/** Decor is leaving: a copy of its house, as the registry takes the work off the house itself. */
function keepHouse(w: BuildWorld, op: DecorOp) {
  const h = w.houses.at(op.decor.x, op.decor.y);
  op.house = h ? { ...h } : null;
}

/** One action of the player, back or forward. */
export class BuildStep implements HistoryStep {
  constructor(
    private readonly w: BuildWorld,
    private readonly ops: BuildOp[],
    /** the tiles it touches as they stood before it, and as it left them */
    private readonly before: Map<number, string>,
    private readonly after: Map<number, string>,
    private goods: GoodsMove[],
    private readonly people: PeopleMove[],
    /** what an action over many frames goes by (`Commands.act`) */
    private readonly stroke?: number,
  ) {}

  get label() {
    return stepLabel(this.ops);
  }
  undo() {
    return this.run(false);
  }
  redo() {
    return this.run(true);
  }

  absorb(next: HistoryStep) {
    if (!(next instanceof BuildStep)) return false;
    if (this.stroke === undefined || next.stroke !== this.stroke) return false;
    this.ops.push(...next.ops);
    for (const [k, v] of next.before) if (!this.before.has(k)) this.before.set(k, v);
    for (const [k, v] of next.after) this.after.set(k, v);
    this.people.push(...next.people);
    const sum = new Map(this.goods.map((m) => [`${m.key} ${m.id}`, { ...m }]));
    for (const m of next.goods) {
      const have = sum.get(`${m.key} ${m.id}`);
      if (have) have.n += m.n;
      else sum.set(`${m.key} ${m.id}`, { ...m });
    }
    this.goods = [...sum.values()];
    return true;
  }

  /**
   * Check first, change after. Goods leave a store while the world still has it and arrive once the
   * world is back to where that store exists: a Townhouse's undo takes from a town store that goes
   * with it and gives to a warehouse's that comes back with its going.
   */
  private run(forward: boolean): CommandResult {
    const moves = this.goods.map((m) => ({ ...m, n: forward ? m.n : -m.n }));
    const takes = moves.filter((m) => m.n < 0).map((m) => ({ ...m, n: -m.n }));
    const why = this.refusal(forward, takes);
    if (why) return { ok: false, message: why };
    const { builder, houses } = this.w;
    for (const m of takes) builder.stores.withdraw(m.key, m.id, m.n);
    for (const op of forward ? this.ops : [...this.ops].reverse()) this.apply(op, forward);
    for (const m of moves) if (m.n > 0) builder.stores.deposit(m.key, m.id, m.n);
    for (const p of this.people) {
      const h = houses.at(p.x, p.y);
      if (h) h.residents = Math.max(0, h.residents + (forward ? p.n : -p.n));
    }
    return { ok: true };
  }

  /** Why this step cannot go now, or null when it can. Changes nothing. */
  private refusal(forward: boolean, takes: readonly GoodsMove[]): string | null {
    const { builder: b, fleet } = this.w;
    for (const [k, state] of forward ? this.before : this.after)
      if (tileState(b, k % b.map.w, Math.floor(k / b.map.w)) !== state)
        return STR.history.builtOver;
    const rails: Tile[] = [];
    for (const op of this.ops) {
      if (op.op === 'track' && (forward ? op.was : op.now)) rails.push(...op.tiles);
      if (op.op !== 'station' || op.built === forward) continue;
      const bound = fleet.trainBoundFor(op.station);
      if (bound) return STR.history.routedTo(bound.name, op.station.name);
      rails.push(...op.station.footprint());
    }
    const train = fleet.trainOn(rails);
    if (train) return STR.history.trainOn(train.name);
    const short = b.stores.shortOf(takes);
    if (short) return STR.history.short(b.stores.label(short.store), fmtCost(short.missing));
    return null;
  }

  private apply(op: BuildOp, forward: boolean) {
    const { builder: b, towns, houses } = this.w;
    switch (op.op) {
      case 'track':
        b.setTrack(op.x, op.y, forward ? op.now : op.was);
        break;
      case 'supply':
        b.setSupply(op.x, op.y, forward ? op.now : op.was);
        break;
      case 'road':
        b.setRoad(op.x, op.y, op.laid === forward);
        break;
      case 'station':
        if (op.built === forward) {
          op.station.work = op.work;
          if (op.town) towns.restore(op.town.town, op.town.index);
          b.standStation(op.station, op.index);
        } else {
          keepStation(this.w, op);
          b.dropStation(op.station);
        }
        break;
      case 'decor':
        if (op.built === forward) {
          if (op.house) houses.restore({ ...op.house });
          b.standDecor(op.decor);
        } else {
          keepHouse(this.w, op);
          b.dropDecor(op.decor);
        }
        break;
      case 'building':
        if (op.built === forward) {
          if (op.work) op.building.work = op.work;
          b.standBuilding(op.building);
        } else {
          op.work = op.building.work;
          b.dropBuilding(op.building);
        }
        break;
      case 'stationLevel': {
        // what stands now, a work finished since or not, is what the way back comes to
        const to = forward ? op.now : op.was;
        if (forward) op.was = stationLevelOf(op.station);
        else op.now = stationLevelOf(op.station);
        b.setStationLevel(op.station, to.level, to.work);
        break;
      }
      case 'worksLevel': {
        const to = forward ? op.now : op.was;
        if (forward) op.was = worksLevelOf(op.building);
        else op.now = worksLevelOf(op.building);
        b.setWorksLevel(op.building, to.level, to.work);
        break;
      }
      case 'name':
        op.station.name = forward ? op.now : op.was;
        break;
    }
  }
}

const lineName = (cls: TrackClass) => STR.toolbar.trackClass[cls] ?? cls;

/** The lines a piece moved to: one for a straight, up to two for a crossing. */
function linesReached(op: TrackOp): TrackClass[] {
  const { was, now } = op;
  if (!was || !now) return [];
  const out = now.cls !== was.cls ? [now.cls] : [];
  if (now.cls2 && now.cls2 !== (was.cls2 ?? was.cls)) out.push(now.cls2);
  return out;
}

/** What a stretch of track work is called: its tiles and line, or plain words for several lines. */
function trackLabel(ops: TrackOp[]): string {
  const H = STR.history;
  const n = ops.reduce((sum, op) => sum + op.tiles.length, 0);
  const dir = ops.find((op) => op.reclass)?.reclass;
  if (dir) {
    const lines = new Set(ops.flatMap(linesReached));
    const [line] = lines;
    if (lines.size !== 1) return dir === 'up' ? H.upgradedTrack : H.downgradedTrack;
    return dir === 'up' ? H.upgradedTiles(n, lineName(line)) : H.downgradedTiles(n, lineName(line));
  }
  const lifted = ops.every((op) => !op.now);
  const pieces = ops.flatMap((op) => (lifted ? op.was : op.now) ?? []);
  // a crossing has two lines: a run through one is named after the plain pieces around it
  const plain = pieces.filter((p) => p.kind !== 'crossing');
  const lines = new Set((plain.length ? plain : pieces).map((p) => p.cls));
  const [line] = lines;
  if (lines.size !== 1) return lifted ? H.demolished(H.track) : H.built(H.track);
  return lifted ? H.demolishedTiles(n, lineName(line)) : H.builtTiles(n, lineName(line));
}

/** What a step is called, in the words of its tooltip and toasts. */
export function stepLabel(ops: readonly BuildOp[]): string {
  const H = STR.history;
  const tracks = ops.filter((op): op is TrackOp => op.op === 'track');
  if (tracks.length) return trackLabel(tracks);
  const main = ops.filter((op) => op.op !== 'road' || !op.spur);
  const first = main[0] ?? ops[0];
  const done = (built: boolean, what: string) => (built ? H.built(what) : H.demolished(what));
  switch (first.op) {
    case 'station':
      return done(first.built, first.built ? first.station.def.name : first.station.name);
    case 'decor':
      return done(first.built, decorDef(first.decor.id).name);
    case 'building':
      return done(first.built, buildingDef(first.building.id).name);
    case 'supply': {
      const n = main.filter((op) => op.op === 'supply').length;
      const kind = STR.toolbar.supply[first.now ?? first.was ?? ''];
      return first.now ? H.builtTiles(n, kind) : H.demolishedTiles(n, kind);
    }
    case 'road': {
      const n = main.filter((op) => op.op === 'road').length;
      return first.laid ? H.builtTiles(n, H.road) : H.demolishedTiles(n, H.road);
    }
    case 'stationLevel': {
      const { was, now } = first;
      return now.level < was.level
        ? H.downgradedTo(first.station.name, now.level)
        : H.upgradedTo(first.station.name, was.level + 1);
    }
    case 'worksLevel':
      return H.upgradedTo(
        buildingDef(first.building.id).name,
        buildingLevel({ ...first.building, level: first.was.level }) + 1,
      );
    case 'name':
      return H.renamed(first.was, first.now);
    default:
      return H.built(H.track);
  }
}
