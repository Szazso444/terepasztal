import { DIRS, DIR_DX, DIR_DY, opposite, type Dir } from '../engine/iso';
import type { TrackGraph, TrackPiece } from '../world/track';
import { content, type Cost } from '../data/content';
import { STR } from '../strings';
import { streetDoors, type Door, type PlaceAt } from './doors';

/**
 * Roads the player lays for stone (Q36 a). Walkers prefer them and go twice their pace along them
 * (`findWalk` and `walkSpeed` in people.ts). A road is kept per tile, so a picture of it can be
 * joined from each tile's four neighbours (`joins`). A road may cross a plain straight of regular
 * or narrow track at right angles: that tile is a level crossing, the track on it is not changed
 * and trains run over it as before. Where a road may go and what it costs is the builder's
 * (`Builder.checkRoad`); this module holds the tiles and the level-crossing rule.
 *
 * A road never stands on a building, and joins one only at a street door (src/sim/doors.ts, #408):
 * on the tile outside it (`Door.reach`), towards it (`roadLinks`), and a place a road reaches so is
 * served (`roadServes`). The game lays the road from a door to the road network itself, free (D2,
 * the author on 2026-10-14): the spur `findSpur` finds, which `Builder` lays when a place is
 * placed and when the player lays a road near a door that has none.
 */

/** What a save keeps of the roads (v20): each road tile as [x, y]. */
export type RoadJSON = [number, number][];

/** Road tiles as a walk reads them. */
export interface RoadTiles {
  has(x: number, y: number): boolean;
}

/** What one road tile costs before the build cost tuning: `road.cost` in track.json. */
export function roadCost(): Cost {
  return content.track.road.cost;
}

/** A road may cross this piece: a plain one-tile straight of regular or narrow track. */
export function crossable(piece: TrackPiece): boolean {
  return piece.kind === 'straight' && !piece.unit && piece.cls !== 'high_speed';
}

/**
 * Why a road on (x, y) may not share the tile with `piece`, or null when it may: there is no
 * track there, or the road crosses a plain straight of regular or narrow track at right angles,
 * so neither tile the rails run on to holds a road (`road`). No road crosses a curve, a switch, a
 * track crossing or a transition, nor any high-speed track.
 */
export function crossingRefusal(
  piece: TrackPiece | undefined,
  x: number,
  y: number,
  road: (x: number, y: number) => boolean,
): string | null {
  if (!piece) return null;
  if (piece.kind !== 'straight' || piece.unit) return STR.build.crossingStraight;
  if (piece.cls === 'high_speed') return STR.build.crossingHighSpeed;
  for (const d of piece.links[0] ?? [])
    if (road(x + DIR_DX[d], y + DIR_DY[d])) return STR.build.crossingAlong;
  return null;
}

/** The road tiles of a map, on the map's track (`track` keys tiles as these are keyed). */
export class Roads implements RoadTiles {
  /** road tiles keyed `y * w + x`, in the order they were laid */
  private readonly tiles = new Set<number>();
  /** bumped on every change, for whatever keeps something it worked out from the roads */
  version = 0;
  constructor(readonly track: TrackGraph) {}

  get w() {
    return this.track.w;
  }
  get h() {
    return this.track.h;
  }
  /** The key of tile (x, y), the one `TrackGraph.key` gives it. */
  key(x: number, y: number) {
    return y * this.w + x;
  }
  private inBounds(x: number, y: number) {
    return (
      Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < this.w && y < this.h
    );
  }
  has(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.tiles.has(this.key(x, y));
  }
  /** How many tiles hold a road. */
  get size() {
    return this.tiles.size;
  }
  /** Every road tile, in the order laid. */
  list(): { x: number; y: number }[] {
    return [...this.tiles].map((k) => ({ x: k % this.w, y: Math.floor(k / this.w) }));
  }
  /**
   * The sides of (x, y) its road joins, one bit a side (`1 << Dir`): a side is joined when the
   * tile beyond it holds a road too. 0 for a tile with no road.
   */
  joins(x: number, y: number): number {
    if (!this.has(x, y)) return 0;
    let bits = 0;
    for (const d of DIRS) if (this.has(x + DIR_DX[d], y + DIR_DY[d])) bits |= 1 << d;
    return bits;
  }
  /** Lay a road on (x, y), asking no rule; false when the tile is off the map or has one. */
  add(x: number, y: number): boolean {
    if (!this.inBounds(x, y) || this.tiles.has(this.key(x, y))) return false;
    this.tiles.add(this.key(x, y));
    this.version++;
    return true;
  }
  /** Take the road off (x, y); false when there is none. */
  remove(x: number, y: number): boolean {
    if (!this.has(x, y)) return false;
    this.tiles.delete(this.key(x, y));
    this.version++;
    return true;
  }

