import { DIRS, DIR_DX, DIR_DY, opposite } from '../engine/iso';
import { hash2 } from '../engine/rng';
import { surfaceNoise } from './terrainMaterials';
import type { PavingDoor } from './townPaving';

/**
 * Roads (#329, the organic look the author approved on the art demo, 2026-10-12): gravel roads
 * 0.32 tile wide, painted into the ground by the landscape painter (roadPaint.ts) along a centre
 * line, with a soft ragged edge (edge B). This is the centre line: which piece a tile's sides make,
 * where its road crosses each edge, how it turns and how its arms join.
 *
 * The centre line of a road tile is a function of its code (its sides, which of its edges it meets
 * in the middle, and whether it is a level crossing) and its world position (map plus origin, so a
 * map that grows keeps its roads' shapes), never of the chunk being painted. Where it crosses an
 * edge is a function of the edge alone (`edgeOffset`), and it crosses at right angles, so the two
 * tiles an edge divides join there without a seam whichever shapes they take. Tile coordinates
 * here are local to the tile: its centre at (0, 0), its edges at -0.5 and 0.5, +u along map x and
 * +v along map y. Pure: the paint workers and the tests run it.
 */

/** The road's width (tiles): its paint weighs one half 0.16 tile from the centre line. */
export const ROAD_WIDTH = 0.32;
/** Half the road's width (tiles). */
export const ROAD_HALF = ROAD_WIDTH / 2;
/** Edge B: how far the road takes to fade into the ground at its edge (tiles). */
export const ROAD_FEATHER = 0.05;
/** The most the road's ragged edge moves it outward (tiles); it never moves it inward. */
export const ROAD_RAG = 0.035;
/** The most the centre line strays from the middle of its tile across its run (tiles). */
export const ROAD_WANDER = 0.1;
/** The radius of a turn's centre line (tiles), the least and the most. */
export const ROAD_RADIUS_MIN = 0.23,
  ROAD_RADIUS_MAX = 0.43;
/** The farthest a road's paint reaches from its centre line (tiles). */
export const ROAD_REACH = ROAD_HALF + ROAD_FEATHER / 2 + ROAD_RAG;
/**
 * Where a level crossing's arm ends toward a side with no road beyond it, from the tile's middle
 * (tiles): its round end, ragged edge and all, stays on the tile.
 */
export const CROSSING_SHORT = 0.5 - ROAD_REACH;

// ------------------------------------------------------------------ the code of a road tile

/** A code's sides: one bit a side, `1 << Dir`, each a side the road runs out through. */
export const ROAD_SIDES = 0xf;
/** Where a code keeps the sides whose edge its road meets in the middle, the same bits shifted. */
export const ROAD_PINNED_SHIFT = 4;
/** A level crossing over track that runs along y: the road runs straight along x. */
export const ROAD_CROSSING_X = 0x100;
/** A level crossing over track that runs along x: the road runs straight along y. */
export const ROAD_CROSSING_Y = 0x200;
/**
 * A road on a bridge platform, as the painter is handed it (`paintedRoads`, roadPaint.ts): the
 * deck is its road, so nothing is painted on the tile. Never part of a code `roadCode` makes.
 */
export const ROAD_ON_DECK = 0x400;

/**
 * A road tile's code, as the painter is handed it: its `sides` (`roadSides`), the sides whose edge
 * its centre line meets in the middle (`pinned`: an edge it shares with a level crossing, whose
 * road runs through the middle, and the edge of a street door it leads to), and `crossing`, the
 * axis its road runs along where it is a level crossing.
 */
export function roadCode(sides: number, pinned: number, crossing: 'x' | 'y' | null = null) {
  return (
    (sides & ROAD_SIDES) |
    ((pinned & ROAD_SIDES) << ROAD_PINNED_SHIFT) |
    (crossing === 'x' ? ROAD_CROSSING_X : crossing === 'y' ? ROAD_CROSSING_Y : 0)
  );
}

// ------------------------------------------------------------------ pieces

