import { DIR_DX, DIR_DY, opposite, type Dir } from '../engine/iso';
import type { TrackGraph, TrackPiece } from '../world/track';
import type { PathSegment } from '../world/pathfinding';

export interface WaitingTrain {
  id: number;
  blockedBy: number | null;
  claimBlocker: number | null;
  claimLimit: number;
  blocked: boolean;
}

/** Connected wait-for groups, including queues feeding a cycle and parked blockers. */
export function blockingGroups<T extends WaitingTrain>(trains: T[]): T[][] {
  const byId = new Map(trains.map((t) => [t.id, t]));
  const edges = new Map<number, Set<number>>();
  for (const t of trains) {
    // Include approaching queues too: they may already occupy the first train's escape.
    const other = t.blockedBy ?? t.claimBlocker;
    if (other === null || other === t.id || !byId.has(other)) continue;
    for (const [a, b] of [
      [t.id, other],
      [other, t.id],
    ]) {
      if (!edges.has(a)) edges.set(a, new Set());
      edges.get(a)!.add(b);
    }
  }
  const seen = new Set<number>();
  const groups: T[][] = [];
  for (const id of edges.keys()) {
    if (seen.has(id)) continue;
    const group: T[] = [];
    const pending = [id];
    seen.add(id);
    while (pending.length) {
      const next = pending.pop()!;
      group.push(byId.get(next)!);
      for (const neighbor of edges.get(next) ?? [])
        if (!seen.has(neighbor)) {
          seen.add(neighbor);
          pending.push(neighbor);
        }
    }
    groups.push(group);
  }
  return groups;
}

/** Members of directed wait-for cycles, excluding the queues that feed into them. */
export function blockingCycles(trains: WaitingTrain[]): Set<number> {
  const next = new Map(trains.map((t) => [t.id, t.blockedBy ?? t.claimBlocker]));
  const done = new Set<number>();
  const cycles = new Set<number>();
  for (const t of trains) {
    const path: number[] = [];
    const at = new Map<number, number>();
    let id: number | null | undefined = t.id;
    while (id !== null && id !== undefined && next.has(id) && !done.has(id)) {
      const seen = at.get(id);
      if (seen !== undefined) {
        for (const member of path.slice(seen)) cycles.add(member);
        break;
      }
      at.set(id, path.length);
      path.push(id);
      id = next.get(id);
    }
    for (const member of path) done.add(member);
  }
  return cycles;
}

/**
 * Search directed track states with a second state variable: clear rail behind the head.
 * The train stops at the final tile's centre, so only half that tile counts towards refuge
 * length. Switches, platforms and the waiting group's routes reset the clearance to zero.
 * No repeated tile is allowed: circling a short loop must not manufacture parking capacity.
 */
export function findRefugePath(
  track: TrackGraph,
  start: { x: number; y: number; in: Dir },
  length: number,
  blocked: (x: number, y: number) => boolean,
  refuge: (x: number, y: number) => boolean,
  access: (piece: TrackPiece, entry: Dir) => boolean,
): PathSegment[] | null {
  type State = { x: number; y: number; in: Dir; clear: number; path: PathSegment[] };
  const queue: State[] = [{ ...start, clear: 0, path: [] }];
  const seen = new Set<string>();
  for (let i = 0; i < queue.length && i < 12000; i++) {
    const s = queue[i];
    const exits = track.exits(s.x, s.y, s.in);
    for (const out of exits) {
      const seg = { x: s.x, y: s.y, in: s.in, out };
      const arc = track.segLength(s.x, s.y, s.in, out);
      const clear = refuge(s.x, s.y) ? s.clear : 0;
      const path = [...s.path, seg];
      if (refuge(s.x, s.y) && clear + arc / 2 >= length + 0.5) {
        track.resolveRoutes(path);
        return path;
      }
      const x = s.x + DIR_DX[out];
      const y = s.y + DIR_DY[out];
      const entry = opposite(out);
      if (!track.opensTo(x, y, entry) || blocked(x, y)) continue;
      if (!access(track.get(x, y)!, entry)) continue;
      if (path.some((p) => p.x === x && p.y === y)) continue;
      // Round down: a bucket can lose parking room but never invent it.
      const nextClear = refuge(s.x, s.y) ? Math.floor((clear + arc) * 20) / 20 : 0;
      const key = `${x},${y},${entry},${nextClear}`;
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push({ x, y, in: entry, clear: nextClear, path });
    }
  }
  return null;
}

export interface RecoveryReservation {
  owner: number;
  group: number[];
  tiles: Set<number>;
  started: number;
  progressed: number;
  progress: number;
  version: number;
}

/** Exclusive route leases: both the group and its escape corridor have one owner. */
export class RecoveryReservations {
  readonly active = new Map<number, RecoveryReservation>();

  hasGroup(group: number[]) {
    return [...this.active.values()].some((p) => p.group.some((id) => group.includes(id)));
  }

  ownerAt(key: number, self: number) {
    for (const p of this.active.values()) if (p.owner !== self && p.tiles.has(key)) return p.owner;
    return null;
  }

  reserve(owner: number, group: number[], tiles: Set<number>, now: number, version: number) {
    if (this.hasGroup(group)) return false;
    for (const k of tiles) if (this.ownerAt(k, owner) !== null) return false;
    this.active.set(owner, {
      owner,
      group,
      tiles,
      started: now,
      progressed: now,
      progress: 0,
      version,
    });
    return true;
  }
}