  /** A level crossing: a road on a plain straight of regular or narrow track (`crossable`). */
  isCrossing(x: number, y: number): boolean {
    const piece = this.has(x, y) ? this.track.get(x, y) : undefined;
    return !!piece && crossable(piece);
  }
  /** The keys of every level crossing, as the track keys its tiles (`y * w + x`). */
  crossingKeys(): Set<number> {
    const out = new Set<number>();
    for (const k of this.tiles) if (this.isCrossing(k % this.w, Math.floor(k / this.w))) out.add(k);
    return out;
  }
  /**
   * Why a road may not be laid on (x, y) for the track on it or beside it, or null when it may:
   * the tile's own piece has to take a level crossing (`crossingRefusal`), and no level crossing
   * beside it may have its rails run on to this tile, where the road would run along its track.
   */
  trackRefusal(x: number, y: number): string | null {
    const road = (rx: number, ry: number) => (rx === x && ry === y) || this.has(rx, ry);
    const own = crossingRefusal(this.track.get(x, y), x, y, road);
    if (own) return own;
    for (const d of DIRS) {
      const nx = x + DIR_DX[d];
      const ny = y + DIR_DY[d];
      if (this.isCrossing(nx, ny)) {
        const why = crossingRefusal(this.track.get(nx, ny), nx, ny, road);
        if (why) return why;
      }
    }
    return null;
  }

  /** A copy of these roads on the same track, to try roads on without laying them here. */
  copy(): Roads {
    const out = new Roads(this.track);
    for (const k of this.tiles) out.tiles.add(k);
    return out;
  }

  toJSON(): RoadJSON {
    return this.list().map(({ x, y }) => [x, y]);
  }
  /**
   * The roads a save holds, in place of any here. An entry that is no [x, y] pair of whole numbers
   * on the map is skipped, and so is a second road on a tile; anything but a list loads none.
   */
  load(j: unknown) {
    this.tiles.clear();
    this.version++;
    if (!Array.isArray(j)) return;
    for (const t of j as unknown[]) {
      if (!Array.isArray(t)) continue;
      const [x, y] = t as unknown[];
      if (typeof x === 'number' && typeof y === 'number') this.add(x, y);
    }
  }
}

// ------------------------------------------------------------------ doors (#408)

/** What a road tile joins, as a picture of it reads them (`roadLinks`). */
export interface RoadLinks {
  /**
   * every side the road joins, one bit a side (`1 << Dir`): a side whose next tile holds a road
   * (`Roads.joins`), and a side a street door faces the tile across (`doors`)
   */
  sides: number;
  /**
   * the sides of `sides` that lead into a building: the tile is the `reach` of a street door, and
   * the door's tile is across that side. A platform door has none, and neither has any other side
   * of a footprint: a road joins a building only at a street door, and only towards it.
   */
  doors: number;
}

/**
 * The sides the road on (x, y) joins (`RoadLinks`), with `doors` the street doors there are (the
 * `streetDoors` of every place; any other door in the list is passed over). Nothing for a tile
 * with no road.
 */
export function roadLinks(roads: Roads, doors: readonly Door[], x: number, y: number): RoadLinks {
  if (!roads.has(x, y)) return { sides: 0, doors: 0 };
  let into = 0;
  for (const d of doors)
    if (d.kind === 'street' && d.reach.x === x && d.reach.y === y) into |= 1 << opposite(d.side);
  return { sides: roads.joins(x, y) | into, doors: into };
}

/**
 * A road serves the place: one stands on the `reach` tile of one of its street doors. A platform
 * door does not count (#406 D1). A place without a road still has its door, and walkers use its
 * reach tile off the road.
 */
export function roadServes(roads: RoadTiles, place: PlaceAt): boolean {
  return streetDoors(place).some((d) => roads.has(d.reach.x, d.reach.y));
}

/**
 * The longest spur the game lays from a street door to a road, in tiles, the door's reach tile
 * among them: the bound of the search `findSpur` makes, so a road this many tiles off or nearer is
 * joined. A door further from every road gets its reach tile alone (`Builder.laySpur`).
 */
export const SPUR_REACH = 12;

/** The rails of the piece on (x, y) run through its side `d`. */
function railsThrough(track: TrackGraph, x: number, y: number, d: Dir): boolean {
  return !!track.get(x, y)?.links.some((l) => l.includes(d));
}

