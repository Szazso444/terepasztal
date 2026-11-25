import { Dir } from '../engine/iso';
import type { Cost } from '../data/content';
import type { PlacementCheck } from '../sim/build';
import { STR } from '../strings';
import type { RunTile } from './dragPath';
import {
  TRACK_ITEMS,
  footprintOf,
  portClass,
  type TrackClass,
  type TrackItem,
  type TrackPiece,
} from '../world/track';

/**
 * The crossing a straight run lays where it meets a line: the piece and its turn, or why the two
 * lines may not cross there.
 */
export type CrossingPick =
  | { ok: true; item: TrackItem; rot: number }
  | { ok: false; why: 'angle' | 'apart' | 'bridge'; other: TrackClass };

/** The class a piece presents along the axis a straight at `rot` runs (0: N–S, 1: E–W). */
function axisClass(p: TrackPiece, rot: number): TrackClass {
  return portClass(p, rot % 2 === 0 ? Dir.N : Dir.E);
}

/**
 * What a straight run of class `cls`, laid at `rot`, has to put on a tile that holds `existing`,
 * or null when no crossing comes into it: an empty tile, a straight along the run (a junction, not
 * a crossing), or a piece the ordinary rules judge.
 *
 * A straight or crossing across the run gets the crossing for the pair, from `items` (the game's
 * `TRACK_ITEMS`), turned so the run's class lies on the run's axis; a crossing at rotation 0 has its
 * first class on N–S, like a straight at rotation 0. A pair with no crossing piece is a pair of
 * separate worlds, and a curve or a switch meets the run at an angle: both are refused, and so is
 * a bridge across the run, which no crossing piece can stand in for.
 */
export function crossingFor(
  cls: TrackClass,
  rot: number,
  existing: TrackPiece | undefined,
  items: readonly TrackItem[] = TRACK_ITEMS,
): CrossingPick | null {
  if (!existing) return null;
  if (existing.kind === 'curve' || existing.kind === 'switch')
    return { ok: false, why: 'angle', other: existing.cls };
  const across = (rot + 1) % 2;
  if (existing.kind === 'bridge')
    return existing.rot % 2 === across ? { ok: false, why: 'bridge', other: existing.cls } : null;
  if (existing.kind !== 'straight' && existing.kind !== 'crossing') return null;
  if (existing.kind === 'straight' && existing.rot % 2 !== across) return null;
  const other = axisClass(existing, across);
  const item = items.find(
    (i) =>
      i.kind === 'crossing' &&
      ((i.cls === cls && (i.cls2 ?? i.cls) === other) ||
        (i.cls === other && (i.cls2 ?? i.cls) === cls)),
  );
  if (!item) return { ok: false, why: 'apart', other };
  // a crossing that stands already keeps its turn, so the run passes through it untouched
  if (existing.kind === 'crossing' && axisClass(existing, rot) === cls)
    return {
      ok: true,
      item: { kind: 'crossing', cls: existing.cls, cls2: existing.cls2 ?? existing.cls },
      rot: existing.rot,
    };
  return { ok: true, item, rot: item.cls === cls ? rot % 2 : across };
}

/**
 * What a bridge run at `rot` meets on a tile that holds `existing`: no crossing stands on a bridge,
 * so any line across the run is refused, and a curve or switch meets it at an angle. Null for a
 * piece along the run or an empty tile, which the ordinary rules judge.
 */
export function bridgeCrossing(rot: number, existing: TrackPiece | undefined): CrossingPick | null {
  if (!existing) return null;
  if (existing.kind === 'curve' || existing.kind === 'switch')
    return { ok: false, why: 'angle', other: existing.cls };
  const across = (rot + 1) % 2;
  if (existing.kind === 'crossing' || existing.rot % 2 === across)
    return { ok: false, why: 'bridge', other: axisClass(existing, across) };
  return null;
}

/** The build status's reason for a refused crossing. */
export function crossingRefusal(cls: TrackClass, pick: Extract<CrossingPick, { ok: false }>) {
  const name = (c: TrackClass) => STR.toolbar.trackClass[c] ?? c;
  if (pick.why === 'angle') return STR.build.crossAngle;
  if (pick.why === 'bridge') return STR.build.crossBridge;
  return STR.build.crossApart(name(cls), name(pick.other).toLowerCase());
}

/** One tile of a dragged run as its release would lay it. */
export interface RunStep extends PlacementCheck {
  x: number;
  y: number;
  item: TrackItem;
  rot: number;
  /** the crossing laid here by itself, or the crossing refused here */
  crossing?: boolean;
  /** the piece stands already: nothing to lay or pay */
  stands?: boolean;
  /** a curve or switch at an end of the run: the run joins it and leaves it as it is */
  joins?: boolean;
}

/** A run judged tile by tile. Tiles from `end` on are not laid: a crossing the run may not make. */
export interface RunPlan {
  steps: RunStep[];
  end: number;
  cost: Cost;
  /** crossings the run lays by itself */
  crossings: number;
  /** curves the run lays at its turns */
  curves: number;
  /** straights (or bridges) the run lays, its crossings and curves not counted */
  straights: number;
  /** why the run stops at `end`, when it does */
  reason?: string;
}

