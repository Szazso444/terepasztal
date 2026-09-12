/**
 * Rigid-body placement of vehicles on a track polyline (spec §3). Bogies sit at fixed arc-length
 * offsets behind the vehicle's front; each rigid segment is posed from its outer bogies, then
 * shifted sideways so that the body centres on the TRACK rather than on its own bogies. Bodies
 * never change length. Pure geometry: no simulation state, usable by the tolerance table and by
 * the trains alike.
 */
import type { Vec2 } from '../engine/iso';

export type VehicleSize = 'small' | 'medium' | 'large';
export type BodyPlan = 'rigid' | 'tender' | 'garratt' | 'meyer';
export const SIZE_LEN: Record<VehicleSize, number> = { small: 1, medium: 2, large: 3 };
/** distance between two coupled bodies along the track */
export const COUPLER_GAP = 0.2;
/** tolerances in tiles: fore-and-aft slide, sideways float budget, residual gap to rail */
export const TOL = { foreAft: 0.3, sideways: 0.4, gap: 0.25 };
export const DEFAULT_PIVOT = 0.7;
/** a three-tile body keeps its bogies nearer the middle: less overhang swing on a curve */
export const LARGE_PIVOT = 0.58;
export const DEFAULT_LATERAL_PLAY = 0.35;

export type PartKind = 'body' | 'engine' | 'tender' | 'cradle' | 'frame' | 'nose' | 'centre';
/** two-axle bogie, three-axle bogie, or the wheeled engine unit of a Meyer frame */
export type BogieKind = 'bogie' | 'bogie3' | 'engine_unit';

export interface SegmentSpec {
  part: PartKind;
  /** body length and pivot spacing, tiles */
  L: number;
  W: number;
  /** bogies (2, or 3 for the Bo-Bo-Bo body) */
  nb: number;
  bogie: BogieKind;
  /** arc offset of the segment's front from the vehicle's front */
  front: number;
  /** drawn back to front (the rear engine unit of a Garratt) */
  mirror?: boolean;
}
export interface VehicleSpec {
  L: number;
  size: VehicleSize;
  plan: BodyPlan;
  segments: SegmentSpec[];
  /** bogies are drawn as separate sprites (medium and large) */
  drawBogies: boolean;
  maxLateralPlay: number;
}

/** What a vehicle definition may say about its body. */
export interface BodyFields {
  size?: VehicleSize;
  plan?: BodyPlan;
  pivotRatio?: number;
  bogies?: number;
  /** axles per bogie: 2 (default) or 3 */
  bogieAxles?: number;
  maxLateralPlay?: number;
  type?: string;
}

export function vehicleSpec(def: BodyFields): VehicleSpec {
  const size = def.size ?? 'small';
  const L = SIZE_LEN[size];
  let plan: BodyPlan = def.plan ?? 'rigid';
  if (size === 'small') plan = 'rigid';
  if (size === 'medium' && plan !== 'tender') plan = 'rigid';
  if (size === 'large' && plan === 'tender') plan = 'rigid';
  const pr = def.pivotRatio ?? (size === 'large' ? LARGE_PIVOT : DEFAULT_PIVOT);
  const bogie: BogieKind = def.bogieAxles === 3 ? 'bogie3' : 'bogie';
  const segs: SegmentSpec[] = [];
  const nbRigid = def.bogies ?? (size === 'large' ? 3 : 2);
  switch (plan) {
    case 'rigid':
      segs.push({ part: 'body', L, W: pr * L, nb: nbRigid, bogie, front: 0 });
      break;
    case 'tender': {
      const le = 1.25;
      const lt = L - le;
      segs.push({ part: 'engine', L: le, W: pr * le, nb: 2, bogie, front: 0 });
      segs.push({ part: 'tender', L: lt, W: 0.66 * lt, nb: 2, bogie: 'bogie', front: le });
      break;
    }
    case 'garratt': {
      const le = 0.8;
      const lc = L - 2 * le;
      segs.push({ part: 'engine', L: le, W: pr * le, nb: 2, bogie, front: 0 });
      segs.push({
        part: 'cradle',
        L: lc,
        W: Math.max(pr, 0.94) * lc,
        nb: 2,
        bogie: 'bogie',
        front: le,
      });
      segs.push({
        part: 'engine',
        L: le,
        W: pr * le,
        nb: 2,
        bogie,
        front: le + lc,
        mirror: true,
      });
      break;
    }
    case 'meyer': {
      const ratio = Math.max(0.5, Math.min(0.75, def.pivotRatio ?? 0.6));
      segs.push({ part: 'frame', L, W: ratio * L, nb: 2, bogie: 'engine_unit', front: 0 });
      break;
    }
  }
  return {
    L,
    size,
    plan,
    segments: segs,
    drawBogies: size !== 'small',
    maxLateralPlay: def.maxLateralPlay ?? DEFAULT_LATERAL_PLAY,
  };
}

