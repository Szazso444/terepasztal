import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameLoop, type LoopPhase } from './loop';
import { forAll, shrinkArray, shrinkInt } from '../testing/property';
import type { Rng } from './rng';

// A browser's frame clock, by hand: requestAnimationFrame queues a callback, and `frame(ms)` moves
// the clock on and runs what was queued before it, the way one display frame does.
let queued = new Map<number, FrameRequestCallback>();
let nextId = 1;
let clock = 0;

function resetFrames() {
  queued = new Map();
  nextId = 1;
  clock = 0;
}
function frame(ms: number) {
  clock += ms;
  const due = [...queued.values()];
  queued.clear();
  for (const cb of due) cb(clock);
}

beforeEach(() => {
  resetFrames();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    queued.set(nextId, cb);
    return nextId++;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => queued.delete(id));
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const HZ = 20; // 50 ms steps, the game's SIM_HZ

describe('GameLoop', () => {
  it('a render that throws once: the next frame still updates and renders', () => {
    const boom = new Error('unknown cargo power');
    const errors: [unknown, LoopPhase][] = [];
    let updates = 0;
    let renders = 0;
    const loop = new GameLoop(
      HZ,
      () => updates++,
      () => {
        if (++renders === 1) throw boom;
      },
      (err, phase) => errors.push([err, phase]),
    );
    loop.start();
    frame(50);
    expect([updates, renders]).toEqual([1, 1]);
    expect(errors).toEqual([[boom, 'render']]);
    frame(50);
    expect([updates, renders]).toEqual([2, 2]);
    expect(errors).toHaveLength(1);
    expect(queued.size).toBe(1);
  });

  it('keeps the schedule of a loop that never throws, whichever calls throw', () => {
    // Twin loops on the same frames: one whose callbacks never throw, one whose chosen calls do.
    // The throwing one must make the same calls with the same arguments, report exactly the calls
    // that threw, in order, and keep running.
    forAll(
      genCase,
      (c) => {
        resetFrames();
        const clean = record(c.hz, new Set(), new Set());
        const faulty = record(c.hz, new Set(c.badUpdates), new Set(c.badRenders));
        clean.loop.start();
        faulty.loop.start();
        for (const ms of c.frames) frame(ms);
        expect(faulty.calls).toEqual(clean.calls);
        expect(faulty.loop.fps).toBe(clean.loop.fps);
        const bad = (call: Call) =>
          (call[0] === 'update' ? c.badUpdates : c.badRenders).includes(call[1]);
        expect(faulty.errors).toEqual(
          clean.calls.filter(bad).map(([phase, i]) => `${phase} ${i} threw (${phase})`),
        );
        expect(clean.errors).toEqual([]);
        expect(queued.size).toBe(2);
      },
      { shrink: shrinkCase },
    );
  });

  it('stop() inside a frame that throws ends the loop', () => {
    const errors: unknown[] = [];
    let renders = 0;
    const loop: GameLoop = new GameLoop(
      HZ,
      () => {},
      () => {
        renders++;
        loop.stop();
        throw new Error('stopped, then threw');
      },
      (err) => errors.push(err),
    );
    loop.start();
    frame(50);
    frame(50);
    expect(renders).toBe(1);
    expect(errors).toHaveLength(1);
    expect(queued.size).toBe(0);
  });

  it('an onError that throws still leaves the next frame scheduled', () => {
    let renders = 0;
    const loop = new GameLoop(
      HZ,
      () => {},
      () => {
        if (++renders === 1) throw new Error('render');
      },
      () => {
        throw new Error('the handler broke too');
      },
    );
    loop.start();
    expect(() => frame(50)).toThrow('the handler broke too');
    expect(queued.size).toBe(1);
    frame(50);
    expect(renders).toBe(2);
  });

  it('a first frame stamped before start() does not hold the updates back', () => {
    // headless Chromium: the first frame's stamp came about 7.6 s before start()'s clock read
    vi.spyOn(performance, 'now').mockReturnValueOnce(7600);
    let updates = 0;
    const renders: [number, number][] = [];
    const loop = new GameLoop(
      HZ,
      () => updates++,
      (alpha, dt) => renders.push([alpha, dt]),
    );
    loop.start();
    frame(0);
    frame(50);
    expect(updates).toBe(1);
    expect(renders).toEqual([
      [0, 0],
      [0, 0.05],
    ]);
  });

  it('a frame stamped before the one before it counts as no time passing', () => {
    // Twin runs: one on frames some of which are stamped earlier than the frame before (the first
    // one earlier than start()), one on the same frames with each of those gaps made zero. They
    // must make the same calls, and no render may see negative time or a negative alpha.
    forAll(
      (rng) => ({
        hz: rng.pick([HZ, 60]),
        frames: Array.from({ length: rng.int(1, 30) }, () =>
          rng.chance(0.3) ? -rng.int(1, 10_000) : rng.int(0, 300),
        ),
      }),
      ({ hz, frames }) => {
        const calls = run(hz, frames);
        expect(calls).toEqual(
          run(
            hz,
            frames.map((ms) => Math.max(0, ms)),
          ),
        );
        for (const [phase, , alpha, dt] of calls)
          if (phase === 'render') expect(Math.min(alpha, dt)).toBeGreaterThanOrEqual(0);
      },
      {
        shrink: function* (c) {
          for (const frames of shrinkArray(c.frames, (ms) => shrinkInt(ms)))
            if (frames.length) yield { ...c, frames };
        },
      },
    );
  });

  it('with no onError, an error goes to console.error and the loop carries on', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const boom = new Error('update');
    let updates = 0;
    let renders = 0;
    const loop = new GameLoop(
      HZ,
      () => {
        if (++updates === 1) throw boom;
      },
      () => renders++,
    );
    loop.start();
    frame(50);
    frame(50);
    expect(logged).toHaveBeenCalledTimes(1);
    expect(logged).toHaveBeenCalledWith(boom);
    expect([updates, renders]).toEqual([2, 2]);
  });
});

