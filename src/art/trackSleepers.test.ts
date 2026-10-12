/**
 * Track sleepers keep one spacing across tile joins (#405). The layout rule is a pure function of
 * a run's length and its class's nominal step; these tests check the rule itself, then the real
 * rail lines of every piece of every class (`tilePaths`, `unitRailPaths`: the lines the atlas
 * generator draws), and the gap across the join of any two pieces that can sit next to each other.
 */
import { describe, expect, it } from 'vitest';
import { forAll } from '../testing/property';
import {
  CLASS_N,
  TRACK_CLASSES,
  TRACK_ITEMS,
  isUnitKind,
  itemKey,
  rotationCount,
  type TrackClass,
} from '../world/track';
import { unitIconPaths, unitRailPaths, type SwitchForm } from '../world/trackGeom';
import {
  railSleepers,
  sleeperLayout,
  sleeperPositions,
  sleeperStep,
  tilePaths,
  type RailPath,
} from './trackIllustrated';

const EPS = 1e-9;

/** Lengths in tiles that a run of track takes: whole tiles, diagonals, quarter circles. */
const LENGTHS: Record<string, number> = {
  'one tile': 1,
  'two tiles': 2,
  'tile diagonal': Math.SQRT2,
  'half a tile diagonal': Math.SQRT2 / 2,
  'diagonal of a 2x2 block': 2 * Math.SQRT2,
  'edge midpoint to far corner': Math.sqrt(5) / 2,
  'quarter circle, radius 0.5': (Math.PI / 2) * 0.5,
  'quarter circle, radius 1.5': (Math.PI / 2) * 1.5,
};
/** Every class's step, and the step of a small icon of a 2x2 piece (scale 1/2). */
const STEPS: Record<string, number> = {
  ...Object.fromEntries(TRACK_CLASSES.map((cls) => [`${cls} step`, sleeperStep(cls)])),
  'icon of a 2x2 piece': sleeperStep('regular', 1 / 2),
};

/**
 * The sleepers of one run of track: its class, its length and the distance of each sleeper along
 * it. A run is a rail line as a whole, so the transition's two drawn halves are one run.
 */
interface Run {
  name: string;
  cls: TrackClass;
  step: number;
  length: number;
  at: number[];
}

const polylineLength = (points: { x: number; y: number }[]) => {
  let sum = 0;
  for (let i = 1; i < points.length; i++)
    sum += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return sum;
};

/** The runs of one frame's rail lines; parts of one run are merged in distance order. */
function runsOf(name: string, paths: RailPath[], scale = 1): Run[] {
  const runs: Run[] = [];
  for (const path of paths) {
    const start = path.run?.start ?? 0;
    const at = railSleepers(path, scale).map((d) => d + start);
    const length = path.run?.length ?? polylineLength(path.points);
    const last = runs[runs.length - 1];
    if (path.run && path.run.start > 0 && last) {
      last.at.push(...at);
      continue;
    }
    runs.push({
      name,
      cls: path.run?.cls ?? path.cls,
      step: sleeperStep(path.run?.cls ?? path.cls, scale),
      length,
      at,
    });
  }
  return runs;
}

/** Every rail line the track generator draws: each piece, class and rotation, unit icons too. */
function everyRun(): Run[] {
  const runs: Run[] = [];
  for (const it of TRACK_ITEMS)
    for (let rotation = 0; rotation < rotationCount(it.kind); rotation++) {
      const name = `${itemKey(it)}_${rotation}`;
      if (isUnitKind(it.kind, it.cls)) {
        const kind = it.kind as 'curve' | 'switch';
        const n = CLASS_N[it.cls];
        const forms: SwitchForm[] = kind === 'switch' ? ['turn', 'parallel'] : ['turn'];
        for (const form of forms) {
          const road = unitRailPaths(kind, n, rotation, form).map((points) => ({
            points,
            cls: it.cls,
          }));
          runs.push(...runsOf(`${name} ${form}`, road));
        }
        const icon = unitIconPaths(kind, n, rotation).map((points) => ({ points, cls: it.cls }));
        runs.push(...runsOf(`${name} icon`, icon, 1 / n));
      } else runs.push(...runsOf(name, tilePaths(it, rotation)));
    }
  return runs;
}

