/**
 * The four rotations a building (a station, a works, a house or a service) is placed in, as
 * section 1 of `docs/superpowers/specs/2026-10-02-building-eras-art-package-design.md` names them:
 * r0 has its front facing S (down-left), r1 W (up-left), r2 N (up-right) and r3 E (down-right).
 * Each step turns the building a quarter turn clockwise seen from above. Track runs parallel to
 * the front, so a rotation and the one opposite it share an axis, and footprints and gates follow
 * the axis alone (`rotationAxis`).
 */
export const BUILDING_ROTATIONS = 4;

/**
 * Any whole number as one of the four rotations, counting on past r3 and back from r0; anything
 * else (a fraction, or no number at all, as a damaged file may hold) is r0.
 */
export function wrapRotation(rot: unknown): number {
  if (typeof rot !== 'number' || !Number.isInteger(rot)) return 0;
  return ((rot % BUILDING_ROTATIONS) + BUILDING_ROTATIONS) % BUILDING_ROTATIONS;
}

/** The rotation one step on: a quarter turn clockwise, r3 back to r0. */
export function nextRotation(rot: number): number {
  return wrapRotation(rot + 1);
}

/**
 * The axis of a rotation, `rot` mod 2: 0 for r0 and r2 (track along x, a depot's gates west and
 * east), 1 for r1 and r3 (track along y, gates north and south).
 */
export function rotationAxis(rot: number): number {
  return wrapRotation(rot) % 2;
}
