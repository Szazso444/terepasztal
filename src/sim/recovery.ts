import { DIRS, DIR_DX, DIR_DY, opposite, type Dir } from '../engine/iso';
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
 * A refuge `accept` turns down (one that would leave the train no way on) does not end the
 * search: it goes on to the next one. At most `cap` states are searched.
 */
export function findRefugePath(
  track: TrackGraph,
  start: { x: number; y: number; in: Dir },
  length: number,
  blocked: (x: number, y: number) => boolean,
  refuge: (x: number, y: number) => boolean,
  access: (piece: TrackPiece, entry: Dir) => boolean,
  accept?: (path: readonly PathSegment[]) => boolean,
  cap = 12000,
): PathSegment[] | null {
  type State = { x: number; y: number; in: Dir; clear: number; path: PathSegment[] };
  const queue: State[] = [{ ...start, clear: 0, path: [] }];
  const seen = new Set<string>();
  for (let i = 0; i < queue.length && i < cap; i++) {
    const s = queue[i];
    const exits = track.exits(s.x, s.y, s.in);
    for (const out of exits) {
      const seg = { x: s.x, y: s.y, in: s.in, out };
      const arc = track.segLength(s.x, s.y, s.in, out);
      const clear = refuge(s.x, s.y) ? s.clear : 0;
      const path = [...s.path, seg];
      if (refuge(s.x, s.y) && clear + arc / 2 >= length + 0.5) {
        track.resolveRoutes(path);
        if (!accept || accept(path)) return path;
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

/** States the first leg of a shunt search (`findShuntPath`) looks at. */
const SHUNT_STATES = 2000;
/** Places to turn a shunt search tries, each with a second leg of at most SHUNT_STATES states. */
export const SHUNT_TURNS = 4;

/** Plain track: no switch or crossing, where a train may stand to turn. */
function plain(piece: TrackPiece | undefined) {
  return !!piece && piece.links.length === 1 && !(piece.unit && piece.kind !== 'curve');
}

/**
 * A move with one reversal partway (a shunt), for when no refuge can be run straight into: the
 * train runs forward (`out`, never twice over a tile) over a switch and on until it stands wholly
 * on plain track past it, its head at the centre of the last tile of `out`; there it turns, and
 * runs from the tile its rear end stands on to a refuge as `findRefugePath` finds one (`back`).
 * It turns only past a switch that offers a choice coming back, at the first place past it where
 * it stands clear, and tries SHUNT_TURNS such places, nearest first: the work is bounded as
 * `findRefugePath`'s is. The train stands now on `under` and its head's tile, `under` the
 * crossings behind the head, rear end first, the way it heads: a switch there counts as one run
 * over, and its rear end may stay on them (`rearOn`: the index of its tile in them and the way
 * together, -1 when they are shorter than the train), so that a train stopped astride a switch
 * runs on just clear of it. Neither leg runs onto a `blocked` tile or one `access` bars; `accept`
 * judges the refuge.
 */
export function findShuntPath(
  track: TrackGraph,
  start: { x: number; y: number; in: Dir },
  length: number,
  blocked: (x: number, y: number) => boolean,
  refuge: (x: number, y: number) => boolean,
  access: (piece: TrackPiece, entry: Dir) => boolean,
  rearOn: (path: readonly PathSegment[]) => number,
  accept?: (path: readonly PathSegment[]) => boolean,
  under: readonly PathSegment[] = [],
): { out: PathSegment[]; back: PathSegment[] } | null {
  // `switched`: a switch with a choice coming back lies behind, and no turn was tried past it
  type State = { x: number; y: number; in: Dir; switched: boolean; path: PathSegment[] };
  const choice = (s: PathSegment) => track.exits(s.x, s.y, s.out).length > 1;
  const queue: State[] = [{ ...start, switched: under.some(choice), path: [] }];
  const seen = new Set<string>();
  let turns = 0;
  for (let i = 0; i < queue.length && i < SHUNT_STATES && turns < SHUNT_TURNS; i++) {
    const s = queue[i];
    for (const out of track.exits(s.x, s.y, s.in)) {
      const seg = { x: s.x, y: s.y, in: s.in, out };
      const path = [...s.path, seg];
      let switched = s.switched || choice(seg);
      // the tiles it stands on once its head stops on the last: some of `under`, and the way
      const stands = under.length ? [...under, ...path] : path;
      const rear = switched ? rearOn(stands) : -1;
      if (rear >= 0 && stands.slice(rear).every((p) => plain(track.get(p.x, p.y)))) {
        // further along the same plain track a turn would only run back over it
        switched = false;
        turns++;
        const from = stands[rear];
        const back = findRefugePath(
          track,
          { x: from.x, y: from.y, in: from.out },
          length,
          blocked,
          refuge,
          access,
          accept,
          SHUNT_STATES,
        );
        if (back) {
          track.resolveRoutes(path);
          return { out: path, back };
        }
        if (turns >= SHUNT_TURNS) break;
      }
      const x = s.x + DIR_DX[out];
      const y = s.y + DIR_DY[out];
      const entry = opposite(out);
      if (!track.opensTo(x, y, entry) || blocked(x, y)) continue;
      if (!access(track.get(x, y)!, entry)) continue;
      if (path.some((p) => p.x === x && p.y === y)) continue;
      const key = `${x},${y},${entry},${switched}`;
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push({ x, y, in: entry, switched, path });
    }
  }
  return null;
}

/**
 * Where the second leg starts in a shunt's escape, reserved as one way with the first leg and
 * then the second (`findShuntPath`): the first segment the one before it does not lead into.
 * The way's length when it never turns.
 */
export function turnIndex(path: readonly PathSegment[]) {
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    if (b.x !== a.x + DIR_DX[a.out] || b.y !== a.y + DIR_DY[a.out] || b.in !== opposite(a.out))
      return i;
  }
  return path.length;
}

/** Key of a directed track state (`statesReaching`): a train on (x, y) that came in through `entry`. */
export function stateKey(w: number, x: number, y: number, entry: Dir) {
  return (y * w + x) * 4 + entry;
}

/**
 * Every directed track state (`stateKey`) from which a train runs on to one of `targets` without
 * reversing, as `findPath` would find it with the consist's `access`, plus every state on a
 * target. One walk back from the targets answers the question for each refuge a search tries.
 */
export function statesReaching(
  track: TrackGraph,
  targets: Iterable<{ x: number; y: number }>,
  access: (piece: TrackPiece, entry: Dir) => boolean,
): Set<number> {
  const w = track.w;
  const states = new Set<number>();
  const queue: number[] = [];
  const add = (k: number) => {
    if (states.has(k)) return;
    states.add(k);
    queue.push(k);
  };
  for (const t of targets)
    if (track.get(t.x, t.y)) for (const d of DIRS) add(stateKey(w, t.x, t.y, d));
  for (let i = 0; i < queue.length; i++) {
    const k = queue[i];
    const entry = (k % 4) as Dir;
    const tile = (k - entry) / 4;
    const nx = tile % w;
    const ny = (tile - nx) / w;
    // the train came onto (nx, ny) through `entry`, from the neighbour on that side
    const x = nx + DIR_DX[entry];
    const y = ny + DIR_DY[entry];
    const out = opposite(entry);
    if (!track.connected(x, y, out) || !access(track.get(nx, ny)!, entry)) continue;
    for (const d of DIRS) if (track.exits(x, y, d).includes(out)) add(stateKey(w, x, y, d));
  }
  return states;
}

export interface RecoveryReservation {
  owner: number;
  group: number[];
  tiles: Set<number>;
  /** a shunt's second leg (`turnIndex`), kept whole until the train turns to run it */
  rest: Set<number>;
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

  reserve(
    owner: number,
    group: number[],
    tiles: Set<number>,
    now: number,
    version: number,
    rest = new Set<number>(),
  ) {
    if (this.hasGroup(group)) return false;
    for (const k of tiles) if (this.ownerAt(k, owner) !== null) return false;
    this.active.set(owner, {
      owner,
      group,
      tiles,
      rest,
      started: now,
      progressed: now,
      progress: 0,
      version,
    });
    return true;
  }
}