/** What a road tile's sides make of it. */
export type RoadKind = 'lone' | 'end' | 'straight' | 'curve' | 'tee' | 'cross';
/** A road piece: its kind, turned `rot` quarter turns clockwise (N to E) from rotation 0. */
export interface RoadPiece {
  kind: RoadKind;
  rot: number;
}
/** Each kind's arms at rotation 0, as `Dir`s; a tee's closed side is W. */
const KIND_ARMS: Readonly<Record<RoadKind, readonly number[]>> = {
  lone: [],
  end: [0],
  straight: [0, 2],
  curve: [0, 1],
  tee: [0, 1, 2],
  cross: [0, 1, 2, 3],
};
/** How many distinct rotations each kind has. */
export const ROAD_ROTATIONS: Readonly<Record<RoadKind, number>> = {
  lone: 1,
  end: 4,
  straight: 2,
  curve: 4,
  tee: 4,
  cross: 1,
};

/** The sides a piece's arms run out through, one bit a side (`1 << Dir`). */
export function roadArms(piece: RoadPiece): number {
  let mask = 0;
  for (const d of KIND_ARMS[piece.kind]) mask |= 1 << ((d + piece.rot) % 4);
  return mask;
}

/**
 * The piece a road tile's sides make (`1 << Dir` each, N 0, E 1, S 2, W 3): none, a lone patch;
 * one, an end; two, a straight or a curve; three, a tee; four, a cross. Its arms are exactly the
 * sides (`roadArms`).
 */
export function roadPiece(sides: number): RoadPiece {
  const m = sides & ROAD_SIDES;
  const count = (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);
  if (count === 0) return { kind: 'lone', rot: 0 };
  if (count === 4) return { kind: 'cross', rot: 0 };
  if (count === 1) return { kind: 'end', rot: 31 - Math.clz32(m) };
  if (count === 3) {
    // rotation 0 closes W (3); each turn closes the next side clockwise
    const closed = 31 - Math.clz32(~m & ROAD_SIDES);
    return { kind: 'tee', rot: (closed + 1) % 4 };
  }
  if (m === 0b0101) return { kind: 'straight', rot: 0 };
  if (m === 0b1010) return { kind: 'straight', rot: 1 };
  for (let rot = 0; rot < 4; rot++)
    if (m === ((1 << rot) | (1 << ((rot + 1) % 4)))) return { kind: 'curve', rot };
  throw Error(`no road piece for sides ${m}`);
}

// ------------------------------------------------------------------ sides

/**
 * The sides of tile (x, y) its road meets, read where the renderer reads them: those whose next
 * tile `roadAt` says holds a road, and the side toward each street door (`PavingDoor`, as
 * `setCity` hands them) whose reach the tile is. Nothing for a tile with no road. The same as
 * `roadLinks(...).sides` in src/sim/roads.ts. `roadAt` says false off the map.
 */
export function roadSides(
  roadAt: (x: number, y: number) => boolean,
  doors: Iterable<PavingDoor>,
  x: number,
  y: number,
): number {
  if (!roadAt(x, y)) return 0;
  let bits = 0;
  for (const d of DIRS) if (roadAt(x + DIR_DX[d], y + DIR_DY[d])) bits |= 1 << d;
  return bits | doorSides(doors, x, y);
}
/** The sides of tile (x, y) toward the street doors whose reach it is. */
export function doorSides(doors: Iterable<PavingDoor>, x: number, y: number): number {
  let into = 0;
  for (const d of doors)
    if (d.tile.x + DIR_DX[d.side] === x && d.tile.y + DIR_DY[d.side] === y)
      into |= 1 << opposite(d.side);
  return into;
}

// ------------------------------------------------------------------ the centre line

/** Seeds of the road's shape. */
const SEED_EDGE_X = 4471,
  SEED_EDGE_Y = 4472,
  SEED_RADIUS = 4473,
  SEED_JOIN = 4474;