/** One loop callback call: its phase, its index among that phase's calls, its arguments. */
type Call = [LoopPhase, number, ...number[]];

interface Case {
  /** loop rate: at 20 Hz no frame reaches the 10-step cap, at 60 Hz a gap of about 167 ms does */
  hz: number;
  /** ms between frames; a gap over 250 is clamped to it */
  frames: number[];
  /** indices of the update calls that throw */
  badUpdates: number[];
  /** indices of the render calls that throw */
  badRenders: number[];
}

function genCase(rng: Rng): Case {
  const frames = Array.from({ length: rng.int(1, 30) }, () =>
    rng.chance(0.2) ? rng.pick([0, 1, 49, 50, 51, 250, 251, 600]) : rng.int(0, 300),
  );
  // as many calls as the frames can make (30 frames of at most 10 steps), so any call may throw
  const chosen = (p: number) =>
    Array.from({ length: 300 }, (_, i) => i).filter(() => rng.chance(p));
  const hz = rng.pick([HZ, 60]);
  return { hz, frames, badUpdates: chosen(rng.next()), badRenders: chosen(rng.next()) };
}

function* shrinkCase(c: Case): Iterable<Case> {
  for (const frames of shrinkArray(c.frames, (ms) => shrinkInt(ms)))
    if (frames.length) yield { ...c, frames };
  for (const badUpdates of shrinkArray(c.badUpdates)) yield { ...c, badUpdates };
  for (const badRenders of shrinkArray(c.badRenders)) yield { ...c, badRenders };
}

/** The calls of a loop that never throws, started on a fresh clock and run over `frames`. */
function run(hz: number, frames: number[]): Call[] {
  resetFrames();
  const { loop, calls } = record(hz, new Set(), new Set());
  loop.start();
  for (const ms of frames) frame(ms);
  loop.stop();
  return calls;
}

/** A loop that logs each call and throws on the chosen ones, with its onError log. */
function record(hz: number, badUpdates: Set<number>, badRenders: Set<number>) {
  const calls: Call[] = [];
  const errors: string[] = [];
  let u = 0;
  let r = 0;
  const loop = new GameLoop(
    hz,
    (dt) => {
      const i = u++;
      calls.push(['update', i, dt]);
      if (badUpdates.has(i)) throw new Error(`update ${i} threw`);
    },
    (alpha, dt) => {
      const i = r++;
      calls.push(['render', i, alpha, dt]);
      if (badRenders.has(i)) throw new Error(`render ${i} threw`);
    },
    (err, phase) => errors.push(`${(err as Error).message} (${phase})`),
  );
  return { loop, calls, errors };
}
