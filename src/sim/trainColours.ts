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

/** Whether a value read from a save is a colour code. */
export function isTrainColour(c: unknown): c is number {
  return typeof c === 'number' && Number.isInteger(c) && c >= 0 && c < TRAIN_COLOURS.length;
}

/** The code after `c`: the last steps back to the first. */
export function nextTrainColour(c: number): number {
  return (c + 1) % TRAIN_COLOURS.length;
}
