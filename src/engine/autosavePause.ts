/**
 * A write of the stored game: `implicit` when the game makes it on its own (the minute autosave,
 * the save on closing the tab, the silent save as the content screen closes, the write before the
 * world grows), `manual` when the player asked for it.
 */
export type SaveKind = 'implicit' | 'manual';

/**
 * Whether the game may still store itself. A loop step that throws can leave the game half-applied,
 * so once the loop reports an error the game stops writing the stored game on its own and the save
 * from before the error stays safe; a save the player asks for always goes through.
 *
 * Held in memory only, for the rest of the page's life: a reload starts clean, and no save or
 * setting carries it.
 */
export class AutosavePause {
  private tripped = false;

  /** The loop reported an error: refuse every implicit write from now on. */
  trip(): void {
    this.tripped = true;
  }

  /** True once `trip()` has been called. */
  get paused(): boolean {
    return this.tripped;
  }

  /** Whether a write of this kind may happen now: manual always, implicit until the first trip. */
  allows(kind: SaveKind): boolean {
    return kind === 'manual' || !this.tripped;
  }
}
