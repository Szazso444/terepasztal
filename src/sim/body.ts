/**
 * Rigid-body placement of vehicles on a track polyline (spec §3). Bogies sit at fixed arc-length
 * offsets behind the vehicle's front; each rigid segment is posed from its outer bogies, then
 * shifted sideways so that the body centres on the TRACK rather than on its own bogies. Bodies
 * never change length. Pure geometry: no simulation state, usable by the tolerance table and by
 * the trains alike.
 */
import type { Vec2 } from '../engine/iso';
import { gearSegments, type Gear } from './gear';

export type VehicleSize = 'tiny' | 'small' | 'medium' | 'large';
export type BodyPlan = 'rigid' | 'tender' | 'garratt' | 'meyer';
export const SIZE_LEN: Record<VehicleSize, number> = { tiny: 0.5, small: 1, medium: 2, large: 3 };
/** distance between two coupled bodies along the track */
export const COUPLER_GAP = 0.2;
/**
 * Rolling stock sprites are drawn this much wider than their length scale, so gauge and body width
 * read at game zoom. The asset pipeline scales rendered models across by the same factor.
 */
export const DRAWN_WIDTH = 1.3;
/** tolerances in tiles: fore-and-aft slide, sideways float budget, residual gap to rail */
export const TOL = { foreAft: 0.3, sideways: 0.4, gap: 0.25 };
export const DEFAULT_PIVOT = 0.7;
/** a three-tile body keeps its bogies nearer the middle: less overhang swing on a curve */
export const LARGE_PIVOT = 0.58;
export const DEFAULT_LATERAL_PLAY = 0.35;
/**
 * A truck with a longer half wheelbase than this (tiles) stands on the rail as a chord, not as a
 * tangent: an engine unit under a boiler, four coupled axles and a pilot truck in one frame.
 */
export const LONG_TRUCK = 0.2;

/** `rear`: the rear half of a hinged body (its front half is `body`) */
export type PartKind =
  'body' | 'engine' | 'tender' | 'cradle' | 'frame' | 'nose' | 'centre' | 'rear';
/** two-axle bogie, three-axle bogie, or the wheeled engine unit of a Meyer frame */
export type BogieKind = 'bogie' | 'bogie3' | 'bogie4' | 'engine_unit';
/** axles under each kind of bogie */
export const BOGIE_AXLES: Record<BogieKind, number> = {
  bogie: 2,
  bogie3: 3,
  bogie4: 4,
  engine_unit: 3,
};

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
  /** each pivot's distance behind the segment's front, front to rear (default: W centred) */
  at?: number[];
  /** wheel group of each pivot (default: `bogie` for all) */
  kinds?: BogieKind[];
  /** pivots that carry the body but draw no truck (a cab hung between two snouts) */
  hidden?: boolean[];
  /** which of the part's trucks (its index in the gear table) each pivot is; -1: none, a fixed axle */
  truck?: number[];
  /** half the wheelbase of each pivot's truck, tiles (0: unknown or a single axle) */
  half?: number[];
  /**
   * Axles fixed in the frame (coupled drivers, a rigid tender's axles, small stock's baked axles):
   * distance behind the segment's front, front to rear. The frame stands on the rail at the first
   * and the last of them; the pivots then swivel and slide under it.
   */
  rigid?: number[];
  /** pivots that carry the frame with its fixed axles (a Mallet's front engine): its supports
   *  are then the fixed axles' middle and these */
  carry?: number[];
  /** a half of a hinged body: this end of it (as the vehicle runs) rests on the part next to it */
  hinge?: 'front' | 'rear';
  /**
   * The body rides pinned on its wheel groups (a model that brings its own trucks): its axis is the
   * line that fits the rail points of its fixed axles and trucks best, its outermost groups stand as
   * far apart through the air as they are on the body, and it is not shifted sideways towards the
   * arc. On two trucks they never leave their sockets; with more groups (a steam engine's drivers,
   * leading and trailing trucks) each is a little off, none far.
   */
  pinned?: boolean;
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
  /** axles per bogie: 2 (default), 3 or 4 */
  bogieAxles?: number;
  maxLateralPlay?: number;
  type?: string;
  /** The engine's own running gear as its model draws it (src/data/gear.json) and its own length in
   *  tiles: together they replace the size's length and the plan's segments. */
  gear?: Gear;
  lengthTiles?: number;
  /** The sprite is a rendered model: the generic trucks are not drawn under it. */
  spriteGear?: boolean;
  /** Trucks rendered as sprites of their own, by part: their indices in the gear table. Each is drawn
   *  at its own place on the rail; the others (and all of them without this) are part of the body. */
  truckSprites?: Record<string, number[]>;
}

