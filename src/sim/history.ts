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
  /**
   * True once what the step changed is gone for good: nothing is left to take back or do again, so
   * it falls off the stack when it comes up, and the step under it is the next one.
   */
  gone?(): boolean;
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

  /** The step on top of `stack`, past those whose subject is gone. */
  private top(stack: HistoryStep[]): HistoryStep | undefined {
    while (stack[stack.length - 1]?.gone?.()) stack.pop();
    return stack[stack.length - 1];
  }
  get canUndo() {
    return !!this.top(this.done);
  }
  get canRedo() {
    return !!this.top(this.undone);
  }
  /** What the next undo takes back; null with nothing to undo. */
  get undoLabel(): string | null {
    return this.top(this.done)?.label ?? null;
  }
  /** What the next redo does again; null with nothing to redo. */
  get redoLabel(): string | null {
    return this.top(this.undone)?.label ?? null;
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
    const step = this.top(this.done);
    if (!step) return { ok: false, message: STR.history.nothingToUndo };
    const did = step.undo();
    if (did.ok) this.move(this.done, this.undone);
    return did;
  }

  redo(): CommandResult {
    const step = this.top(this.undone);
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
