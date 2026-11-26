import { DIR_DX, DIR_DY, Dir, opposite } from '../engine/iso';
import {
  CLASS_N,
  pieceLinks,
  rotationCount,
  type TrackClass,
  type TrackItem,
} from '../world/track';
import { unitDef } from '../world/trackGeom';

/** One piece of a dragged run: a straight at `rot` (0: N–S, 1: E–W), or `item` anchored here. */
export interface RunTile {
  x: number;
  y: number;
  rot: number;
  /** the piece laid here when it is not the run's straight: the curve at the turn */
  item?: TrackItem;
}

type Axis = 'x' | 'y';
type Tile = { x: number; y: number };

/** Straights from `a` towards `b` along the longer axis, as the drag laid them before it turned. */
export function lineTiles(a: Tile, b: Tile): RunTile[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const out: RunTile[] = [];
  if (Math.abs(dx) >= Math.abs(dy)) {
    const s = Math.sign(dx) || 1;
    for (let i = 0; i <= Math.abs(dx); i++) out.push({ x: a.x + i * s, y: a.y, rot: 1 });
  } else {
    const s = Math.sign(dy) || 1;
    for (let i = 0; i <= Math.abs(dy); i++) out.push({ x: a.x, y: a.y + i * s, rot: 0 });
  }
  return out;
}

/**
 * The tiles from `a` to `b` that turn at most once: along `first`, then along the other axis. Each
 * touches the one before it by a side and none comes twice, so the Drill can take it as one line.
 */
export function elbowPath(a: Tile, b: Tile, first: Axis): Tile[] {
  const out: Tile[] = [{ x: a.x, y: a.y }];
  const go = (axis: Axis, to: number) => {
    for (let at = out[out.length - 1]; at[axis] !== to; at = out[out.length - 1])
      out.push({ ...at, [axis]: at[axis] + Math.sign(to - at[axis]) });
  };
  go(first, b[first]);
  const second = first === 'x' ? 'y' : 'x';
  go(second, b[second]);
  return out;
}

/** How many tiles the cursor must leave the first leg's line before the run turns. */
export const TURN_AFTER = 2;

/**
 * The axis a drag from `a` sets off along, once the cursor at `t` is `TURN_AFTER` tiles out (null
 * before): the longer way it has gone by then, so a wobble on the first tile does not decide it.
 */
export function setOffAxis(a: Tile, t: Tile): Axis | null {
  const dx = Math.abs(t.x - a.x),
    dy = Math.abs(t.y - a.y);
  if (Math.max(dx, dy) < TURN_AFTER) return null;
  return dx >= dy ? 'x' : 'y';
}

/** The two open ends of a curve of class `cls` at `rot`: offsets from its anchor and the edge each opens by. */
export function curveEnds(cls: TrackClass, rot: number): { dx: number; dy: number; dir: Dir }[] {
  const n = CLASS_N[cls];
  if (n === 1) {
    const [a, b] = pieceLinks('curve', rot)[0];
    return [
      { dx: 0, dy: 0, dir: a },
      { dx: 0, dy: 0, dir: b },
    ];
  }
  const def = unitDef('curve', n, rot);
  const seq = def.routes[0].members;
  const first = def.members[seq[0]],
    last = def.members[seq[seq.length - 1]];
  return [
    { dx: first.dx, dy: first.dy, dir: first.links.find((l) => l.route === 0)!.in },
    { dx: last.dx, dy: last.dy, dir: last.links.find((l) => l.route === 0)!.out },
  ];
}

/**
 * A run dragged from `a` to `b` that turns once: straights along `first` (the axis the drag set off
 * on) from `a`, the class's curve at the corner, then straights on to `b`. The curve takes its
 * footprint out of both legs, so the second leg lies on `b`'s line. A cursor less than `TURN_AFTER`
 * tiles off the first leg's line, or too close to `a` for the curve to fit, lays the straight line.
 */
export function turnPath(a: Tile, b: Tile, first: Axis, cls: TrackClass): RunTile[] {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const along = first === 'x' ? dx : dy,
    off = first === 'x' ? dy : dx;
  if (along === 0 || Math.abs(off) < TURN_AFTER) return lineTiles(a, b);
  const go1 = first === 'x' ? (dx > 0 ? Dir.E : Dir.W) : dy > 0 ? Dir.S : Dir.N;
  const go2 = first === 'x' ? (dy > 0 ? Dir.S : Dir.N) : dx > 0 ? Dir.E : Dir.W;
  const straightRot = (d: Dir) => (d === Dir.E || d === Dir.W ? 1 : 0);
  const steps = (from: Tile, to: Tile, d: Dir) =>
    (to.x - from.x) * DIR_DX[d] + (to.y - from.y) * DIR_DY[d];
  for (let rot = 0; rot < rotationCount('curve'); rot++) {
    const ends = curveEnds(cls, rot);
    const inEnd = ends.find((e) => e.dir === opposite(go1)),
      outEnd = ends.find((e) => e.dir === go2);
    if (!inEnd || !outEnd) continue;
    // the curve opens back onto the first leg's line and on along the cursor's
    const ax = first === 'x' ? b.x - outEnd.dx : a.x - inEnd.dx,
      ay = first === 'x' ? a.y - inEnd.dy : b.y - outEnd.dy;
    const enter = { x: ax + inEnd.dx, y: ay + inEnd.dy },
      leave = { x: ax + outEnd.dx, y: ay + outEnd.dy };
    const n1 = steps(a, enter, go1),
      n2 = steps(leave, b, go2);
    if (n1 < 0 || n2 < 0) return lineTiles(a, b);
    const out: RunTile[] = [];
    for (let i = 0; i < n1; i++)
      out.push({ x: a.x + i * DIR_DX[go1], y: a.y + i * DIR_DY[go1], rot: straightRot(go1) });
    out.push({ x: ax, y: ay, rot, item: { kind: 'curve', cls } });
    for (let i = 1; i <= n2; i++)
      out.push({
        x: leave.x + i * DIR_DX[go2],
        y: leave.y + i * DIR_DY[go2],
        rot: straightRot(go2),
      });
    return out;
  }
  return lineTiles(a, b);
}
