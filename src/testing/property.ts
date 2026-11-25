// Seeded property runner for the standard in docs/process/verification.md: one case per seed from
// a fresh Rng, a failing case shrunk to the smallest one found, the seed in every failure message.
// Plain TypeScript with no test framework, DOM or clock, so any runner under Node can use it.

import { Rng } from '../engine/rng';

/** The seeds forAll runs by default, one case each: 1 to 100. */
export const SEEDS: readonly number[] = Object.freeze(Array.from({ length: 100 }, (_, i) => i + 1));

/** What forAll may be given besides the generator and the property; every field is optional. */
export interface ForAllOptions<T> {
  /** Smaller candidates for a failing case, simplest first; the first that still fails is kept. */
  shrink?: (value: T) => Iterable<T>;
  /** Seeds to run instead of SEEDS; `{ seeds: [s] }` replays the case of seed s alone. */
  seeds?: readonly number[];
  /** Renders a case for the failure message; JSON by default, String where JSON fails. */
  format?: (value: T) => string;
  /** Most property calls spent shrinking one failure (default 10 000), so it cannot hang. */
  shrinkBudget?: number;
}

/**
 * Runs `property` on one case per seed, drawn by `gen` from a fresh `Rng(seed)`. A case fails when
 * the property returns false or throws, so `expect` inside it works. The first failure is shrunk
 * greedily and thrown as an Error naming its seed and the smallest failing case found.
 */
export function forAll<T>(
  gen: (rng: Rng) => T,
  property: (value: T) => boolean | void,
  options: ForAllOptions<T> = {},
): void {
  const { shrink, seeds = SEEDS, format = formatCase, shrinkBudget = 10_000 } = options;
  for (let i = 0; i < seeds.length; i++) {
    const seed = seeds[i];
    const where = `seed ${seed} (case ${i + 1} of ${seeds.length})`;
    let first: T;
    try {
      first = gen(new Rng(seed));
    } catch (error) {
      throw new Error(`The generator threw for ${where}: ${String(error)}`, { cause: error });
    }
    let failure = check(property, first);
    if (!failure) continue;

    // Greedy: move to the first candidate that still fails, until none does or the budget is spent.
    let smallest = first;
    let steps = 0;
    let calls = 0;
    let spent = false;
    try {
      search: for (;;) {
        for (const candidate of shrink ? shrink(smallest) : []) {
          if (calls >= shrinkBudget) {
            spent = true;
            break search;
          }
          calls++;
          const f = check(property, candidate);
          if (f) {
            smallest = candidate;
            failure = f;
            steps++;
            continue search;
          }
        }
        break;
      }
    } catch (error) {
      const at = `${where} while shrinking ${format(smallest)}`;
      throw new Error(`The shrinker threw for ${at}: ${String(error)}`, { cause: error });
    }

    const lines = [
      `Property failed for ${where}.`,
      `Smallest failing case, after ${steps} shrink steps: ${format(smallest)}`,
      `Reason: ${failure.reason}`,
    ];
    if (spent) lines.push(`Shrinking stopped at its budget of ${shrinkBudget} calls.`);
    if (steps > 0) lines.push(`First failing case: ${format(first)}`);
    lines.push(`Replay it alone with { seeds: [${seed}] }.`);
    throw new Error(lines.join('\n'), { cause: failure.error });
  }
}

/** Integers between `target` and `n`: `target` first, n's neighbour last; none when n is target. */
export function* shrinkInt(n: number, target = 0): Iterable<number> {
  if (n === target) return;
  yield target;
  // Halving the distance to n binary-searches a boundary; the last step of 1 lands exactly on it.
  for (let d = Math.trunc((n - target) / 2); d !== 0; d = Math.trunc(d / 2)) yield n - d;
}

/** Shorter arrays (chunks removed, largest first), then copies with one item shrunk by `item`. */
export function* shrinkArray<T>(xs: readonly T[], item?: (x: T) => Iterable<T>): Iterable<T[]> {
  for (let size = xs.length; size > 0; size = Math.floor(size / 2)) {
    for (let at = 0; at + size <= xs.length; at += size) {
      yield [...xs.slice(0, at), ...xs.slice(at + size)];
    }
  }
  if (!item) return;
  for (let i = 0; i < xs.length; i++) {
    for (const x of item(xs[i])) yield [...xs.slice(0, i), x, ...xs.slice(i + 1)];
  }
}

interface Failure {
  reason: string;
  error?: unknown;
}

function check<T>(property: (value: T) => boolean | void, value: T): Failure | undefined {
  try {
    if (property(value) === false) return { reason: 'returned false' };
  } catch (error) {
    return { reason: `threw ${String(error)}`, error };
  }
  return undefined;
}

function formatCase(value: unknown): string {
  try {
    // JSON writes NaN and the infinities as null; spell them out instead.
    const json = JSON.stringify(value, (_key, v: unknown) =>
      typeof v === 'number' && !Number.isFinite(v) ? String(v) : v,
    );
    if (json !== undefined) return json;
  } catch {
    // A cycle or a bigint: fall back to String below.
  }
  return String(value);
}
