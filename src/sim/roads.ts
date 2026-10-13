import { DIRS, DIR_DX, DIR_DY } from '../engine/iso';
import type { TrackGraph, TrackPiece } from '../world/track';
import { content, type Cost } from '../data/content';
import { STR } from '../strings';

/**
 * Roads the player lays for stone (Q36 a). Walkers prefer them and go twice their pace along them
 * (`findWalk` and `walkSpeed` in people.ts). A road is kept per tile, so a picture of it can be
 * joined from each tile's four neighbours (`joins`). A road may cross a plain straight of regular
 * or narrow track at right angles: that tile is a level crossing, the track on it is not changed
 * and trains run over it as before. Where a road may go and what it costs is the builder's
 * (`Builder.checkRoad`); this module holds the tiles and the level-crossing rule.
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
