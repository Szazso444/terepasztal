import { levelCrossingFrame as deckFrame, type LevelCrossingClass } from '../art/trackIllustrated';

/**
 * A plain one-tile straight of a class a road crosses on the level (Q36 a), as `pieceFrame`
 * names it.
 */
const CROSSABLE = /^track\/straight_(branch|narrow)_(\d+)$/;

/**
 * The level-crossing deck a road lays over the track piece showing `trackFrame` (`pieceFrame`,
 * src/world/track.ts), as #309 names it: `track/level_crossing_<branch|narrow>_<rot>` over
 * `track/straight_<branch|narrow>_<rot>`, drawn at the same place with the same transform. Null
 * for every other piece: other lines, curves, switches, track crossings, bridges
 * and the members of a multi-tile piece take no road across them.
 */
export function levelCrossingFrame(trackFrame: string): string | null {
  const m = CROSSABLE.exec(trackFrame);
  return m ? deckFrame(m[1] as LevelCrossingClass, Number(m[2])) : null;
}

/**
 * The axis a road runs along over the track piece showing `trackFrame`, where it is a level
 * crossing (`levelCrossingFrame`): square to the track, along x over a straight at rotation 0
 * (along y), along y over one at rotation 1. Null where no road crosses.
 */
export function crossingAxis(trackFrame: string): 'x' | 'y' | null {
  const m = CROSSABLE.exec(trackFrame);
  return m ? (Number(m[2]) % 2 === 0 ? 'x' : 'y') : null;
}
