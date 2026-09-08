import { el, btn } from './dom';

/** Small centred dialog asking for a name; resolves with the text or null when dismissed. */
export class NamePrompt {
  readonly root = el('div', { id: 'name-prompt-root' });
  private frame = el('div', { id: 'name-prompt', class: 'panel' });
  private title = el('div', { class: 'panel-title' });
  private hint = el('div', { class: 'dim' });
  private input = el('input', { type: 'text', maxlength: '20' }) as HTMLInputElement;
  private resolve: ((v: string | null) => void) | null = null;

  constructor() {
    const ok = btn('OK', () => this.finish(this.input.value), 'accent');
    const cancel = btn('Keep', () => this.finish(null), 'small');
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.finish(this.input.value);
      else if (e.key === 'Escape') this.finish(null);
      e.stopPropagation();
    });
    this.input.addEventListener('keyup', (e) => e.stopPropagation());
    this.frame.append(
      this.title,
      el(
        'div',
        { class: 'panel-body' },
        this.hint,
        this.input,
        el('div', { class: 'row' }, ok, cancel),
      ),
    );
    this.root.append(this.frame);
    this.root.style.display = 'none';
    this.root.addEventListener('mousedown', (e) => {
      if (e.target === this.root) this.finish(null);
    });
  }
  get open() {
    return this.root.style.display !== 'none';
  }
  ask(title: string, hint: string, value: string): Promise<string | null> {
    this.finish(null);
    this.title.textContent = title;
    this.hint.textContent = hint;
    this.input.value = value;
    this.root.style.display = 'flex';
    setTimeout(() => {
      this.input.focus();
      this.input.select();
    }, 0);
    return new Promise((res) => (this.resolve = res));
  }
  private finish(v: string | null) {
    const r = this.resolve;
    this.resolve = null;
    this.root.style.display = 'none';
    r?.(v && v.trim() ? v.trim() : null);
  }
}
