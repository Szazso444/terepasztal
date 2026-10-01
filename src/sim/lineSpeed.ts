import type { TrackClass } from '../world/track';
import { rules } from './rules';

/**
 * Line speed: regular and narrow track cap a train's top speed, high-speed track does not. That
 * is what high-speed lines are for. In the units of `Train.maxSpeed`.
 */
export function lineSpeedCap(cls: TrackClass): number {
  if (cls === 'high_speed') return Infinity;
  const v = cls === 'narrow' ? rules.lineSpeedNarrow : rules.lineSpeedRegular;
  return v * rules.trainSpeedMul;
}
/** Speed allowed `distance` tiles before a stretch capped at `limit`, braking at `decel`. */
export function approachCap(limit: number, distance: number, decel: number): number {
  if (distance <= 0) return limit;
  return Math.sqrt(limit * limit + 2 * decel * Math.max(0, distance - 0.25));
}
