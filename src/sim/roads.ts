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
 * lets a road be laid on as the map stands, and no step runs along rails (into or out of a tile
 * through a side its rails run through), so where a spur crosses track it crosses at right angles,
 * as a level crossing must. Of spurs alike in length the first found wins: tiles are searched
 * nearest first, and each one's sides in the order N, E, S, W. `from` holds no road. No tile is
 * judged here against the spur's other tiles: a builder still judges the spur whole, tile by tile,
 * before it lays it.
 */
export function findSpur(
  roads: Roads,
  from: { x: number; y: number },
  free: (x: number, y: number) => boolean,
  network: (x: number, y: number) => boolean = (x, y) => roads.has(x, y),
): { x: number; y: number }[] | null {
  const { w, h, track } = roads;
  const key = (x: number, y: number) => y * w + x;
  const prev = new Map<number, number>([[key(from.x, from.y), -1]]);
  const queue: { x: number; y: number; tiles: number }[] = [{ ...from, tiles: 1 }];
  /** the tile a step from (x, y) through side `d` goes to; null off the map or along rails */
  const step = (x: number, y: number, d: Dir) => {
    const nx = x + DIR_DX[d];
    const ny = y + DIR_DY[d];
    if (nx < 0 || ny < 0 || nx >= w || ny >= h) return null;
    if (railsThrough(track, x, y, d) || railsThrough(track, nx, ny, opposite(d))) return null;
    return { x: nx, y: ny };
  };
  for (let i = 0; i < queue.length; i++) {
    const at = queue[i];
    const beside = DIRS.some((d) => {
      const n = step(at.x, at.y, d);
      return !!n && network(n.x, n.y);
    });
    // beside a road: the spur ends here and joins it
    if (beside) {
      const out: { x: number; y: number }[] = [];
      for (let k = key(at.x, at.y); k >= 0; k = prev.get(k)!)
        out.push({ x: k % w, y: Math.floor(k / w) });
      return out.reverse();
    }
    if (at.tiles >= SPUR_REACH) continue;
    for (const d of DIRS) {
      const n = step(at.x, at.y, d);
      if (!n || prev.has(key(n.x, n.y)) || roads.has(n.x, n.y) || !free(n.x, n.y)) continue;
      prev.set(key(n.x, n.y), key(at.x, at.y));
      queue.push({ ...n, tiles: at.tiles + 1 });
    }
  }
  return null;
}
