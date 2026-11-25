/**
 * Track wear (docs/superpowers/specs/2026-10-30-track-wear-design.md). Every piece carries one
 * health share (`TrackPiece.wear`); a crossing and a multi-tile curve or switch are one piece with
 * one share. This file holds what a piece's health means: its maximum HP, its state, and the
 * once-per-game warnings kept in the save. Neither Maglev Guideway nor Hyperloop Tube wears. A
 * piece at zero closes to traffic: `Train.canUse` reads its health, and `TrackWear.flush` tells the
 * trains.
 */
import type { Cost } from '../data/content';
import type { Dir } from '../engine/iso';
import { pieceCost, type TrackGraph, type TrackClass, type TrackPiece } from '../world/track';
import type { Builder } from './build';
import { pieceClassFor } from './compat';
import { rules } from './rules';
import { scaleCost } from './stores';

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
  /** told the tiles of a piece whose state changed */
  onChange: ((tiles: { x: number; y: number }[]) => void) | null = null;
  /** told once per game, at a tile of the piece, when the first one turns degraded or unusable */
  onFirst: ((kind: 'degraded' | 'unusable', x: number, y: number) => void) | null = null;
  /** what `unusable` hands out, and the track version it was built for */
  private failed = new Set<number>();
  private failedFor = -1;
  /** a piece entered or left the unusable state since the last `flush` */
  private closures = false;
  /** keys (y * w + x) of every depot gate tile; `invalidateGates` has it rebuilt */
  private gates = new Set<number>();
  private gatesStale = true;
  constructor(
    readonly track: TrackGraph,
    readonly builder: Builder,
  ) {}
  /** The stations changed (placed, removed, swapped, loaded): the depot gates are read again. */
  invalidateGates(): void {
    this.gatesStale = true;
  }
  /**
   * Nothing wears the piece at (x, y): a free builder, a depot gate on any tile of the piece,
   * Maglev Guideway or Hyperloop Tube.
   */
  exempt(x: number, y: number): boolean {
    if (this.builder.free) return true;
    const p = this.track.get(x, y);
    if (!p || !wearsAtAll(p)) return true;
    if (this.gatesStale) {
      this.gatesStale = false;
      this.gates.clear();
      for (const d of this.builder.depots())
        for (const g of d.gateTiles()) this.gates.add(g.y * this.track.w + g.x);
    }
    return this.track.unitTiles(x, y).some((t) => this.gates.has(t.y * this.track.w + t.x));
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
    this.lose(x, y, p, share);
  }
  /** One game day passes: every piece loses its time wear, standing or not. */
  daily(): void {
    for (const { x, y, piece } of this.track.anchors())
      if (!this.exempt(x, y)) this.lose(x, y, piece, rules.trackTimeWear * rules.trackWearMul);
  }
  /**
   * What mending `share` of the piece's HP costs: that share of its build cost at the repair price,
   * each resource rounded up; by hand it is dearer (`trackHandRepairMul`).
   */
  repairCost(p: TrackPiece, share: number, hand: boolean): Cost {
    const mul =
      share * rules.trackRepairPrice * rules.buildCostMul * (hand ? rules.trackHandRepairMul : 1);
    return scaleCost(pieceCost(p.kind, p.cls, p.cls2), mul);
  }
  /** What a maintenance train owes for mending `share` of the piece's HP, in fractions of a unit. */
  repairDue(p: TrackPiece, share: number): Cost {
    const mul = share * rules.trackRepairPrice * rules.buildCostMul;
    const due: Cost = {};
    for (const [k, v] of Object.entries(pieceCost(p.kind, p.cls, p.cls2))) due[k] = v * mul;
    return due;
  }
  /**
   * Give the piece at (x, y) the health it had (an undo lays it back as it stood), and tell the
   * trains if it closes.
   */
  setHealth(x: number, y: number, health: number): void {
    const p = this.track.get(x, y);
    if (!p || !Number.isFinite(health)) return;
    const was = stateOf(p);
    p.wear.health = Math.min(1, Math.max(0, health));
    this.settle(x, y, p, was);
    this.flush();
  }
  /** Mend the piece at (x, y) by `share` of its HP, never past full, and tell the trains what opened. */
  restore(x: number, y: number, share: number): void {
    const p = this.track.get(x, y);
    if (!p) return;
    const was = stateOf(p);
    p.wear.health = Math.min(1, p.wear.health + Math.max(0, share));
    this.settle(x, y, p, was);
    this.flush();
  }
  /**
   * Keys (y * w + x) of every tile of an unusable piece. Rebuilt after a track edit or a load,
   * which bring and take pieces with their health; between those `settle` keeps it.
   */
  get unusable(): Set<number> {
    if (this.track.version !== this.failedFor) {
      this.failedFor = this.track.version;
      this.failed.clear();
      for (const [key, p] of this.track.pieces) if (p.wear.health <= 0) this.failed.add(key);
    }
    return this.failed;
  }
  /** Every unusable piece once, by tile order: its anchor tile and all its tiles. */
  failedPieces(): { x: number; y: number; tiles: { x: number; y: number }[] }[] {
    const { track } = this;
    const out: { x: number; y: number; tiles: { x: number; y: number }[] }[] = [];
    // a curve's tiles share one wear, so the first tile met stands for the piece
    const seen = new Set<object>();
    for (const k of [...this.unusable].sort((a, b) => a - b)) {
      const p = track.pieces.get(k);
      if (!p || seen.has(p.wear)) continue;
      seen.add(p.wear);
      const x = k % track.w;
      const y = Math.floor(k / track.w);
      out.push({ ...track.anchorOf(x, y), tiles: track.unitTiles(x, y) });
    }
    return out;
  }
  /**
   * Tell the trains what closed or opened since the last call: one rise of `track.version`, however
   * many pieces, so a batch of failures costs one round of path checks.
   */
  flush(): void {
    if (!this.closures) return;
    this.closures = false;
    this.track.version++;
  }
  /**
   * The one place a piece's health changes: it loses `share` of its maximum HP, twice that once
   * degraded, and never goes below zero.
   */
  private lose(x: number, y: number, p: TrackPiece, share: number): void {
    const was = stateOf(p);
    const worn = was === 'healthy' ? share : share * rules.trackDegradedWear;
    p.wear.health = Math.max(0, p.wear.health - Math.max(0, worn));
    this.settle(x, y, p, was);
  }
  /** After a health change: what follows from the piece at (x, y) no longer being in state `was`. */
  private settle(x: number, y: number, p: TrackPiece, was: WearState): void {
    const now = stateOf(p);
    if (now === was) return;
    const tiles = this.track.unitTiles(x, y);
    if (now === 'unusable' || was === 'unusable') {
      this.closures = true;
      for (const t of tiles) {
        const key = this.track.key(t.x, t.y);
        if (now === 'unusable') this.failed.add(key);
        else this.failed.delete(key);
      }
    }
    this.onChange?.(tiles);
    if (now === 'degraded' && was === 'healthy' && !this.degradedShown) {
      this.degradedShown = true;
      this.onFirst?.('degraded', x, y);
    } else if (now === 'unusable' && !this.unusableShown) {
      this.unusableShown = true;
      this.onFirst?.('unusable', x, y);
    }
  }
  toJSON(): WearJSON {
    return { degraded: this.degradedShown, unusable: this.unusableShown };
  }
  fromJSON(j: Partial<WearJSON> | undefined) {
    this.degradedShown = j?.degraded === true;
    this.unusableShown = j?.unusable === true;
  }
}
