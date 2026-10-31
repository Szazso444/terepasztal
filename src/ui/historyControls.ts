/**
 * What the undo and redo controls draw, say and do, DOM-free so Node tests read it: the buttons'
 * icons and tooltips, and one step of the history with its toast.
 */
import type { History } from '../sim/history';
import { STR } from '../strings';
import { title, type TipDoc } from './tooltipDoc';

export type HistoryWay = 'undo' | 'redo';

/** The key each button names: Ctrl+Shift+Z redoes too, as `KEYMAP` has it. */
const KEY: Record<HistoryWay, string> = { undo: 'Ctrl+Z', redo: 'Ctrl+Y' };

/** Lucide's `undo-2` and `redo-2` (ISC), as the UI workshop's design draws them, on a 24 px grid. */
const ICON: Record<HistoryWay, string> = {
  undo: 'M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  redo: 'M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
};

/** A button's icon as SVG markup, in the colour of the text. */
export function historyIconSvg(way: HistoryWay, size: number): string {
  return (
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" ` +
    `stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
    `<path d="${ICON[way]}"/></svg>`
  );
}

/** A button's tooltip: the step it would take, `label`, or that there is none. */
export function historyTip(way: HistoryWay, label: string | null): TipDoc {
  const H = STR.history;
  if (label === null)
    return [title(H.idleTip(way === 'undo' ? H.nothingToUndo : H.nothingToRedo, KEY[way]))];
  return [title(H.tip(way === 'undo' ? H.undo : H.redo, label, KEY[way]))];
}

/**
 * Undo or redo one step. The toast says what was done, or why not; true when it was done, and what
 * is on the screen may have changed.
 */
export function stepHistory(
  way: HistoryWay,
  history: History,
  toast: (m: string, k?: 'info' | 'warn' | 'good') => void,
): boolean {
  const H = STR.history;
  const label = way === 'undo' ? history.undoLabel : history.redoLabel;
  const did = way === 'undo' ? history.undo() : history.redo();
  if (!did.ok) {
    toast(did.message, label === null ? 'info' : 'warn');
    return false;
  }
  toast(way === 'undo' ? H.undone(label ?? '') : H.redone(label ?? ''), 'info');
  return true;
}