/** The layout rule, checked on the positions of one run. */
function expectEven(at: number[], length: number, step: number) {
  const count = Math.max(1, Math.round(length / step));
  const pitch = length / count;
  expect(at).toHaveLength(count);
  expect(at[0]).toBeCloseTo(pitch / 2, 9);
  expect(length - at[at.length - 1]).toBeCloseTo(pitch / 2, 9);
  for (let i = 1; i < at.length; i++) expect(at[i] - at[i - 1]).toBeCloseTo(pitch, 9);
  // a pitch never strays from the nominal step by more than half a step spread over the run
  expect(Math.abs(pitch - step)).toBeLessThanOrEqual(step / (2 * count) + EPS);
}

describe('sleeperLayout', () => {
  for (const [lengthName, length] of Object.entries(LENGTHS))
    for (const [stepName, step] of Object.entries(STEPS))
      it(`holds a whole number of pitches on ${lengthName}, ${stepName}`, () => {
        const { count, pitch, first } = sleeperLayout(length, step);
        expect(Number.isInteger(count)).toBe(true);
        expect(count * pitch).toBeCloseTo(length, 9);
        expect(first).toBeCloseTo(pitch / 2, 12);
        expectEven(sleeperPositions(length, step), length, step);
      });

  it('leaves exactly one pitch across a join of two runs of the same pitch', () => {
    // the leftover after the last sleeper plus the first sleeper's offset on the next run
    for (const step of Object.values(STEPS)) {
      const at = sleeperPositions(1, step);
      const { pitch } = sleeperLayout(1, step);
      expect(1 - at[at.length - 1] + at[0]).toBeCloseTo(pitch, 12);
    }
  });

  it('puts the narrow gauge straight on 9 sleepers a tile, not 8.7', () => {
    expect(sleeperLayout(1, sleeperStep('narrow')).count).toBe(9);
    expect(sleeperLayout(1, sleeperStep('regular')).count).toBe(7);
  });

  it('keeps a run shorter than half a step to one sleeper, and an empty run to none', () => {
    expect(sleeperPositions(0.01, 0.14)).toEqual([0.005]);
    expect(sleeperPositions(0, 0.14)).toEqual([]);
    expect(sleeperPositions(-1, 0.14)).toEqual([]);
  });

  it('is the same for any random run longer than a step', () => {
    forAll(
      (rng) => {
        const step = rng.range(0.05, 0.3);
        return { step, length: step + rng.range(0, 8) };
      },
      ({ step, length }) => {
        expectEven(sleeperPositions(length, step), length, step);
      },
      {
        // a smaller run, then a smaller step: the simplest failing layout is found first
        shrink: ({ step, length }) => [
          { step, length: step + (length - step) / 2 },
          { step: step * 0.9, length },
        ],
      },
    );
  });
});

