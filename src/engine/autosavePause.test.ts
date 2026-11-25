import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutosavePause, type SaveKind } from './autosavePause';
import { GameLoop, type LoopPhase } from './loop';
import { forAll, shrinkArray, shrinkInt } from '../testing/property';
import type { Rng } from './rng';

describe('AutosavePause', () => {
  it('allows every write before an error', () => {
    const pause = new AutosavePause();
    expect(pause.paused).toBe(false);
    expect(pause.allows('implicit')).toBe(true);
    expect(pause.allows('manual')).toBe(true);
  });

  it('refuses implicit writes from the first error on, and never a manual save', () => {
    const pause = new AutosavePause();
    pause.trip();
    expect(pause.paused).toBe(true);
    expect(pause.allows('implicit')).toBe(false);
    expect(pause.allows('manual')).toBe(true);
    // a manual save and a repeated error lift nothing
    pause.trip();
    expect(pause.allows('implicit')).toBe(false);
    expect(pause.allows('manual')).toBe(true);
    expect(pause.paused).toBe(true);
  });

  it('offers no way to lift the pause: paused is read-only', () => {
    // Game and the settings screen read it; writing it back would lift the pause before a reload
    const pause = new AutosavePause();
    pause.trip();
    expect(() => {
      // @ts-expect-error paused has a getter and no setter
      pause.paused = false;
    }).toThrow(TypeError);
    expect(pause.paused).toBe(true);
    expect(pause.allows('implicit')).toBe(false);
  });

  it('allows an implicit write exactly when no error came before it, and every manual save', () => {
    // The oracle reads the sequence itself: an attempt at i is refused exactly when 'error' occurs
    // among events 0..i-1, and the pause reports itself paused once an 'error' is among 0..i.
    const seen = { refused: 0, allowed: 0, manualAfterError: 0, afterSecondError: 0, none: 0 };
    forAll(
      genEvents,
      (events) => {
        const want = oracle(events);
        trace(new AutosavePause(), events).forEach((got, i) =>
          expect(got, `event ${i}, ${events[i]}`).toEqual(want[i]),
        );
        const first = events.indexOf('error');
        if (first < 0) seen.none++;
        events.forEach((e, i) => {
          if (e === 'implicit') seen[first < 0 || i < first ? 'allowed' : 'refused']++;
          if (e === 'manual' && first >= 0 && i > first) seen.manualAfterError++;
          if (e === 'implicit' && events.slice(0, i).filter((x) => x === 'error').length >= 2)
            seen.afterSecondError++;
        });
      },
      { shrink: (events) => shrinkArray(events) },
    );
    // the seeds reach every branch: no error at all, attempts on both sides of the first error,
    // and attempts after a second error (a pause that toggled would fail there)
    for (const [branch, n] of Object.entries(seen)) expect(n, branch).toBeGreaterThan(0);
  });

  it('is one pause per instance: a fresh one, as after a reload, starts allowing', () => {
    // Several games side by side, each event aimed at one of them; 'reload' replaces that one with
    // a new AutosavePause. Each must answer from its own events since its last reload only.
    let reloadsAfterError = 0;
    forAll(
      (rng) => {
        const games = rng.int(1, 3);
        const pError = rng.pick([0.05, 0.2, 0.5]);
        return Array.from({ length: rng.int(0, 40) }, (): Aimed => {
          const at = rng.int(0, games - 1);
          if (rng.chance(0.1)) return { at, event: 'reload' };
          return { at, event: rng.chance(pError) ? 'error' : rng.pick(KINDS) };
        });
      },
      (steps) => {
        const pauses = [0, 1, 2].map(() => new AutosavePause());
        const since: Event[][] = [[], [], []];
        steps.forEach(({ at, event }, i) => {
          const where = `step ${i} (${event} at game ${at})`;
          if (event === 'reload') {
            if (since[at].includes('error')) reloadsAfterError++;
            pauses[at] = new AutosavePause();
            since[at] = [];
          } else {
            const [answer] = trace(pauses[at], [event]);
            expect(answer, where).toEqual(oracle([...since[at], event]).at(-1));
            since[at].push(event);
          }
          for (const g of [0, 1, 2])
            expect(pauses[g].paused, `${where}, game ${g}`).toBe(since[g].includes('error'));
        });
      },
      { shrink: (steps) => shrinkArray(steps) },
    );
    expect(reloadsAfterError).toBeGreaterThan(0);
  });
});

// A browser's frame clock, by hand, as in loop.test.ts: requestAnimationFrame queues a callback,
// and `frame(ms)` moves the clock on and runs what was queued before it.
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

