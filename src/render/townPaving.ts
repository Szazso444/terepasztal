import { hash2 } from '../engine/rng';
import { DIR_DX, DIR_DY, type Dir } from '../engine/iso';
import { surfaceNoise } from './terrainMaterials';
import { roadRag, roadWeight } from './roadPaint';
import { ROAD_HALF } from './roadShape';

/**
 * Town paving (#443, the approved look of the art demo's v7, 2026-10-14): small setts about a
 * tenth of a tile laid in arcs, lit from the upper left, in warm sandstone greys a value step
 * below the house walls. The paving follows the paved tiles (`cityTiles`, src/sim/city.ts) with a
 * gentle wobble and rounded convex corners, plus a doorstep in front of each street door on a
 * paved tile. Over its last quarter tile it wears out (grass in the joints, setts missing) and a
 * fringe of packed earth outside it fades into the ground.
 *
 * A road across the square (#476) runs on as a lane of setts: where the paving holds a road, the
 * setts lie in straight courses along it (`courses`), a little darker, with dust that gathers toward
 * the road's centre line (`laneWeight`). The painter hands `paint` its distance from that line
 * (roadShape.ts, read by a `RoadPaint` of the paved road tiles); the demo's `streetAt` and
 * `PW_ROAD` are the model.
 *
 * Everything here is a function of the map point and the paved tiles, never of the chunk being
 * painted, so neighbouring chunks agree pixel for pixel. Points are map tile coordinates (a tile's
 * centre at whole numbers, as the painter reads them); the pattern and the noise run on world
 * coordinates (map plus origin), so a map that grows keeps its picture.
 */

/** A street door, as `Door` in src/sim/doors.ts gives it: a tile and the side it faces. */
export interface PavingDoor {
  tile: { readonly x: number; readonly y: number };
  side: Dir;
}

/** The setts' colours: three for the square's one colour cluster, a lighter and a darker odd one. */
const SETTS = [
  [166, 149, 119],
  [171, 154, 123],
  [161, 145, 116],
  [173, 153, 119],
  [152, 139, 114],
] as const;
const JOINT = [140, 126, 101] as const;
/** Packed earth: worn setts gather it, missing ones show it, the fringe outside is made of it. */
const DUST = [160, 142, 110] as const;
/** The packed earth of the fringe outside the paving. */
export const FRINGE_EARTH: readonly number[] = DUST.map((c) => c * 0.92);
/** The light, in tile coordinates: from -x (the screen's upper left), a little from +y. */
const LIGHT_U = -0.8,
  LIGHT_V = 0.6;

/** Doorstep half sizes (tiles): along the door's side, and out from it; its centre's distance out. */
const STEP_ALONG = 0.17,
  STEP_OUT = 0.2,
  STEP_AT = 0.56,
  STEP_ROUND = 0.08;
/** Corner radius of the paving's convex corners (tiles). */
const CORNER = 0.28;
/** How far inside the outline the setts wear out (tiles), the last quarter tile. */
const WEAR = 0.26;
/** The most the wear's ragged line moves it (tiles). */
const RAG = 0.04;
/**
 * The most the outline's wobble moves it (tiles). Farther than this and PAVING_FRINGE outside the
 * paved tiles and the doorsteps, the paving changes nothing.
 */
const WOBBLE = 0.08;
/** How far outside the outline the fringe of packed earth reaches (tiles). */
export const PAVING_FRINGE = 0.18;
/**
 * Inside distance (tiles) from which no wear reaches a point: its joints never fill with the
 * ground, so the painter need not paint the ground under it (`paint` reads no `ground`).
 */
export const PAVING_SOLID = WEAR + RAG;
/**
 * Inside distance (tiles) from which no sett is missing either: the centre of the sett a point lies
 * in is never more than about a tenth of a tile away, and `distance` changes by at most 2.2 times
 * the way travelled (the outline's 1, its wobble's 1.2), so the centre is PAVING_SOLID in too.
 */
export const PAVING_DEEP = 0.55;
/**
 * Returned (negated) for a point the paving does not reach, and for one deep inside it; the
 * painter reads a tile the paving cannot reach as this far outside it.
 */
