/**
 * Is the ground in view painted? The counting behind `Landscape.viewProgress` and
 * `Landscape.whenViewPainted`, as pure functions of chunk rectangles and flags: nothing here knows
 * about Pixi, workers or time, so the rules run under Node.
 */
import { RELIEF_MAX } from './terrainRelief';

/** A camera's world rectangle. */
export type ViewRect = { x: number; y: number; w: number; h: number };
/** A landscape chunk: its top-left tile and size in tiles. */
export type ChunkRect = { x: number; y: number; w: number; h: number };
/** A chunk and whether its picture is on the ground for the current map. */
export type ChunkPaint = ChunkRect & { painted: boolean };
/** Chunks of the view with a picture, out of all of the view's chunks. */
export type ViewProgress = { done: number; total: number };
/** How a wait for the view ends: the ground is painted, painting failed, or the time ran out. */
export type ViewPaint = 'painted' | 'failed' | 'timeout';

/** The world rectangle a chunk's picture covers, with the margin the painter adds around it. */
export function chunkBox(c: ChunkRect) {
  return {
    left: (c.x - c.y - c.h) * 32 - 4,
    top: (c.x + c.y - 1) * 16 - RELIEF_MAX - 5,
    width: (c.w + c.h) * 32 + 8,
    height: (c.w + c.h) * 16 + RELIEF_MAX + 12,
  };
}

/** Does any part of this box fall inside the view? Touching edges count. */
export function boxInView(box: ReturnType<typeof chunkBox>, view: ViewRect): boolean {
  return !(
    box.left > view.x + view.w ||
    box.top > view.y + view.h ||
    box.left + box.width < view.x ||
    box.top + box.height < view.y
  );
}

/** Does any part of the chunk's picture fall inside the view? */
export function chunkInView(c: ChunkRect, view: ViewRect): boolean {
  return boxInView(chunkBox(c), view);
}

/**
 * How many of the chunks in view are painted. With no view yet every chunk counts, as the painter
 * hands out chunks before it knows where the camera is; a view that holds no chunk is `0 of 0`.
 */
export function countView(chunks: Iterable<ChunkPaint>, view: ViewRect | null): ViewProgress {
  let done = 0,
    total = 0;
  for (const c of chunks) {
    if (view && !chunkInView(c, view)) continue;
    total++;
    if (c.painted) done++;
  }
  return { done, total };
}

/**
 * How a wait for the view ends now, or null while it goes on. Failure ends it first, whatever is
 * painted, as the per-tile ground covers everything then; painted ends it before the time does, so
 * a wait that finishes at its limit still reports success. A view with no chunk in it has nothing
 * left to paint.
 */
export function viewOutcome(
  progress: ViewProgress,
  failed: boolean,
  timedOut: boolean,
): ViewPaint | null {
  if (failed) return 'failed';
  if (progress.done >= progress.total) return 'painted';
  return timedOut ? 'timeout' : null;
}
