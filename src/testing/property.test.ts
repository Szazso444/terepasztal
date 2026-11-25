import { describe, it, expect } from 'vitest';
import { Rng } from '../engine/rng';
import { SEEDS, forAll, shrinkArray, shrinkInt } from './property';

/** The Error `run` throws; fails the test when every case passes. */
function failureOf(run: () => void): Error {
  try {
    run();
  } catch (error) {
    if (error instanceof Error) return error;
    throw error;
  }
  throw new Error('expected a failure, and every case passed');
}

const messageOf = (run: () => void) => failureOf(run).message;
const seedIn = (message: string) => Number(/\bseed (\d+)/.exec(message)?.[1]);
const smallestIn = (message: string) => /^Smallest failing case[^:]*: (.*)$/m.exec(message)?.[1];
const firstIn = (message: string) => /^First failing case: (.*)$/m.exec(message)?.[1];

/** 0 to 12 ints in [0, 39]: some seeds sum past 100, some stay below. */
const ints = (rng: Rng) => Array.from({ length: rng.int(0, 12) }, () => rng.int(0, 39));
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
const sumsBelow100 = (xs: readonly number[]) => sum(xs) < 100;

/** The generic shrinks, then each adjacent pair merged: shorter, with the same sum. */
function* shrinkSummed(xs: readonly number[]): Iterable<number[]> {
  yield* shrinkArray(xs, (x) => shrinkInt(x));
  for (let i = 0; i + 1 < xs.length; i++) {
    yield [...xs.slice(0, i), xs[i] + xs[i + 1], ...xs.slice(i + 2)];
  }
}

describe('SEEDS', () => {
  it('holds distinct uint32 seeds that no test can edit', () => {
    // Rng truncates a seed to uint32, so a duplicate or out-of-range seed runs one case twice; a
    // list a test could push to would make the next test depend on the order they ran in.
    expect(SEEDS.length).toBeGreaterThan(0);
    expect(new Set(SEEDS).size).toBe(SEEDS.length);
    for (const s of SEEDS) expect(s >>> 0).toBe(s);
    expect(Object.isFrozen(SEEDS)).toBe(true);
  });
});

