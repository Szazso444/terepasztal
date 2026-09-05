import { el } from './dom';

/** Transient messages stacked above the toolbar. */
export class Toasts {
  readonly root = el('div', { id: 'toasts' });
  push(msg: string, kind: 'info' | 'warn' | 'good' = 'info') {
    const t = el('div', { class: `toast ${kind}`, text: msg });
    this.root.append(t);
    setTimeout(() => t.classList.add('fade'), 2600);
    setTimeout(() => t.remove(), 3200);
    while (this.root.children.length > 5) this.root.firstChild?.remove();
  }
}
