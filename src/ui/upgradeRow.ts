import { el, btn } from './dom';
import type { UpgradeView } from './upgradeView';

/**
 * The upgrade part of a panel (`upgradeView`): the work's bar with the time left, the top level
 * as a quiet line, or the Upgrade button, off with the reason when it cannot be pressed. The panels
 * redraw twice a second, so the bar follows the work.
 */
export function upgradeRow(v: UpgradeView, onUpgrade: () => void, cls = 'accent'): HTMLElement {
  if (v.kind === 'work')
    return el(
      'div',
      { class: 'bar' },
      el('div', { class: 'bar-fill', style: `width:${Math.round(v.progress * 100)}%` }),
      el('span', { class: 'bar-label', text: v.label }),
    );
  if (v.kind === 'top') return el('span', { class: 'dim', text: v.label });
  const b = btn(v.label, onUpgrade, cls);
  b.disabled = !v.enabled;
  b.title = v.title;
  return b;
}
