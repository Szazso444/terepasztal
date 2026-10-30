import type { TrackClass } from '../world/track';
import { rules } from './rules';

/**
 * Line speed: Narrow Gauge and Branch Line cap a train's top speed; the bigger lines do not, their
 * wide curves are what they are built for. In the units of `Train.maxSpeed`.
 */
export function lineSpeedCap(cls: TrackClass): number {
  if (cls === 'narrow') return rules.lineSpeedNarrow * rules.trainSpeedMul;
  if (cls === 'branch') return rules.lineSpeedBranch * rules.trainSpeedMul;
  return Infinity;
}
/** Speed allowed `distance` tiles before a stretch capped at `limit`, braking at `decel`. */
export function approachCap(limit: number, distance: number, decel: number): number {
  if (distance <= 0) return limit;
  return Math.sqrt(limit * limit + 2 * decel * Math.max(0, distance - 0.25));
}