export function vehicleSpec(def: BodyFields): VehicleSpec {
  const size = def.size ?? 'small';
  if (def.gear && def.lengthTiles) {
    const segments = gearSegments(def.gear, def.lengthTiles);
    if (def.spriteGear)
      for (const g of segments) {
        g.pinned = true;
        if (g.at) {
          const own = def.truckSprites?.[g.part];
          g.hidden = g.at.map(
            (_, k) => (g.hidden?.[k] ?? false) || !own?.includes(g.truck?.[k] ?? -1),
          );
        }
      }
    const parts = new Set(segments.map((s) => s.part));
    return {
      L: def.lengthTiles,
      size,
      plan: parts.has('tender') ? 'tender' : parts.has('cradle') ? 'garratt' : 'rigid',
      segments,
      drawBogies: segments.some((s) => s.nb > 0 && !(s.hidden ?? []).every(Boolean)),
      maxLateralPlay: def.maxLateralPlay ?? DEFAULT_LATERAL_PLAY,
    };
  }
  const L = SIZE_LEN[size];
  let plan: BodyPlan = def.plan ?? 'rigid';
  if (size === 'small' || size === 'tiny') plan = 'rigid';
  if (size === 'medium' && plan !== 'tender') plan = 'rigid';
  if (size === 'large' && plan === 'tender') plan = 'rigid';
  const pr = def.pivotRatio ?? (size === 'large' ? LARGE_PIVOT : DEFAULT_PIVOT);
  const bogie: BogieKind =
    def.bogieAxles === 4 ? 'bogie4' : def.bogieAxles === 3 ? 'bogie3' : 'bogie';
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
    // bodies up to a tile long are drawn with their own wheels
    drawBogies: size !== 'small' && size !== 'tiny',
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
  /** carries the body without a drawn truck */
  hidden?: boolean;
  /** the part's truck this is (its index in the gear table), where the gear table names it */
  truck?: number;
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
  /** furthest a fixed axle between the frame's end axles sits from the rail */
  wheelGap: number;
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
  reversed = false,
): SegmentPose {
  const { L, W, nb } = seg;
  // positions in track order: a reversed vehicle or a mirrored segment meets its rear first
  const back = reversed !== !!seg.mirror;
  const flip = (a: number[]) => (back ? a.map((x) => L - x).reverse() : a);
  const t = seg.at
    ? flip(seg.at)
    : Array.from({ length: nb }, (_, i) => (L - W) / 2 + (W / (nb - 1)) * i);
  const kinds = seg.kinds ? (back ? [...seg.kinds].reverse() : seg.kinds) : null;
  const hidden = seg.hidden ? (back ? [...seg.hidden].reverse() : seg.hidden) : null;
  const truck = seg.truck ? (back ? [...seg.truck].reverse() : seg.truck) : null;
  const half = seg.half ? (back ? [...seg.half].reverse() : seg.half) : null;
  /**
   * Where a wheel group stands whose middle is at `arc`: on the rail there, along the rail. A long
   * truck cannot follow a curve along its length: tangent at its middle its end axles run wide. It
   * stands on the chord through the rail 0.7 of its half wheelbase either side of its middle
   * instead, so its end axles and its middle ones are equally near the rail (a quarter as far off
   * as the tangent's ends).
   */
  const stand = (arc: number, hw: number) => {
    if (hw <= LONG_TRUCK) {
      const P = pl.at(arc),
        tg = pl.tangent(arc);
      return { x: P.x, y: P.y, angle: Math.atan2(tg.y, tg.x) };
    }
    const q = hw * Math.SQRT1_2,
      A = pl.at(arc + q),
      B = pl.at(arc - q);
    if (Math.hypot(A.x - B.x, A.y - B.y) < 1e-9) {
      const tg = pl.tangent(arc);
      return { x: A.x, y: A.y, angle: Math.atan2(tg.y, tg.x) };
    }
    return { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2, angle: Math.atan2(A.y - B.y, A.x - B.x) };
  };
  /** half the wheelbase of the truck whose pivot is `g` behind the segment's front (0: a fixed axle) */
  const halfOf = (g: number) => {
    const i = half ? t.findIndex((v) => Math.abs(v - g) < 1e-9) : -1;
    return i >= 0 ? half![i] : 0;
  };
  const rig = seg.rigid && seg.rigid.length >= 2 ? flip(seg.rigid) : null;
  const carry = seg.carry?.length ? flip(seg.carry) : null;
  // the frame's two supports: its end fixed axles (or their middle and a carrying unit), else its
  // outer pivots
  const ends =
    rig && carry
      ? [
          Math.min(carry[0], (rig[0] + rig[rig.length - 1]) / 2),
          Math.max(carry[carry.length - 1], (rig[0] + rig[rig.length - 1]) / 2),
        ]
      : rig
        ? [rig[0], rig[rig.length - 1]]
        : t.length >= 2
          ? [t[0], t[t.length - 1]]
          : null;
  let axx: number;
  let axy: number;
  let cx: number;
  let cy: number;
  // a pinned body sits on every wheel group it has: its fixed axles and its trucks. Its outermost
  // groups stand this much further apart along the rail than on the body (a chord is shorter than
  // its arc), measured from their middle.
  const groups = seg.pinned ? [...(rig ?? []), ...t] : [];
  const span = groups.length >= 2 ? [Math.min(...groups), Math.max(...groups)] : (ends ?? [0, 0]);
  const pinned = seg.pinned && groups.length >= 2 && span[1] - span[0] > 1e-6;
  const mid = (span[0] + span[1]) / 2;
  let stretch = 1;
  if (pinned) {
    const h = (span[1] - span[0]) / 2;
    let a = h;
    for (let k = 0; k < 8; k++) {
      const P = stand(arcFront - mid + a, halfOf(span[0]));
      const Q = stand(arcFront - mid - a, halfOf(span[1]));
      const chord = Math.hypot(P.x - Q.x, P.y - Q.y);
      if (chord < 1e-9) break;
      a *= (2 * h) / chord;
    }
    stretch = a / h;
  }
  /** where a point `t` behind the segment's front stands along the rail */
  const arcOf = (t: number) => arcFront - mid - (t - mid) * stretch;
  if (pinned) {
    // the line that fits the rail points of all groups best: two groups are met exactly, more
    // share what a rigid body cannot follow of the curve
    const pts = groups.map((g) => stand(arcOf(g), halfOf(g)));
    const n = pts.length;
    const mx = pts.reduce((a, p) => a + p.x, 0) / n;
    const my = pts.reduce((a, p) => a + p.y, 0) / n;
    let sxx = 0;
    let sxy = 0;
    let syy = 0;
    for (const p of pts) {
      sxx += (p.x - mx) * (p.x - mx);
      sxy += (p.x - mx) * (p.y - my);
      syy += (p.y - my) * (p.y - my);
    }
    const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    axx = Math.cos(th);
    axy = Math.sin(th);
    // towards the front: from the rearmost group to the foremost
    const F = pl.at(arcOf(span[0]));
    const R = pl.at(arcOf(span[1]));
    if ((F.x - R.x) * axx + (F.y - R.y) * axy < 0) {
      axx = -axx;
      axy = -axy;
    }
    // the groups' middle on the body stands on the middle of their rail points
    const gm = groups.reduce((a, g) => a + g, 0) / n;
    cx = mx + axx * (gm - L / 2);
    cy = my + axy * (gm - L / 2);
  } else if (ends) {
    const A = pl.at(arcOf(ends[0]));
    const B = pl.at(arcOf(ends[1]));
    axx = A.x - B.x;
    axy = A.y - B.y;
    const al = Math.hypot(axx, axy);
    if (al < 1e-9) {
      const tg = pl.tangent(arcFront - L / 2);
      axx = tg.x;
      axy = tg.y;
    } else {
      axx /= al;
      axy /= al;
    }
    const sm = (ends[0] + ends[1]) / 2;
    cx = (A.x + B.x) / 2 - axx * (L / 2 - sm);
    cy = (A.y + B.y) / 2 - axy * (L / 2 - sm);
  } else {
    const P = pl.at(arcFront - L / 2);
    const tg = pl.tangent(arcFront - L / 2);
    axx = tg.x;
    axy = tg.y;
    cx = P.x;
    cy = P.y;
  }
  const nxx = -axy;
  const nxy = axx;
  // centre the body on the track, not on its own bogies: the mean gap over the body's length
  // pulls a long body out towards the arc (where its middle bogie runs) rather than leaving it
  // on the chord between the outer bogies
  let eMin = Infinity;
  let eMax = -Infinity;
  let eSum = 0;
  const K = 12;
  for (let k = 0; k <= K; k++) {
    const u = ((k + 0.5) / (K + 1) - 0.5) * L;
    const S = { x: cx + axx * u, y: cy + axy * u };
    const N = pl.nearest(S, arcFront - L / 2 + u).p;
    const e = (N.x - S.x) * nxx + (N.y - S.y) * nxy;
    if (e < eMin) eMin = e;
    if (e > eMax) eMax = e;
    eSum += e;
  }
  const want = t.length > 2 ? eSum / (K + 1) : (eMin + eMax) / 2;
  // a frame on fixed axles does not float sideways: it stands where they are, and so does a body
  // pinned on its supports
  const delta = rig || seg.pinned ? 0 : Math.max(-sideways, Math.min(sideways, want));
  cx += nxx * delta;
  cy += nxy * delta;
  const residualGap = Math.max(Math.abs(eMax - delta), Math.abs(eMin - delta));
  let wheelGap = 0;
  if (rig)
    for (const r of rig) {
      const u = L / 2 - r;
      const S = { x: cx + axx * u, y: cy + axy * u };
      const N = pl.nearest(S, arcOf(r)).p;
      wheelGap = Math.max(wheelGap, Math.hypot(N.x - S.x, N.y - S.y));
    }
  const bogies: BogiePose[] = [];
  for (let i = 0; i < t.length; i++) {
    const arc = arcOf(t[i]);
    const P = stand(arc, half?.[i] ?? 0);
    const socket = L / 2 - t[i];
    const skx = cx + axx * socket;
    const sky = cy + axy * socket;
    const rx = P.x - skx;
    const ry = P.y - sky;
    const along = rx * axx + ry * axy;
    const across = rx * nxx + ry * nxy;
    bogies.push({
      x: P.x,
      y: P.y,
      angle: P.angle,
      kind: kinds?.[i] ?? seg.bogie,
      foreAft: Math.abs(along),
      lateral: Math.abs(across),
      drawX: P.x,
      drawY: P.y,
      hidden: hidden?.[i] || undefined,
      truck: truck?.[i],
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
    wheelGap,
  };
}

/** Pose every segment of a vehicle whose front end is at `arcFront`. */
export function poseVehicle(
  pl: Polyline,
  arcFront: number,
  spec: VehicleSpec,
  reversed = false,
): VehiclePose {
  const segments = spec.segments.map((s) =>
    poseSegment(
      pl,
      arcFront - (reversed ? spec.L - s.front - s.L : s.front),
      s,
      TOL.sideways,
      reversed,
    ),
  );
  // a hinged half hangs on the end of the part it is hinged to (spec order: front part first), and
  // stands on its own truck: its axis runs from that truck's rail point to the carrying part's end
  spec.segments.forEach((s, i) => {
    if (!s.hinge) return;
    const host = segments[s.hinge === 'front' ? i - 1 : i + 1];
    const seg = segments[i];
    const truck = seg.bogies.filter((b) => !b.hidden);
    if (!host || !truck.length) return;
    const hx = Math.cos(host.angle),
      hy = Math.sin(host.angle);
    // the carrying part's end that faces this half
    const ends = [1, -1].map((k) => ({
      x: host.x + (k * hx * host.L) / 2,
      y: host.y + (k * hy * host.L) / 2,
    }));
    const E =
      Math.hypot(ends[0].x - seg.x, ends[0].y - seg.y) <
      Math.hypot(ends[1].x - seg.x, ends[1].y - seg.y)
        ? ends[0]
        : ends[1];
    const ox = Math.cos(seg.angle),
      oy = Math.sin(seg.angle);
    // which of its own ends is the hinge: the one towards the carrying part
    const side = (E.x - seg.x) * ox + (E.y - seg.y) * oy >= 0 ? 1 : -1;
    // its own support: the truck furthest from the joint
    const T = truck.reduce((a, b) =>
      Math.hypot(b.x - E.x, b.y - E.y) > Math.hypot(a.x - E.x, a.y - E.y) ? b : a,
    );
    let ax = (E.x - T.x) * side,
      ay = (E.y - T.y) * side;
    const al = Math.hypot(ax, ay);
    if (al < 1e-9) return;
    ax /= al;
    ay /= al;
    seg.x = E.x - (side * ax * seg.L) / 2;
    seg.y = E.y - (side * ay * seg.L) / 2;
    seg.angle = Math.atan2(ay, ax);
  });
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
/** Screen pixels a height of one tile side spans (slope.ts UP_PX, terrainRelief's TILE_SIDE_PX). */
export const UP_TILE_PX = (32 * Math.SQRT2 * Math.sqrt(3)) / 2;

/**
 * The box a drawn part fills, for swinging its picture between two facings: tiles from the part's
 * anchor on the rail. `u0`..`u1` along the heading (rear end, front end), `w` half its width, `h`
 * its height over the rail.
 */
export interface PartBox {
  u0: number;
  u1: number;
  w: number;
  h: number;
}

/** A swing mesh: six fans of seven points (each of the box's three seen faces in two halves). */
export const SWING_FAN = 7;
export const SWING_FANS = 6;
export const SWING_VERTS = SWING_FANS * SWING_FAN;
/**
 * Sines of the angle between a face's two edges on the screen: below the first the face counts as
 * seen edge on, from the second up it is swung as itself (fifteen and thirty degrees off its edge).
 */
export const SWING_EDGE_ON = [0.26, 0.5] as const;

const polyA = new Float64Array(16),
  polyB = new Float64Array(16);

/** Keeps the part of a convex polygon (n points in `src`) where k·cross(e, p − j) ≥ 0. */
function clipHalf(
  src: Float64Array,
  n: number,
  dst: Float64Array,
  jx: number,
  jy: number,
  ex: number,
  ey: number,
  k: number,
) {
  let m = 0;
  for (let i = 0; i < n; i++) {
    const ax = src[2 * i],
      ay = src[2 * i + 1],
      bx = src[2 * ((i + 1) % n)],
      by = src[2 * ((i + 1) % n) + 1],
      da = k * (ex * (ay - jy) - ey * (ax - jx)),
      db = k * (ex * (by - jy) - ey * (bx - jx));
    if (da >= 0) {
      dst[2 * m] = ax;
      dst[2 * m + 1] = ay;
      m++;
    }
    if (da >= 0 !== db >= 0) {
      const t = da / (da - db);
      dst[2 * m] = ax + (bx - ax) * t;
      dst[2 * m + 1] = ay + (by - ay) * t;
      m++;
    }
  }
  return m;
}

/**
 * The picture of a part drawn for heading `drawn`, swung to the heading `angle` a few degrees off.
 *
 * A flat picture cannot be turned as a whole: turned on the screen its uprights lean, sheared along
 * its length its width breathes with every degree. What turns is a box. A camera sees three faces of
 * it (top, near side, near end), each flat, and each face's picture goes to the same face seen at
 * the true heading by a map of its own: the side keeps its uprights, the top turns like a footprint,
 * the end swings across. The three maps agree along the box's edges, so the picture does not tear,
 * and each runs on past its face over what is drawn beyond it (a chimney, a buffer, the wheels).
 *
 * Each face fills the angle between two of the three edges that meet at the box's near top corner,
 * and is drawn in two halves either side of that angle's middle line. A face seen nearly edge on
 * (its two edges almost in one line) has next to no picture of its own, and its map would fling what
 * is drawn beside the box far off: there the middle line stays as it is drawn, and the halves only
 * follow the edges they share with the other faces (SWING_EDGE_ON).
 *
 * `rect` is the sprite as it is shown: left, top, right, bottom in pixels from its anchor (the rail
 * point under the part). Writes `SWING_VERTS` points to `src` (where each is in the picture) and `dst`
 * (where it is drawn), x and y interleaved: `SWING_FANS` fans of `SWING_FAN`, a fan's unused points
 * repeating its last. Exact for every point of the box's three seen faces.
 */
export function swingMesh(
  box: PartBox,
  drawn: number,
  angle: number,
  rect: readonly [number, number, number, number],
  src: Float32Array,
  dst: Float32Array,
) {
  const c0 = Math.cos(drawn),
    s0 = Math.sin(drawn),
    c1 = Math.cos(angle),
    s1 = Math.sin(angle);
  // the corner the three seen faces share: top, near end, near side (near: lower on the screen)
  const un = c0 + s0 >= 0 ? box.u1 : box.u0,
    uf = c0 + s0 >= 0 ? box.u0 : box.u1,
    wn = c0 - s0 >= 0 ? box.w : -box.w,
    du = uf - un,
    up = box.h * UP_TILE_PX;
  // where that corner is drawn, and where it belongs
  const jx = 32 * (un * (c0 - s0) - wn * (s0 + c0)),
    jy = 16 * (un * (c0 + s0) + wn * (c0 - s0)) - up,
    kx = 32 * (un * (c1 - s1) - wn * (s1 + c1)),
    ky = 16 * (un * (c1 + s1) + wn * (c1 - s1)) - up;
  // the three edges from it: along the body to the far end, across to the far side, down to the rail;
  // as drawn (x, y) and as they belong (x, y)
  const E = [
    [32 * du * (c0 - s0), 16 * du * (c0 + s0), 32 * du * (c1 - s1), 16 * du * (c1 + s1)],
    [64 * wn * (s0 + c0), -32 * wn * (c0 - s0), 64 * wn * (s1 + c1), -32 * wn * (c1 - s1)],
    [0, up, 0, up],
  ];
  // faces: top (far end, far side), near side (far end, down), near end (far side, down); each
  // with the edge it does not touch
  const FACES = [
    [0, 1, 2],
    [0, 2, 1],
    [1, 2, 0],
  ];
  for (let face = 0; face < 3; face++) {
    const e1 = E[FACES[face][0]],
      e2 = E[FACES[face][1]],
      e3 = E[FACES[face][2]],
      l1 = Math.hypot(e1[0], e1[1]),
      l2 = Math.hypot(e2[0], e2[1]),
      turn = e1[0] * e2[1] - e1[1] * e2[0],
      sine = l1 > 0 && l2 > 0 ? turn / (l1 * l2) : 0,
      cosine = l1 > 0 && l2 > 0 ? (e1[0] * e2[0] + e1[1] * e2[1]) / (l1 * l2) : -1;
    // the middle line of the face's angle, as long as the shorter edge; where the edges run in one
    // line it stands square to them, away from the third edge
    let mx = l1 > 0 && l2 > 0 ? e1[0] / l1 + e2[0] / l2 : 0,
      my = l1 > 0 && l2 > 0 ? e1[1] / l1 + e2[1] / l2 : 0,
      ml = Math.hypot(mx, my);
    if (ml < 1e-4) {
      mx = -e1[1];
      my = e1[0];
      if (mx * e3[0] + my * e3[1] > 0) {
        mx = -mx;
        my = -my;
      }
      ml = Math.hypot(mx, my);
    }
    const len = Math.max(1, Math.min(l1, l2));
    mx = (mx / (ml || 1)) * len;
    my = (my / (ml || 1)) * len;
    // where the face's own map takes that line, and how far the face is trusted with it: fully when
    // it is seen thirty degrees or more off its edge, not at all within fifteen
    const trust =
      cosine > 0
        ? 1
        : Math.min(
            1,
            Math.max(
              0,
              (Math.abs(sine) - SWING_EDGE_ON[0]) / (SWING_EDGE_ON[1] - SWING_EDGE_ON[0]),
            ),
          );
    let nx = mx,
      ny = my;
    if (trust > 0) {
      const a = (mx * e2[1] - my * e2[0]) / turn,
        b = (e1[0] * my - e1[1] * mx) / turn;
      nx = mx + trust * (a * e1[2] + b * e2[2] - mx);
      ny = my + trust * (a * e1[3] + b * e2[3] - my);
    }
    for (let half = 0; half < 2; half++) {
      // this half's two edges, as drawn and as they belong
      const ax = half ? mx : e1[0],
        ay = half ? my : e1[1],
        bx = half ? e2[0] : mx,
        by = half ? e2[1] : my,
        ax1 = half ? nx : e1[2],
        ay1 = half ? ny : e1[3],
        bx1 = half ? e2[2] : nx,
        by1 = half ? e2[3] : ny,
        det = ax * by - ay * bx,
        base = (face * 2 + half) * SWING_FAN * 2;
      let n = 0;
      if (Math.abs(det) > 1e-9) {
        const k = det > 0 ? 1 : -1;
        polyA[0] = rect[0];
        polyA[1] = rect[1];
        polyA[2] = rect[2];
        polyA[3] = rect[1];
        polyA[4] = rect[2];
        polyA[5] = rect[3];
        polyA[6] = rect[0];
        polyA[7] = rect[3];
        n = clipHalf(polyA, 4, polyB, jx, jy, ax, ay, k);
        n = clipHalf(polyB, n, polyA, jx, jy, bx, by, -k);
      }
      for (let i = 0; i < SWING_FAN; i++) {
        const at = base + 2 * i;
        if (n < 3) {
          // nothing of the picture lies here
          src[at] = src[at + 1] = dst[at] = dst[at + 1] = 0;
          continue;
        }
        const p = Math.min(i, n - 1),
          qx = polyA[2 * p] - jx,
          qy = polyA[2 * p + 1] - jy,
          a = (qx * by - qy * bx) / det,
          b = (ax * qy - ay * qx) / det;
        src[at] = polyA[2 * p];
        src[at + 1] = polyA[2 * p + 1];
        dst[at] = kx + a * ax1 + b * bx1;
        dst[at + 1] = ky + a * ay1 + b * by1;
      }
    }
  }
}
/** Runtime rotation that turns the sprite drawn for facing f into the exact heading. */
export function residualRotation(angle: number, f: number) {
  let d = screenAngle(angle) - screenAngle(facingAngle(f));
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