export const PAVING_FAR = 9;

/**
 * The lane of a road across the paving (#476). Its dust is full within LANE_FULL of the road's
 * centre line and gone LANE_FADE farther out, the edge moved by the paving's ragged line.
 */
export const LANE_FULL = 0.12,
  LANE_FADE = 0.18;
/** The farthest from a road's centre line (tiles) the lane changes the paving at all. */
export const LANE_REACH = LANE_FULL + LANE_FADE + RAG;
/** How much of the lane's weight is dust over the setts, how much the setts darken, how much wider the joints. */
const LANE_DUST = 0.28,
  LANE_DARKEN = 0.035,
  LANE_JOINT = 0.004;
/** The street's setts mix a little toward the dust of its traffic even on the road's line. */
const STREET_DUST = 0.05;

/** Seeds of the paving's noise. */
const SEED_WOBBLE = 4431,
  SEED_RIPPLE = 4432,
  SEED_RAG = 4433,
  SEED_FRINGE = 4434,
  SEED_TONE = 4435,
  SEED_TONE_FINE = 4436,
  SEED_TILE = 4437,
  SEED_WARMTH = 4438;

const sstep = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
/** Length of (x, y) (`Math.hypot` is several times slower, and this runs per pixel). */
const length = (x: number, y: number) => Math.sqrt(x * x + y * y);
/** Length of the positive parts of (x, y): a box's outside distance. */
const outside = (x: number, y: number) => length(x > 0 ? x : 0, y > 0 ? y : 0);

/**
 * How much of a road's lane there is `dist` tiles from its centre line (roadShape.ts), the ragged
 * line moved it `rag` tiles (within RAG either way): 1 within LANE_FULL, 0 from LANE_FADE farther
 * out, falling smoothly between. Not up to the lane's setts, which lie over the road's own width
 * (`streetWeight`); this is the dust and the wear that spreads past them.
 */
export function laneWeight(dist: number, rag: number) {
  return 1 - sstep((dist - LANE_FULL + rag) / LANE_FADE);
}

/**
 * How much of the paving is laid in courses `dist` tiles from a road's centre line: the road's own
 * width and soft edge (`roadWeight`), as the gravel road would have it, `rag` tiles out (0 to
 * ROAD_RAG).
 */
export function streetWeight(dist: number, rag: number) {
  return roadWeight(dist - ROAD_HALF, rag);
}

/** Tile flags: paved; the paving can reach it; doorsteps reach it. */
const PAVED = 1,
  NEAR = 2,
  STEPS = 4;
/** Sides of a tile that face unpaved ground (or the map's edge): -x, +x, -y, +y. */
const OPEN_W = 8,
  OPEN_E = 16,
  OPEN_N = 32,
  OPEN_S = 64;
/** A paved tile with an unpaved tile (or the map's edge) among its eight neighbours. */
const BORDER = 128;

/**
 * The doorsteps of the street doors on paved tiles, four numbers each: the centre (map tile
 * coordinates) and the half sizes along x and y. A doorstep is a rounded box in front of the door,
 * reaching a quarter tile out over the tile it faces.
 */
export function pavingDoorsteps(
  doors: Iterable<PavingDoor>,
  paved: (tile: number) => boolean,
  w: number,
  h: number,
): number[] {
  const out: number[] = [];
  for (const { tile, side } of doors) {
    if (tile.x < 0 || tile.y < 0 || tile.x >= w || tile.y >= h) continue;
    if (!paved(tile.y * w + tile.x)) continue;
    const dx = DIR_DX[side],
      dy = DIR_DY[side];
    out.push(
      tile.x + dx * STEP_AT,
      tile.y + dy * STEP_AT,
      dx ? STEP_OUT : STEP_ALONG,
      dx ? STEP_ALONG : STEP_OUT,
    );
  }
  return out;
}

