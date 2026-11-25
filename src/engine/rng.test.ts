import { describe, it, expect } from 'vitest';
import { Rng, hash2, hashString } from './rng';

const draw = (r: { next(): number }, n: number) => Array.from({ length: n }, () => r.next());

const U32 = 0xffffffffn;
const WEYL = 0x6d2b79f5n;

/**
 * Reference mulberry32: the published C, line for line, in BigInt so it shares none of Rng's
 * 32-bit tricks (Math.imul, ToInt32 on ^ and |). Its state is a Weyl counter, so `skip` jumps
 * straight to the state after that many draws.
 */
class Mulberry32 {
  private s: bigint;
  constructor(seed: number, skip = 0) {
    this.s = (BigInt(seed) + BigInt(skip) * WEYL) & U32;
  }
  get state(): number {
    return Number(this.s);
  }
  next(): number {
    let z = (this.s = (this.s + WEYL) & U32);
    z = ((z ^ (z >> 15n)) * (z | 1n)) & U32;
    z ^= (z + (z ^ (z >> 7n)) * (z | 61n)) & U32;
    return Number(z ^ (z >> 14n)) / 4294967296;
  }
}

const isU32 = (v: number) => Number.isInteger(v) && v >= 0 && v < 2 ** 32;

describe('Rng', () => {
  it('gives the same stream for the same seed', () => {
    expect(draw(new Rng(1234), 8)).toEqual(draw(new Rng(1234), 8));
    expect(draw(new Rng(1234), 8)).not.toEqual(draw(new Rng(1235), 8));
  });

  it('resumes from a stored state', () => {
    const a = new Rng(99);
    draw(a, 5);
    const mid = a.state;
    const rest = draw(a, 5);

    const b = new Rng(0);
    b.state = mid;
    expect(draw(b, 5)).toEqual(rest);
  });

  it('keeps state a uint32 so it survives a JSON round trip', () => {
    const r = new Rng(-1);
    expect(r.state).toBe(0xffffffff);
    r.state = -7;
    expect(r.state).toBe(0xfffffff9);
    const revived = new Rng(0);
    revived.state = JSON.parse(JSON.stringify(r.state)) as number;
    expect(revived.next()).toBe(new Rng(0xfffffff9).next());
  });

  it('stays inside its ranges', () => {
    const r = new Rng(7);
    for (let i = 0; i < 2000; i++) {
      const f = r.next();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
    }
    const ints = new Set<number>();
    for (let i = 0; i < 2000; i++) ints.add(r.int(3, 6));
    expect([...ints].sort()).toEqual([3, 4, 5, 6]);
    for (let i = 0; i < 500; i++) {
      const v = r.range(-2, 2);
      expect(v).toBeGreaterThanOrEqual(-2);
      expect(v).toBeLessThan(2);
    }
    expect(r.int(5, 5)).toBe(5);
  });

  it('picks and shuffles without dropping elements', () => {
    const r = new Rng(42);
    const src = [1, 2, 3, 4, 5, 6, 7, 8];
    for (let i = 0; i < 200; i++) expect(src).toContain(r.pick(src));

    const arr = [...src];
    const same = r.shuffle(arr);
    expect(same).toBe(arr);
    expect([...arr].sort((a, b) => a - b)).toEqual(src);
  });

  it('shuffles the same way for the same seed', () => {
    const a = new Rng(5).shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const b = new Rng(5).shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(a).toEqual(b);
  });

  it('draws the reference mulberry32 stream and state', () => {
    for (const seed of [1, 0x5eed, 20260912]) {
      const r = new Rng(seed);
      const ref = new Mulberry32(seed);
      let firstDiff: object | null = null;
      for (let i = 1; i <= 10_000 && !firstDiff; i++) {
        const got = { value: r.next(), state: r.state };
        const want = { value: ref.next(), state: ref.state };
        if (got.value !== want.value || got.state !== want.state)
          firstDiff = { seed, draw: i, got, want };
      }
      expect(firstDiff).toBeNull();
    }
  });

  it('keeps state an integer in [0, 2^32) after any draw', () => {
    const src = [1, 2, 3];
    const draws: ((r: Rng) => unknown)[] = [
      (r) => r.next(),
      (r) => r.int(0, 9),
      (r) => r.range(-1, 1),
      (r) => r.chance(0.5),
      (r) => r.pick(src),
      (r) => r.shuffle([...src]),
    ];
    for (const seed of [0, 1, 0x5eed, 0xffffffff]) {
      const r = new Rng(seed);
      let bad: object | null = null;
      for (let i = 1; i <= 10_000 && !bad; i++) {
        draws[i % draws.length](r);
        if (!isU32(r.state)) bad = { seed, draw: i, state: r.state };
      }
      expect(bad).toBeNull();
    }
  });

  it('resumes a JSON-saved state identically millions of draws in', () => {
    // An unwrapped counter would pass 2^53 at draw 4,917,759 of Rng(0x5eed), where adding to it
    // stops being exact; these two saves sit either side of that point.
    const seed = 0x5eed;
    const early = 4_917_700;
    const late = 4_917_800;
    const live = new Rng(seed);
    for (let i = 0; i < early; i++) live.next();
    const savedEarly = JSON.parse(JSON.stringify(live.state)) as number;
    const between = draw(live, late - early);
    const savedLate = JSON.parse(JSON.stringify(live.state)) as number;
    const afterLate = draw(live, 1000);
    const afterEarly = [...between, ...afterLate].slice(0, 1000);

    for (const [taken, saved, liveTail] of [
      [early, savedEarly, afterEarly],
      [late, savedLate, afterLate],
    ] as const) {
      // Soft, so a failure at one save does not hide the other.
      const resumed = new Rng(0);
      resumed.state = saved;
      expect.soft(draw(resumed, 1000), `resumed after ${taken} draws`).toEqual(liveTail);
      const ref = new Mulberry32(seed, taken);
      expect.soft(saved, `state after ${taken} draws`).toBe(ref.state);
      expect.soft(liveTail, `live after ${taken} draws`).toEqual(draw(ref, 1000));
    }
  });
});

describe('hash2', () => {
  it('is stateless and stable per coordinate', () => {
    expect(hash2(3, 4)).toBe(hash2(3, 4));
    expect(hash2(3, 4, 1)).not.toBe(hash2(3, 4, 2));
    expect(hash2(3, 4)).not.toBe(hash2(4, 3));
  });

  it('stays in [0, 1)', () => {
    for (let x = -50; x < 50; x++)
      for (let y = -50; y < 50; y++) {
        const h = hash2(x, y);
        expect(h).toBeGreaterThanOrEqual(0);
        expect(h).toBeLessThan(1);
      }
  });
});

describe('hashString', () => {
  it('is a stable uint32', () => {
    expect(hashString('terepasztal')).toBe(hashString('terepasztal'));
    expect(hashString('a')).not.toBe(hashString('b'));
    expect(hashString('')).toBe(2166136261);
    for (const s of ['', 'a', 'seed-1', 'árvíztűrő']) {
      const h = hashString(s);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
    }
  });
});
