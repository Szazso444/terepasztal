/**
 * Building levels by age. Stations (depots, town hall and warehouse included), works and houses
 * get one level per age from the age they appear in: a building of the Steam age may reach level 2
 * in the Diesel age and level 6 in the Hyper age, one of the Electric age reaches 4 at most. In the
 * Steam age nothing can be upgraded. Bridges keep their own four levels and are not capped by age.
 *
 * The module imports nothing: src/data/content.ts reads `MAX_LEVEL` while it loads.
 */

/** The highest level any station, works or house reaches. */
export const MAX_LEVEL = 6;

/** The highest level a building that appears in `firstAge` may reach in `age` (1..MAX_LEVEL). */
export function levelCap(firstAge: number, age: number): number {
  return Math.max(1, Math.min(MAX_LEVEL, age - firstAge + 1));
}

/** The age in which a building that appears in `firstAge` may first reach `level`. */
export function ageOfLevel(firstAge: number, level: number): number {
  return firstAge + level - 1;
}
