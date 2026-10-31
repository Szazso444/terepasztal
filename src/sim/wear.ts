/**
 * Track wear (docs/superpowers/specs/2026-10-30-track-wear-design.md). Every piece carries one
 * health share (`TrackPiece.wear`); a crossing and a multi-tile curve or switch are one piece with
 * one share. This file holds what a piece's health means: its maximum HP, its state, and the
 * once-per-game warnings kept in the save. Neither Maglev Guideway nor Hyperloop Tube wears.
 */
import type { Dir } from '../engine/iso';
import type { TrackGraph, TrackClass, TrackPiece } from '../world/track';
import type { Builder } from './build';
import { pieceClassFor } from './compat';
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

/** The wear of a game's track: what trains and time take from it, and the warnings kept in a save. */
export class TrackWear {
  /** the first degraded piece has been announced */
  degradedShown = false;
  /** the first unusable piece has been announced */
  unusableShown = false;
  /** keys (y * w + x) of every depot gate tile, rebuilt when the track or the stations change */
  private gates = new Set<number>();
  private gatesFor = '';
  constructor(
    readonly track: TrackGraph,
    readonly builder: Builder,
  ) {}
  /** Nothing wears here: a free builder, a depot gate, Maglev Guideway or Hyperloop Tube. */
  exempt(x: number, y: number): boolean {
    if (this.builder.free) return true;
    const p = this.track.get(x, y);
    if (!p || !wearsAtAll(p)) return true;
    const stamp = this.track.version + ':' + this.builder.stations.length;
    if (stamp !== this.gatesFor) {
      this.gatesFor = stamp;
      this.gates.clear();
      for (const d of this.builder.depots())
        for (const g of d.gateTiles()) this.gates.add(g.y * this.track.w + g.x);
    }
    return this.gates.has(y * this.track.w + x);
  }
  /** A train of `tonnes` runs onto the piece at (x, y), entering through `entry`. */
  hit(x: number, y: number, entry: Dir, tonnes: number): void {
    const p = this.track.get(x, y);
    if (!p || this.exempt(x, y)) return;
    const share =
      (tonnes *
        rules.trackWearPerTonne *
        lineWearMul(pieceClassFor(p, entry)) *
        rules.trackWearMul) /
      maxHp(p);
    this.lose(p, share);
  }
  /** One game day passes: every piece loses its time wear, standing or not. */
  daily(): void {
    for (const { x, y, piece } of this.track.anchors())
      if (!this.exempt(x, y)) this.lose(piece, rules.trackTimeWear * rules.trackWearMul);
  }
  /**
   * The one place a piece's health changes: it loses `share` of its maximum HP, twice that once
   * degraded, and never goes below zero.
   */
  private lose(p: TrackPiece, share: number): void {
    const worn = stateOf(p) === 'healthy' ? share : share * rules.trackDegradedWear;
    p.wear.health = Math.max(0, p.wear.health - Math.max(0, worn));
  }
  toJSON(): WearJSON {
    return { degraded: this.degradedShown, unusable: this.unusableShown };
  }
  fromJSON(j: Partial<WearJSON> | undefined) {
    this.degradedShown = j?.degraded === true;
    this.unusableShown = j?.unusable === true;
  }
}
