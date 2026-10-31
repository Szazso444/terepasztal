import { describe, it, expect, vi } from 'vitest';
import { STR } from '../strings';
import type { CommandResult } from './commands';
import { HISTORY_CAP, History, type HistoryStep } from './history';

/** A step that keeps a log of what was run, and refuses while `refuse` holds a reason. */
function step(label: string, log: string[] = []) {
  const s: HistoryStep & { refuse: string | null } = {
    label,
    refuse: null,
    undo: (): CommandResult => {
      if (s.refuse) return { ok: false, message: s.refuse };
      log.push(`undo ${label}`);
      return { ok: true };
    },
    redo: (): CommandResult => {
      if (s.refuse) return { ok: false, message: s.refuse };
      log.push(`redo ${label}`);
      return { ok: true };
    },
  };
  return s;
}

describe('History', () => {
  it('starts with nothing to undo or redo, and says so', () => {
    const h = new History();
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
    expect(h.undoLabel).toBeNull();
    expect(h.redoLabel).toBeNull();
    expect(h.undo()).toEqual({ ok: false, message: STR.history.nothingToUndo });
    expect(h.redo()).toEqual({ ok: false, message: STR.history.nothingToRedo });
  });

  it('undoes the newest step first and redoes in the order they were done', () => {
    const log: string[] = [];
    const h = new History();
    h.push(step('a', log));
    h.push(step('b', log));
    expect(h.undoLabel).toBe('b');
    expect(h.undo()).toEqual({ ok: true });
    expect(h.undoLabel).toBe('a');
    expect(h.redoLabel).toBe('b');
    expect(h.undo()).toEqual({ ok: true });
    expect(h.canUndo).toBe(false);
    expect(h.redo()).toEqual({ ok: true });
    expect(h.redo()).toEqual({ ok: true });
    expect(h.canRedo).toBe(false);
    expect(log).toEqual(['undo b', 'undo a', 'redo a', 'redo b']);
  });

  it('a new action clears what could be redone', () => {
    const h = new History();
    h.push(step('a'));
    h.undo();
    expect(h.canRedo).toBe(true);
    h.push(step('b'));
    expect(h.canRedo).toBe(false);
    expect(h.undoLabel).toBe('b');
  });

  it('keeps a refused step where it is, and hands on the reason', () => {
    const h = new History();
    const a = step('a');
    h.push(a);
    a.refuse = 'a train stands there';
    expect(h.undo()).toEqual({ ok: false, message: 'a train stands there' });
    expect(h.undoLabel).toBe('a');
    expect(h.canRedo).toBe(false);
    a.refuse = null;
    h.undo();
    a.refuse = 'short of wood';
    expect(h.redo()).toEqual({ ok: false, message: 'short of wood' });
    expect(h.redoLabel).toBe('a');
    expect(h.canUndo).toBe(false);
  });

  it('keeps the last 100 steps', () => {
    expect(HISTORY_CAP).toBe(100);
    const h = new History();
    for (let i = 0; i < HISTORY_CAP + 5; i++) h.push(step(`s${i}`));
    let n = 0;
    while (h.canUndo) {
      expect(h.undoLabel).toBe(`s${HISTORY_CAP + 4 - n}`);
      h.undo();
      n++;
    }
    expect(n).toBe(HISTORY_CAP);
  });

  it('clear forgets both ways', () => {
    const h = new History();
    h.push(step('a'));
    h.push(step('b'));
    h.undo();
    h.clear();
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
  });

  it('tells on every change, and not on a refusal', () => {
    const h = new History();
    const seen = vi.fn();
    h.onChange = seen;
    const a = step('a');
    h.push(a);
    expect(seen).toHaveBeenCalledTimes(1);
    h.undo();
    expect(seen).toHaveBeenCalledTimes(2);
    h.redo();
    expect(seen).toHaveBeenCalledTimes(3);
    a.refuse = 'no';
    h.undo();
    expect(seen).toHaveBeenCalledTimes(3);
    h.clear();
    expect(seen).toHaveBeenCalledTimes(4);
  });

  it('lets the newest step take in the next one, which makes no step of its own', () => {
    const h = new History();
    const a = step('a');
    a.absorb = (next) => next.label === 'more of a';
    h.push(a);
    h.push(step('more of a'));
    expect(h.undoLabel).toBe('a');
    h.push(step('b'));
    expect(h.undoLabel).toBe('b');
    h.undo();
    expect(h.undoLabel).toBe('a');
    expect(h.canRedo).toBe(true);
    // taken in or not, a new action clears redo
    h.push(step('more of a'));
    expect(h.canRedo).toBe(false);
    expect(h.undoLabel).toBe('a');
  });
});
