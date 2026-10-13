import { describe, expect, it } from 'vitest';
import {
  BOOT_STAGES,
  BootProgress,
  STAGE_WEIGHTS,
  bootPlan,
  groundFraction,
  type BootFlags,
  type BootPlan,
  type BootStage,
} from './boot';
import type { Intent } from '../intent';
import { forAll, shrinkArray } from '../testing/property';
import type { Rng } from './rng';

type Weights = Record<BootStage, number>;
type Report = [BootStage, number];

/** Any positive shares for the stages. */
function weights(rng: Rng): Weights {
  const w = {} as Weights;
  for (const stage of BOOT_STAGES) w[stage] = rng.range(0.01, 1);
  return w;
}

/** A fraction as a stage may report it: mostly in 0..1, sometimes 1, above 1, below 0 or NaN. */
function fraction(rng: Rng): number {
  const r = rng.next();
  if (r < 0.05) return Number.NaN;
  if (r < 0.1) return -rng.next();
  if (r < 0.15) return 1 + rng.next();
  if (r < 0.25) return 1;
  return rng.next();
}

/** Reports from the stages in any order, as many as a boot might make. */
function reports(rng: Rng): Report[] {
  return Array.from({ length: rng.int(0, 40) }, (): Report => [
    rng.pick(BOOT_STAGES),
    fraction(rng),
  ]);
}

const shrinkReports = (c: { w: Weights; rs: Report[] }) =>
  [...shrinkArray(c.rs)].map((rs) => ({ w: c.w, rs }));

describe('BootProgress', () => {
  it('never goes back and stays within 0..1, whatever the stages report', () => {
    forAll(
      (rng) => ({ w: weights(rng), rs: reports(rng) }),
      ({ w, rs }) => {
        const p = new BootProgress(w);
        let last = p.total;
        expect(last).toBe(0);
        for (const [stage, f] of rs) {
          const total = p.report(stage, f);
          expect(total).toBe(p.total);
          expect(total).toBeGreaterThanOrEqual(last);
          expect(total).toBeLessThanOrEqual(1);
          last = total;
        }
      },
      { shrink: shrinkReports },
    );
  });

  it('reaches 1 exactly when every stage has reported its end, and not before', () => {
    forAll(
      (rng) => ({ w: weights(rng), rs: reports(rng), ends: rng.shuffle([...BOOT_STAGES]) }),
      ({ w, rs, ends }) => {
        const p = new BootProgress(w);
        const complete = new Set<BootStage>();
        for (const [stage, f] of [...rs, ...ends.map((s): Report => [s, 1])]) {
          if (f >= 1) complete.add(stage);
          const total = p.report(stage, f);
          if (complete.size === BOOT_STAGES.length) expect(total).toBe(1);
          else expect(total).toBeLessThan(1);
        }
        expect(p.total).toBe(1);
      },
    );
  });

  it('weights each stage as declared', () => {
    forAll(
      (rng) => ({ w: weights(rng), f: BOOT_STAGES.map(() => rng.next()) }),
      ({ w, f }) => {
        const p = new BootProgress(w);
        BOOT_STAGES.forEach((stage, i) => p.report(stage, f[i]));
        const all = BOOT_STAGES.reduce((sum, s) => sum + w[s], 0);
        const want = BOOT_STAGES.reduce((sum, s, i) => sum + w[s] * f[i], 0) / all;
        expect(p.total).toBeCloseTo(want, 12);
        // and one stage alone, done, is its own share of the bar
        for (const stage of BOOT_STAGES) {
          const one = new BootProgress(w);
          expect(one.report(stage, 1)).toBeCloseTo(w[stage] / all, 12);
        }
      },
    );
  });

  it('declares a share above 0 for every stage, so each one moves the bar', () => {
    for (const stage of BOOT_STAGES) expect(STAGE_WEIGHTS[stage]).toBeGreaterThan(0);
    // the default progress is weighted by the declared shares
    const all = BOOT_STAGES.reduce((sum, s) => sum + STAGE_WEIGHTS[s], 0);
    for (const stage of BOOT_STAGES)
      expect(new BootProgress().report(stage, 1)).toBeCloseTo(STAGE_WEIGHTS[stage] / all, 12);
  });
});

