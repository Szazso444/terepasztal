import { readdirSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  FADE_MS,
  FEATHER,
  IRIS_MS,
  LOADING_PICTURES,
  REDUCED_FADE_OUT_MS,
  SKIP_GUARD_MS,
  canSkip,
  clampProgress,
  irisMask,
  irisRadius,
  isPlainKey,
  pickIndex,
  pictureUrl,
  revealDuration,
  revealFrame,
  smootherstep,
} from './loadingMath';

/** 0, 1/n, ... 1 */
const grid = (n: number) => Array.from({ length: n + 1 }, (_, i) => i / n);
const increasing = (xs: number[]) => xs.every((x, i) => i === 0 || x >= xs[i - 1]);

describe('the progress bar', () => {
  it('holds the value to 0..1', () => {
    expect(clampProgress(0, -3)).toBe(0);
    expect(clampProgress(0, 0.4)).toBe(0.4);
    expect(clampProgress(0, 7)).toBe(1);
    expect(clampProgress(0, Infinity)).toBe(1);
    expect(clampProgress(0, -Infinity)).toBe(0);
    // a previous value outside the range is held too
    expect(clampProgress(5, 0.2)).toBe(1);
    expect(clampProgress(-5, 0.2)).toBe(0.2);
  });

  it('never moves backwards, whatever a stage reports', () => {
    expect(clampProgress(0.6, 0.2)).toBe(0.6);
    expect(clampProgress(0.6, NaN)).toBe(0.6);
    expect(clampProgress(0.6, 0.6)).toBe(0.6);
    expect(clampProgress(0.6, 0.9)).toBe(0.9);
    // an out-of-order run of reports: the bar only ever rises, inside 0..1
    const reports = [0.1, 0.5, 0.3, NaN, -1, 0.8, 0.8, 0.2, 2, 0.4];
    const shown: number[] = [];
    let bar = 0;
    for (const r of reports) shown.push((bar = clampProgress(bar, r)));
    expect(increasing(shown)).toBe(true);
    expect(shown.every((v) => v >= 0 && v <= 1)).toBe(true);
    expect(shown.at(-1)).toBe(1);
  });
});

describe('smootherstep', () => {
  it('is 0 at 0 and 1 at 1, and holds the ends outside them', () => {
    expect(smootherstep(0)).toBe(0);
    expect(smootherstep(1)).toBe(1);
    expect(smootherstep(-2)).toBe(0);
    expect(smootherstep(3)).toBe(1);
    expect(smootherstep(NaN)).toBe(0);
  });

  it('is symmetric about the middle and rises monotonically', () => {
    expect(smootherstep(0.5)).toBeCloseTo(0.5, 12);
    for (const t of grid(20)) expect(smootherstep(t) + smootherstep(1 - t)).toBeCloseTo(1, 12);
    expect(increasing(grid(1000).map(smootherstep))).toBe(true);
  });

  it('eases in and out: slower than linear at both ends', () => {
    expect(smootherstep(0.1)).toBeLessThan(0.1);
    expect(smootherstep(0.9)).toBeGreaterThan(0.9);
  });
});

describe('the iris radius', () => {
  const viewports: [number, number][] = [
    [1280, 720],
    [1920, 1080],
    [801, 457],
    [500, 1400],
    [1, 1],
  ];

  it('is 0 at the start and the distance to the far corner at the end', () => {
    for (const [w, h] of viewports) {
      expect(irisRadius(0, w, h)).toBe(0);
      expect(irisRadius(1, w, h)).toBeCloseTo(Math.hypot(w / 2, h / 2), 9);
    }
  });

  it('opens from the exact centre: the radius at the end reaches every corner and no more', () => {
    for (const [w, h] of viewports) {
      const r = irisRadius(1, w, h);
      for (const [x, y] of [
        [0, 0],
        [w, 0],
        [0, h],
        [w, h],
      ])
        expect(Math.hypot(x - w / 2, y - h / 2)).toBeLessThanOrEqual(r + 1e-9);
      // past the end it stays at the far corner
      expect(irisRadius(1.5, w, h)).toBe(r);
    }
  });

  it('grows monotonically with time, and with the size of the viewport', () => {
    for (const [w, h] of viewports)
      expect(increasing(grid(500).map((t) => irisRadius(t, w, h)))).toBe(true);
    expect(irisRadius(0.5, 2000, 1000)).toBeGreaterThan(irisRadius(0.5, 1000, 1000));
    expect(irisRadius(0.5, 1000, 2000)).toBeGreaterThan(irisRadius(0.5, 1000, 1000));
  });

  it('follows smootherstep of the time', () => {
    expect(irisRadius(0.25, 1000, 600) / irisRadius(1, 1000, 600)).toBeCloseTo(
      smootherstep(0.25),
      12,
    );
  });

  it('survives a viewport with no size', () => {
    expect(irisRadius(0.5, 0, 0)).toBe(0);
    expect(irisRadius(0.5, -10, -10)).toBe(0);
  });
});

