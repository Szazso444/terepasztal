import { Dir, DIR_DX, DIR_DY } from '../engine/iso';
import {
  BUILDABLE_CLASSES,
  CLASS_N,
  LINES,
  TRACK_ITEMS,
  pieceLinks,
  type SwitchForm,
  type TrackClass,
  type TrackGraph,
  type TrackKind,
  type TrackPiece,
} from './track';

/** Which way the Upgrade and Downgrade tools move a standard line: one tier up or down. */
export type ReclassDir = 'up' | 'down';

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
  /**
   * why nothing changes: track off the standard network, a curve or switch of the wrong size for
   * the next line, no buildable line that way, or nothing there
   */
  reason?: 'separate' | 'size' | 'noLine' | 'nothing';
}
type Tile = { x: number; y: number };

/** The buildable standard line one tier above or below `cls`, or null. */
export function nextLine(cls: TrackClass, dir: ReclassDir): TrackClass | null {
  const line = LINES[cls];
  if (line.network !== 'standard') return null;
  const tier = line.tier + (dir === 'up' ? 1 : -1);
  return (
    BUILDABLE_CLASSES.find((c) => LINES[c].network === 'standard' && LINES[c].tier === tier) ?? null
  );
}

/** The crossing piece and turn that carry these classes on the two lines, if there is one. */
function crossingFor(ns: TrackClass, ew: TrackClass, prefer: number) {
  for (const rot of [prefer % 2, (prefer + 1) % 2]) {
    const first = pieceLinks('crossing', rot)[0];
    const northSouth = first.includes(Dir.N);
    const cls = northSouth ? ns : ew,
      cls2 = northSouth ? ew : ns;
    if (
      TRACK_ITEMS.some((i) => i.kind === 'crossing' && i.cls === cls && (i.cls2 ?? i.cls) === cls2)
    )
      return { rot, cls, cls2 };
  }
  return null;
}

/**
 * Plan moving the pieces on `seeds` one standard line up or down. The lines of the standard
 * network join each other directly, so a straight simply changes line. A curve or switch keeps
 * its footprint, so it changes only where the next line's curves are the same size; otherwise
 * it stays as it is and the plan says why. A crossing converts by line: the one the stroke runs
 * along (`from` is the tile it came from), both when clicked. Nothing is changed here; the
 * caller lays the pieces.
 */
export function planReclass(
  track: TrackGraph,
  seeds: Tile[],
  dir: ReclassDir,
  from?: Tile,
): ReclassPlan {
  const changes: PieceChange[] = [];
  const seen = new Set<number>();
  const why = { separate: false, size: false, noLine: false };
  const step = (cls: TrackClass): TrackClass | null => {
    if (LINES[cls].network !== 'standard') {
      why.separate = true;
      return null;
    }
    const to = nextLine(cls, dir);
    if (!to) why.noLine = true;
    return to;
  };
  for (const t of seeds) {
    const p = track.get(t.x, t.y);
    if (!p) continue;
    const a = track.anchorOf(t.x, t.y);
    const k = a.y * track.w + a.x;
    if (seen.has(k)) continue;
    seen.add(k);
    const piece: TrackPiece = track.get(a.x, a.y)!;
    if (piece.kind === 'crossing') {
      const via = from ? edgeTowards(t, from) : undefined;
      const lines = [0, 1].filter((i) => via === undefined || piece.links[i].includes(via));
      const cls = [piece.cls, piece.cls2 ?? piece.cls];
      let moved = false;
      for (const i of lines) {
        const to = step(cls[i]);
        if (to) {
          cls[i] = to;
          moved = true;
        }
      }
      if (!moved) continue;
      // the classes by axis: line 0 runs N-S at even turns
      const nsFirst = piece.links[0].includes(Dir.N);
      const c = crossingFor(nsFirst ? cls[0] : cls[1], nsFirst ? cls[1] : cls[0], piece.rot);
      if (c) changes.push({ x: a.x, y: a.y, kind: 'crossing', ...c });
      continue;
    }
    const to = step(piece.cls);
    if (!to) continue;
    if ((piece.kind === 'curve' || piece.kind === 'switch') && CLASS_N[to] !== CLASS_N[piece.cls]) {
      why.size = true;
      continue;
    }
    const change: PieceChange = { x: a.x, y: a.y, kind: piece.kind, rot: piece.rot, cls: to };
    if (piece.form) change.form = piece.form;
    changes.push(change);
  }
  if (changes.length) {
    // lay them in reading order: the same plan always lists the same way
    changes.sort((p, q) => p.y - q.y || p.x - q.x);
    return { changes };
  }
  const reason = why.size ? 'size' : why.separate ? 'separate' : why.noLine ? 'noLine' : 'nothing';
  return { changes, reason };
}

/** The edge of tile `t` that faces the neighbouring tile `n`. */
function edgeTowards(t: Tile, n: Tile): Dir | undefined {
  for (const d of [Dir.N, Dir.E, Dir.S, Dir.W])
    if (t.x + DIR_DX[d] === n.x && t.y + DIR_DY[d] === n.y) return d;
  return undefined;
}

/**
 * The tiles a stroke passes from `a` to `b`, after `a` and up to `b`, each beside the one before:
 * a cursor that jumps several tiles between frames still visits every tile on the way. Where the
 * straight line runs exactly between two tiles, a stroke heading along `heading` steps across
 * first, back onto its line, and then along it.
 */
export function stepTiles(a: Tile, b: Tile, heading?: 'x' | 'y'): Tile[] {
  const out: Tile[] = [];
  const nx = Math.abs(b.x - a.x),
    ny = Math.abs(b.y - a.y);
  const sx = Math.sign(b.x - a.x),
    sy = Math.sign(b.y - a.y);
  let x = a.x,
    y = a.y;
  // step along whichever axis has fallen further behind the straight line
  for (let ix = 0, iy = 0; ix < nx || iy < ny;) {
    const behind = (ix + 0.5) * ny - (iy + 0.5) * nx;
    if (iy >= ny || (ix < nx && (behind < 0 || (behind === 0 && heading === 'y')))) {
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
