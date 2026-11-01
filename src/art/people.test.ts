import { describe, expect, it } from 'vitest';
import { PERSON_PX } from '../render/assetScale';
import { PROFESSIONS } from '../sim/people';
import golden from './atlasFrames.golden.json';
import { professionFigure, WALK_FRAMES, type FigurePose, type FigureView } from './people';
import type { PixelBuf } from './pixels';

const VIEWS: FigureView[] = ['front', 'back'];
const GATHERERS = ['lumberjack', 'stone_mason', 'farmer', 'pump_hand'];
const frames = golden.people as Record<string, string>;

const figures = PROFESSIONS.flatMap((profession) =>
  VIEWS.flatMap((view) =>
    (GATHERERS.includes(profession) ? (['walk', 'carry'] as const) : (['walk'] as const)).flatMap(
      (pose: FigurePose) =>
        Array.from({ length: WALK_FRAMES }, (_, f) => ({ profession, view, pose, f })),
    ),
  ),
);

/** The rows with any ink, top to bottom. */
function inkRows(b: PixelBuf) {
  const rows: number[] = [];
  for (let y = 0; y < b.h; y++)
    for (let x = 0; x < b.w; x++)
      if (b.alpha(x, y)) {
        rows.push(y);
        break;
      }
  return rows;
}

describe('the figures of the professions', () => {
  it('has four walk frames', () => {
    expect(WALK_FRAMES).toBe(4);
  });

  it('draws every frame PERSON_PX tall, with its lowest ink on the anchor row', () => {
    for (const { profession, view, pose, f } of figures) {
      const key = `people/${profession}_${view}_${pose}_f${f}`,
        rows = inkRows(professionFigure(profession, view, pose, f)),
        // a frame is its ink box: "w x h @ anchor x, anchor y" in the frame table
        [, h, ay] = /^\d+x(\d+)@\d+,(\d+)$/.exec(frames[key] ?? '')!.map(Number);
      expect(rows[0], key).toBe(0);
      expect(rows.at(-1), key).toBe(PERSON_PX - 1);
      expect(h, key).toBe(PERSON_PX);
      expect(ay, key).toBe(PERSON_PX - 1);
    }
  });

  it('has carry frames only for those who gather from the ground', () => {
    const carrying = Object.keys(frames).filter((key) => key.includes('_carry_'));
    expect(carrying).toHaveLength(GATHERERS.length * VIEWS.length * WALK_FRAMES);
    for (const key of carrying)
      expect(GATHERERS.some((g) => key.startsWith(`people/${g}_`))).toBe(true);
  });

  it('moves the legs from frame to frame, in both views', () => {
    for (const profession of PROFESSIONS)
      for (const view of VIEWS) {
        const legs = Array.from({ length: WALK_FRAMES }, (_, f) => {
          const b = professionFigure(profession, view, 'walk', f);
          return Array.from(b.data.subarray(6 * b.w * 4)).join();
        });
        expect(new Set(legs).size, `${profession} ${view}`).toBe(WALK_FRAMES);
      }
  });

  it('keeps the old walker frames until nothing reads them', () => {
    expect(Object.keys(frames).filter((key) => key.startsWith('people/walker_'))).toHaveLength(8);
  });
});
