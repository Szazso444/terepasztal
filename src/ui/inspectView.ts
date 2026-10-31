/**
 * What the Inspect 3D screen decides, apart from drawing it: how the headings run, how far a drag
 * turns the model, how fast it turns by itself. DOM-free, so it runs under Node.
 */
import { FACINGS } from '../sim/body';

/** The headings a model is drawn at, 7.5 degrees apart. */
export const FACING_COUNT = FACINGS;
export const FACING_DEGREES = 360 / FACING_COUNT;
/** How long the model stays on a heading while it turns by itself. */
export const FACING_STEP_MS = 120;
/** How many pixels of a drag turn the model by one heading. */
export const DRAG_PX_PER_FACING = 8;

/** The heading after `facing`, round the circle. */
export function nextFacing(facing: number): number {
  return (facing + 1) % FACING_COUNT;
}

/** A heading in degrees. */
export function facingDegrees(facing: number): number {
  return facing * FACING_DEGREES;
}

/** How many headings a drag of `dx` pixels turns the model by, towards zero. */
export function turnedBy(dx: number): number {
  return Math.trunc(dx / DRAG_PX_PER_FACING);
}

/**
 * The cached frames of one model drawn at one scale, out of every key of the cache (`vehicle/<id>_f<n>@<scale>`):
 * its turntable's headings, which are let go of once it is closed. Another model, or the same one
 * at another scale (a recipe row's thumbnail), is left.
 */
export function framesToForget(keys: Iterable<string>, defId: string, scale: number): string[] {
  const own = `vehicle/${defId}_f`;
  return [...keys].filter((k) => k.startsWith(own) && k.endsWith(`@${scale}`));
}