// ------------------------------------------------------------------ polyline sampling

/** A sampled track path with arc-length lookup. */
export class Polyline {
  readonly cum: number[] = [];
  constructor(readonly pts: Vec2[]) {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      if (i) a += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      this.cum.push(a);
    }
  }
  get length() {
    return this.cum[this.cum.length - 1] ?? 0;
  }
  private seg(arc: number): number {
    const cum = this.cum;
    let lo = 1;
    let hi = cum.length - 1;
    if (hi < 1) return 1;
    if (arc <= cum[0]) return 1;
    if (arc >= cum[hi]) return hi;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < arc) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
  at(arc: number): Vec2 {
    const pts = this.pts;
    if (pts.length === 1) return { x: pts[0].x, y: pts[0].y };
    if (arc <= 0) return { x: pts[0].x, y: pts[0].y };
    if (arc >= this.length) {
      const p = pts[pts.length - 1];
      return { x: p.x, y: p.y };
    }
    const i = this.seg(arc);
    const t = (arc - this.cum[i - 1]) / Math.max(1e-9, this.cum[i] - this.cum[i - 1]);
    const a = pts[i - 1];
    const b = pts[i];
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }
  /** Unit tangent at an arc position, from the points 0.02 either side. */
  tangent(arc: number): Vec2 {
    const a = this.at(Math.max(0, arc - 0.02));
    const b = this.at(Math.min(this.length, arc + 0.02));
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    if (l < 1e-9) {
      const p = this.pts;
      if (p.length >= 2) {
        const n = p.length - 1;
        const l2 = Math.hypot(p[n].x - p[n - 1].x, p[n].y - p[n - 1].y) || 1;
        return { x: (p[n].x - p[n - 1].x) / l2, y: (p[n].y - p[n - 1].y) / l2 };
      }
      return { x: 1, y: 0 };
    }
    return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
  }
  /**
   * Nearest point of the polyline to P, searched within `window` tiles of arc either side of
   * `arcGuess`. Returns the point and its arc.
   */
  nearest(P: Vec2, arcGuess: number, window = 1.5): { p: Vec2; arc: number } {
    const pts = this.pts;
    if (pts.length === 1) return { p: pts[0], arc: 0 };
    const i0 = Math.max(1, this.seg(arcGuess - window));
    const i1 = Math.min(pts.length - 1, this.seg(arcGuess + window));
    let best = { p: pts[i0 - 1], arc: this.cum[i0 - 1] };
    let bd = Infinity;
    for (let i = i0; i <= i1; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const l2 = dx * dx + dy * dy;
      let t = l2 > 1e-12 ? ((P.x - a.x) * dx + (P.y - a.y) * dy) / l2 : 0;
      t = Math.max(0, Math.min(1, t));
      const q = { x: a.x + dx * t, y: a.y + dy * t };
      const d = (q.x - P.x) ** 2 + (q.y - P.y) ** 2;
      if (d < bd) {
        bd = d;
        best = { p: q, arc: this.cum[i - 1] + Math.sqrt(l2) * t };
      }
    }
    return best;
  }
}

// ------------------------------------------------------------------ posing

export interface BogiePose {
  x: number;
  y: number;
  /** track tangent angle */
  angle: number;
  kind: BogieKind;
  /** measured slide from its socket: along the body and across it */
  foreAft: number;
  lateral: number;
  /** Rail position of the independently moving sprite, also used during interpolation. */
  drawX: number;
  drawY: number;
}
export interface SegmentPose {
  part: PartKind;
  x: number;
  y: number;
  /** body axis angle (front minus rear pivot) */
  angle: number;
  L: number;
  mirror: boolean;
  bogies: BogiePose[];
  /** sideways shift applied to centre the body on the track, and what remains */
  delta: number;
  residualGap: number;
}
export interface VehiclePose {
  /** vehicle centre on the track and the tangent there */
  x: number;
  y: number;
  heading: number;
  segments: SegmentPose[];
}

/**
 * Pose one rigid segment whose front end sits at `arcFront` along the polyline (arc grows towards
 * the front of the train). Implements the exact algorithm of spec §3.
 */
