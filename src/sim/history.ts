import { STR } from '../strings';
import type { CommandResult } from './commands';

/** Steps the game keeps to undo; the oldest goes when a new one comes past this. */
export const HISTORY_CAP = 100;

/**
 * One player action that can be taken back. `undo` and `redo` check first and change after: a
 * refused one has changed nothing, and its reason is what the player reads.
 */
export interface HistoryStep {
  /** what the player did, in words (`Undo: <label>`) */
  readonly label: string;
  undo(): CommandResult;
  redo(): CommandResult;
  /**
   * Take `next` into this step, for an action that runs over many frames (an Upgrade drag): true
   * when it did, and `next` makes no step of its own.
   */
  absorb?(next: HistoryStep): boolean;
}

/**
 * The player's undo and redo: two stacks of steps, nothing else. A step that is refused stays where
 * it is. It belongs to the session and is never saved.
 */
export class History {
  private readonly done: HistoryStep[] = [];
  private readonly undone: HistoryStep[] = [];
  /** fired when what can be undone or redone changed */
  onChange: (() => void) | null = null;

  get canUndo() {
    return this.done.length > 0;
  }
  get canRedo() {
    return this.undone.length > 0;
  }
  /** What the next undo takes back; null with nothing to undo. */
  get undoLabel(): string | null {
    return this.done[this.done.length - 1]?.label ?? null;
  }
  /** What the next redo does again; null with nothing to redo. */
  get redoLabel(): string | null {
    return this.undone[this.undone.length - 1]?.label ?? null;
  }

  /** A new action: it can be undone, and what was undone before it can no longer be redone. */
  push(step: HistoryStep) {
    this.undone.length = 0;
    if (!this.done[this.done.length - 1]?.absorb?.(step)) {
      this.done.push(step);
      if (this.done.length > HISTORY_CAP) this.done.shift();
    }
    this.onChange?.();
  }

  undo(): CommandResult {
    const step = this.done[this.done.length - 1];
    if (!step) return { ok: false, message: STR.history.nothingToUndo };
    const did = step.undo();
    if (did.ok) this.move(this.done, this.undone);
    return did;
  }

  redo(): CommandResult {
    const step = this.undone[this.undone.length - 1];
    if (!step) return { ok: false, message: STR.history.nothingToRedo };
    const did = step.redo();
    if (did.ok) this.move(this.undone, this.done);
    return did;
  }

  private move(from: HistoryStep[], to: HistoryStep[]) {
    to.push(from.pop()!);
    this.onChange?.();
  }

  /** Forget everything: a new game, a load, leaving to the title. */
  clear() {
    this.done.length = 0;
    this.undone.length = 0;
    this.onChange?.();
  }
}
