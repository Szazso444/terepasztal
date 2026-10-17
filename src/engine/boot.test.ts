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
import { forAll, shrinkArray, shrinkInt } from '../testing/property';
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

  it("is each stage's best report, held to 0..1, weighted as declared, whatever the order", () => {
    forAll(
      (rng) => ({ w: weights(rng), rs: reports(rng) }),
      ({ w, rs }) => {
        const p = new BootProgress(w);
        for (const [stage, f] of rs) p.report(stage, f);
        // the slow obvious sum over the whole history: a stage counts at the most it reported,
        // a value above 1 as 1, and NaN or anything below 0 as nothing
        let all = 0;
        let done = 0;
        for (const stage of BOOT_STAGES) {
          const best = rs
            .filter(([s, f]) => s === stage && f > 0)
            .reduce((most, [, f]) => Math.max(most, Math.min(1, f)), 0);
          all += w[stage];
          done += w[stage] * best;
        }
        expect(p.total).toBeCloseTo(done / all, 12);
      },
      { shrink: shrinkReports },
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

  it('stays within 0..1, is 1 exactly when every chunk in view is painted, and never goes back', () => {
    type View = { done: number; total: number };
    forAll(
      (rng): View => {
        const total = rng.int(0, 64);
        // a count the landscape should not give, more painted than in view, now and then
        return { done: rng.int(0, total + (rng.chance(0.2) ? 8 : 0)), total };
      },
      ({ done, total }) => {
        const f = groundFraction({ done, total });
        expect(f).toBeGreaterThanOrEqual(0);
        expect(f).toBeLessThanOrEqual(1);
        expect(f === 1).toBe(done >= total);
        if (done <= total && total > 0) expect(f).toBe(done / total);
        // one more chunk painted never takes the bar back
        expect(groundFraction({ done: done + 1, total })).toBeGreaterThanOrEqual(f);
      },
      {
        *shrink({ done, total }: View): Iterable<View> {
          for (const t of shrinkInt(total)) yield { done: Math.min(done, t + 8), total: t };
          for (const d of shrinkInt(done)) yield { done: d, total };
        },
      },
    );
  });
});

describe('bootPlan', () => {
  /** into play where the player clicked on the way: the music starts as loading finishes */
  const INTO_PLAY: BootPlan = { loading: true, reveal: true, clickToBegin: true, music: 'loaded' };
  /** into play on a page opened afresh: the music starts at "Click to begin" */
  const AFRESH: BootPlan = { loading: true, reveal: true, clickToBegin: true, music: 'click' };
  const TITLE: BootPlan = { loading: true, reveal: false, clickToBegin: false, music: null };
  const NONE: BootPlan = { loading: false, reveal: false, clickToBegin: false, music: null };

  /**
   * Every way the boot is started, with what it shows. The flags are what `main.ts` knows: a page
   * that no menu reloaded into (no stored intent) is opened afresh.
   */
  const ROUTES: [string, Intent | null, BootFlags, BootPlan][] = [
    ['the first page load', null, { fresh: true }, TITLE],
    ['the title, from the editor or a play test', { action: 'menu' }, {}, TITLE],
    ['New game', { action: 'new', seed: 42 }, {}, INTO_PLAY],
    ['New game in the Full chain', { action: 'new', seed: 42, supply: 'full' }, {}, INTO_PLAY],
    ['New game from an old #seed=…&new link', { action: 'new', seed: 42 }, { fresh: true }, AFRESH],
    ['Play level', { action: 'play', levelId: 'l1' }, {}, INTO_PLAY],
    ['the continue intent', { action: 'continue' }, {}, INTO_PLAY],
    ['Continue at boot', null, { continueFromTitle: true }, INTO_PLAY],
    [
      'Continue at boot, on the title of the first page load',
      null,
      { continueFromTitle: true, fresh: true },
      INTO_PLAY,
    ],
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
    ['the dev reload', null, { devReload: true, fresh: true }, NONE],
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
  /** Every combination of the flags. */
  const FLAGS: BootFlags[] = [false, true].flatMap((devReload) =>
    [false, true].flatMap((continueFromTitle) =>
      [false, true].map((fresh) => ({ devReload, continueFromTitle, fresh })),
    ),
  );

  it('shows nothing on a dev reload, whatever the intent', () => {
    for (const intent of INTENTS)
      for (const flags of FLAGS)
        expect(bootPlan(intent, { ...flags, devReload: true })).toEqual(NONE);
  });

  it('asks for the click wherever the reveal plays, and reveals only what it loaded', () => {
    for (const intent of INTENTS)
      for (const flags of FLAGS) {
        const plan = bootPlan(intent, flags);
        expect(plan.clickToBegin).toBe(plan.reveal);
        if (plan.reveal) expect(plan.loading).toBe(true);
      }
  });

  it('starts the music wherever it reveals, at the click only where nothing was clicked before', () => {
    for (const intent of INTENTS)
      for (const flags of FLAGS) {
        const plan = bootPlan(intent, flags);
        expect(plan.music !== null).toBe(plan.reveal);
        if (!plan.reveal) continue;
        // a menu of the page before, or the title's Continue on this one, was a click
        const clicked = !flags.fresh || !!flags.continueFromTitle;
        expect(plan.music).toBe(clicked ? 'loaded' : 'click');
        // the music that waits for the click is never left without one
        if (plan.music === 'click') expect(plan.clickToBegin).toBe(true);
      }
  });

  it('hands out a plan of its own each time', () => {
    const a = bootPlan(null);
    a.loading = false;
    expect(bootPlan(null)).toEqual(TITLE);
  });
});