export function poseSegment(
  pl: Polyline,
  arcFront: number,
  seg: SegmentSpec,
  sideways = TOL.sideways,
): SegmentPose {
  const { L, W, nb } = seg;
  const arcs: number[] = [];
  const first = arcFront - (L - W) / 2;
  for (let i = 0; i < nb; i++) arcs.push(first - (W / (nb - 1)) * i);
  const A = pl.at(arcs[0]);
  const B = pl.at(arcs[nb - 1]);
  let axx = A.x - B.x;
  let axy = A.y - B.y;
  const al = Math.hypot(axx, axy);
  if (al < 1e-9) {
    const t = pl.tangent(arcFront - L / 2);
    axx = t.x;
    axy = t.y;
  } else {
    axx /= al;
    axy /= al;
  }
  const nxx = -axy;
  const nxy = axx;
  let cx = (A.x + B.x) / 2;
  let cy = (A.y + B.y) / 2;
  // centre the body on the track, not on its own bogies: the mean gap over the body's length
  // pulls a long body out towards the arc (where its middle bogie runs) rather than leaving it
  // on the chord between the outer bogies
  let eMin = Infinity;
  let eMax = -Infinity;
  let eSum = 0;
  for (let k = 0; k <= 6; k++) {
    const t = (k / 6 - 0.5) * L;
    const S = { x: cx + axx * t, y: cy + axy * t };
    const N = pl.nearest(S, arcFront - L / 2 + t).p;
    const e = (N.x - S.x) * nxx + (N.y - S.y) * nxy;
    if (e < eMin) eMin = e;
    if (e > eMax) eMax = e;
    eSum += e;
  }
  const want = nb > 2 ? eSum / 7 : (eMin + eMax) / 2;
  const delta = Math.max(-sideways, Math.min(sideways, want));
  cx += nxx * delta;
  cy += nxy * delta;
  const residualGap = Math.max(Math.abs(eMax - delta), Math.abs(eMin - delta));
  const bogies: BogiePose[] = [];
  for (let i = 0; i < nb; i++) {
    const P = pl.at(arcs[i]);
    const socket = W / 2 - (W / (nb - 1)) * i;
    const skx = cx + axx * socket;
    const sky = cy + axy * socket;
    const rx = P.x - skx;
    const ry = P.y - sky;
    const tg = pl.tangent(arcs[i]);
    const along = rx * axx + ry * axy;
    const across = rx * nxx + ry * nxy;
    bogies.push({
      x: P.x,
      y: P.y,
      angle: Math.atan2(tg.y, tg.x),
      kind: seg.bogie,
      foreAft: Math.abs(along),
      lateral: Math.abs(across),
      drawX: P.x,
      drawY: P.y,
    });
  }
  return {
    part: seg.part,
    x: cx,
    y: cy,
    angle: Math.atan2(axy, axx),
    L,
    mirror: !!seg.mirror,
    bogies,
    delta,
    residualGap,
  };
}

/** Pose every segment of a vehicle whose front end is at `arcFront`. */
export function poseVehicle(pl: Polyline, arcFront: number, spec: VehicleSpec): VehiclePose {
  const segments = spec.segments.map((s) => poseSegment(pl, arcFront - s.front, s));
  const mid = pl.at(arcFront - spec.L / 2);
  const tg = pl.tangent(arcFront - spec.L / 2);
  return { x: mid.x, y: mid.y, heading: Math.atan2(tg.y, tg.x), segments };
}

/** Front arc offsets of every vehicle behind the head (vehicle 0's front is at 0). */
export function vehicleFronts(lengths: number[]): number[] {
  const out: number[] = [];
  let a = 0;
  for (let i = 0; i < lengths.length; i++) {
    out.push(a);
    a += lengths[i] + COUPLER_GAP;
  }
  return out;
}
export function consistLength(lengths: number[]) {
  return lengths.reduce((a, b) => a + b, 0) + Math.max(0, lengths.length - 1) * COUPLER_GAP;
}

// ------------------------------------------------------------------ facings

export const FACINGS = 48;
const STEP = (Math.PI * 2) / FACINGS;
/** Nearest of the 48 facings (7.5° apart) for a tile-space heading. */
export function facingOf(angle: number): number {
  const a = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  return Math.round(a / STEP) % FACINGS;
}
export function facingAngle(f: number) {
  return f * STEP;
}
/** The drawn facing whose horizontal mirror shows facing f (the reflection tx ↔ ty maps heading θ to 90° − θ). */
export function mirrorFacing(f: number) {
  return (((FACINGS / 4 - f) % FACINGS) + FACINGS) % FACINGS;
}
/** Facings drawn by the generators: the smaller member of each mirror pair; the rest are mirrored at draw time. */
export const DRAWN_FACINGS = new Set(
  Array.from({ length: FACINGS }, (_, f) => f).filter((f) => f <= mirrorFacing(f)),
);
/**
 * Share of the residual angle applied as a runtime rotation. A flattened isometric sprite cannot
 * be turned without its verticals leaning, so only part of the remainder is applied; with 48
 * facings the step is 7.5° and the lean stays under a few degrees.
 */
export const ROTATION_SHARE = 0.5;
/** Angle a tile-space heading makes on screen (2:1 projection, y down). */
export function screenAngle(angle: number) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return Math.atan2((c + s) * 0.5, c - s);
}
/** Runtime rotation that turns the sprite drawn for facing f into the exact heading. */
export function residualRotation(angle: number, f: number) {
  let d = screenAngle(angle) - screenAngle(facingAngle(f));
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