describe('the sleepers of every track piece', () => {
  const runs = everyRun();

  it('covers every piece, class and rotation', () => {
    expect(runs.length).toBeGreaterThanOrEqual(TRACK_ITEMS.length);
    for (const cls of TRACK_CLASSES) expect(runs.some((r) => r.cls === cls)).toBe(true);
  });

  it('are evenly spaced along each rail line, half a pitch in from both ends', () => {
    for (const run of runs) {
      try {
        expectEven(run.at, run.length, run.step);
      } catch (error) {
        throw new Error(`${run.name}: ${String(error)}`, { cause: error });
      }
    }
  });

  it('lay the transition as one run over both halves, with no tight pair in the middle', () => {
    const it = TRACK_ITEMS.find((i) => i.kind === 'transition')!;
    for (let rotation = 0; rotation < rotationCount('transition'); rotation++) {
      const paths = tilePaths(it, rotation);
      expect(paths.map((p) => p.cls)).toEqual(['regular', 'high_speed']);
      const [run] = runsOf('transition', paths);
      const whole = sleeperPositions(run.length, sleeperStep('regular'));
      // every sleeper of the run is drawn once, on the half it falls on
      expect(run.at).toHaveLength(whole.length);
      run.at.forEach((d, i) => expect(d).toBeCloseTo(whole[i], 9));
      const { pitch } = sleeperLayout(run.length, sleeperStep('regular'));
      for (let i = 1; i < run.at.length; i++)
        expect(run.at[i] - run.at[i - 1]).toBeGreaterThan(pitch * 0.95);
      // each half holds the sleepers that lie on it, in its own distances
      const half = polylineLength(paths[0].points);
      const parts = paths.map((p) => railSleepers(p));
      expect(parts[0].every((d) => d < half)).toBe(true);
      expect(parts[1].every((d) => d >= 0 && d <= polylineLength(paths[1].points) + EPS)).toBe(
        true,
      );
      expect(parts[0].length + parts[1].length).toBe(whole.length);
      // across the seam the two halves leave exactly one pitch, as inside either of them
      expect(half - parts[0][parts[0].length - 1] + parts[1][0]).toBeCloseTo(pitch, 9);
    }
  });

  it('take the spacing of the run, not of the class a part of it is drawn in', () => {
    const it = TRACK_ITEMS.find((i) => i.kind === 'transition')!;
    const paths = tilePaths(it, 0);
    const length = paths[0].run!.length;
    for (const path of paths) expect(path.run?.length).toBe(length);
    expect(paths[0].run?.cls).toBe(paths[1].run?.cls);
  });
});

describe('the join of two track pieces', () => {
  const runs = everyRun();
  /** Regular and high speed join through a transition; narrow joins only narrow. */
  const gauge = (cls: TrackClass) => (cls === 'narrow' ? 'narrow' : 'wide');

  it('leaves one pitch between the sleepers either side, within 5%, for any two pieces of a gauge', () => {
    for (const g of ['narrow', 'wide']) {
      const ends = runs
        .filter((r) => gauge(r.cls) === g && !r.name.endsWith('icon'))
        .map((r) => ({
          name: r.name,
          pitch: r.length / r.at.length,
          head: r.at[0],
          tail: r.length - r.at[r.at.length - 1],
        }));
      expect(ends.length).toBeGreaterThan(10);
      for (const a of ends)
        for (const b of ends) {
          const gap = a.tail + b.head;
          expect(Math.abs(gap / a.pitch - 1), `${a.name} to ${b.name}`).toBeLessThan(0.05);
          expect(Math.abs(gap / b.pitch - 1), `${b.name} from ${a.name}`).toBeLessThan(0.05);
        }
    }
  });

  it('keeps one pitch along a line of straights, whichever the class', () => {
    for (const cls of TRACK_CLASSES) {
      const it = TRACK_ITEMS.find((i) => i.kind === 'straight' && i.cls === cls)!;
      const [run] = runsOf(cls, tilePaths(it, 0));
      const pitch = run.length / run.at.length;
      const line = [0, 1, 2, 3].flatMap((tile) => run.at.map((d) => tile * run.length + d));
      for (let i = 1; i < line.length; i++)
        expect(line[i] - line[i - 1], `${cls} sleeper ${i}`).toBeCloseTo(pitch, 9);
    }
  });

  it('keeps the narrow gauge straight and curve within 1% of each other', () => {
    const narrow = (kind: string) => {
      const it = TRACK_ITEMS.find((i) => i.kind === kind && i.cls === 'narrow')!;
      const [run] = runsOf(kind, tilePaths(it, 0));
      return { run, pitch: run.length / run.at.length };
    };
    const straight = narrow('straight'),
      curve = narrow('curve');
    const gap = (a: typeof straight, b: typeof straight) =>
      a.run.length - a.run.at[a.run.at.length - 1] + b.run.at[0];
    expect(gap(straight, curve) / straight.pitch).toBeCloseTo(1, 1);
    expect(Math.abs(gap(curve, straight) / curve.pitch - 1)).toBeLessThan(0.01);
    expect(Math.abs(gap(curve, straight) / straight.pitch - 1)).toBeLessThan(0.01);
  });
});