/** The tiles a doorstep can change the picture of (`pavingDoorsteps`'s four numbers from `at`). */
export function doorstepTiles(steps: readonly number[], at: number, w: number, h: number) {
  const reach = WOBBLE + PAVING_FRINGE + 0.04,
    out: number[] = [];
  const x0 = Math.max(0, Math.round(steps[at] - steps[at + 2] - reach)),
    x1 = Math.min(w - 1, Math.round(steps[at] + steps[at + 2] + reach)),
    y0 = Math.max(0, Math.round(steps[at + 1] - steps[at + 3] - reach)),
    y1 = Math.min(h - 1, Math.round(steps[at + 1] + steps[at + 3] + reach));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push(y * w + x);
  return out;
}

/**
 * The tiles whose picture changes when doorsteps `before` become `after` (`pavingDoorsteps`):
 * those a doorstep laid or taken up reaches.
 */
export function doorstepChanges(
  before: readonly number[],
  after: readonly number[],
  w: number,
  h: number,
): Set<number> {
  const key = (list: readonly number[], at: number) => list.slice(at, at + 4).join();
  const keys = (list: readonly number[]) => {
    const out = new Set<string>();
    for (let at = 0; at + 3 < list.length; at += 4) out.add(key(list, at));
    return out;
  };
  const was = keys(before),
    is = keys(after),
    out = new Set<number>();
  for (const [list, other] of [
    [before, is],
    [after, was],
  ] as const)
    for (let at = 0; at + 3 < list.length; at += 4)
      if (!other.has(key(list, at))) for (const k of doorstepTiles(list, at, w, h)) out.add(k);
  return out;
}

/** The sett a point lies in, as `fan` leaves it. */
let settId = 0,
  settU = 0,
  settV = 0,
  settInside = 0,
  settNormalU = 0,
  settNormalV = 0;
/**
 * Inside distance of point (pu, pv) from a rounded rectangle's centre, its half sizes and corner
 * radius, into `settInside`, and the outward normal of the outline nearest it.
 */
function roundedRect(pu: number, pv: number, hu: number, hv: number, round: number) {
  const qx = hu - Math.abs(pu),
    qy = hv - Math.abs(pv);
  if (qx < round && qy < round) {
    const ex = round - qx,
      ey = round - qy,
      l = length(ex, ey) || 1;
    settInside = round - l;
    settNormalU = (ex / l) * Math.sign(pu);
    settNormalV = (ey / l) * Math.sign(pv);
  } else if (qx < qy) {
    settInside = qx;
    settNormalU = Math.sign(pu);
    settNormalV = 0;
  } else {
    settInside = qy;
    settNormalU = 0;
    settNormalV = Math.sign(pv);
  }
}
/** Width of a fan's scale (tiles); its rows lie half that apart. */
const FAN = 0.8,
  FAN_RADIUS = FAN * 0.72,
  /** Depth of a ring of setts. */
  RING = 0.095;
/**
 * The fan (segmental) laying at world point (u, v): scales 0.8 tile wide in rows 0.4 apart, each
 * of rings of setts 0.095 deep, a nearer row lying over the one behind it. Leaves the sett's id
 * (0..1), the point's inside distance, the outline's outward normal and, if `centre`, the sett's
 * centre.
 */
function fan(u: number, v: number, centre: boolean) {
  const j0 = Math.floor(v / (FAN / 2));
  let cu = 0,
    cv = 0,
    ci = 0,
    cj = 0,
    found = false;
  for (let j = j0 + 2; j >= j0 - 1 && !found; j--) {
    const off = ((j & 1) * FAN) / 2,
      i0 = Math.round((u - off) / FAN);
    for (let i = i0 - 1; i <= i0 + 1; i++) {
      const x = i * FAN + off,
        y = (j * FAN) / 2;
      if (v <= y + 1e-9 && (u - x) * (u - x) + (v - y) * (v - y) < FAN_RADIUS * FAN_RADIUS) {
        cu = x;
        cv = y;
        ci = i;
        cj = j;
        found = true;
        break;
      }
    }
  }
  if (!found) {
    settId = 0.5;
    settU = u;
    settV = v;
    settInside = settNormalU = settNormalV = 0;
    return;
  }
  const du = u - cu,
    dv = v - cv,
    r = length(du, dv) || 1e-6,
    ru = du / r,
    rv = dv / r;
  const ring = Math.floor(r / RING),
    middle = (ring + 0.5) * RING,
    n = Math.max(1, Math.round((Math.PI * middle) / (RING * 1.3)));
  const phase = hash2(ring, ci, 821 + cj),
    t = (Math.atan2(-dv, du) / Math.PI) * n + phase,
    k = Math.floor(t),
    span = (Math.PI * middle) / n;
  settId = hash2(k, ring * 131 + ci, cj * 7 + 822);
  if (centre) {
    const angle = ((k + 0.5 - phase) / n) * Math.PI;
    settU = cu + middle * Math.cos(angle);
    settV = cv - middle * Math.sin(angle);
  }
  roundedRect((t - k - 0.5) * span, r - middle, span / 2, RING / 2, 0.022);
  // from the ring's frame (along it, across it) back to tile coordinates
  const along = settNormalU,
    across = settNormalV;
  settNormalU = across * ru + along * rv;
  settNormalV = across * rv - along * ru;
}

