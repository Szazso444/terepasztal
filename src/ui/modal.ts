import { el, btn } from './dom';

export interface Screen {
  readonly id: string;
  readonly title: string;
  readonly root: HTMLElement;
  onOpen?(): void;
  onClose?(): void;
  /** periodic refresh while open */
  refresh?(): void;
}

/** One modal screen at a time over the game. */
export class ScreenManager {
  readonly root = el('div', { id: 'modal-root' });
  private frame = el('div', { id: 'modal', class: 'panel' });
  private titleEl = el('span');
  private body = el('div', { id: 'modal-body' });
  current: Screen | null = null;
  onChange: ((s: Screen | null) => void) | null = null;

  constructor() {
    this.frame.append(
      el(
        'div',
        { class: 'panel-title' },
        this.titleEl,
        btn('x', () => this.close(), 'small'),
      ),
      this.body,
    );
    this.root.append(this.frame);
    this.root.style.display = 'none';
    this.root.addEventListener('mousedown', (e) => {
      if (e.target === this.root) this.close();
    });
  }
  open(s: Screen) {
    if (this.current === s) return;
    this.current?.onClose?.();
    this.current = s;
    this.titleEl.textContent = s.title;
    this.body.innerHTML = '';
    this.body.append(s.root);
    this.root.style.display = 'flex';
    s.onOpen?.();
    this.onChange?.(s);
  }
  toggle(s: Screen) {
    if (this.current === s) this.close();
    else this.open(s);
  }
  close() {
    if (!this.current) return;
    this.current.onClose?.();
    this.current = null;
    this.root.style.display = 'none';
    this.onChange?.(null);
  }
  refresh() {
    this.current?.refresh?.();
  }
}
