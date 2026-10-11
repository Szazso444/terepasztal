/**
 * An upgrade under way. Pressing Upgrade pays and starts a work; the building stays closed (it
 * makes nothing, takes nothing in and has no crew) until the work's game time has passed, and
 * then its level rises by one. The times are game hours of a day (`daySeconds`), scaled by
 * `rules.upgradeTimeMul`; at 0 every upgrade is instant. The depot's upgrade never takes time.
 */
import { rules, daySeconds } from './rules';

/** A work under way: the level it brings, and its game seconds left and in all. */
export interface Work {
  to: number;
  left: number;
  total: number;
}

/** Game hours an upgrade takes, to level 2, 3, 4, 5 and 6. */
export const UPGRADE_HOURS: readonly number[] = [6, 9, 12, 18, 24];

/**
 * Game seconds below which a work counts as done, so that steps adding up to its time finish it
 * whatever their sizes and the rounding of their sum.
 */
const DONE_EPSILON = 1e-6;

/** Game seconds the upgrade to `toLevel` takes under the rules now; 0 when it is instant. */
export function upgradeSeconds(toLevel: number): number {
  if (!(toLevel >= 2)) return 0;
  const hours = UPGRADE_HOURS[Math.min(toLevel - 2, UPGRADE_HOURS.length - 1)];
  return ((hours * daySeconds()) / 24) * rules.upgradeTimeMul;
}

/** A new work towards `toLevel`, or null when it takes no time and is done at once. */
export function startWork(toLevel: number): Work | null {
  const total = upgradeSeconds(toLevel);
  return total > 0 ? { to: toLevel, left: total, total } : null;
}

/** Advance a work by `gameDt` game seconds; true when it is done. */
export function advanceWork(w: Work, gameDt: number): boolean {
  if (gameDt > 0) w.left = Math.max(0, w.left - gameDt);
  return w.left <= DONE_EPSILON;
}

/** How far a work has come: 0 when it starts, 1 when it is done. */
export function workProgress(w: Work): number {
  if (!(w.total > 0)) return 1;
  return Math.min(1, Math.max(0, 1 - w.left / w.total));
}

/** Game hours a work has left, under the day length now. */
export function hoursLeft(w: Work): number {
  return w.left / (daySeconds() / 24);
}

/** A work as a save holds it: a copy, or null when there is none. */
export function workToJSON(w: Work | null | undefined): Work | null {
  return w ? { to: w.to, left: w.left, total: w.total } : null;
}

/**
 * A work read from a save for a building at `level`: null for none, and for anything that is not
 * a work towards `level + 1` (at most `max`) with a positive time. The time left is kept within
 * the work's time.
 */
export function workFromJSON(v: unknown, level: number, max = Infinity): Work | null {
  if (!v || typeof v !== 'object') return null;
  const { to, left, total } = v as Record<string, unknown>;
  if (typeof to !== 'number' || typeof left !== 'number' || typeof total !== 'number') return null;
  if (to !== level + 1 || to > max) return null;
  if (!Number.isFinite(total) || !(total > 0) || !Number.isFinite(left)) return null;
  return { to, left: Math.min(total, Math.max(0, left)), total };
}

/** What `onUpgraded` reports when a level rises: what rose, where it stands, how big, and to what. */
export interface Upgraded {
  kind: 'station' | 'works' | 'house';
  /** the footprint's corner tile */
  x: number;
  y: number;
  /** the footprint's width along x and depth along y, in tiles */
  w: number;
  h: number;
  name: string;
  level: number;
}

/** A work under way where it stands, for the bars drawn over the world. */
export interface WorkSite {
  x: number;
  y: number;
  w: number;
  h: number;
  /** 0 .. 1 (`workProgress`) */
  progress: number;
}