describe('groundFraction', () => {
  it('is the share of the chunks in view that are painted, and a view with none is painted', () => {
    expect(groundFraction({ done: 0, total: 0 })).toBe(1);
    expect(groundFraction({ done: 0, total: 4 })).toBe(0);
    expect(groundFraction({ done: 3, total: 4 })).toBe(0.75);
    expect(groundFraction({ done: 4, total: 4 })).toBe(1);
  });
});

describe('bootPlan', () => {
  const INTO_PLAY: BootPlan = { loading: true, reveal: true, clickToBegin: true };
  const TITLE: BootPlan = { loading: true, reveal: false, clickToBegin: false };
  const NONE: BootPlan = { loading: false, reveal: false, clickToBegin: false };

  /** Every way the boot is started, with what it shows. */
  const ROUTES: [string, Intent | null, BootFlags, BootPlan][] = [
    ['the first page load', null, {}, TITLE],
    ['the title, from the editor or a play test', { action: 'menu' }, {}, TITLE],
    ['New game', { action: 'new', seed: 42 }, {}, INTO_PLAY],
    ['New game in the Full chain', { action: 'new', seed: 42, supply: 'full' }, {}, INTO_PLAY],
    ['Play level', { action: 'play', levelId: 'l1' }, {}, INTO_PLAY],
    ['the continue intent', { action: 'continue' }, {}, INTO_PLAY],
    ['Continue at boot', null, { continueFromTitle: true }, INTO_PLAY],
    [
      'Continue at boot, on the title from the editor',
      { action: 'menu' },
      { continueFromTitle: true },
      INTO_PLAY,
    ],
    // `Game.loadSlot` (and Load, and an imported save) reload into the stored game with this one
    ['a save slot', { action: 'continue' }, {}, INTO_PLAY],
    // `Game.buyChunk` grows the world and reloads into it at the speed it ran
    ['the growth reload', { action: 'continue', keepSpeed: true }, {}, INTO_PLAY],
    ['the dev reload', null, { devReload: true }, NONE],
    ['the editor on a level', { action: 'edit', levelId: 'l1' }, {}, NONE],
    [
      'the editor on a new level',
      { action: 'edit', levelId: null, blank: true, size: 64, seed: 3 },
      {},
      NONE,
    ],
    ['the editor play test', { action: 'play', levelId: 'l1', testing: true }, {}, NONE],
  ];

  it.each(ROUTES)('%s', (_, intent, flags, want) => {
    expect(bootPlan(intent, flags)).toEqual(want);
  });

  const INTENTS = [null, ...ROUTES.map(([, intent]) => intent)];
  const FLAGS: BootFlags[] = [
    {},
    { devReload: true },
    { continueFromTitle: true },
    { devReload: true, continueFromTitle: true },
  ];

  it('shows nothing on a dev reload, whatever the intent', () => {
    for (const intent of INTENTS)
      for (const continueFromTitle of [false, true])
        expect(bootPlan(intent, { devReload: true, continueFromTitle })).toEqual(NONE);
  });

  it('asks for the click wherever the reveal plays, and reveals only what it loaded', () => {
    for (const intent of INTENTS)
      for (const flags of FLAGS) {
        const plan = bootPlan(intent, flags);
        expect(plan.clickToBegin).toBe(plan.reveal);
        if (plan.reveal) expect(plan.loading).toBe(true);
      }
  });

  it('hands out a plan of its own each time', () => {
    const a = bootPlan(null);
    a.loading = false;
    expect(bootPlan(null)).toEqual(TITLE);
  });
});