/** Depth of a course of setts along a road (tiles), the length of a sett, and how far it varies. */
const COURSE = 0.1,
  SETT_LONG = 0.13,
  SETT_JITTER = 0.6;
/**
 * The laying of a lane at world point (u, v): straight courses 0.1 tile deep, along u (or along v,
 * if `alongV`), their setts 0.09 to 0.17 long, each course offset from the next. Leaves what `fan`
 * does.
 */
function courses(u: number, v: number, alongV: boolean) {
  if (alongV) {
    courses(v, u, false);
    const c = settU;
    settU = settV;
    settV = c;
    const n = settNormalU;
    settNormalU = settNormalV;
    settNormalV = n;
    return;
  }
  const j = Math.floor(v / COURSE),
    shift = hash2(j, 7, 811) * SETT_LONG,
    uu = u - shift,
    jit = (k: number) => (hash2(k, j, 812) - 0.5) * SETT_JITTER * SETT_LONG;
  let k = Math.floor(uu / SETT_LONG),
    a0 = k * SETT_LONG + jit(k),
    a1 = (k + 1) * SETT_LONG + jit(k + 1);
  if (uu < a0) {
    k--;
    a1 = a0;
    a0 = k * SETT_LONG + jit(k);
  } else if (uu >= a1) {
    k++;
    a0 = a1;
    a1 = (k + 1) * SETT_LONG + jit(k + 1);
  }
  settId = hash2(k, j, 813);
  settU = shift + (a0 + a1) / 2;
  settV = (j + 0.5) * COURSE;
  roundedRect(u - settU, v - settV, (a1 - a0) / 2, COURSE / 2, 0.022);
}

/** The course laying's sett at world point (u, v), for tests: its id, centre and inside distance. */
export function courseAt(u: number, v: number, alongV = false) {
  courses(u, v, alongV);
  return { id: settId, u: settU, v: settV, inside: settInside };
}

/** The fan's sett at world point (u, v), for tests: its id and centre. */
export function settAt(u: number, v: number) {
  fan(u, v, true);
  return { id: settId, u: settU, v: settV, inside: settInside };
}

/**
 * The paving of one map: which tiles are paved, the doorsteps, and from them the outline the
 * painter reads at any map point.
 */