/** How fast the edge offsets change along a run (per tile): a wander over a tile or two. */
const EDGE_FREQ = 0.7;
/** The least and the most a tee's or a cross's arms round into each other (tiles). */
const JOIN_MIN = 0.05,
  JOIN_MAX = 0.12;

/**
 * Where a road crosses the edge whose middle is at world point (wx, wy), along the edge from that
 * middle (tiles, toward +y on an edge a road crosses going along x, toward +x on one it crosses
 * going along y), within ROAD_WANDER. A function of the edge alone, so both tiles it divides agree;
 * it changes gently from edge to edge along a run, so a long straight wanders.
 */
export function edgeOffset(wx: number, wy: number, alongX: boolean): number {
  const s =
    2 * surfaceNoise(wx * EDGE_FREQ, wy * EDGE_FREQ, alongX ? SEED_EDGE_X : SEED_EDGE_Y) - 1;
  // pushed out from the middle, as value noise keeps near it
  return (ROAD_WANDER * Math.tanh(2.2 * s)) / Math.tanh(2.2);
}

/** A road tile's centre line, as `roadShape` works it out. */
export interface RoadShape {
  piece: RoadPiece;
  /**
   * Where the centre line crosses each side's edge (N, E, S, W): along the edge from its middle,
   * toward +x on N and S, toward +y on E and W (tiles). NaN on a side no arm crosses.
   */
  offsets: number[];
  /**
   * How far each side's arm runs from the middle (tiles): 0.5, to its edge; CROSSING_SHORT, a level
   * crossing's arm toward a side with no road beyond it. NaN on a side with no arm.
   */
  ends: number[];
  /** A curve's radius at its centre line (tiles), fitted between its arms; 0 for another piece. */
  radius: number;
  /** How far the arms of a tee or a cross round into each other where they meet (tiles); else 0. */
  join: number;
  /** A level crossing: the axis its road runs along, straight through the middle; else null. */
  crossing: 'x' | 'y' | null;
}

/**
 * The centre line of the road tile with `code` (`roadCode`) at world point (wx, wy), the tile's
 * middle. Each arm crosses its edge at right angles where `edgeOffset` says, or in the middle on a
 * pinned side. A straight runs from edge to edge in a gentle S between its two offsets; a curve
 * runs in from each edge and turns on a circle whose radius, between ROAD_RADIUS_MIN and
 * ROAD_RADIUS_MAX by the tile's position, is cut to the room between its arms' corner and the
 * nearer edge (never below 0.4 tile while ROAD_WANDER is 0.1, so only the top of the range is ever
 * cut); an end runs from its edge to the middle and stops there in a round end; a lone tile is a
 * round patch in the middle; a tee is a straight with a branch run out to it; a cross two
 * straights. A level crossing runs straight through the middle across its track, whatever its
 * sides along it, and an arm toward a side with no road ends short of the edge.
 */
export function roadShape(code: number, wx: number, wy: number): RoadShape {
  const sides = code & ROAD_SIDES,
    pinned = (code >> ROAD_PINNED_SHIFT) & ROAD_SIDES,
    crossing = code & ROAD_CROSSING_X ? 'x' : code & ROAD_CROSSING_Y ? 'y' : null,
    arms = crossing === 'x' ? 0b1010 : crossing === 'y' ? 0b0101 : sides,
    piece = roadPiece(arms),
    offsets = [NaN, NaN, NaN, NaN],
    ends = [NaN, NaN, NaN, NaN];
  for (const d of DIRS) {
    if (!(arms & (1 << d))) continue;
    offsets[d] =
      crossing || pinned & (1 << d)
        ? 0
        : edgeOffset(wx + DIR_DX[d] * 0.5, wy + DIR_DY[d] * 0.5, DIR_DX[d] !== 0);
    ends[d] = crossing && !(sides & (1 << d)) ? CROSSING_SHORT : 0.5;
  }
  let radius = 0,
    join = 0;
  if (piece.kind === 'curve') {
    const [a, b] = [piece.rot, (piece.rot + 1) % 4],
      [kx, ky] = corner(a, offsets[a], b, offsets[b]),
      room = Math.min(
        0.5 - (kx * DIR_DX[a] + ky * DIR_DY[a]),
        0.5 - (kx * DIR_DX[b] + ky * DIR_DY[b]),
      );
    radius = Math.min(
      ROAD_RADIUS_MIN + (ROAD_RADIUS_MAX - ROAD_RADIUS_MIN) * hash2(wx, wy, SEED_RADIUS),
      room,
    );
  } else if (piece.kind === 'tee' || piece.kind === 'cross')
    join = JOIN_MIN + (JOIN_MAX - JOIN_MIN) * hash2(wx, wy, SEED_JOIN);
  return { piece, offsets, ends, radius, join, crossing };
}

