import { roadPath, roadShape } from './roadShape';

/**
 * Walkers keep to the road they walk (#477). The simulation steps a walker between tile centres,
 * but the road is painted along an organic centre line (roadShape.ts, #329) that strays up to
 * up to about 0.3 tile from a tile's middle, so a walker at the middle of a turn stands on the road's
 * soft edge. Here the drawn position is moved onto that centre line, a little to the right of it
 * (ROAD_SIDE, the demo's 0.035 tile), and nothing else changes: where the walker is in the simulation,
 * how fast it goes and the tile it is on stay as they were. Pure: no Pixi, no simulation state.
 */

/** How far to the right of the centre line, as the walker faces, it keeps (tiles): the demo's. */
export const ROAD_SIDE = 0.035;
/** A walker this near the centre line (tiles) is moved onto it whole ... */
export const FOLLOW_FULL = 0.28;
/**
 * ... and one this far from it is not moved at all (a walker crossing the road, or off it). A
 * tile's corner is never nearer than 0.4 tile to its centre line, so no walker is moved there,
 * where the tile it is on changes with a step.
 */
export const FOLLOW_GONE = 0.38;
/**
 * Where a road tile's side meets a tile with no road of its own (or one under the town paving,
 * where no road is painted), the move fades out over this much of the tile before that edge
 * (tiles), and likewise before a corner it shares with a tile with none, so a walker crossing the
 * edge or the corner does not jump.
 */
export const EDGE_RAMP = 0.2;
/** How much two strokes of a tee or a cross share a walker between them, as a distance (tiles). */
const BLEND = 0.03;

/** Over this much of a tile before a side (tiles), a stroke that does not reach it gives way. */
const STROKE_RAMP = 0.15;

/** How far along a stroke (tiles) a stretch must lie from the nearest to rival it. */
const RIVAL_APART = 0.2;
/** How much nearer than its other stretches a stroke's nearest point must be to be followed (tiles). */
const SURE_GAP = 0.05;

const smoothstep = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** The point of segment `i` of a polyline nearest to (u, v), into `hitX`, `hitY`; its distance. */
let hitX = 0,
  hitY = 0;
function reach(line: Float64Array, i: number, u: number, v: number) {
  const ax = line[2 * i],
    ay = line[2 * i + 1],
    ex = line[2 * i + 2] - ax,
    ey = line[2 * i + 3] - ay,
    l = ex * ex + ey * ey,
    t = l > 0 ? Math.max(0, Math.min(1, ((u - ax) * ex + (v - ay) * ey) / l)) : 0;
  hitX = ax + ex * t;
  hitY = ay + ey * t;
  return Math.hypot(u - hitX, v - hitY);
}

/** Two ends this near (tiles) are one point: where one primitive of a centre line meets the next. */
const JOINED = 1e-6;

/**
 * The primitives of a centre line chained into the polylines they make: a turn's straight, arc and
 * straight are one line, and a walker is pulled to the nearest point of that line once, not once
 * per piece of it (a piece far down the line would otherwise add a pull its neighbour tile's one
 * stroke does not have, so the pull would jump at the tile's edge).
 */
function chain(lines: [number, number][][]): [number, number][][] {
  const todo = lines.map((l) => l.slice()),
    out: [number, number][][] = [];
  const same = (a: [number, number], b: [number, number]) =>
    Math.abs(a[0] - b[0]) < JOINED && Math.abs(a[1] - b[1]) < JOINED;
  while (todo.length) {
    const run = todo.shift()!;
    for (let grew = true; grew;) {
      grew = false;
      for (let i = 0; i < todo.length; i++) {
        const o = todo[i],
          head = run[0],
          tail = run[run.length - 1];
        if (same(tail, o[0])) run.push(...o.slice(1));
        else if (same(tail, o[o.length - 1])) run.push(...o.slice(0, -1).reverse());
        else if (same(head, o[o.length - 1])) run.unshift(...o.slice(0, -1));
        else if (same(head, o[0])) run.unshift(...o.slice(1).reverse());
        else continue;
        todo.splice(i, 1);
        grew = true;
        break;
      }
    }
    out.push(run);
  }
  return out;
}