describe('AutosavePause behind a GameLoop', () => {
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

  it('refuses implicit writes from the call after the first throw in either phase', () => {
    // Game wires its loop's onError to trip the pause first (frameError) and makes the minute
    // autosave at the top of update. Every call here asks before it may throw, so a call's own
    // implicit attempt is allowed exactly when no earlier call, in either phase, threw; a later
    // step of the same frame included.
    const seen = { afterUpdate: 0, afterRender: 0, sameFrame: 0 };
    forAll(
      genLoopCase,
      (c) => {
        resetFrames();
        const pause = new AutosavePause();
        const calls: LoopCall[] = [];
        let f = 0;
        const counts = { update: 0, render: 0 };
        const step = (phase: LoopPhase) => {
          const i = counts[phase]++;
          const threw = (phase === 'update' ? c.badUpdates : c.badRenders).includes(i);
          calls.push({
            phase,
            i,
            frame: f,
            implicit: pause.allows('implicit'),
            manual: pause.allows('manual'),
            threw,
          });
          if (threw) throw new Error(`${phase} ${i} threw`);
        };
        const loop = new GameLoop(
          c.hz,
          () => step('update'),
          () => step('render'),
          () => pause.trip(),
        );
        loop.start();
        for (; f < c.frames.length; f++) frame(c.frames[f]);
        loop.stop();

        calls.forEach(({ phase, i, frame: at, implicit, manual }, k) => {
          const threwBefore = calls.slice(0, k).some((x) => x.threw);
          expect({ implicit, manual }, `${phase} ${i} in frame ${at}`).toEqual({
            implicit: !threwBefore,
            manual: true,
          });
        });
        expect(pause.paused, 'paused after the run').toBe(calls.some((x) => x.threw));

        const first = calls.findIndex((x) => x.threw);
        if (first >= 0 && first < calls.length - 1) {
          seen[calls[first].phase === 'update' ? 'afterUpdate' : 'afterRender']++;
          if (calls[first + 1].frame === calls[first].frame) seen.sameFrame++;
        }
      },
      { shrink: shrinkLoopCase },
    );
    // the seeds reach a first throw in each phase with calls after it, and one in the same frame
    for (const [branch, n] of Object.entries(seen)) expect(n, branch).toBeGreaterThan(0);
  });
});

/** What can happen to the pause: the loop reports an error, or the game asks before a write. */
type Event = 'error' | SaveKind;
/** One event aimed at one of several games; `reload` gives that game a fresh pause. */
interface Aimed {
  at: number;
  event: Event | 'reload';
}
const KINDS: readonly SaveKind[] = ['implicit', 'manual'];

/** Errors and write attempts, from sequences that never pause to ones that pause early. */
function genEvents(rng: Rng): Event[] {
  const pError = rng.pick([0, 0.03, 0.1, 0.3, 0.7]);
  return Array.from({ length: rng.int(0, 40) }, () =>
    rng.chance(pError) ? 'error' : rng.pick(KINDS),
  );
}

/** Per event: the answer to a write attempt (null for an error) and `paused` right after it. */
function trace(pause: AutosavePause, events: readonly Event[]): [boolean | null, boolean][] {
  return events.map((e) => {
    if (e === 'error') pause.trip();
    return [e === 'error' ? null : pause.allows(e), pause.paused];
  });
}

/** The trace the rule gives, read from the sequence alone. */
function oracle(events: readonly Event[]): [boolean | null, boolean][] {
  return events.map((e, i) => {
    const errorBefore = events.slice(0, i).includes('error');
    const answer = e === 'error' ? null : e === 'manual' || !errorBefore;
    return [answer, events.slice(0, i + 1).includes('error')];
  });
}

/** One loop callback call, with what the pause answered at its start and whether it threw. */
interface LoopCall {
  phase: LoopPhase;
  /** index among this phase's calls */
  i: number;
  /** index of the frame it ran in */
  frame: number;
  implicit: boolean;
  manual: boolean;
  threw: boolean;
}

interface LoopCase {
  /** loop rate: at 60 Hz a long frame makes several update steps */
  hz: number;
  /** ms between frames; a gap over 250 is clamped to it */
  frames: number[];
  /** indices of the update calls that throw */
  badUpdates: number[];
  /** indices of the render calls that throw */
  badRenders: number[];
}

function genLoopCase(rng: Rng): LoopCase {
  const frames = Array.from({ length: rng.int(1, 20) }, () =>
    rng.chance(0.2) ? rng.pick([0, 49, 50, 51, 250, 600]) : rng.int(0, 300),
  );
  // 20 frames of at most 10 steps make at most 200 updates and 20 renders
  const chosen = (n: number, p: number) =>
    Array.from({ length: n }, (_, i) => i).filter(() => rng.chance(p));
  return {
    hz: rng.pick([20, 60]),
    frames,
    badUpdates: chosen(200, rng.pick([0, 0.01, 0.05, 0.3])),
    badRenders: chosen(20, rng.pick([0, 0.05, 0.2])),
  };
}

function* shrinkLoopCase(c: LoopCase): Iterable<LoopCase> {
  for (const frames of shrinkArray(c.frames, (ms) => shrinkInt(ms)))
    if (frames.length) yield { ...c, frames };
  // a throwing call moves earlier too, so the frames before it can go
  for (const badUpdates of shrinkArray(c.badUpdates, (i) => shrinkInt(i)))
    yield { ...c, badUpdates };
  for (const badRenders of shrinkArray(c.badRenders, (i) => shrinkInt(i)))
    yield { ...c, badRenders };
  if (c.hz !== 20) yield { ...c, hz: 20 };
}
