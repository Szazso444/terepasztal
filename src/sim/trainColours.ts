/**
 * The colour codes a train can carry, in the order a click on its stripe steps through them. The
 * first is the one a train starts with and an older save gets; the mock's new trains are grey, so
 * grey heads the list and the rest keep the mock's order. A train keeps its code's index, which a
 * save holds: a new colour goes at the end.
 */
export const TRAIN_COLOURS = [
  '#c9ccd0',
  '#d9584b',
  '#e8aa48',
  '#9cbf6a',
  '#5b9bd5',
  '#a888b4',
] as const;

/** Whether a value is a colour code of this build. */
export function isTrainColour(c: unknown): c is number {
  return typeof c === 'number' && Number.isInteger(c) && c >= 0 && c < TRAIN_COLOURS.length;
}

/**
 * The code a train keeps from a save: a later build's goes on through this one's saves, as it may
 * be that build that reads them next; what is no code at all is the first.
 */
export function savedTrainColour(c: unknown): number {
  return typeof c === 'number' && Number.isInteger(c) && c >= 0 ? c : 0;
}

/** The code this build draws for `c`: one it does not know is the first. */
export function shownTrainColour(c: number): number {
  return isTrainColour(c) ? c : 0;
}

/** The code after `c`: the last steps back to the first. */
export function nextTrainColour(c: number): number {
  return (shownTrainColour(c) + 1) % TRAIN_COLOURS.length;
}
