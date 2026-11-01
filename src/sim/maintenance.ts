/**
 * Maintenance trains: which piece each one looks after (spec, section 6). A train looks when it
 * starts, finishes or leaves a job, never per frame: one search per tier, every job of the tier a
 * target, gives the nearest it can reach. The claims are the jobs the trains hold (`Train.maint`),
 * so they come back with a save and end with the train.
 */
import { DIR_DX, DIR_DY, DIRS } from '../engine/iso';
import type { PathSegment } from '../world/pathfinding';
import type { TrackGraph, TrackPiece } from '../world/track';
import type { Builder } from './build';
import { rules } from './rules';
import type { Station } from './stations';
import type { Train } from './trains';

/** Game seconds between two looks for work of a train with none. */
export const MAINT_LOOK_EVERY = 30;

/** A piece a train looks after. */
export interface MaintJob {
  /** the piece's anchor */
  ax: number;
  ay: number;
  /** 0 unusable, 1 degraded, 2 close to degraded */
  tier: 0 | 1 | 2;
  /** the tile the train stands on */
  x: number;
  y: number;
}

/** The tier a piece's health puts it in; null for a piece that needs no looking after. */
function tierOf(p: TrackPiece): MaintJob['tier'] | null {
  const h = p.wear.health;
  if (h <= 0) return 0;
  if (h < rules.trackDegradedAt) return 1;
  return h < rules.trackCloseAt ? 2 : null;
}

/** What the fleet's maintenance trains are working on, and what is left to do. */
export class MaintenanceBoard {
  constructor(
    private readonly trains: () => readonly Train[],
    private readonly builder: Builder,
  ) {}
  /** The train's next job, claimed for it, and the way there; null with nothing left it can reach. */
  pick(t: Train, track: TrackGraph): { job: MaintJob; path: PathSegment[] } | null {
    this.release(t);
    for (const jobs of this.openJobs(track)) {
      if (!jobs.size) continue;
      const path = this.search(t, track, (x, y) => jobs.has(track.key(x, y)));
      if (!path) continue;
      const end = path[path.length - 1];
      const job = jobs.get(track.key(end.x, end.y))!;
      t.maint = job;
      return { job, path };
    }
    return null;
  }
  /** The train gives its job up: the piece is on the board again. */
  release(t: Train): void {
    t.maint = null;
  }
  /** The nearest depot the train can reach, and the way there. */
  depot(t: Train, track: TrackGraph): { depot: Station; path: PathSegment[] } | null {
    const gates = new Map<number, Station>();
    for (const d of this.builder.depots())
      for (const p of this.builder.platformTiles(d)) gates.set(track.key(p.x, p.y), d);
    if (!gates.size) return null;
    const path = this.search(t, track, (x, y) => gates.has(track.key(x, y)));
    if (!path) return null;
    const end = path[path.length - 1];
    return { depot: gates.get(track.key(end.x, end.y))!, path };
  }
  /**
   * The way to the nearest target from either end of the train, one search whichever it turns out
   * to be. A train with an end on a target already has a way of that one tile.
   */
  private search(
    t: Train,
    track: TrackGraph,
    isTarget: (x: number, y: number) => boolean,
  ): PathSegment[] | null {
    const ends = t.pathEnds();
    const there = ends.find((e) => isTarget(e.x, e.y));
    if (there) return [{ ...there, out: there.in }];
    return ends.length ? t.pathTo(track, ends, isTarget) : null;
  }
  /**
   * Every piece no train holds, tier by tier, keyed by the tile a train would stand on: any tile of
   * a piece it may enter. An unusable piece it may not, so that is each sound tile through an open
   * end; a piece with no sound neighbour waits for its neighbour's repair.
   */
  private openJobs(track: TrackGraph): Map<number, MaintJob>[] {
    const tiers: Map<number, MaintJob>[] = [new Map(), new Map(), new Map()];
    const claimed = new Set<number>();
    for (const o of this.trains()) if (o.maint) claimed.add(track.key(o.maint.ax, o.maint.ay));
    for (const { x: ax, y: ay, piece } of track.anchors()) {
      const tier = tierOf(piece);
      if (tier === null || claimed.has(track.key(ax, ay))) continue;
      const add = (x: number, y: number) => {
        const k = track.key(x, y);
        if (!tiers[tier].has(k)) tiers[tier].set(k, { ax, ay, tier, x, y });
      };
      for (const { x, y } of track.unitTiles(ax, ay)) {
        if (tier > 0) add(x, y);
        else
          for (const d of DIRS) {
            const nx = x + DIR_DX[d];
            const ny = y + DIR_DY[d];
            const next = track.connected(x, y, d) ? track.get(nx, ny) : undefined;
            if (next && next.wear.health > 0) add(nx, ny);
          }
      }
    }
    return tiers;
  }
}
