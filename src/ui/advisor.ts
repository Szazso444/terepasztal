import { el, btn } from './dom';
import { STR } from '../strings';
import type { Notice } from '../sim/notices';

export interface Tip {
  key: string;
  text: string;
  kind: 'bad' | 'warn' | 'info';
}

/** Top-right helper: turns blockers and idle opportunities into plain instructions. */
export class Advisor {
  readonly root = el('div', { id: 'advisor', class: 'panel' });
  readonly button = btn(STR.advisor.button, () => this.toggle(), 'small');
  private badge = el('span', { class: 'badge' });
  private body = el('div', { class: 'panel-body' });
  private silenceBtn: HTMLButtonElement;
  open = false;
  silenced = false;
  onSilence: ((v: boolean) => void) | null = null;
  private lastKey = '';

  constructor(silenced: boolean) {
    this.silenced = silenced;
    this.silenceBtn = btn(
      silenced ? STR.advisor.unsilence : STR.advisor.silence,
      () => {
        this.silenced = !this.silenced;
        this.silenceBtn.textContent = this.silenced ? STR.advisor.unsilence : STR.advisor.silence;
        this.onSilence?.(this.silenced);
        this.lastKey = '';
      },
      'small',
    );
    this.button.append(this.badge);
    this.root.append(
      el(
        'div',
        { class: 'panel-title' },
        el('span', { text: STR.advisor.title }),
        this.silenceBtn,
        btn('x', () => this.toggle(false), 'small'),
      ),
      this.body,
    );
    this.root.style.display = 'none';
  }
  toggle(v = !this.open) {
    this.open = v;
    this.root.style.display = v ? '' : 'none';
  }
  update(tips: Tip[], notices: Notice[]) {
    const key = tips.map((t) => t.key).join('|') + '#' + notices.map((n) => n.key).join('|');
    if (key === this.lastKey) return;
    this.lastKey = key;
    const urgent = tips.filter((t) => t.kind === 'bad').length;
    this.badge.textContent = this.silenced ? '' : tips.length ? String(tips.length) : '';
    this.badge.classList.toggle('urgent', urgent > 0);
    this.body.innerHTML = '';
    if (this.silenced) {
      this.body.append(el('div', { class: 'dim', text: STR.advisor.silencedHint }));
      return;
    }
    if (!tips.length) {
      this.body.append(el('div', { class: 'dim', text: STR.advisor.allGood }));
      return;
    }
    for (const t of tips)
      this.body.append(
        el(
          'div',
          { class: `tip ${t.kind}` },
          el('span', { class: 'dot' }),
          el('span', { text: t.text }),
        ),
      );
  }
}