describe('forAll', () => {
  it('names the seed that produced the failure', () => {
    // A message without the seed, or with another seed or the case number in its place, cannot be
    // replayed. Exactly one case fails, from the middle of the default list and of a list whose
    // seeds differ from their positions; the named seed alone must fail again.
    const draw = (rng: Rng) => rng.int(0, 0x7fffffff);
    for (const seeds of [SEEDS, SEEDS.map((s) => s * 7919)]) {
      const culprit = seeds[37];
      const bad = draw(new Rng(culprit));
      expect(seeds.filter((s) => draw(new Rng(s)) === bad)).toEqual([culprit]);

      const message = messageOf(() => forAll(draw, (x) => x !== bad, { seeds }));
      const named = seedIn(message);
      expect(named).toBe(culprit);
      expect(message).toContain(`{ seeds: [${culprit}] }`);
      const replay = messageOf(() => forAll(draw, (x) => x !== bad, { seeds: [named] }));
      expect(seedIn(replay)).toBe(culprit);
    }
  });

  it('shrinks to the one minimal counterexample, [100], from every failing seed', () => {
    // "Every array of non-negative ints sums below 100". A failing array no candidate improves on
    // sums to exactly 100 (else lower an item) and has one item (else merge a pair): [100]. A
    // loop that stops early, or moves to a candidate that passes, reports a longer or larger case.
    const failing = SEEDS.filter((s) => !sumsBelow100(ints(new Rng(s))));
    expect(failing.length).toBeGreaterThan(10);
    for (const seed of failing) {
      const message = messageOf(() =>
        forAll(ints, sumsBelow100, { shrink: shrinkSummed, seeds: [seed] }),
      );
      expect(smallestIn(message), `seed ${seed}`).toBe('[100]');
      expect(firstIn(message), `seed ${seed}`).toBe(JSON.stringify(ints(new Rng(seed))));
    }
    const message = messageOf(() => forAll(ints, sumsBelow100, { shrink: shrinkSummed }));
    expect(seedIn(message)).toBe(failing[0]);
    expect(smallestIn(message)).toBe('[100]');
  });

  it('visits the same cases, in the same order, on every run', () => {
    // Cases from Math.random, the clock or a stream left over from an earlier run differ between
    // two runs. A passing run covers every seed, a failing one every shrink candidate tried.
    const run = () => {
      const seen: number[][] = [];
      forAll(ints, (xs) => void seen.push(xs));
      const message = messageOf(() =>
        forAll(ints, (xs) => seen.push(xs) > 0 && sumsBelow100(xs), { shrink: shrinkSummed }),
      );
      return { seen, message };
    };
    const a = run();
    const b = run();
    expect(a.seen.length).toBeGreaterThan(SEEDS.length);
    expect(b.seen).toEqual(a.seen);
    expect(b.message).toBe(a.message);
  });

  it('runs a passing property once for every seed in the list', () => {
    // A loop that skips the last seed or the first, or runs one twice, checks fewer cases than the
    // list promises; each case must be the one its seed draws on a fresh Rng.
    const draw = (rng: Rng) => rng.next();
    const seen: number[] = [];
    forAll(draw, (x) => seen.push(x) > 0);
    expect(seen).toHaveLength(SEEDS.length);
    expect(seen).toEqual(SEEDS.map((s) => draw(new Rng(s))));
  });

  it('counts a throw as a failure and keeps its message, so expect works inside a property', () => {
    // A runner that let the throw escape before shrinking, or took it for a pass, would make every
    // property written with expect report the unshrunk case or nothing at all.
    const failure = failureOf(() =>
      forAll(ints, (xs) => void expect(sum(xs)).toBeLessThan(100), { shrink: shrinkSummed }),
    );
    expect(smallestIn(failure.message)).toBe('[100]');
    expect(failure.message).toMatch(/^Reason: threw .*expected 100 to be less than 100/m);
    expect(failure.cause).toBeInstanceOf(Error);
  });

  it('stops shrinking at its budget and still names the seed', () => {
    // A shrinker that keeps finding failing candidates would otherwise hang the run. This one stops
    // at 1000, so a runner without a budget fails here instead of hanging.
    const draw = (rng: Rng) => rng.int(0, 9);
    const climb = (n: number) => (n < 1000 ? [n + 1] : []);
    let calls = 0;
    const message = messageOf(() =>
      forAll(draw, () => ++calls < 0, { shrink: climb, shrinkBudget: 50 }),
    );
    expect(calls).toBe(1 + 50);
    expect(seedIn(message)).toBe(SEEDS[0]);
    expect(message).toMatch(/budget of 50 calls/);
    expect(smallestIn(message)).toBe(String(draw(new Rng(SEEDS[0])) + 50));
  });

  it('names the seed when the generator or the shrinker throws', () => {
    // A generator that breaks on one seed is a bug that only that seed can replay.
    const draw = (rng: Rng) => rng.next();
    const culprit = SEEDS[20];
    const bad = draw(new Rng(culprit));
    const gen = (rng: Rng) => {
      const x = draw(rng);
      if (x === bad) throw new Error('no case here');
      return x;
    };
    const generator = messageOf(() => forAll(gen, () => true));
    expect(seedIn(generator)).toBe(culprit);
    expect(generator).toMatch(/generator threw .*no case here/);

    const broken = () => {
      throw new Error('nothing smaller');
    };
    const shrinker = messageOf(() => forAll(draw, (x) => x !== bad, { shrink: broken }));
    expect(seedIn(shrinker)).toBe(culprit);
    expect(shrinker).toMatch(/shrinker threw .*nothing smaller/);
  });

  it('writes a case as JSON with NaN spelled out, else with String or the given formatter', () => {
    // JSON.stringify throws on a cycle and writes NaN as null: either would hide the failing case.
    const never = () => false;
    const shown = (value: unknown, format?: (v: unknown) => string) => {
      const just = () => value;
      return smallestIn(messageOf(() => forAll(just, never, { format, seeds: [1] })));
    };
    expect(shown([1, 'a', { b: null }])).toBe('[1,"a",{"b":null}]');
    expect(shown([NaN, -Infinity])).toBe('["NaN","-Infinity"]');
    const loop: { self?: unknown } = {};
    loop.self = loop;
    expect(shown(loop)).toBe('[object Object]');
    expect(shown(undefined)).toBe('undefined');
    expect(shown(7, (v) => `<${String(v)}>`)).toBe('<7>');
  });
});

