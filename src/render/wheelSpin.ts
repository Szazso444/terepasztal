/**
 * Turning wheels are drawn as a short cycle of frames (one turn of coupled wheels with their rods,
 * or one step of a plain wheel's symmetry). A layer keeps its place in that cycle as a number in
 * 0..1 and moves on by the track it has rolled.
 */

/** No more than this share of a cycle in one frame: beyond it wheels seem to stand or run back. */
export const SPIN_CAP = 0.34;

/**
 * The layer's place in its cycle after rolling `rolled` tiles towards its own front (negative:
 * backwards), `cycle` tiles of track making one cycle. A fast train's step is held at SPIN_CAP,
 * so its wheels keep turning the way it runs.
 */
export function advanceSpin(u: number, rolled: number, cycle: number): number {
  if (!(cycle > 0) || !Number.isFinite(rolled)) return u;
  const step = Math.max(-SPIN_CAP, Math.min(SPIN_CAP, rolled / cycle));
  const v = (u + step) % 1;
  return v < 0 ? v + 1 : v;
}

/** Which of the cycle's `phases` frames shows at place `u` (0..1). */
export function spinPhase(u: number, phases: number): number {
  return Math.min(phases - 1, Math.max(0, Math.floor(u * phases)));
}
