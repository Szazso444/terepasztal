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
      const P = pl.at(arcFront - mid + a);
      const Q = pl.at(arcFront - mid - a);
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
    const pts = groups.map((g) => pl.at(arcOf(g)));
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
    const P = pl.at(arc);
    const socket = L / 2 - t[i];
    const skx = cx + axx * socket;
    const sky = cy + axy * socket;
    const rx = P.x - skx;
    const ry = P.y - sky;
    const tg = pl.tangent(arc);
    const along = rx * axx + ry * axy;
    const across = rx * nxx + ry * nxy;
    bogies.push({
      x: P.x,
      y: P.y,
      angle: Math.atan2(tg.y, tg.x),
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
/**
 * The screen map that takes the sprite drawn for facing f to the exact heading: the drawn heading's
 * picture (its direction and its foreshortened length) goes to the true heading's, and the screen's
 * vertical stays where it is, so uprights stay upright while the body swings. Exact for the body's
 * centre plane; a point half a body-width to the side is off by a pixel at most. A heading that
 * runs up the screen has no screen x to shear about: there the sprite is turned instead (half the
 * difference, as before), and between the two the maps blend. PIXI matrix terms: x' = a·x + c·y,
 * y' = b·x + d·y.
 */
export function headingShear(
  angle: number,
  f: number,
): { a: number; b: number; c: number; d: number } {
  const af = facingAngle(f);
  const fx = Math.cos(af) - Math.sin(af),
    fy = (Math.cos(af) + Math.sin(af)) / 2,
    tx = Math.cos(angle) - Math.sin(angle),
    ty = (Math.cos(angle) + Math.sin(angle)) / 2,
    share = Math.min(1, Math.max(0, (Math.abs(fx) - 0.25) / 0.5)),
    th = residualRotation(angle, f) * ROTATION_SHARE,
    rc = Math.cos(th),
    rs = Math.sin(th);
  if (!share) return { a: rc, b: rs, c: -rs, d: rc };
  const sa = tx / fx,
    sb = (ty - fy) / fx;
  return {
    a: rc + (sa - rc) * share,
    b: rs + (sb - rs) * share,
    c: -rs * (1 - share),
    d: rc + (1 - rc) * share,
  };
}
/** Runtime rotation that turns the sprite drawn for facing f into the exact heading. */
export function residualRotation(angle: number, f: number) {
  let d = screenAngle(angle) - screenAngle(facingAngle(f));
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
