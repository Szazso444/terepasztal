import { describe, expect, it } from 'vitest';
import { content } from '../data/content';
import { bogieFrame, loadFrame, locoFrame, wagonFrame } from '../art/frames';
import { FACINGS, type BogieKind, type PartKind } from '../sim/body';
import { FrameKeys } from './frameKeys';

// every third name exists, so each fallback of the frame functions is taken somewhere
const atlas = {
  framesVersion: 0,
  has(key: string) {
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
    return h % 3 === 0;
  },
};

describe('kept frame keys', () => {
  it('are the keys the frame functions give, for every vehicle and facing', () => {
    const keys = new FrameKeys(atlas);
    const parts: PartKind[] = ['body', 'tender'];
    for (let f = 0; f < FACINGS; f++) {
      for (const def of content.locomotives)
        for (const part of parts)
          expect(keys.loco(def, part)[f]).toBe(locoFrame(atlas, def, f, part));
      for (const def of content.wagons) expect(keys.wagon(def)[f]).toBe(wagonFrame(atlas, def, f));
    }
  });
  it('tell bogies and loads apart by style, kind and gauge', () => {
    const keys = new FrameKeys(atlas);
    const kinds: BogieKind[] = ['bogie', 'engine_unit'];
    for (const style of [undefined, 'cylinders', 'plain'])
      for (const kind of kinds)
        for (const narrow of [false, true])
          for (let f = 0; f < FACINGS; f++)
            expect(keys.bogie(style, kind, narrow)[f]).toBe(
              bogieFrame(atlas, style, kind, f, narrow),
            );
    for (const kind of ['heap', 'logs'])
      for (const thin of [false, true])
        for (let f = 0; f < FACINGS; f++)
          expect(keys.load(kind, thin)[f]).toBe(loadFrame(kind, f, thin));
  });
  it('asks the atlas once per list, not once per frame', () => {
    let asked = 0;
    const keys = new FrameKeys({
      framesVersion: 0,
      has: () => {
        asked++;
        return true;
      },
    });
    const first = keys.loco(content.locomotives[0], 'body');
    const after = asked;
    expect(keys.loco(content.locomotives[0], 'body')).toBe(first);
    expect(asked).toBe(after);
  });
  it('follow a vehicle whose own pages come and go', () => {
    const def = content.locomotives[0];
    const own = `rolling/loco_${def.id}_body_f0`;
    const frames = new Set<string>();
    const pages = { framesVersion: 0, has: (key: string) => frames.has(key) };
    const keys = new FrameKeys(pages);
    expect(keys.loco(def, 'body')[0]).not.toBe(own);
    frames.add(own);
    pages.framesVersion++;
    expect(keys.loco(def, 'body')[0]).toBe(own);
    frames.delete(own);
    pages.framesVersion++;
    expect(keys.loco(def, 'body')[0]).not.toBe(own);
  });
});
