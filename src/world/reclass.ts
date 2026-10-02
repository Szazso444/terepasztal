import { Dir, DIR_DX, DIR_DY, opposite } from '../engine/iso';
import {
  TRACK_ITEMS,
  pieceLinks,
  portClass,
  transitionRot,
  type SwitchForm,
  type TrackClass,
  type TrackGraph,
  type TrackKind,
  type TrackPiece,
} from './track';

/** The two classes track can be converted between in place: their pieces have the same shapes. */
export type WideClass = 'regular' | 'high_speed';

/** A piece to lay at an anchor tile, over the piece that is there. */
export interface PieceChange {
  x: number;
  y: number;
  kind: TrackKind;
  rot: number;
  cls: TrackClass;
  cls2?: TrackClass;
  form?: SwitchForm;
}
export interface ReclassPlan {
  changes: PieceChange[];
  /** why nothing changes: only narrow track, nothing left to convert, or a joint that cannot be kept */
  reason?: 'narrow' | 'nothing' | 'blocked';
}
type Virtual = Omit<PieceChange, 'x' | 'y'>;
type Tile = { x: number; y: number };

/** The crossing piece and turn that carry these classes on the two lines, if there is one. */
function crossingFor(ns: TrackClass, ew: TrackClass, prefer: number): Virtual | null {
  for (const rot of [prefer % 2, (prefer + 1) % 2]) {
    const first = pieceLinks('crossing', rot)[0];
    const northSouth = first.includes(Dir.N);
    const cls = northSouth ? ns : ew,
      cls2 = northSouth ? ew : ns;
    if (
      TRACK_ITEMS.some((i) => i.kind === 'crossing' && i.cls === cls && (i.cls2 ?? i.cls) === cls2)
    )
      return { kind: 'crossing', rot, cls, cls2 };
  }
  return null;
}

/**
 * Plan the conversion of the pieces on `seeds` to class `target` (wide to high speed or back).
 *
 * Wide and high-speed track join only through a transition, so the plan keeps every joint that
 * carries trains today: a converted straight that still meets the other class becomes a
 * transition, a converted curve, switch or crossing turns the straight beside it into one, and
 * where no straight lies between two such pieces the conversion carries on through the next one.
 * A crossing converts by line: the one the stroke runs along (`from` is the tile it came from).
 * Nothing is changed here; the caller lays the pieces.
 */
