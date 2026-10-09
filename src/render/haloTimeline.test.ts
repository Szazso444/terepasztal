import { describe, expect, it } from 'vitest';
import { forAll } from '../testing/property';
import { HALO_SECONDS, SPARKS, haloAt, type HaloFrame } from './haloTimeline';

/** The halo sampled every millisecond from its start up to, not including, its end. */
const STEPS = 1600;
const samples = Array.from({ length: STEPS }, (_, i) => {
  const t = (i * HALO_SECONDS) / STEPS;
  return { t, f: haloAt(t) };
});

function dark(f: HaloFrame) {
  return f.ring.alpha === 0 && f.beam.alpha === 0 && f.sparks.every((s) => s.alpha === 0);
}

/** The sample where `value` is highest (the first of equals). */
function peak(value: (f: HaloFrame) => number) {
  return samples.reduce((best, s) => (value(s.f) > value(best.f) ? s : best));
}

describe('halo timeline', () => {
  it('shows nothing at the start and nothing once it is done', () => {
    const start = haloAt(0);
    expect(dark(start)).toBe(true);
    expect(start.done).toBe(false);
    for (const t of [HALO_SECONDS, HALO_SECONDS + 0.001, 2, 10, 1e6]) {
      const f = haloAt(t);
      expect(f.done, `t ${t}`).toBe(true);
      expect(dark(f), `t ${t}`).toBe(true);
    }
    // it plays in between
    expect(samples.every((s) => !s.f.done)).toBe(true);
    expect(samples.some((s) => !dark(s.f))).toBe(true);
    // and everything has faded out by its last moment rather than being cut off at the end
    const last = haloAt(HALO_SECONDS - 0.001);
    const lights = [last.ring.alpha, last.beam.alpha, ...last.sparks.map((s) => s.alpha)];
    for (const a of lights) expect(a).toBeLessThan(0.01);
  });

  it('starts the ring on the ground and only ever raises it', () => {
    expect(haloAt(0).ring.rise).toBe(0);
    const lit = samples.find((s) => s.f.ring.alpha > 0)!;
    expect(lit.f.ring.rise).toBeLessThan(0.01);
    for (let i = 1; i < STEPS; i++)
      expect(samples[i].f.ring.rise, `t ${samples[i].t}`).toBeGreaterThanOrEqual(
        samples[i - 1].f.ring.rise,
      );
    expect(samples[STEPS - 1].f.ring.rise).toBeGreaterThan(0.5);
  });

  it('brings the ring to full light in the first half and fades it to nothing at the end', () => {
    const top = peak((f) => f.ring.alpha);
    expect(top.f.ring.alpha).toBeGreaterThan(0.5);
    expect(top.t).toBeLessThan(HALO_SECONDS / 2);
    for (const s of samples.filter((q) => q.t > top.t))
      expect(s.f.ring.alpha, `t ${s.t}`).toBeLessThanOrEqual(top.f.ring.alpha);
    // it fades out rather than being cut off when the halo ends
    expect(haloAt(HALO_SECONDS - 0.001).ring.alpha).toBeLessThan(0.01);
  });

  it('makes the beam brightest when the ring is half way up', () => {
    const top = Math.max(...samples.map((s) => s.f.ring.rise));
    const brightest = peak((f) => f.beam.alpha);
    expect(brightest.f.beam.alpha).toBeGreaterThan(0);
    expect(Math.abs(brightest.f.ring.rise - top / 2)).toBeLessThanOrEqual(top * 0.05);
  });

  it('starts every spark inside the footprint and ends it above where it started', () => {
    for (let i = 0; i < SPARKS; i++) {
      const lit = samples.filter((s) => s.f.sparks[i].alpha > 0).map((s) => s.f.sparks[i]);
      expect(lit.length, `spark ${i} never shows`).toBeGreaterThan(0);
      const first = lit[0];
      const last = lit[lit.length - 1];
      // the footprint's diamond on screen: half-diagonals of 1/2 and 1/4 of its width
      expect(Math.abs(first.x) * 2 + Math.abs(first.y) * 4, `spark ${i}`).toBeLessThanOrEqual(1);
      expect(last.y, `spark ${i}`).toBeLessThan(first.y);
    }
    expect(samples.every((s) => s.f.sparks.length === SPARKS)).toBe(true);
  });

  it('gives the same frame for the same t, whatever came before', () => {
    forAll(
      (rng) => ({ t: rng.range(-0.5, HALO_SECONDS + 0.5), other: rng.range(-0.5, 2) }),
      ({ t, other }) => {
        const a = haloAt(t);
        haloAt(other);
        const b = haloAt(t);
        expect(b).toEqual(a);
        // a frame is the caller's own: changing it changes no later frame
        b.ring.rise = 99;
        b.sparks[0].alpha = 99;
        expect(haloAt(t)).toEqual(a);
      },
    );
  });
});