export class TownPaving {
  private readonly flags: Uint8Array;
  /** Doorstep indices (into `steps`, in fours) by tile, for the tiles flagged STEPS. */
  private readonly stepsAt = new Map<number, number[]>();
  constructor(
    readonly w: number,
    readonly h: number,
    readonly originX: number,
    readonly originY: number,
    paved: Iterable<number>,
    private readonly steps: readonly number[] = [],
  ) {
    const flags = (this.flags = new Uint8Array(w * h));
    for (const k of paved) if (k >= 0 && k < flags.length) flags[k] |= PAVED;
    const isPaved = (x: number, y: number) =>
      x >= 0 && y >= 0 && x < w && y < h && flags[y * w + x] & PAVED;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const k = y * w + x;
        if (!(flags[k] & PAVED)) continue;
        if (!isPaved(x - 1, y)) flags[k] |= OPEN_W;
        if (!isPaved(x + 1, y)) flags[k] |= OPEN_E;
        if (!isPaved(x, y - 1)) flags[k] |= OPEN_N;
        if (!isPaved(x, y + 1)) flags[k] |= OPEN_S;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            if (!isPaved(x + dx, y + dy)) flags[k] |= BORDER;
            const xx = x + dx,
              yy = y + dy;
            if (xx >= 0 && yy >= 0 && xx < w && yy < h) flags[yy * w + xx] |= NEAR;
          }
      }
    for (let at = 0; at + 3 < steps.length; at += 4)
      for (const k of doorstepTiles(steps, at, w, h)) {
        flags[k] |= NEAR | STEPS;
        const list = this.stepsAt.get(k);
        if (list) list.push(at);
        else this.stepsAt.set(k, [at]);
      }
  }
  /** Is the tile with index `k` (`y * w + x`) paved? */
  paved(k: number) {
    return (this.flags[k] & PAVED) !== 0;
  }
  /** Can the paving or its fringe change the picture anywhere on the tile with index `k`? */
  near(k: number) {
    return (this.flags[k] & NEAR) !== 0;
  }
  /**
   * The outline of paved tile (i, j) at point (x, y), as a signed distance (tiles, inside
   * positive): only its sides facing unpaved ground count, and the corner between two such sides
   * is rounded.
   */
  private tileOutline(i: number, j: number, f: number, x: number, y: number) {
    const w = f & OPEN_W,
      e = f & OPEN_E,
      n = f & OPEN_N,
      s = f & OPEN_S;
    const dx = w && e ? 0.5 - Math.abs(x - i) : w ? x - i + 0.5 : e ? i + 0.5 - x : PAVING_FAR;
    const dy = n && s ? 0.5 - Math.abs(y - j) : n ? y - j + 0.5 : s ? j + 0.5 - y : PAVING_FAR;
    const qx = CORNER - dx,
      qy = CORNER - dy;
    return CORNER - outside(qx, qy) - Math.min(Math.max(qx, qy), 0);
  }
  /**
   * How far inside the paving's outline map point (x, y) lies (tiles; negative outside), wobble
   * included. A point the paving does not reach gives -9, one deep inside a paved area 9.
   *
   * Inside a paved tile: its own outline, and no farther from the edge than the nearest unpaved
   * tile around it (a concave corner stays sharp). Outside: the outline of the paved tile beside
   * it nearest to it; a paved tile diagonal to it counts only where its corner is convex, as an
   * edge-adjacent paved tile is nearer otherwise. A doorstep adds its rounded box.
   */
  distance(x: number, y: number): number {
    const w = this.w,
      h = this.h,
      i0 = Math.round(x),
      j0 = Math.round(y);
    if (i0 < 0 || j0 < 0 || i0 >= w || j0 >= h) return -PAVING_FAR;
    const flags = this.flags,
      f = flags[j0 * w + i0];
    if (!(f & NEAR)) return -PAVING_FAR;
    let d: number;
    if (f & PAVED) {
      d = this.tileOutline(i0, j0, f, x, y);
      if (f & BORDER)
        for (let dj = -1; dj <= 1; dj++)
          for (let di = -1; di <= 1; di++) {
            const i = i0 + di,
              j = j0 + dj;
            if (i >= 0 && j >= 0 && i < w && j < h && flags[j * w + i] & PAVED) continue;
            const ex = Math.abs(x - i) - 0.5,
              ey = Math.abs(y - j) - 0.5,
              out = outside(ex, ey);
            if (out < d) d = out;
          }
    } else {
      d = -PAVING_FAR;
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          const i = i0 + di,
            j = j0 + dj;
          if ((!di && !dj) || i < 0 || j < 0 || i >= w || j >= h) continue;
          const g = flags[j * w + i];
          if (!(g & PAVED)) continue;
          // a diagonal tile counts where both its sides toward this tile face unpaved ground
          if (di && dj && !(g & (di > 0 ? OPEN_W : OPEN_E) && g & (dj > 0 ? OPEN_N : OPEN_S)))
            continue;
          const v = this.tileOutline(i, j, g, x, y);
          if (v > d) d = v;
        }
    }
    if (f & STEPS) {
      const steps = this.steps;
      for (const at of this.stepsAt.get(j0 * w + i0)!) {
        const qx = Math.abs(x - steps[at]) - steps[at + 2] + STEP_ROUND,
          qy = Math.abs(y - steps[at + 1]) - steps[at + 3] + STEP_ROUND;
        const inside = STEP_ROUND - outside(qx, qy) - Math.min(Math.max(qx, qy), 0);
        if (inside > d) d = inside;
      }
    }
    // the wobble, only where it can move the picture
    if (d <= -(PAVING_FRINGE + WOBBLE) || d >= PAVING_DEEP + 0.25) return d;
    const wx = x + this.originX,
      wy = y + this.originY;
    return (
      d +
      (surfaceNoise(wx * 2.2, wy * 2.2, SEED_WOBBLE) - 0.5) * 0.12 +
      (surfaceNoise(wx * 7, wy * 7, SEED_RIPPLE) - 0.5) * 0.04
    );
  }
  /**
   * How whole the paving is at map point (x, y), `d` inside its outline (`distance`): 1 from a
   * quarter tile in, falling to 0 at the outline over a ragged line.
   */
  private wear(x: number, y: number, d: number) {
    if (d >= PAVING_SOLID) return 1;
    const rag =
      (surfaceNoise((x + this.originX) * 6.3, (y + this.originY) * 6.3, SEED_RAG) - 0.5) * 2 * RAG;
    return sstep((d + rag) / WEAR);
  }
  /**
   * Share of packed earth over the ground at map point (x, y), `d` outside the outline (-0.18 to
   * 0): three quarters at the outline, fading out a little over a tenth of a tile.
   */
  fringe(x: number, y: number, d: number) {
    if (d <= -PAVING_FRINGE) return 0;
    const n = surfaceNoise((x + this.originX) * 7.1, (y + this.originY) * 7.1, SEED_FRINGE) - 0.5;
    return 0.75 * (1 - sstep((-d - 0.02 + n * 0.06) / 0.12));
  }
  /** The street's colour while `paint` blends it over the plain paving. */
  private readonly street = [0, 0, 0];
  /**
   * The paving's colour at map point (x, y), `d` inside its outline (`distance`, above 0), into
   * `out`, ready to show (no season tint). `ground` is the colour of the ground under it, which
   * worn joints and missing setts show; from `PAVING_SOLID` in it is never read, so it may be null
   * there. `scale` is raster pixels per world pixel: joints are softened to a pixel's width.
   *
   * `lane` is the point's distance from the centre line of a road across the paving (tiles; leave
   * it out where none is near), and `axis` the way that road runs there, 1 along x and 2 along y:
   * its setts lie in courses along it, darker and dustier toward the line.
   */
  paint(
    x: number,
    y: number,
    d: number,
    ground: readonly number[] | null,
    scale: number,
    out: number[],
    lane = Infinity,
    axis = 1,
  ) {
    if (lane >= LANE_REACH) {
      this.lay(x, y, d, ground, scale, out, 0, 0);
      return;
    }
    const wx = x + this.originX,
      wy = y + this.originY,
      rag = (surfaceNoise(wx * 6.3, wy * 6.3, SEED_RAG) - 0.5) * 2 * RAG,
      dusty = laneWeight(lane, rag),
      street = lane < ROAD_HALF + 0.1 ? streetWeight(lane, roadRag(wx, wy)) : 0;
    this.lay(x, y, d, ground, scale, out, 0, dusty);
    if (street <= 0) return;
    const alt = this.street;
    this.lay(x, y, d, ground, scale, alt, axis, dusty, STREET_DUST);
    for (let c = 0; c < 3; c++) out[c] += (alt[c] - out[c]) * street;
  }
  /**
   * The paving at map point (x, y) laid in the fan (`axis` 0) or in courses along x (1) or y (2),
   * `dusty` of the lane's weight there, `dust` more of the packed earth mixed in.
   */
  private lay(
    x: number,
    y: number,
    d: number,
    ground: readonly number[] | null,
    scale: number,
    out: number[],
    axis: number,
    dusty: number,
    dust0 = 0,
  ) {
    const wx = x + this.originX,
      wy = y + this.originY;
    if (axis) courses(wx, wy, axis === 2);
    else fan(wx, wy, d < PAVING_DEEP);
    const id = settId,
      inside = settInside,
      nu = settNormalU,
      nv = settNormalV;
    let keep = 1,
      gone = 0;
    if (d < PAVING_DEEP) {
      // whether a sett is there at all is decided at its centre, so setts go whole
      const cx = settU - this.originX,
        cy = settV - this.originY;
      const kept = this.wear(cx, cy, this.distance(cx, cy));
      gone = sstep((id * 0.85 + 0.08 - kept) / 0.05);
      keep = this.wear(x, y, d);
    }
    // one colour cluster: a slow tint across the square, a sett's own shade a step either way
    const tone = surfaceNoise(wx * 1.1, wy * 1.1, SEED_TONE) - 0.5,
      fine = surfaceNoise(wx * 3.2, wy * 3.2, SEED_TONE_FINE) - 0.5;
    const pick =
      id < 0.07 ? 4 : id > 0.94 ? 3 : Math.floor(((id - 0.07) / 0.87) * 2.999 + tone * 1.2 + 3) % 3;
    const tile = surfaceNoise(wx, wy, SEED_TILE) - 0.5,
      warmth = (surfaceNoise(wx, wy, SEED_WARMTH) - 0.5) * 6;
    const base = SETTS[pick],
      value =
        1 +
        (hash2(Math.floor(id * 9973), 3, 841) - 0.5) * 0.03 +
        tone * 0.04 +
        fine * 0.015 +
        tile * 0.035;
    // the sett's rounded top: lit along its upper-left edges, shaded along the lower right
    const joint = 0.008 + 0.012 * (1 - keep) + LANE_JOINT * dusty,
      soft = Math.max(0.007, 0.028 / scale),
      covered = sstep((inside - joint) / soft);
    const light = 1 + 0.04 * (1 - sstep((inside - joint) / 0.03)) * (nu * LIGHT_U + nv * LIGHT_V);
    const dim = 1 - LANE_DARKEN * dusty;
    let r = (base[0] + warmth) * value * light * dim,
      g = base[1] * value * light * dim,
      b = (base[2] - warmth) * value * light * dim;
    // dust on worn setts, and in a road's lane
    const dust = Math.min(1, (1 - keep) * 0.5 + LANE_DUST * dusty);
    if (dust0) {
      r += (DUST[0] - r) * dust0;
      g += (DUST[1] - g) * dust0;
      b += (DUST[2] - b) * dust0;
    }
    r += (DUST[0] - r) * dust;
    g += (DUST[1] - g) * dust;
    b += (DUST[2] - b) * dust;
    const open = Math.max(1 - covered, gone);
    if (open > 0) {
      // the joint, and in a missing sett's place packed earth, toward the edge the ground itself
      let jr = JOINT[0] + (DUST[0] * 0.9 - JOINT[0]) * dust,
        jg = JOINT[1] + (DUST[1] * 0.9 - JOINT[1]) * dust,
        jb = JOINT[2] + (DUST[2] * 0.9 - JOINT[2]) * dust;
      const bare = Math.min(1, (1 - keep) * 1.6);
      let er = DUST[0] * 0.88,
        eg = DUST[1] * 0.88,
        eb = DUST[2] * 0.88;
      if (bare > 0.01 && ground) {
        er += (ground[0] - er) * bare * 0.8;
        eg += (ground[1] - eg) * bare * 0.8;
        eb += (ground[2] - eb) * bare * 0.8;
      }
      // the joint fills with that ground toward the edge; a missing sett shows it all
      const fill = Math.min(1, bare * 0.85);
      jr += (er - jr) * fill;
      jg += (eg - jg) * fill;
      jb += (eb - jb) * fill;
      r = jr + (r - jr) * covered;
      g = jg + (g - jg) * covered;
      b = jb + (b - jb) * covered;
      r += (er - r) * gone;
      g += (eg - g) * gone;
      b += (eb - b) * gone;
    }
    out[0] = r;
    out[1] = g;
    out[2] = b;
  }
}