/**
 * The spur from a door's reach tile `from` to the road network (D2): the fewest tiles, side to
 * side, from `from` to a tile beside a road `network` takes (any road, unless it says otherwise),
 * at most SPUR_REACH of them; null when none is that near. Every tile but `from` is one `free`
 * lets a road be laid on as the map stands, and no rails run through a side two tiles of the spur
 * share, nor the side its last tile shares with the road it joins: where the spur crosses track it
 * crosses at right angles, as a level crossing must, and no tile of it lies where the rails of one
 * of its own crossings run on to. Of spurs alike in length the first wins, their steps compared in
 * turn, each one's sides in the order N, E, S, W. `from` holds no road.
 *
 * The search goes nearest first over the tiles a spur may take, none where the rails of `from` run
 * on to it or its own rails run on to `from`, and the first way it finds to the network is the
 * spur when it keeps that rule whole. When it does not, as where it crosses a line and comes back
 * beside the rails, every way is tried in turn, a tile longer each round, and a way is cut where
 * the tiles still to come could not fit in.
 */
export function findSpur(
  roads: Roads,
  from: { x: number; y: number },
  free: (x: number, y: number) => boolean,
  network: (x: number, y: number) => boolean = (x, y) => roads.has(x, y),
): { x: number; y: number }[] | null {
  const { w, h, track } = roads;
  const tileOf = (k: number) => ({ x: k % w, y: Math.floor(k / w) });
  /** the key of the tile across side `d` of tile `k`; -1 off the map */
  const beside = (k: number, d: Dir) => {
    const x = (k % w) + DIR_DX[d];
    const y = Math.floor(k / w) + DIR_DY[d];
    return x < 0 || y < 0 || x >= w || y >= h ? -1 : y * w + x;
  };
  /** the tile a step from tile `k` through side `d` goes to; -1 off the map or along rails */
  const step = (k: number, d: Dir) => {
    const n = beside(k, d);
    if (n < 0) return -1;
    const at = tileOf(k);
    const to = tileOf(n);
    return railsThrough(track, at.x, at.y, d) || railsThrough(track, to.x, to.y, opposite(d))
      ? -1
      : n;
  };
  /** a step from tile `k` joins a road of the network */
  const joins = (k: number) =>
    DIRS.some((d) => {
      const n = step(k, d);
      return n >= 0 && network(n % w, Math.floor(n / w));
    });
  /** no rails run through a side tile `k` shares with a tile of `spur` */
  const clear = (k: number, spur: Set<number>) =>
    DIRS.every((d) => !spur.has(beside(k, d)) || step(k, d) >= 0);

  // nearest first: every tile a spur may take within the bound, its tiles that far, its way there;
  // none where the rails of `from` run on to it, or its own rails run on to `from`
  const start = from.y * w + from.x;
  const origin = new Set([start]);
  const prev = new Map<number, number>([[start, -1]]);
  const tiles = new Map<number, number>([[start, 1]]);
  const queue = [start];
  const ends: number[] = [];
  for (let i = 0; i < queue.length; i++) {
    const k = queue[i];
    // beside a road: a spur may end here and join it
    if (joins(k)) {
      if (!ends.length) {
        const first: number[] = [];
        for (let t = k; t >= 0; t = prev.get(t)!) first.push(t);
        const on = new Set(first);
        if (first.every((t) => clear(t, on))) return first.reverse().map(tileOf);
      }
      ends.push(k);
      continue;
    }
    if (tiles.get(k)! >= SPUR_REACH) continue;
    for (const d of DIRS) {
      const n = step(k, d);
      if (n < 0 || prev.has(n)) continue;
      const { x, y } = tileOf(n);
      if (roads.has(x, y) || !clear(n, origin) || !free(x, y)) continue;
      prev.set(n, k);
      tiles.set(n, tiles.get(k)! + 1);
      queue.push(n);
    }
  }
  if (!ends.length) return null;

  // the fewest tiles still to come after each of those tiles, back from where a spur may end
  const left = new Map<number, number>(ends.map((k) => [k, 0]));
  const back = [...ends];
  for (let i = 0; i < back.length; i++)
    for (const d of DIRS) {
      const n = step(back[i], d);
      if (n < 0 || !prev.has(n) || left.has(n)) continue;
      left.set(n, left.get(back[i])! + 1);
      back.push(n);
    }
  // every way of at most `most` tiles, each tile's sides in turn: the first that ends wins
  const way: number[] = [];
  const laid = new Set<number>();
  const go = (k: number, most: number): boolean => {
    way.push(k);
    laid.add(k);
    if (left.get(k) === 0) return true;
    for (const d of DIRS) {
      const n = step(k, d);
      const rest = n < 0 || laid.has(n) ? undefined : left.get(n);
      if (rest === undefined || way.length + 1 + rest > most || !clear(n, laid)) continue;
      if (go(n, most)) return true;
    }
    way.pop();
    laid.delete(k);
    return false;
  };
  for (let most = 1 + left.get(start)!; most <= SPUR_REACH; most++)
    if (go(start, most)) return way.map(tileOf);
  return null;
}