describe('the iris edge', () => {
  /** [clear radius, solid radius] of the gradient in px */
  const stops = (mask: string) => {
    const px = [...mask.matchAll(/(-?\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
    expect(px).toHaveLength(2);
    return px as [number, number];
  };

  it('is feathered over 10% of the radius, beyond the clear radius', () => {
    expect(FEATHER).toBe(0.1);
    for (const r of [10, 333.33, 1100]) {
      const [clear, solid] = stops(irisMask(r));
      expect(clear).toBeCloseTo(r, 2);
      expect((solid - clear) / r).toBeCloseTo(FEATHER, 2);
    }
  });

  it('is centred on the viewport and hides the black inside the radius', () => {
    const mask = irisMask(100);
    expect(mask).toMatch(/^radial-gradient\(circle at 50% 50%, transparent /);
    expect(mask).toContain('#000');
  });

  it('is shut at radius 0 and never takes a negative radius', () => {
    expect(stops(irisMask(0))).toEqual([0, 0]);
    expect(stops(irisMask(-5))).toEqual([0, 0]);
  });
});

describe('the reveal timeline', () => {
  it('fades to black for 1 s, then opens the iris for 2.5 s', () => {
    expect(FADE_MS).toBe(1000);
    expect(IRIS_MS).toBe(2500);
    expect(revealDuration(false)).toBe(FADE_MS + IRIS_MS);
  });

  it('starts clear, is black when the fade ends and fully open at the end', () => {
    expect(revealFrame(0, false)).toEqual({ phase: 'fade', black: 0, open: 0 });
    expect(revealFrame(FADE_MS, false)).toEqual({ phase: 'open', black: 1, open: 0 });
    expect(revealFrame(FADE_MS + IRIS_MS, false)).toMatchObject({ phase: 'done', open: 1 });
    expect(revealFrame(1e9, false).phase).toBe('done');
  });

  it('keeps the black solid while the iris opens, and the iris only opens after the fade', () => {
    for (let t = 0; t <= revealDuration(false); t += 25) {
      const f = revealFrame(t, false);
      if (f.phase === 'fade') expect(f.open).toBe(0);
      if (f.phase === 'open') expect(f.black).toBe(1);
    }
  });

  it('never goes backwards: the black darkens, then the iris opens, in order', () => {
    const frames = Array.from({ length: 400 }, (_, i) => revealFrame(i * 10, false));
    const rank = { fade: 0, open: 1, done: 2 };
    expect(increasing(frames.map((f) => rank[f.phase]))).toBe(true);
    expect(increasing(frames.map((f) => f.black))).toBe(true);
    expect(increasing(frames.map((f) => f.open))).toBe(true);
  });

  it('reads a time before the start, or no time, as the start', () => {
    expect(revealFrame(-50, false)).toEqual(revealFrame(0, false));
    expect(revealFrame(NaN, true)).toEqual(revealFrame(0, true));
  });

  it('is a plain fade under reduced motion: black fades in, then out, with no iris', () => {
    expect(revealDuration(true)).toBe(FADE_MS + REDUCED_FADE_OUT_MS);
    expect(revealFrame(0, true).black).toBe(0);
    expect(revealFrame(FADE_MS, true)).toEqual({ phase: 'open', black: 1, open: 0 });
    const out = Array.from({ length: REDUCED_FADE_OUT_MS / 10 }, (_, i) =>
      revealFrame(FADE_MS + i * 10, true),
    );
    expect(out.every((f) => f.phase === 'open')).toBe(true);
    expect(increasing(out.map((f) => -f.black))).toBe(true);
    expect(out[0].black).toBe(1);
    expect(out.at(-1)!.black).toBeLessThan(0.01);
    expect(revealFrame(revealDuration(true), true)).toMatchObject({ phase: 'done', black: 0 });
  });
});

describe('skipping', () => {
  it('ignores input for a moment after the reveal starts, so a double click does not skip it', () => {
    expect(canSkip(0)).toBe(false);
    expect(canSkip(SKIP_GUARD_MS - 1)).toBe(false);
    expect(canSkip(SKIP_GUARD_MS)).toBe(true);
    expect(canSkip(5000)).toBe(true);
    // the moment is a fraction of the fade, never the whole of it
    expect(SKIP_GUARD_MS).toBeLessThan(FADE_MS / 2);
  });

  it('counts a key of the player, and leaves modifiers and browser chords alone', () => {
    const key = (
      k: string,
      mods: Partial<Record<'ctrlKey' | 'altKey' | 'metaKey', boolean>> = {},
    ) => isPlainKey({ key: k, ctrlKey: false, altKey: false, metaKey: false, ...mods });
    for (const k of ['a', ' ', 'Enter', 'Escape', 'ArrowLeft', 'F5', '1'])
      expect(key(k)).toBe(true);
    for (const k of ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock']) expect(key(k)).toBe(false);
    expect(key('r', { ctrlKey: true })).toBe(false);
    expect(key('r', { metaKey: true })).toBe(false);
    expect(key('F4', { altKey: true })).toBe(false);
  });
});

describe('the picture pick', () => {
  it('gives every picture an equal share of 0..1, in order', () => {
    const n = LOADING_PICTURES;
    expect(n).toBeGreaterThan(1);
    const picks = Array.from({ length: 3000 }, (_, i) => pickIndex(i / 3000, n));
    expect(increasing(picks)).toBe(true);
    for (let k = 0; k < n; k++) {
      const share = picks.filter((p) => p === k).length / picks.length;
      expect(share).toBeCloseTo(1 / n, 2);
    }
  });

  it('stays inside the range for any number it is given', () => {
    for (const r of [0, 1, 0.999999, -1, 2, NaN, Infinity, -Infinity]) {
      const i = pickIndex(r, LOADING_PICTURES);
      expect(Number.isInteger(i)).toBe(true);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(LOADING_PICTURES);
    }
    expect(pickIndex(1, 3)).toBe(2);
    expect(pickIndex(0, 3)).toBe(0);
    // nothing to pick from: the first slot, never NaN or -1
    expect(pickIndex(0.5, 0)).toBe(0);
  });

  it('is a pure function of the number: the same number picks the same picture', () => {
    for (const r of [0, 0.2, 0.5, 0.99]) expect(pickIndex(r, 3)).toBe(pickIndex(r, 3));
  });

  it('names the file under the base URL of the build', () => {
    expect(pictureUrl('/', 1)).toBe('/assets/loading-1.png');
    expect(pictureUrl('/sub/', 3)).toBe('/sub/assets/loading-3.png');
    expect(pictureUrl('./', 2)).toBe('./assets/loading-2.png');
  });

  it('covers exactly the pictures that ship in public/assets', () => {
    const dir = new URL('../../public/assets/', import.meta.url);
    const shipped = readdirSync(dir)
      .map((f) => /^loading-(\d+)\.png$/.exec(f)?.[1])
      .filter((n): n is string => !!n)
      .map(Number)
      .sort((a, b) => a - b);
    // a picture added or removed by Art is one the pick must know about
    expect(shipped).toEqual(Array.from({ length: LOADING_PICTURES }, (_, i) => i + 1));
  });
});