/** What a run is judged against: the track and the builder's rule for one piece. */
export interface RunWorld {
  track: { get(x: number, y: number): TrackPiece | undefined };
  checkTrack(x: number, y: number, item: TrackItem, rot: number): PlacementCheck;
  /** a copy of the world to judge the run on in order, laying each piece there unpaid (`Builder.runProbe`) */
  runProbe?(): Omit<RunWorld, 'runProbe'> & {
    lay(x: number, y: number, item: TrackItem, rot: number): void;
  };
}

/**
 * The run of `item` along `line`. Where it meets a line at right angles the crossing for the pair
 * goes down instead of the straight, and is priced as one. A crossing that is refused, by the pair
 * or by the rules of its tile, stops the run there: the line it meets is never cut. A curve at a
 * turn that cannot go down stops it too (the leg after it would lead nowhere), and so does track in
 * its way, which a curve never replaces. A curve or switch where the run starts or ends is where it
 * joins: left as it is. Any other refused tile is skipped, as before; a piece that stands already
 * costs nothing. Each piece is judged with the run's pieces before it down (on the world's
 * `runProbe`, when it has one), so a line climbs a mountain from its foot as it is laid.
 */
export function planRun(world: RunWorld, line: readonly RunTile[], item: TrackItem): RunPlan {
  const steps: RunStep[] = [];
  const cost: Cost = {};
  let end = line.length,
    crossings = 0,
    curves = 0,
    straights = 0,
    reason: string | undefined;
  const probe = line.length > 1 ? world.runProbe?.() : undefined;
  const judge = probe ?? world;
  for (const [i, l] of line.entries()) {
    const existing = judge.track.get(l.x, l.y);
    const own = l.item ?? item,
      curve = own.kind === 'curve';
    let pick =
      own.kind === 'straight'
        ? crossingFor(own.cls, l.rot, existing)
        : own.kind === 'bridge'
          ? bridgeCrossing(l.rot, existing)
          : null;
    // one piece clicked over a curve is the ordinary rules' (a one-tile piece may replace another)
    if (pick && !pick.ok && pick.why === 'angle' && line.length === 1) pick = null;
    let step: RunStep;
    if (pick && !pick.ok && pick.why === 'angle' && (i === 0 || i === line.length - 1)) {
      step = { x: l.x, y: l.y, item: own, rot: l.rot, ok: true, cost: {}, stands: true };
      step.joins = true;
      steps.push(step);
      continue;
    }
    if (pick && !pick.ok) {
      step = {
        x: l.x,
        y: l.y,
        item: own,
        rot: l.rot,
        ok: false,
        cost: {},
        reason: crossingRefusal(own.cls, pick),
      };
    } else {
      const it = pick ? pick.item : own,
        rot = pick ? pick.rot : l.rot;
      step = { x: l.x, y: l.y, item: it, rot, ...judge.checkTrack(l.x, l.y, it, rot) };
      step.stands =
        !!existing &&
        existing.kind === it.kind &&
        existing.cls === it.cls &&
        (existing.cls2 ?? existing.cls) === (it.cls2 ?? it.cls) &&
        existing.rot === rot &&
        (!existing.unit || (existing.unit.ax === l.x && existing.unit.ay === l.y));
      const inWay = () =>
        footprintOf(l.x, l.y, it.kind, rot, it.cls).some((f) => judge.track.get(f.x, f.y));
      if (curve && step.ok && !step.stands && inWay())
        step = { ...step, ok: false, cost: {}, reason: STR.build.trackInWay };
    }
    if (pick) step.crossing = true;
    if (end === line.length && (pick || curve) && !step.ok) {
      end = steps.length;
      reason = step.reason;
    }
    if (probe && end === line.length && step.ok && !step.stands)
      probe.lay(step.x, step.y, step.item, step.rot);
    steps.push(step);
  }
  for (const [i, s] of steps.entries()) {
    if (i >= end || !s.ok || s.stands) continue;
    if (s.crossing) crossings++;
    else if (s.item.kind === 'curve') curves++;
    else straights++;
    for (const [k, v] of Object.entries(s.cost)) cost[k] = (cost[k] ?? 0) + v;
  }
  return { steps, end, cost, crossings, curves, straights, reason };
}

/**
 * Lay what `plan` lets through, in order: the tiles before its end, skipping refused and standing
 * ones. A piece that fails to go down after all (the stock ran out on the way) stops the run there,
 * so no track is laid beyond a gap. Returns the index the run stopped at.
 */
export function layRun(
  builder: { placeTrack(x: number, y: number, item: TrackItem, rot: number): boolean },
  plan: RunPlan,
): number {
  for (const [i, s] of plan.steps.entries()) {
    if (i >= plan.end) return plan.end;
    if (s.ok && !s.stands && !builder.placeTrack(s.x, s.y, s.item, s.rot)) return i;
  }
  return plan.end;
}
