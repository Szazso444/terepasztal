/**
 * Which stock may run on which track class (spec §4 and §5). At load every vehicle model is run
 * once over a reference curve of each class (straight lead-in, quarter arc, straight lead-out)
 * and its peak bogie slide, sideways shift, residual gap and centre-bogie offset are compared to
 * the tolerances. Runtime only looks the verdict up. On top of the geometry sits one rule about
 * size: large stock is barred from regular track, both body plans alike.
 */
import { content, type LocoDef, type WagonDef } from '../data/content';
import { TRACK_CLASSES, classRadius, type TrackClass, type TrackPiece } from '../world/track';
import { Polyline, poseVehicle, vehicleSpec, TOL, type VehicleSpec } from './body';
import { STR } from '../strings';

export interface Verdict {
  ok: boolean;
  /** peak values measured over the traversal, tiles */
  foreAft: number;
  sideways: number;
  gap: number;
  lateral: number;
  /** why the model fails, in the player's words */
  reason: string | null;
}

/** Reference curve of a class: 4 tiles straight, a quarter arc of the class radius, 4 tiles straight. */
export function referencePath(cls: TrackClass, step = 0.05): Polyline {
  const R = classRadius(cls);
  const pts: { x: number; y: number }[] = [];
  const lead = 4;
  for (let s = 0; s <= lead + 1e-9; s += step) pts.push({ x: s, y: 0 });
  const n = Math.max(4, Math.ceil(((Math.PI / 2) * R) / step));
  for (let i = 1; i <= n; i++) {
    const t = ((Math.PI / 2) * i) / n;
    pts.push({ x: lead + R * Math.sin(t), y: R - R * Math.cos(t) });
  }
  const ex = lead + R;
  const ey = R;
  for (let s = step; s <= lead + 1e-9; s += step) pts.push({ x: ex, y: ey + s });
  return new Polyline(pts);
}

/** Run one vehicle over the reference curve and record its peaks. */
export function measure(spec: VehicleSpec, cls: TrackClass): Verdict {
  const pl = referencePath(cls);
  let foreAft = 0;
  let sideways = 0;
  let gap = 0;
  let lateral = 0;
  for (let front = spec.L; front <= pl.length; front += 0.05) {
    const v = poseVehicle(pl, front, spec);
    for (const seg of v.segments) {
      sideways = Math.max(sideways, Math.abs(seg.delta));
      gap = Math.max(gap, seg.residualGap);
      seg.bogies.forEach((b, i) => {
        foreAft = Math.max(foreAft, b.foreAft);
        // outer bogies define the axis; only inner ones can sit off their sockets sideways
        if (i > 0 && i < seg.bogies.length - 1) lateral = Math.max(lateral, b.lateral);
      });
    }
  }
  // the rail gap a body may show grows with its length: a long body reads as "on the track"
  // when its ends sit a little further out than a short one would
  const gapLimit = TOL.gap * spec.L;
  let reason: string | null = null;
  if (foreAft > TOL.foreAft) reason = STR.compat.foreAft(foreAft, TOL.foreAft);
  else if (gap > gapLimit) reason = STR.compat.gap(gap, gapLimit);
  else if (lateral > spec.maxLateralPlay) reason = STR.compat.lateral(lateral, spec.maxLateralPlay);
  return { ok: reason === null, foreAft, sideways, gap, lateral, reason };
}

const table = new Map<string, Verdict>();
function key(defId: string, cls: TrackClass) {
  return `${defId}|${cls}`;
}

/** Build the whole table once (cheap: a few thousand poses). */
export function buildCompatTable() {
  table.clear();
  const all: (LocoDef | WagonDef)[] = [...content.locomotives, ...content.wagons];
  for (const d of all)
    for (const cls of TRACK_CLASSES) table.set(key(d.id, cls), measure(vehicleSpec(d), cls));
}

/** Measured verdict for a model on a class (geometry only). */
export function verdictOf(def: LocoDef | WagonDef, cls: TrackClass): Verdict {
  let v = table.get(key(def.id, cls));
  if (!v) {
    v = measure(vehicleSpec(def), cls);
    table.set(key(def.id, cls), v);
  }
  return v;
}

/**
 * May this model use a class? One rule about size first, then the tolerance table. Returns the
 * reason when not.
 */
export function vehicleAccess(def: LocoDef | WagonDef, cls: TrackClass): string | null {
  const size = def.size ?? 'small';
  if (size === 'large' && cls === 'regular') return STR.compat.largeBarred;
  const v = verdictOf(def, cls);
  return v.ok ? null : v.reason;
}

export interface ConsistAccess {
  /** classes every vehicle may use */
  classes: Set<TrackClass>;
  /** for a barred class, the first vehicle that bars it and why */
  blockedBy: Partial<Record<TrackClass, { name: string; reason: string }>>;
}
/** The most restrictive access across a consist. */
export function consistAccess(defs: (LocoDef | WagonDef)[]): ConsistAccess {
  const out: ConsistAccess = { classes: new Set(TRACK_CLASSES), blockedBy: {} };
  for (const cls of TRACK_CLASSES)
    for (const d of defs) {
      const why = vehicleAccess(d, cls);
      if (why) {
        out.classes.delete(cls);
        out.blockedBy[cls] = { name: d.name, reason: why };
        break;
      }
    }
  return out;
}

/** Class a piece presents when entered through `entry` (crossings differ per axis). */
export function pieceClassFor(p: TrackPiece, entry: number): TrackClass {
  if (p.kind === 'crossing' && p.links[1]) {
    const [a, b] = p.links[1];
    if (a === entry || b === entry) return p.cls2 ?? p.cls;
  }
  return p.cls;
}
