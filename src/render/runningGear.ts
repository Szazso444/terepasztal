/**
 * Running gear: which wheel-phase frame a vehicle part shows for the distance its train has run.
 * Pure: no Pixi, no canvas, no DOM.
 *
 * The naming contract the Art side renders against:
 * - For a still frame key K (what `locoFrame`, `wagonFrame` or `bogieFrame` in
 *   `src/art/frames.ts` return, for example `rolling/loco_rocket_body_f6`), phase 0 is K itself
 *   and phase k (1 or more) is `K_w<k>`.
 * - The number of phases N is 1 plus the count of consecutive `K_w1`, `K_w2`, ... in the atlas,
 *   at most `MAX_PHASES`.
 * - The N phases are evenly spaced over one full turn of the wheels (`WHEEL_CYCLE_TILES` of
 *   travel), in the order the gear turns when the vehicle moves nose first.
 * - A part without `K_w1` does not animate.
 * - An undrawn facing uses its mirror partner's phases, as it uses its frame.
 * - All drawn facings of one part are meant to carry the same N; the renderer counts per key and
 *   does not enforce it.
 */

/** The most phases a still frame can have; the probe for `_w` frames stops here. */
export const MAX_PHASES = 16;

/**
 * Tiles of travel per full turn of the wheels, for all stock. A medium vehicle is 2 tiles long
 * (`SIZE_LEN`), so one turn is a quarter of it: a 1.6 m driving wheel on a 20 m locomotive,
 * between a diesel's bogie wheel and a steam engine's drivers. The fastest locomotive in
 * `src/data/locomotives.json` (tgv) runs 3 tiles per game second, which at 1x and 60 fps is
 * 0.05 tiles a rendered frame, a tenth of a turn: with up to 10 phases the phase changes at most
 * once a frame (8 phases: 0.8). `Train.distance` steps once per sim tick (20 a game second), so
 * the shown phase moves every third frame, by at most 0.15 tiles (0.3 of a turn), short of the
 * half turn at which wheels would seem to run backwards. Item levels, the train speed rule and
 * fast-forward run faster than that basis.
 */
export const WHEEL_CYCLE_TILES = 0.5;

/** The key of phase `k` (0 to N - 1) of still frame `still`: phase 0 is the still frame. */
export function phaseKey(still: string, k: number): string {
  return k > 0 ? `${still}_w${k}` : still;
}

/**
 * Counts the phases of still frames in an atlas. A key is probed once, for at most
 * `MAX_PHASES - 1` `_w` names, and its count remembered; the memory is this object's own, so
 * counters over different atlases never share it. Only loading adds frames to an atlas, and the
 * game loads before it draws, so a remembered count stays true.
 */
export class PhaseCounter {
  private readonly counts = new Map<string, number>();
  constructor(private readonly atlas: { has(key: string): boolean }) {}

  /** N for still frame `still`: 1 plus its consecutive `_w1`, `_w2`, ... frames. */
  count(still: string): number {
    let n = this.counts.get(still);
    if (n === undefined) {
      n = 1;
      while (n < MAX_PHASES && this.atlas.has(phaseKey(still, n))) n++;
      this.counts.set(still, n);
    }
    return n;
  }
}

/**
 * The phase (0 to n - 1) shown after `roll` tiles of travel: one full cycle of n phases every
 * `WHEEL_CYCLE_TILES`, stepping backwards as `roll` falls. A non-finite roll, or one too large to
 * count in, shows phase 0, and so does any n under 2.
 */
export function phaseIndex(roll: number, n: number): number {
  const phases = Math.floor(n);
  if (!(phases > 1)) return 0;
  const step = Math.floor((roll / WHEEL_CYCLE_TILES) * phases);
  if (!Number.isFinite(step)) return 0;
  return ((step % phases) + phases) % phases;
}

/**
 * Each train's wheel roll in tiles: the distance it has run, counted down while it runs tail
 * first. The renderer owns one and feeds it every train's `Train.distance` each frame.
 */
export class WheelRolls {
  private readonly rolls = new Map<number, { last: number; roll: number }>();

  /**
   * The roll of train `id` now that its distance reads `distance`. A train seen for the first
   * time, or whose distance went down (a load, a re-placement), keeps its roll this frame and is
   * measured from the new value after. A missing or non-finite distance has no roll (phase 0),
   * and the next finite one is a first sight.
   */
  advance(id: number, distance: number | undefined, reversed: boolean): number | undefined {
    if (typeof distance !== 'number' || !Number.isFinite(distance)) {
      this.rolls.delete(id);
      return undefined;
    }
    const r = this.rolls.get(id);
    if (!r) {
      this.rolls.set(id, { last: distance, roll: 0 });
      return 0;
    }
    if (distance > r.last) r.roll += reversed ? r.last - distance : distance - r.last;
    r.last = distance;
    return r.roll;
  }

  /** Forget train `id`: its next `advance` is a first sight. */
  drop(id: number) {
    this.rolls.delete(id);
  }

  /** Whether train `id` has a roll remembered. */
  has(id: number) {
    return this.rolls.has(id);
  }
}
