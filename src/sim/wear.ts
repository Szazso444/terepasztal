/**
 * Track wear (docs/superpowers/specs/2026-10-30-track-wear-design.md). Every piece carries one
 * health share (`TrackPiece.wear`); a crossing and a multi-tile curve or switch are one piece with
 * one share. This file holds what a piece's health means: its maximum HP, its state, and the
 * once-per-game warnings kept in the save. Neither Maglev Guideway nor Hyperloop Tube wears.
 */
import type { TrackGraph, TrackClass, TrackPiece } from '../world/track';
import type { Builder } from './build';
import { rules } from './rules';

export type WearState = 'healthy' | 'degraded' | 'unusable';

/** Does this piece wear at all? Maglev Guideway and Hyperloop Tube, on either axis, do not. */
export function wearsAtAll(p: TrackPiece): boolean {
  const never = (c: TrackClass | undefined) => c === 'maglev' || c === 'hyperloop';
  return !never(p.cls) && !never(p.cls2);
}

/** HP a piece of one line has when new. */
function lineHp(cls: TrackClass): number {
  switch (cls) {
    case 'narrow':
      return rules.trackHpNarrow;
    case 'branch':
      return rules.trackHpBranch;
    case 'main':
      return rules.trackHpMain;
    case 'trunk':
      return rules.trackHpTrunk;
    default:
      return Infinity;
  }
}

/** Maximum HP of a piece: its line's, or a crossing's bigger line's. */
export function maxHp(p: TrackPiece): number {
  const hp = lineHp(p.cls);
  return p.cls2 ? Math.max(hp, lineHp(p.cls2)) : hp;
}

/** What a train on one line multiplies its wear by. */
export function lineWearMul(cls: TrackClass): number {
  switch (cls) {
    case 'narrow':
      return rules.trackWearNarrow;
    case 'branch':
      return rules.trackWearBranch;
    case 'main':
      return rules.trackWearMain;
    case 'trunk':
      return rules.trackWearTrunk;
    default:
      return 0;
  }
}

/** A piece at zero is unusable, one under the degraded share is degraded, the rest are healthy. */
export function stateOf(p: TrackPiece): WearState {
  const h = p.wear.health;
  if (h <= 0) return 'unusable';
  return h < rules.trackDegradedAt ? 'degraded' : 'healthy';
}

/** What `TrackWear` keeps in a save: which first-time warnings the player has had. */
export interface WearJSON {
  degraded: boolean;
  unusable: boolean;
}

/** The wear of a game's track: for now the two once-per-game warnings; the rest follows. */
export class TrackWear {
  /** the first degraded piece has been announced */
  degradedShown = false;
  /** the first unusable piece has been announced */
  unusableShown = false;
  constructor(
    readonly track: TrackGraph,
    readonly builder: Builder,
  ) {}
  toJSON(): WearJSON {
    return { degraded: this.degradedShown, unusable: this.unusableShown };
  }
  fromJSON(j: Partial<WearJSON> | undefined) {
    this.degradedShown = j?.degraded === true;
    this.unusableShown = j?.unusable === true;
  }
}