/** The side's edge point: where its arm crosses the edge, `offset` along it. */
function edgePoint(d: number, offset: number): [number, number] {
  return DIR_DX[d] ? [DIR_DX[d] * 0.5, offset] : [offset, DIR_DY[d] * 0.5];
}
/** Where the straight lines in from two perpendicular sides' edge points meet. */
function corner(a: number, oa: number, b: number, ob: number): [number, number] {
  // an arm in from a side with an x direction runs at its offset in y, and the other way round
  return DIR_DX[a] ? [ob, oa] : [oa, ob];
}

// ------------------------------------------------------------------ distance to the centre line

/** Floats per primitive: its stroke, its type and up to seven numbers. */
const PRIM = 9;
/** Floats a compiled road tile takes: its join and how many primitives, then up to three. */
export const ROAD_STRIDE = 2 + 3 * PRIM;
/** Primitive types. */
const WAVE_Y = 0,
  WAVE_X = 1,
  SEGMENT = 2,
  ARC = 3;

/**
 * A road tile's centre line as `roadDistance` reads it, into `out` from `at` (ROAD_STRIDE floats):
 * its join, then its primitives, each of one of the strokes a tee or a cross is made of (a curve
 * and every other piece are one stroke). A wave runs along an axis between two ends in a smooth S
 * from one lateral offset to another, square to the axis at both; a segment is straight; an arc is
 * a quarter circle between two directions.
 */
export function compileRoad(shape: RoadShape, out: Float64Array, at = 0) {
  const { piece, offsets: o, ends } = shape;
  let n = 0;
  const put = (stroke: number, type: number, ...p: number[]) => {
    const k = at + 2 + n * PRIM;
    out[k] = stroke;
    out[k + 1] = type;
    for (let i = 0; i < 7; i++) out[k + 2 + i] = p[i] ?? 0;
    n++;
  };
  /** The wave of a straight along y (N to S), or along x (W to E). */
  const straightY = (stroke: number) => put(stroke, WAVE_Y, -ends[0], ends[2], o[0], o[2]);
  const straightX = (stroke: number) => put(stroke, WAVE_X, -ends[3], ends[1], o[3], o[1]);
  switch (piece.kind) {
    case 'lone':
      put(0, SEGMENT, 0, 0, 0, 0);
      break;
    case 'end': {
      // from the edge to the middle, its lateral offset easing to none there
      const d = piece.rot,
        s = DIR_DX[d] + DIR_DY[d];
      const type = DIR_DX[d] ? WAVE_X : WAVE_Y;
      if (s < 0) put(0, type, -0.5, 0, o[d], 0);
      else put(0, type, 0, 0.5, 0, o[d]);
      break;
    }
    case 'straight':
      if (piece.rot === 0) straightY(0);
      else straightX(0);
      break;
    case 'curve': {
      const a = piece.rot,
        b = (piece.rot + 1) % 4,
        r = shape.radius,
        [kx, ky] = corner(a, o[a], b, o[b]),
        [pax, pay] = edgePoint(a, o[a]),
        [pbx, pby] = edgePoint(b, o[b]);
      // in from each edge to where the turn begins, and the turn between
      put(0, SEGMENT, pax, pay, kx + r * DIR_DX[a], ky + r * DIR_DY[a]);
      put(
        0,
        ARC,
        kx + r * (DIR_DX[a] + DIR_DX[b]),
        ky + r * (DIR_DY[a] + DIR_DY[b]),
        r,
        DIR_DX[a],
        DIR_DY[a],
        DIR_DX[b],
        DIR_DY[b],
      );
      put(0, SEGMENT, kx + r * DIR_DX[b], ky + r * DIR_DY[b], pbx, pby);
      break;
    }
    case 'tee': {
      // the straight through, and the branch from its edge in to the straight's centre line
      const branch = (piece.rot + 1) % 4,
        [px, py] = edgePoint(branch, o[branch]);
      if (DIR_DX[branch]) {
        straightY(0);
        put(1, SEGMENT, px, py, wave(-ends[0], ends[2], o[0], o[2], py), py);
      } else {
        straightX(0);
        put(1, SEGMENT, px, py, px, wave(-ends[3], ends[1], o[3], o[1], px));
      }
      break;
    }
    case 'cross':
      straightY(0);
      straightX(1);
      break;
  }
  out[at] = shape.join;
  out[at + 1] = n;
}

