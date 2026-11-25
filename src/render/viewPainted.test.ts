import { describe, it, expect } from 'vitest';
import { forAll, shrinkArray } from '../testing/property';
import type { Rng } from '../engine/rng';
import {
  boxInView,
  chunkBox,
  chunkInView,
  countView,
  viewOutcome,
  type ChunkPaint,
  type ViewPaint,
  type ViewProgress,
  type ViewRect,
} from './viewPainted';

/** The chunks of a 32 x 32 tile map, eight tiles to a side. */
const GRID = [0, 8, 16, 24].flatMap((y) => [0, 8, 16, 24].map((x) => ({ x, y, w: 8, h: 8 })));
const WHOLE: ViewRect = { x: -3000, y: -3000, w: 6000, h: 6000 };

function chunks(rng: Rng): ChunkPaint[] {
  return GRID.filter(() => rng.chance(0.7)).map((c) => ({ ...c, painted: rng.chance(0.5) }));
}
function viewOf(rng: Rng): ViewRect {
  return {
    x: rng.int(-1500, 1500),
    y: rng.int(-300, 1100),
    w: rng.int(0, 1400),
    h: rng.int(0, 900),
  };
}
/** A view that holds `outer`: the same corner and at least as large. */
const wider = (view: ViewRect, by: number): ViewRect => ({
  x: view.x - by,
  y: view.y - by,
  w: view.w + 2 * by,
  h: view.h + 2 * by,
});

describe('chunkInView', () => {
  const chunk = { x: 8, y: 8, w: 8, h: 8 };
  const box = chunkBox(chunk);

  it('holds a chunk whose picture is partly in the view, and one whose edge only touches it', () => {
    expect(chunkInView(chunk, { x: box.left + 10, y: box.top + 10, w: 5, h: 5 })).toBe(true);
    expect(chunkInView(chunk, { x: box.left - 100, y: box.top - 100, w: 101, h: 101 })).toBe(true);
    // The edge of the picture on the edge of the view is in; a pixel further is out.
    const right = { x: box.left + box.width, y: box.top, w: 50, h: 50 };
    expect(chunkInView(chunk, right)).toBe(true);
    expect(chunkInView(chunk, { ...right, x: right.x + 0.5 })).toBe(false);
    const below = { x: box.left, y: box.top + box.height, w: 50, h: 50 };
    expect(chunkInView(chunk, below)).toBe(true);
    expect(chunkInView(chunk, { ...below, y: below.y + 0.5 })).toBe(false);
  });

  it('leaves out a chunk wholly beside, above or below the view', () => {
    const size = { w: 20, h: 20 };
    expect(chunkInView(chunk, { x: box.left - 500, y: box.top, ...size })).toBe(false);
    expect(chunkInView(chunk, { x: box.left + box.width + 500, y: box.top, ...size })).toBe(false);
    expect(chunkInView(chunk, { x: box.left, y: box.top - 500, ...size })).toBe(false);
    expect(chunkInView(chunk, { x: box.left, y: box.top + box.height + 500, ...size })).toBe(false);
  });

  it('agrees with the box it is made of', () => {
    forAll(viewOf, (view) => chunkInView(chunk, view) === boxInView(box, view));
  });
});

