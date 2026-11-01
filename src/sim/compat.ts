/**
 * Which stock may run on which track line. Every vehicle has a train class (specs/track-classes.md):
 * the smallest line it runs on. On the standard network a class runs on its own line and every
 * bigger one; a separate network (Narrow Gauge, Maglev, Hyperloop) takes only its own class.
 *
 * The geometry stays the check behind the classes: every vehicle model can be run over a
 * reference curve of each line (straight lead-in, quarter arc, straight lead-out) and its peak
 * bogie slide, sideways shift, residual gap and centre-bogie offset compared to the tolerances
 * (`verdictOf`). The tests hold every vehicle to fitting its own class's line.
 */
import { content, type Gauge, type LocoDef, type TrainClass, type WagonDef } from '../data/content';
import {
  BUILDABLE_CLASSES,
  LINES,
  TRACK_CLASSES,
  classRadius,
  networkOf,
  type Network,
  type TrackClass,
  type TrackPiece,
} from '../world/track';
import { Polyline, poseVehicle, vehicleSpec, TOL, type VehicleSpec } from './body';
import { STR } from '../strings';
import { rules } from './rules';
import type { Train } from './trains';

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

/** The smallest line of each train class. */
export const CLASS_LINE: Record<TrainClass, TrackClass> = {
  corvette: 'narrow',
  frigate: 'branch',
  destroyer: 'main',
  cruiser: 'trunk',
  carrier: 'trunk',
  hydrofoil: 'maglev',
  submarine: 'hyperloop',
};
/** Train classes, smallest first on each network. */
export const TRAIN_CLASSES = Object.keys(CLASS_LINE) as TrainClass[];

/** A vehicle's train class; a def without one is a Corvette on narrow gauge, else a Frigate. */
export function classOf(def: { class?: TrainClass; gauge?: Gauge }): TrainClass {
  return def.class ?? (gaugeOf(def) === 'narrow' ? 'corvette' : 'frigate');
}
/** Does a class run on a line: its own, or on the standard network any bigger one? */
export function classRunsOn(tc: TrainClass, cls: TrackClass): boolean {
  const own = LINES[CLASS_LINE[tc]];
  const line = LINES[cls];
  if (own.network !== line.network) return false;
  return own.network === 'standard' ? line.tier >= own.tier : true;
}
/**
 * A consist's class: its biggest vehicle's (the one that needs the biggest line), null for none.
 * Stock of two networks makes no train; the first vehicle's network wins here.
 */
export function trainClassOf(defs: { class?: TrainClass; gauge?: Gauge }[]): TrainClass | null {
  let best: TrainClass | null = null;
  for (const d of defs) {
    const tc = classOf(d);
    if (!best) best = tc;
    else if (
      LINES[CLASS_LINE[tc]].network === LINES[CLASS_LINE[best]].network &&
      LINES[CLASS_LINE[tc]].tier > LINES[CLASS_LINE[best]].tier
    )
      best = tc;
  }
  return best;
}

/**
 * Priority rank of a class where trains contest track: on the standard network its own line's
 * size step (Frigate 1, Destroyer 2, Cruiser and Carrier 3), so the train that needs a bigger
 * line goes first. A separate network meets the standard one only at a level crossing with
 * Branch Line and ranks with the Frigates there.
 */
export function classRank(tc: TrainClass | null): number {
  if (!tc) return 1;
  const own = LINES[CLASS_LINE[tc]];
  return own.network === 'standard' ? own.tier : 1;
}

/**
 * Priority rank of a train where trains contest track: its class's, except on a maintenance job.
 * Bound for or at an unusable piece it goes before every class, on any other piece after them all.
 */
export function trafficRank(t: Train): number {
  if (t.maint) return t.maint.tier === 0 ? 4 : 0;
  return classRank(t.trainClass);
}

/**
 * Route cost multiplier for a train of class `tc` on a line: a smaller train pays
 * `rules.smallOnBigLine` per line size above its own, so it keeps to its own line where it can
 * and leaves the bigger line to the trains that need it.
 */
export function lineToll(tc: TrainClass | null, cls: TrackClass): number {
  if (!tc) return 1;
  const own = LINES[CLASS_LINE[tc]];
  const line = LINES[cls];
  if (own.network !== 'standard' || line.network !== 'standard') return 1;
  return 1 + rules.smallOnBigLine * Math.max(0, line.tier - own.tier);
}

/** May this model use a line? By its train class. Returns the reason when not. */
export function vehicleAccess(def: LocoDef | WagonDef, cls: TrackClass): string | null {
  const tc = classOf(def);
  if (classRunsOn(tc, cls)) return null;
  if (networkOf(CLASS_LINE[tc]) !== networkOf(cls))
    return STR.compat.wrongNetwork(STR.toolbar.trackClass[cls]);
  return STR.compat.tooBig(STR.trainClass[tc], STR.toolbar.trackClass[cls]);
}

export function gaugeOf(def: { gauge?: Gauge }): Gauge {
  return def.gauge ?? 'regular';
}
/** The network a gauge's stock runs on: narrow on Narrow Gauge, regular on the standard lines. */
export function gaugeNetwork(gauge: Gauge): Network {
  return gauge === 'narrow' ? 'narrow' : 'standard';
}
/** The line a depot of this gauge lays across its gates. */
export function gaugeLine(gauge: Gauge): TrackClass {
  return gauge === 'narrow' ? 'narrow' : 'branch';
}
/** The gauge every vehicle shares, 'mixed' when they differ, null for none. */
export function consistGauge(defs: { gauge?: Gauge }[]): Gauge | 'mixed' | null {
  let g: Gauge | null = null;
  for (const d of defs) {
    const own = gaugeOf(d);
    if (g && own !== g) return 'mixed';
    g = own;
  }
  return g;
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

/** One line for a vehicle's data sheet: its class and the buildable lines it may run on. */
export function runsOn(def: LocoDef | WagonDef): string {
  const names = BUILDABLE_CLASSES.filter((cls) => !vehicleAccess(def, cls)).map(
    (cls) => STR.toolbar.trackClass[cls],
  );
  return STR.compat.runsOn(STR.trainClass[classOf(def)], names);
}

/** Class a piece presents when entered through `entry` (crossings differ per axis). */
export function pieceClassFor(p: TrackPiece, entry: number): TrackClass {
  if (p.kind === 'crossing' && p.links[1]) {
    const [a, b] = p.links[1];
    if (a === entry || b === entry) return p.cls2 ?? p.cls;
  }
  return p.cls;
}