const sstep = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
/** A wave's lateral offset at `t` along its axis, between ends t0 and t1 (offsets a and b). */
function wave(t0: number, t1: number, a: number, b: number, t: number) {
  return a + (b - a) * sstep((t - t0) / (t1 - t0));
}

/** From the nearest point of the primitive read last (`primDistance`) out to the point read. */
let qu = 0,
  qv = 0;
/**
 * Distance from (u, v) to primitive `k` of a compiled road (tiles); Infinity off an arc's span.
 * The way out from its nearest point to (u, v) goes into `qu`, `qv`.
 */
function primDistance(c: Float64Array, k: number, u: number, v: number) {
  const type = c[k + 1];
  if (type === WAVE_Y || type === WAVE_X) {
    const t = type === WAVE_Y ? v : u,
      lat = type === WAVE_Y ? u : v,
      t0 = c[k + 2],
      t1 = c[k + 3],
      a = c[k + 4],
      b = c[k + 5];
    let dl: number, dt: number, d: number;
    if (t <= t0) {
      dl = lat - a;
      dt = t - t0;
      d = Math.sqrt(dl * dl + dt * dt);
    } else if (t >= t1) {
      dl = lat - b;
      dt = t - t1;
      d = Math.sqrt(dl * dl + dt * dt);
    } else {
      // square to the curve to first order: the lateral gap times the cosine of its slope
      const len = t1 - t0,
        s = (t - t0) / len,
        mid = a + (b - a) * s * s * (3 - 2 * s),
        slope = ((b - a) * 6 * s * (1 - s)) / len;
      dl = lat - mid;
      dt = 0;
      d = Math.abs(dl) / Math.sqrt(1 + slope * slope);
    }
    qu = type === WAVE_Y ? dl : dt;
    qv = type === WAVE_Y ? dt : dl;
    return d;
  }
  if (type === SEGMENT) {
    const ax = c[k + 2],
      ay = c[k + 3],
      ex = c[k + 4] - ax,
      ey = c[k + 5] - ay,
      wx = u - ax,
      wy = v - ay,
      l = ex * ex + ey * ey,
      t = l > 0 ? Math.max(0, Math.min(1, (wx * ex + wy * ey) / l)) : 0,
      dx = wx - ex * t,
      dy = wy - ey * t;
    qu = dx;
    qv = dy;
    return Math.sqrt(dx * dx + dy * dy);
  }
  // an arc: a quarter circle round (cx, cy), between the directions -n1 and -n2
  const dx = u - c[k + 2],
    dy = v - c[k + 3];
  if (dx * c[k + 5] + dy * c[k + 6] > 0 || dx * c[k + 7] + dy * c[k + 8] > 0) return Infinity;
  const l = Math.sqrt(dx * dx + dy * dy),
    out = l > 0 ? (l - c[k + 4]) / l : 0;
  qu = dx * out;
  qv = dy * out;
  return Math.abs(l - c[k + 4]);
}