describe('shrinkInt', () => {
  it("offers integers between the target and n, the target first and n's neighbour last", () => {
    // A candidate equal to n, or past the target, lets greedy shrinking cycle or leave the
    // generator's range; without the target and n's neighbour it stops short of a boundary.
    const pair = (rng: Rng) => [rng.int(-1000, 1000), rng.pick([0, rng.int(-50, 50)])] as const;
    forAll(pair, ([n, target]) => {
      const c = [...shrinkInt(n, target)];
      if (n === target) return c.length === 0;
      const [lo, hi] = [Math.min(n, target), Math.max(n, target)];
      expect(c.every((x) => Number.isInteger(x) && x >= lo && x <= hi && x !== n)).toBe(true);
      expect(new Set(c).size).toBe(c.length);
      expect(c[0]).toBe(target);
      expect(c[c.length - 1]).toBe(n - Math.sign(n - target));
      // Halving, not counting down: one candidate per binary digit of the distance.
      expect(c.length).toBe(Math.abs(n - target).toString(2).length);
    });
    expect([...shrinkInt(0)]).toEqual([]);
    expect([...shrinkInt(-4, -4)]).toEqual([]);
  });
});

describe('shrinkArray', () => {
  it('offers shorter subsequences, every one-item removal among them, then item shrinks', () => {
    // Without every one-item removal and every one-item shrink, greedy shrinking can stop on an
    // array with a spare or oversized item; a candidate that is not smaller lets it cycle.
    const key = (ys: readonly number[]) => JSON.stringify(ys);
    const isSubsequence = (ys: readonly number[], xs: readonly number[]) => {
      let j = 0;
      for (const x of xs) if (j < ys.length && ys[j] === x) j++;
      return j === ys.length;
    };
    forAll(ints, (xs) => {
      const c = [...shrinkArray(xs, (x) => shrinkInt(x))];
      const keys = new Set(c.map(key));
      const shorter = c.filter((ys) => ys.length < xs.length);
      expect(shorter.every((ys) => isSubsequence(ys, xs))).toBe(true);
      expect(c.slice(0, shorter.length)).toEqual(shorter);
      if (xs.length > 0) expect(c[0]).toEqual([]);
      for (const ys of c.slice(shorter.length)) {
        const changed = xs.flatMap((x, i) => (ys[i] === x ? [] : [i]));
        expect(ys).toHaveLength(xs.length);
        expect(changed).toHaveLength(1);
        expect([...shrinkInt(xs[changed[0]])]).toContain(ys[changed[0]]);
      }
      for (let i = 0; i < xs.length; i++) {
        const rest = [...xs.slice(0, i), ...xs.slice(i + 1)];
        expect(keys.has(key(rest))).toBe(true);
        for (const x of shrinkInt(xs[i])) {
          expect(keys.has(key([...xs.slice(0, i), x, ...rest.slice(i)]))).toBe(true);
        }
      }
      expect([...shrinkArray(xs)]).toEqual(shorter);
    });
  });
});
