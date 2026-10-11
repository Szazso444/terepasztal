/**
 * What became of a write of the game, told by the one thing the player can act on:
 * - `stored`: the save is written;
 * - `broken number`: it was refused because the snapshot holds a number JSON cannot write (NaN or
 *   an infinity), with the path of the first one for the console; the game holds a broken value,
 *   and clearing storage space would not help;
 * - `storage`: it was refused for any other reason (storage full or blocked).
 */
export type SaveOutcome =
  { kind: 'stored' } | { kind: 'storage' } | { kind: 'broken number'; path: string };

/**
 * The outcome of a write, from whether it was stored and `firstBroken`: the path of the first
 * non-finite number in the snapshot that was written, or null when it holds none (`firstNonFinite`
 * in `src/sim/save.ts`). Only a write that failed asks for it, so a stored save costs no walk of
 * the snapshot; a stored save is `stored` whatever the snapshot holds. A path of '' (the snapshot
 * is itself the broken number) still counts: only null means there is none.
 */
export function saveOutcome(stored: boolean, firstBroken: () => string | null): SaveOutcome {
  if (stored) return { kind: 'stored' };
  const path = firstBroken();
  return path === null ? { kind: 'storage' } : { kind: 'broken number', path };
}

/**
 * Tells the player once about a stretch of saves refused for a broken number, not every time one
 * is. Every refusal repeats until the value is repaired, and an autosave tries again every
 * minute, so a toast for each would bury the screen.
 *
 * Fed the outcome of each write, of either kind: it answers true when the player is to be warned
 * now, which is when a write is refused for a broken number and none has been given since the last
 * stored save. A refusal for storage says nothing and neither lifts nor sets the latch (it
 * is another trouble, with its own text), and a stored save lifts it, so a later break warns
 * again. A manual save always shows its own text for a refusal; it feeds the latch all the same,
 * so the autosave after it does not repeat what the player was just told.
 *
 * Held in memory only: a reload starts clean.
 */
export class BrokenNumberWarning {
  private warned = false;

  /** The outcome of one write; true when the player is to be warned about it now. */
  note(kind: SaveOutcome['kind']): boolean {
    if (kind === 'stored') {
      this.warned = false;
      return false;
    }
    if (kind === 'storage' || this.warned) return false;
    this.warned = true;
    return true;
  }
}