export function planReclass(
  track: TrackGraph,
  seeds: Tile[],
  target: WideClass,
  from?: Tile,
): ReclassPlan {
  const other: WideClass = target === 'high_speed' ? 'regular' : 'high_speed';
  const key = (x: number, y: number) => y * track.w + x;
  /** pieces after the plan, by anchor */
  const next = new Map<number, Virtual>();
  /** crossings: the lines (link indexes) being converted */
  const lines = new Map<number, Set<number>>();
  /** curves, switches and crossing lines whose joints are still to be looked at */
  const walk: { x: number; y: number; line?: number }[] = [];
  /** straights and transitions that settle at the end: transition where they still meet the other class */
  const settle = new Map<number, Tile>();
  let blocked = false;
  let sawNarrow = false;

  const lineClass = (p: TrackPiece, i: number) => (i === 0 ? p.cls : (p.cls2 ?? p.cls));
  /** Will the piece on this tile present the other class on edge `d` once the plan is laid? */
  const presentsOther = (x: number, y: number, d: Dir): boolean => {
    const p = track.get(x, y);
    if (!p) return false;
    const a = track.anchorOf(x, y);
    const k = key(a.x, a.y);
    if (settle.has(k)) return false;
    const v = next.get(k);
    if (!v) return portClass(p, d) === other;
    if (v.kind !== 'crossing') return v.cls === other;
    const second = pieceLinks('crossing', v.rot)[1];
    return (second.includes(d) ? v.cls2 : v.cls) === other;
  };

  /** Bring the piece on a tile into the plan. `via` is the edge of that tile the stroke or the joint comes through. */
  const want = (x: number, y: number, via?: Dir): 'ok' | 'skip' | 'blocked' => {
    const p = track.get(x, y);
    if (!p) return 'skip';
    const a = track.anchorOf(x, y);
    const k = key(a.x, a.y);
    if (p.kind === 'transition') {
      settle.set(k, a);
      return 'ok';
    }
    if (p.kind === 'crossing') {
      const convertible = [0, 1].filter((i) => lineClass(p, i) === other);
      if ([0, 1].some((i) => lineClass(p, i) === 'narrow')) sawNarrow = true;
      let picked: number[];
      if (via !== undefined) picked = convertible.filter((i) => p.links[i].includes(via));
      else {
        // a click: the line that track of the new class already runs up to, else every line
        const reached = convertible.filter((i) =>
          p.links[i].some((d) => {
            const q = track.get(x + DIR_DX[d], y + DIR_DY[d]);
            if (!q || !track.opensTo(x + DIR_DX[d], y + DIR_DY[d], opposite(d))) return false;
            return q.kind === 'transition' || portClass(q, opposite(d)) === target;
          }),
        );
        picked = reached.length ? reached : convertible;
      }
      // nothing of the other class on the line asked for: it is narrow, or converted already
      if (!picked.length) return 'skip';
      const mine = lines.get(k) ?? new Set<number>();
      picked = picked.filter((i) => !mine.has(i));
      if (!picked.length) return 'ok';
      for (const i of picked) mine.add(i);
      const cls = (i: number) => (mine.has(i) ? target : lineClass(p, i));
      const northSouth = p.links[0].includes(Dir.N) ? 0 : 1;
      const v = crossingFor(cls(northSouth), cls(1 - northSouth), p.rot);
      if (!v) return 'blocked';
      lines.set(k, mine);
      next.set(k, v);
      for (const i of picked) walk.push({ x, y, line: i });
      return 'ok';
    }
    if (p.cls === 'narrow') {
      sawNarrow = true;
      return 'skip';
    }
    if (p.cls !== other) return 'skip';
    if (p.kind === 'straight') {
      settle.set(k, a);
      return 'ok';
    }
    if (p.kind !== 'curve' && p.kind !== 'switch') return 'skip';
    if (!next.has(k)) {
      next.set(k, { kind: p.kind, rot: p.rot, cls: target, form: p.form });
      walk.push(a);
    }
    return 'ok';
  };

  for (const s of seeds) {
    const dx = from ? from.x - s.x : 0,
      dy = from ? from.y - s.y : 0;
    const via =
      from && Math.abs(dx) + Math.abs(dy) === 1
        ? dx === 1
          ? Dir.E
          : dx === -1
            ? Dir.W
            : dy === 1
              ? Dir.S
              : Dir.N
        : undefined;
    if (want(s.x, s.y, via) === 'blocked') blocked = true;
  }

  // keep the joints of every converted curve, switch and crossing line
  while (walk.length && !blocked) {
    const w = walk.pop()!;
    const tiles = track.unitTiles(w.x, w.y);
    const inside = (x: number, y: number) => tiles.some((t) => t.x === x && t.y === y);
    for (const t of tiles) {
      const p = track.get(t.x, t.y)!;
      const links = w.line === undefined ? p.links : [p.links[w.line]];
      for (const d of links.flat()) {
        const nx = t.x + DIR_DX[d],
          ny = t.y + DIR_DY[d];
        if (inside(nx, ny) || !track.connected(t.x, t.y, d)) continue;
        const q = track.get(nx, ny)!;
        const qa = track.anchorOf(nx, ny);
        if (q.kind === 'transition') {
          // it may have no reason to stay a transition once this piece is converted
          settle.set(key(qa.x, qa.y), qa);
          continue;
        }
        if (!presentsOther(nx, ny, opposite(d))) continue;
        if (q.kind === 'straight') settle.set(key(qa.x, qa.y), qa);
        else if (want(nx, ny, opposite(d)) !== 'ok') blocked = true;
      }
    }
  }
  if (blocked) return { changes: [], reason: 'blocked' };

  // straights and transitions: a transition where the other class is still met, else plain track
  const pending = [...settle.values()];
  const settled = new Set<number>();
  while (pending.length) {
    const s = pending.pop()!;
    const k = key(s.x, s.y);
    if (settled.has(k)) continue;
    settled.add(k);
    const p = track.get(s.x, s.y)!;
    const ends = p.links[0];
    const joined = ends.filter((d) => track.connected(s.x, s.y, d));
    const meets = joined.filter((d) =>
      presentsOther(s.x + DIR_DX[d], s.y + DIR_DY[d], opposite(d)),
    );
    let v: Virtual;
    if (meets.length) {
      // the high-speed half lies away from wide track, or towards high-speed track
      const hs =
        meets.length === 2 ? ends[1] : target === 'high_speed' ? opposite(meets[0]) : meets[0];
      const rot = p.kind === 'transition' && meets.length === 2 ? p.rot : transitionRot(hs);
      v = { kind: 'transition', rot, cls: 'regular' };
    } else v = { kind: 'straight', rot: p.rot % 2, cls: target };
    next.set(k, v);
    // a piece that changed may free the transition beside it
    if (v.kind !== p.kind || v.cls !== p.cls)
      for (const d of joined) {
        const nx = s.x + DIR_DX[d],
          ny = s.y + DIR_DY[d];
        if (track.get(nx, ny)!.kind !== 'transition' || settle.has(key(nx, ny))) continue;
        settle.set(key(nx, ny), { x: nx, y: ny });
        pending.push({ x: nx, y: ny });
      }
  }

  const changes: PieceChange[] = [];
  for (const [k, v] of next) {
    const x = k % track.w,
      y = Math.floor(k / track.w);
    const p = track.get(x, y)!;
    const same =
      v.kind === p.kind &&
      v.rot === p.rot &&
      v.cls === p.cls &&
      (v.kind !== 'crossing' || (v.cls2 ?? v.cls) === (p.cls2 ?? p.cls));
    if (!same) changes.push({ x, y, ...v });
  }
  if (!changes.length) return { changes, reason: sawNarrow ? 'narrow' : 'nothing' };
  // lay them in reading order: the same plan always lists the same way
  changes.sort((a, b) => a.y - b.y || a.x - b.x);
  return { changes };
}

/**
 * The tiles a stroke passes from `a` to `b`, after `a` and up to `b`, each beside the one before:
 * a cursor that jumps several tiles between frames still visits every tile on the way.
 */
export function stepTiles(a: Tile, b: Tile): Tile[] {
  const out: Tile[] = [];
  const nx = Math.abs(b.x - a.x),
    ny = Math.abs(b.y - a.y);
  const sx = Math.sign(b.x - a.x),
    sy = Math.sign(b.y - a.y);
  let x = a.x,
    y = a.y;
  // step along whichever axis has fallen further behind the straight line
  for (let ix = 0, iy = 0; ix < nx || iy < ny;) {
    if (iy >= ny || (ix < nx && (ix + 0.5) * ny < (iy + 0.5) * nx)) {
      x += sx;
      ix++;
    } else {
      y += sy;
      iy++;
    }
    out.push({ x, y });
  }
  return out;
}