/**
 * Which side of its road's centre line the point read last (`roadDistance`) lies on, as the
 * screen sees it: 1 straight down the screen from it (+x +y), -1 straight up, 0 square to that or
 * on the line.
 */
export function roadSide() {
  const l = Math.sqrt(sideU * sideU + sideV * sideV);
  return l > 0 ? (sideU + sideV) / (l * Math.SQRT2) : 0;
}
/** The way out from the nearest centre line to the point `roadDistance` read last. */
let sideU = 0,
  sideV = 0;

/**
 * Distance from tile-local point (u, v) to a compiled road's centre line (`compileRoad`, from
 * `at`), in tiles: to the nearest of its primitives, past an open end to the end itself (a round
 * end), with the two strokes of a tee or a cross rounded into each other by its join.
 */
export function roadDistance(c: Float64Array, at: number, u: number, v: number) {
  const n = c[at + 1];
  let d0 = Infinity,
    d1 = Infinity,
    u0 = 0,
    v0 = 0,
    u1 = 0,
    v1 = 0;
  for (let i = 0; i < n; i++) {
    const k = at + 2 + i * PRIM,
      d = primDistance(c, k, u, v);
    if (c[k] === 0) {
      if (d < d0) {
        d0 = d;
        u0 = qu;
        v0 = qv;
      }
    } else if (d < d1) {
      d1 = d;
      u1 = qu;
      v1 = qv;
    }
  }
  const first = d0 <= d1;
  sideU = first ? u0 : u1;
  sideV = first ? v0 : v1;
  if (d1 === Infinity) return d0;
  // a smooth minimum: the inner corners where the arms meet are rounded
  const k = c[at],
    h = Math.max(k - Math.abs(d0 - d1), 0) / k;
  return Math.min(d0, d1) - h * h * k * 0.25;
}

/** The distance from (u, v) to the centre line of a road shape (tiles), for one-off reads. */
export function shapeDistance(shape: RoadShape, u: number, v: number) {
  const c = new Float64Array(ROAD_STRIDE);
  compileRoad(shape, c);
  return roadDistance(c, 0, u, v);
}

/**
 * The centre line of a road shape as polylines in tile-local coordinates, one per primitive
 * `compileRoad` makes of it, each sampled at `steps` points or more along it: what the painter
 * measures its distance to.
 */
export function roadPath(shape: RoadShape, steps = 32): [number, number][][] {
  const c = new Float64Array(ROAD_STRIDE);
  compileRoad(shape, c);
  const out: [number, number][][] = [];
  for (let i = 0; i < c[1]; i++) {
    const k = 2 + i * PRIM,
      type = c[k + 1],
      line: [number, number][] = [];
    for (let j = 0; j <= steps; j++) {
      const s = j / steps;
      if (type === WAVE_Y || type === WAVE_X) {
        const t = c[k + 2] + (c[k + 3] - c[k + 2]) * s,
          lat = wave(c[k + 2], c[k + 3], c[k + 4], c[k + 5], t);
        line.push(type === WAVE_Y ? [lat, t] : [t, lat]);
      } else if (type === SEGMENT)
        line.push([c[k + 2] + (c[k + 4] - c[k + 2]) * s, c[k + 3] + (c[k + 5] - c[k + 3]) * s]);
      else {
        // from -n2 round to -n1
        const a0 = Math.atan2(-c[k + 8], -c[k + 7]),
          a1 = Math.atan2(-c[k + 6], -c[k + 5]);
        let da = a1 - a0;
        if (da > Math.PI) da -= 2 * Math.PI;
        if (da < -Math.PI) da += 2 * Math.PI;
        const a = a0 + da * s;
        line.push([c[k + 2] + c[k + 4] * Math.cos(a), c[k + 3] + c[k + 4] * Math.sin(a)]);
      }
    }
    out.push(line);
  }
  return out;
}