describe('countView', () => {
  it('counts every chunk when there is no view yet, and nothing for no chunks', () => {
    const some = [
      { x: 0, y: 0, w: 8, h: 8, painted: true },
      { x: 8, y: 0, w: 8, h: 8, painted: false },
    ];
    expect(countView(some, null)).toEqual({ done: 1, total: 2 });
    expect(countView([], null)).toEqual({ done: 0, total: 0 });
    expect(countView([], WHOLE)).toEqual({ done: 0, total: 0 });
  });

  it('counts only the chunks in the view, painted or not', () => {
    const near = { x: 0, y: 0, w: 8, h: 8 };
    const far = { x: 24, y: 24, w: 8, h: 8 };
    const view = { x: -300, y: -100, w: 700, h: 300 };
    expect(chunkInView(near, view)).toBe(true);
    expect(chunkInView(far, view)).toBe(false);
    expect(
      countView(
        [
          { ...near, painted: true },
          { ...far, painted: false },
        ],
        view,
      ),
    ).toEqual({
      done: 1,
      total: 1,
    });
    expect(
      countView(
        [
          { ...near, painted: false },
          { ...far, painted: true },
        ],
        view,
      ),
    ).toEqual({
      done: 0,
      total: 1,
    });
  });

  it('never has more done than total, or more total than chunks, and counts the painted ones', () => {
    forAll(
      (rng) => ({ list: chunks(rng), view: rng.chance(0.2) ? null : viewOf(rng) }),
      ({ list, view }) => {
        const { done, total } = countView(list, view);
        const inView = list.filter((c) => !view || chunkInView(c, view));
        expect(total).toBe(inView.length);
        expect(done).toBe(inView.filter((c) => c.painted).length);
        expect(done).toBeLessThanOrEqual(total);
        expect(total).toBeLessThanOrEqual(list.length);
      },
      {
        *shrink({ list, view }) {
          for (const l of shrinkArray(list)) yield { list: l, view };
        },
      },
    );
  });

  it('is complete exactly when every chunk in view is painted', () => {
    forAll(
      (rng) => ({ list: chunks(rng), view: viewOf(rng) }),
      ({ list, view }) => {
        const { done, total } = countView(list, view);
        const unpainted = list.filter((c) => chunkInView(c, view) && !c.painted);
        expect(done === total).toBe(unpainted.length === 0);
        // Painting them all completes it, and it is never more than the view held.
        const all = countView(
          list.map((c) => ({ ...c, painted: true })),
          view,
        );
        expect(all).toEqual({ done: total, total });
      },
    );
  });

  it('holds more chunks in a wider view, and never fewer done', () => {
    forAll(
      (rng) => ({ list: chunks(rng), view: viewOf(rng), by: rng.int(0, 600) }),
      ({ list, view, by }) => {
        const small = countView(list, view);
        const large = countView(list, wider(view, by));
        expect(large.total).toBeGreaterThanOrEqual(small.total);
        expect(large.done).toBeGreaterThanOrEqual(small.done);
        expect(large.total - large.done).toBeGreaterThanOrEqual(0);
      },
    );
  });

  it('reads a one-shot iterable once', () => {
    function* once() {
      yield { x: 0, y: 0, w: 8, h: 8, painted: true };
      yield { x: 8, y: 0, w: 8, h: 8, painted: true };
    }
    expect(countView(once(), WHOLE)).toEqual({ done: 2, total: 2 });
  });
});

describe('viewOutcome', () => {
  const progress: Record<string, ViewProgress> = {
    none: { done: 0, total: 4 },
    some: { done: 3, total: 4 },
    all: { done: 4, total: 4 },
    empty: { done: 0, total: 0 },
  };

  it('is painted when every chunk in view is, failed when painting failed, timeout when time ran out', () => {
    const cases: [string, boolean, boolean, ViewPaint | null][] = [
      // [progress, failed, timed out, how the wait ends]
      ['none', false, false, null],
      ['some', false, false, null],
      ['all', false, false, 'painted'],
      ['empty', false, false, 'painted'],
      ['none', false, true, 'timeout'],
      ['some', false, true, 'timeout'],
      ['all', false, true, 'painted'],
      ['empty', false, true, 'painted'],
      ['none', true, false, 'failed'],
      ['some', true, false, 'failed'],
      ['all', true, false, 'failed'],
      ['empty', true, false, 'failed'],
      ['none', true, true, 'failed'],
      ['all', true, true, 'failed'],
    ];
    for (const [name, failed, timedOut, how] of cases)
      expect(
        viewOutcome(progress[name], failed, timedOut),
        `${name} failed=${failed} timedOut=${timedOut}`,
      ).toBe(how);
  });

  it('keeps waiting only while the view is unpainted, nothing failed and the time is not up', () => {
    forAll(
      (rng) => {
        const total = rng.int(0, 20);
        return {
          progress: { done: rng.int(0, total), total },
          failed: rng.chance(0.3),
          timedOut: rng.chance(0.5),
        };
      },
      ({ progress: p, failed, timedOut }) => {
        const how = viewOutcome(p, failed, timedOut);
        const complete = p.done >= p.total;
        // Failure beats a finished paint, and a finished paint beats the time running out.
        if (failed) expect(how).toBe('failed');
        else if (complete) expect(how).toBe('painted');
        else expect(how).toBe(timedOut ? 'timeout' : null);
        // A wait that has ended stays ended as chunks arrive and time passes.
        if (how !== null && how !== 'timeout')
          expect(viewOutcome({ ...p, done: p.total }, failed, true)).toBe(how);
      },
    );
  });
});
