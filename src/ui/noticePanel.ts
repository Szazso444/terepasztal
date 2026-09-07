import { el } from './dom';
import { STR } from '../strings';
import type { Notice } from '../sim/notices';

/** Top-of-column list of active notices; click one to jump to its object. */
export class NoticePanel {
  readonly root = el('div', { id: 'notices', class: 'panel' });
  private body = el('div', { class: 'panel-body' });
  private count = el('span', { class: 'num' });
  onFocus: ((n: Notice) => void) | null = null;
  constructor() {
    this.root.append(
      el('div', { class: 'panel-title' }, el('span', { text: STR.notice.title }), this.count),
      this.body,
    );
  }
  render(list: Notice[]) {
    this.count.textContent = list.length ? String(list.length) : '';
    this.body.innerHTML = '';
    if (!list.length) {
      this.body.append(el('div', { class: 'dim', text: STR.notice.none }));
      return;
    }
    for (const n of list.slice(0, 8)) {
      const row = el(
        'div',
        { class: `notice ${n.kind}` },
        el('span', { class: 'dot' }),
        el('span', { class: 'text', text: n.text }),
      );
      if (n.target) row.addEventListener('click', () => this.onFocus?.(n));
      this.body.append(row);
    }
    if (list.length > 8)
      this.body.append(el('div', { class: 'dim', text: STR.notice.more(list.length - 8) }));
  }
}
