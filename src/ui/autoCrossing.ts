import { Dir } from '../engine/iso';
import type { Cost } from '../data/content';
import type { PlacementCheck } from '../sim/build';
import { STR } from '../strings';
import {
  TRACK_ITEMS,
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
  | { ok: false; why: 'angle' | 'apart'; other: TrackClass };

/** The class a piece presents along the axis a straight at `rot` runs (0: N–S, 1: E–W). */
function axisClass(p: TrackPiece, rot: number): TrackClass {
  const c = portClass(p, rot % 2 === 0 ? Dir.N : Dir.E);
  return c === 'any' ? p.cls : c;
}

/**
 * What a straight run of class `cls`, laid at `rot`, has to put on a tile that holds `existing`,
 * or null when no crossing comes into it: an empty tile, a straight along the run (a junction, not
 * a crossing), or a piece the ordinary rules judge.
 *
 * A straight or crossing across the run gets the crossing for the pair, from `items` (the game's
 * `TRACK_ITEMS`), turned so the run's class lies on the run's axis; a crossing at rotation 0 has its
 * first class on N–S, like a straight at rotation 0. A pair with no crossing piece is a pair of
 * separate worlds, and a curve or a switch meets the run at an angle: both are refused.
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
  if (existing.kind !== 'straight' && existing.kind !== 'crossing') return null;
  const across = (rot + 1) % 2;
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

/** The build status's reason for a refused crossing. */
export function crossingRefusal(cls: TrackClass, pick: Extract<CrossingPick, { ok: false }>) {
  const name = (c: TrackClass) => STR.toolbar.trackClass[c] ?? c;
  return pick.why === 'angle'
    ? STR.build.crossAngle
    : STR.build.crossApart(name(cls), name(pick.other).toLowerCase());
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
}

/** A run judged tile by tile. Tiles from `end` on are not laid: a crossing the run may not make. */
export interface RunPlan {
  steps: RunStep[];
  end: number;
  cost: Cost;
  /** crossings the run lays by itself */
  crossings: number;
  /** why the run stops at `end`, when it does */
  reason?: string;
}

/** What a run is judged against: the track and the builder's rule for one piece. */
export interface RunWorld {
  track: { get(x: number, y: number): TrackPiece | undefined };
  checkTrack(x: number, y: number, item: TrackItem, rot: number): PlacementCheck;
}

/**
 * The run of `item` along `line`. Where it meets a line at right angles the crossing for the pair
 * goes down instead of the straight, and is priced as one. A crossing that is refused, by the pair
 * or by the rules of its tile, stops the run there: the line it meets is never cut. Any other
 * refused tile is skipped, as before; a piece that stands already costs nothing.
 */
export function planRun(
  world: RunWorld,
  line: readonly { x: number; y: number; rot: number }[],
  item: TrackItem,
): RunPlan {
  const steps: RunStep[] = [];
  const cost: Cost = {};
  let end = line.length,
    crossings = 0,
    reason: string | undefined;
  for (const l of line) {
    const existing = world.track.get(l.x, l.y);
    const pick = item.kind === 'straight' ? crossingFor(item.cls, l.rot, existing) : null;
    let step: RunStep;
    if (pick && !pick.ok) {
      step = {
        x: l.x,
        y: l.y,
        item,
        rot: l.rot,
        ok: false,
        cost: {},
        reason: crossingRefusal(item.cls, pick),
      };
    } else {
      const it = pick ? pick.item : item,
        rot = pick ? pick.rot : l.rot;
      step = { x: l.x, y: l.y, item: it, rot, ...world.checkTrack(l.x, l.y, it, rot) };
      step.stands =
        !!existing &&
        existing.kind === it.kind &&
        existing.cls === it.cls &&
        (existing.cls2 ?? existing.cls) === (it.cls2 ?? it.cls) &&
        existing.rot === rot;
    }
    if (pick) step.crossing = true;
    if (end === line.length && pick && !step.ok) {
      end = steps.length;
      reason = step.reason;
    }
    steps.push(step);
  }
  for (const [i, s] of steps.entries()) {
    if (i >= end || !s.ok || s.stands) continue;
    if (s.crossing) crossings++;
    for (const [k, v] of Object.entries(s.cost)) cost[k] = (cost[k] ?? 0) + v;
  }
  return { steps, end, cost, crossings, reason };
}

/** Lay what `plan` lets through, in order: the tiles before its end, skipping refused and standing ones. */
export function layRun(
  builder: { placeTrack(x: number, y: number, item: TrackItem, rot: number): boolean },
  plan: RunPlan,
) {
  for (const [i, s] of plan.steps.entries())
    if (i < plan.end && s.ok && !s.stands) builder.placeTrack(s.x, s.y, s.item, s.rot);
}
