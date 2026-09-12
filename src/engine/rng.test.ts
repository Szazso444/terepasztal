import { describe, it, expect } from 'vitest';
import { Rng, hash2, hashString } from './rng';

const draw = (r: Rng, n: number) => Array.from({ length: n }, () => r.next());

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