function stroke(line: [number, number][]): Stroke {
  const along = new Float64Array(line.length);
  for (let i = 1; i < line.length; i++)
    along[i] = along[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
  // the sides of the tile its ends lie on: +u, -u, +v, -v
  const touch = [false, false, false, false];
  for (const [u, v] of [line[0], line[line.length - 1]]) {
    if (u > 0.5 - JOINED) touch[0] = true;
    if (u < JOINED - 0.5) touch[1] = true;
    if (v > 0.5 - JOINED) touch[2] = true;
    if (v < JOINED - 0.5) touch[3] = true;
  }
  return { pts: Float64Array.from(line.flat()), along, touch };
}

/** How far a walker travels (tiles) while its facing turns most of the way to a new heading. */
export const TURN_DISTANCE = 0.12;
/** The way a walker is facing: a vector of length 1 on the move, shorter as it has only set off. */
export interface Heading {
  hx: number;
  hy: number;
}
/**
 * Turns `h` toward the way a walker has just moved, by (dx, dy) tiles: over a short distance, so
 * the corner of a path is rounded off rather than turned at a stroke.
 */
export function turn(h: Heading, dx: number, dy: number) {
  const moved = Math.hypot(dx, dy);
  if (moved <= 1e-9) return;
  const k = 1 - Math.exp(-moved / TURN_DISTANCE);
  h.hx += (dx / moved - h.hx) * k;
  h.hy += (dy / moved - h.hy) * k;
}

/** The map a road tile's centre line is worked out for: its size and where it lies in the world. */
export interface RoadWalkMap {
  readonly w: number;
  readonly h: number;
  readonly originX: number;
  readonly originY: number;
}

/** A stroke of the centre line: its points [x0, y0, x1, y1, ...] and how far along each lies. */
interface Stroke {
  pts: Float64Array;
  along: Float64Array;
  /** Whether it ends on the tile's +u, -u, +v and -v side: where the next tile's line takes it up. */
  touch: boolean[];
}
/** A road tile's centre line, as the polylines `roadPath` makes of it. */
interface Lines {
  code: number;
  wx: number;
  wy: number;
  strokes: Stroke[];
}

/** The point a walker is drawn at, in tile coordinates. */
export interface Placed {
  x: number;
  y: number;
}

/**
 * Where walkers are drawn on the roads of one map. `codeAt` is the road code of the tile
 * (`roadCode`, roadShape.ts) as the painter was handed it, -1 for a tile the painter draws no road
 * on: one with none, and one under the town paving.
 */
export class RoadWalk {
  private readonly cache = new Map<number, Lines>();
  constructor(
    private readonly map: () => RoadWalkMap,
    private readonly codeAt: (x: number, y: number) => number,
  ) {}

  /** The centre line of the road on tile (tx, ty), null for a tile with none. */
  private lines(tx: number, ty: number): Lines | null {
    const { w, h, originX, originY } = this.map();
    if (tx < 0 || ty < 0 || tx >= w || ty >= h) return null;
    const code = this.codeAt(tx, ty);
    if (code < 0) return null;
    const k = ty * w + tx,
      wx = tx + originX,
      wy = ty + originY;
    let at = this.cache.get(k);
    if (!at || at.code !== code || at.wx !== wx || at.wy !== wy) {
      at = {
        code,
        wx,
        wy,
        strokes: chain(roadPath(roadShape(code, wx, wy))).map(stroke),
      };
      this.cache.set(k, at);
    }
    return at;
  }

  /**
   * Where a walker whose simulated place is tile point (x, y) is drawn, into `out`. `hx`, `hy` is
   * the way it is facing, a vector of length 1 for one on the move and 0 to 1 as it has only just
   * set off; (0, 0) for one that has not moved. The move is only across its heading, so the walker
   * keeps its place along the road, and it fades out with the walker's distance from the centre
   * line and toward the edges of a tile with no road beside it.
   */
  place(x: number, y: number, hx: number, hy: number, out: Placed = { x, y }): Placed {
    out.x = x;
    out.y = y;
    const tx = Math.round(x),
      ty = Math.round(y),
      at = this.lines(tx, ty);
    if (!at) return out;
    const u = x - tx,
      v = y - ty;
    // the way to the nearest point of each stroke, shared between them by how near they are
    let sw = 0,
      mx = 0,
      my = 0,
      near = Infinity;
    const gaps = [0.5 - u, 0.5 + u, 0.5 - v, 0.5 + v];
    for (const { pts: line, along, touch } of at.strokes) {
      const n = along.length - 1;
      let best = Infinity,
        from = 0,
        bx = 0,
        by = 0;
      for (let i = 0; i < n; i++) {
        const d = reach(line, i, u, v);
        if (d < best) {
          best = d;
          from = i;
          bx = hitX;
          by = hitY;
        }
      }
      // Where the stroke has another stretch nearly as near as the nearest, far along it from
      // there (the middle of a turn's circle), the nearest point is not to be trusted: it leaps
      // as the walker moves, so the pull toward it gives way.
      let rival = Infinity;
      for (let i = 0; i < n; i++)
        if (Math.abs(along[i] - along[from]) > RIVAL_APART)
          rival = Math.min(rival, reach(line, i, u, v));
      const sure = smoothstep((rival - best) / SURE_GAP);
      // A stroke that does not reach a side has no counterpart in the tile beside it, which has
      // only the strokes that do, so near that side it gives way to the ones that do.
      let reaches = 1;
      for (let k = 0; k < 4; k++) if (!touch[k]) reaches *= smoothstep(gaps[k] / STROKE_RAMP);
      const wt = reaches / ((best * best + BLEND * BLEND) * (best * best + BLEND * BLEND));
      sw += wt;
      mx += wt * (bx - u) * sure;
      my += wt * (by - v) * sure;
      near = Math.min(near, best);
    }
    if (sw === 0) return out;
    let share = 1 - smoothstep((near - FOLLOW_FULL) / (FOLLOW_GONE - FOLLOW_FULL));
    if (share <= 0) return out;
    // fading out toward each edge, and each corner, whose other side has no road
    const sides: [number, number, number][] = [
      [1, 0, 0.5 - u],
      [-1, 0, 0.5 + u],
      [0, 1, 0.5 - v],
      [0, -1, 0.5 + v],
      [1, 1, Math.max(0.5 - u, 0.5 - v)],
      [1, -1, Math.max(0.5 - u, 0.5 + v)],
      [-1, 1, Math.max(0.5 + u, 0.5 - v)],
      [-1, -1, Math.max(0.5 + u, 0.5 + v)],
    ];
    for (const [dx, dy, gap] of sides)
      if (gap < EDGE_RAMP && !this.lines(tx + dx, ty + dy)) share *= smoothstep(gap / EDGE_RAMP);
    if (share <= 0) return out;
    mx /= sw;
    my /= sw;
    let sideX = 0,
      sideY = 0;
    const len = Math.hypot(hx, hy);
    if (len > 1e-9) {
      const ux = hx / len,
        uy = hy / len,
        keep = Math.min(1, len),
        along = (mx * ux + my * uy) * keep;
      mx -= along * ux;
      my -= along * uy;
      // to the right of the way it faces: with +x down the screen to the right and +y down to the
      // left, the right of +x is +y
      sideX = -uy * ROAD_SIDE * keep;
      sideY = ux * ROAD_SIDE * keep;
    }
    out.x = x + share * (mx + sideX);
    out.y = y + share * (my + sideY);
    return out;
  }
}

/**
 * The road walk of each walkers' layer: the world renderer registers the one for its object layer
 * (the layer the people renderer is given), so the people renderer finds the roads of the world it
 * draws into without the game having to hand it over.
 */
export const roadWalks = new WeakMap<object, RoadWalk>();
