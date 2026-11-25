import { describe, expect, it } from 'vitest';
import { History, type HistoryStep } from '../sim/history';
import { STR } from '../strings';
import { historyIconSvg, historyTip, stepHistory } from './historyControls';
import { blockText } from './tooltipDoc';

/** A step that does as it is told, undone or redone. */
function step(label: string, refuse: string | null = null): HistoryStep {
  const go = () => (refuse ? { ok: false as const, message: refuse } : { ok: true as const });
  return { label, undo: go, redo: go };
}

/** What the toasts said, each with its kind. */
function toasts() {
  const said: [string, string | undefined][] = [];
  return { said, toast: (m: string, k?: 'info' | 'warn' | 'good') => void said.push([m, k]) };
}

describe('the buttons', () => {
  it('name the step and the key in their tooltips', () => {
    const text = (way: 'undo' | 'redo', label: string | null) =>
      historyTip(way, label).map(blockText).join('\n');
    expect(text('undo', 'Built 13 tiles of Branch Line')).toBe(
      'Undo: Built 13 tiles of Branch Line · Ctrl+Z',
    );
    expect(text('redo', 'Built 13 tiles of Branch Line')).toBe(
      'Redo: Built 13 tiles of Branch Line · Ctrl+Y',
    );
    expect(text('undo', null)).toBe(`${STR.history.nothingToUndo} · Ctrl+Z`);
    expect(text('redo', null)).toBe(`${STR.history.nothingToRedo} · Ctrl+Y`);
  });

  it('draw an icon each, in the colour of the text', () => {
    for (const way of ['undo', 'redo'] as const) {
      const svg = historyIconSvg(way, 16);
      expect(svg).toContain('width="16"');
      expect(svg).toContain('stroke="currentColor"');
      expect(svg).toMatch(/<path d="M.+"\/>/);
    }
    expect(historyIconSvg('undo', 16)).not.toBe(historyIconSvg('redo', 16));
  });
});

describe('a step of the history', () => {
  it('says what was undone and redone', () => {
    const h = new History();
    h.push(step('Built a thing'));
    const t = toasts();
    expect(stepHistory('undo', h, t.toast)).toBe(true);
    expect(stepHistory('redo', h, t.toast)).toBe(true);
    expect(t.said).toEqual([
      ['Undone: Built a thing', 'info'],
      ['Redone: Built a thing', 'info'],
    ]);
  });

  it('gives the reason when it is refused, and leaves the step', () => {
    const h = new History();
    h.push(step('Built a thing', 'a train stands on it'));
    const t = toasts();
    expect(stepHistory('undo', h, t.toast)).toBe(false);
    expect(t.said).toEqual([['a train stands on it', 'warn']]);
    expect(h.undoLabel).toBe('Built a thing');
  });

  it('says so, without alarm, when there is nothing to do', () => {
    const t = toasts();
    expect(stepHistory('undo', new History(), t.toast)).toBe(false);
    expect(stepHistory('redo', new History(), t.toast)).toBe(false);
    expect(t.said).toEqual([
      [STR.history.nothingToUndo, 'info'],
      [STR.history.nothingToRedo, 'info'],
    ]);
  });
});
