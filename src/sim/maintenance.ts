/**
 * Maintenance trains: which piece each one looks after (spec, section 6). A train looks when it
 * starts, finishes or leaves a job, never per frame: one search per tier, every job of the tier a
 * target, gives the nearest it can reach. The claims are the jobs the trains hold (`Train.maint`),
 * so they come back with a save and end with the train.
 */
import { DIR_DX, DIR_DY, DIRS, opposite } from '../engine/iso';
import type { PathSegment, PathStart } from '../world/pathfinding';
import type { TrackGraph, TrackPiece } from '../world/track';
import type { Builder } from './build';
import { rules } from './rules';
import type { Station } from './stations';
import type { Train } from './trains';

/** A piece a train looks after. */
export interface MaintJob {
  /** the piece's anchor */
  ax: number;
  ay: number;
  /** 0 unusable, 1 degraded, 2 close to degraded, as the piece stood when picked (`urgentWork`) */
  tier: 0 | 1 | 2;
  /** the tile the train stands on */
  x: number;
  y: number;
}

/** How far along the line out of a gate a train looks for a place to wait. */
const LINE_OUT_TILES = 64;

/** A tile of the map. */
interface Tile {
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

/**
 * Does this train's job go before other trains and hold its ground against them? While its piece is
 * unusable, whatever the piece was when picked; and a job begun on an unusable piece until the piece
 * is out of degraded, so the first repair does not end it. A piece that is gone asks for nothing,
 * and a job no store can pay is no work done: it holds no traffic.
 */
export function urgentWork(t: Train, track: TrackGraph): boolean {
  const job = t.maint;
  if (!job || t.repairUnpaid) return false;
  const piece = track.get(job.ax, job.ay);
  const now = piece ? tierOf(piece) : null;
  return now === 0 || (now === 1 && job.tier === 0);
}

/** What the fleet's maintenance trains are working on, and what is left to do. */
export class MaintenanceBoard {
  constructor(
    private readonly trains: () => readonly Train[],
    private readonly builder: Builder,
  ) {}
  /**
   * The train's next job, claimed for it, and the way there; null with nothing left it can reach.
   * With `ahead`, for a train under way, it looks past its head only: it does not turn at speed.
   */
  pick(t: Train, track: TrackGraph, ahead = false): { job: MaintJob; path: PathSegment[] } | null {
    this.release(t);
    const found = this.nearest(t, track, ahead ? t.pathEnds().slice(0, 1) : t.pathEnds());
    if (found) t.maint = found.job;
    return found;
  }
  /** The job `pick` would give a train standing where it stands, claiming nothing. */
  peek(t: Train, track: TrackGraph): MaintJob | null {
    return this.nearest(t, track, t.pathEnds())?.job ?? null;
  }
  /** One search per tier, from the ends given, stopping at the first that reaches a job. */
  private nearest(
    t: Train,
    track: TrackGraph,
    ends: PathStart[],
  ): { job: MaintJob; path: PathSegment[] } | null {
    for (const jobs of this.openJobs(track)) {
      if (!jobs.size) continue;
      const path = this.search(t, track, (x, y) => jobs.has(track.key(x, y)), ends);
      if (!path) continue;
      const end = path[path.length - 1];
      return { job: jobs.get(track.key(end.x, end.y))!, path };
    }
    return null;
  }
  /** The train gives its job up: the piece is on the board again. */
  release(t: Train): void {
    t.maint = null;
    t.repairUnpaid = false;
  }
  /**
   * Where a train with no work waits, and the way there; null with no depot in reach. It heads for
   * the nearest depot and stops its own length and one tile short of the gate, on plain track, so
   * that a train like it can still roll out. A train already nearer the gate than that runs out
   * along the line until its near end stands that far off. Only with no such track does it stand
   * at the gate.
   */
  park(t: Train, track: TrackGraph): { at: Tile; path: PathSegment[] } | null {
    const gates = new Map<number, Station>();
    for (const d of this.builder.depots())
      for (const p of this.builder.platformTiles(d)) gates.set(track.key(p.x, p.y), d);
    if (!gates.size) return null;
    const path = this.search(t, track, (x, y) => gates.has(track.key(x, y)));
    if (!path) return null;
    const gate = path[path.length - 1];
    const len = Math.ceil(t.length);
    const clear = this.standsClear(t, track);
    const home = path.map(({ x, y }) => ({ x, y })).reverse();
    for (let i = len + 1; i < home.length; i++)
      if (clear(home, i, i + len)) return { at: home[i], path: path.slice(0, path.length - i) };
    const out = this.lineOut(t, track, gates.get(track.key(gate.x, gate.y))!, gate);
    for (let i = 2 * len + 1; i < out.length; i++) {
      if (!clear(out, i - len, i)) continue;
      const { x, y } = out[i];
      const way = this.search(t, track, (tx, ty) => tx === x && ty === y);
      if (way) return { at: out[i], path: way };
      break;
    }
    return { at: { x: gate.x, y: gate.y }, path };
  }
  /**
   * The test of a stretch of `way` (`from` to `to`, as far as it goes) for a train to stand on:
   * plain track, no platform, switch or crossing, and clear of where another train waits.
   */
  private standsClear(t: Train, track: TrackGraph) {
    const platforms = new Set<number>();
    for (const s of this.builder.stations)
      for (const p of this.builder.platformTiles(s)) platforms.add(track.key(p.x, p.y));
    const others = this.waiting(t);
    const taken = new Set<number>();
    for (const o of others) {
      taken.add(track.key(o.parkAt!.x, o.parkAt!.y));
      if (o.state === 'idle') for (const k of o.occupancyKeys(track.w)) taken.add(k);
    }
    const back = Math.max(0, ...others.map((o) => Math.ceil(o.length))) + 1;
    const plain = ({ x, y }: Tile) => {
      const kind = track.get(x, y)?.kind;
      return kind !== 'switch' && kind !== 'crossing' && !platforms.has(track.key(x, y));
    };
    return (way: readonly Tile[], from: number, to: number) =>
      way.slice(from, to + 1).every(plain) &&
      !way.slice(Math.max(0, from - back), to + 2).some((p) => taken.has(track.key(p.x, p.y)));
  }
  /** The other trains waiting for work, or on their way to wait. */
  private waiting(t: Train): Train[] {
    return this.trains().filter((o) => o !== t && o.parkAt);
  }
  /** The tiles of the line out of a gate, straight on at a switch, as far as the train may run. */
  private lineOut(t: Train, track: TrackGraph, depot: Station, gate: Tile): Tile[] {
    const tiles: Tile[] = [{ x: gate.x, y: gate.y }];
    const links = track.get(gate.x, gate.y)?.links ?? [];
    let entry = depot.gateEntry(gate, links);
    while (entry !== undefined && tiles.length <= LINE_OUT_TILES) {
      const at = tiles[tiles.length - 1];
      const exits = track.exits(at.x, at.y, entry);
      const leave = exits.find((e) => e === opposite(entry!)) ?? exits[0];
      if (leave === undefined || !track.connected(at.x, at.y, leave)) break;
      const next = { x: at.x + DIR_DX[leave], y: at.y + DIR_DY[leave] };
      entry = opposite(leave);
      if (!t.canUse(track.get(next.x, next.y)!, entry)) break;
      tiles.push(next);
    }
    return tiles;
  }
  /**
   * The way to the nearest target from the ends given, by default either end of the train, one
   * search whichever it turns out to be. A train with an end on a target already has a way of that
   * one tile.
   */
  private search(
    t: Train,
    track: TrackGraph,
    isTarget: (x: number, y: number) => boolean,
    ends = t.pathEnds(),
  ): PathSegment[] | null {
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
