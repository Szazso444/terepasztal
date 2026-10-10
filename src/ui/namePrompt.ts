import { el, btn } from './dom';
import { STR } from '../strings';

/** Small centred dialog asking for a name; resolves with the text or null when dismissed. */
export class NamePrompt {
  readonly root = el('div', { id: 'name-prompt-root' });
  // focusable, so a click on its text keeps the keys in the dialog
  private frame = el('div', { id: 'name-prompt', class: 'panel', tabindex: '-1' });
  private title = el('div', { class: 'panel-title' });
  private hint = el('div', { class: 'dim' });
  private input = el('input', { type: 'text', maxlength: '20' }) as HTMLInputElement;
  private resolve: ((v: string | null) => void) | null = null;
  private ok = btn(STR.prompt.ok, () => {}, 'accent');
  private cancel = btn(STR.prompt.keep, () => {}, 'small');

  constructor() {
    const ok = this.ok;
    const cancel = this.cancel;
    ok.addEventListener('click', () => this.finish(this.input.value));
    cancel.addEventListener('click', () => this.finish(null));
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.finish(this.input.value);
      else if (e.key === 'Escape') this.finish(null);
      e.stopPropagation();
    });
    this.input.addEventListener('keyup', (e) => e.stopPropagation());
    // a yes / no question has the focus on its buttons: Escape says no, Enter presses the one
    // focused, and no key press reaches the game or the menu underneath while it is up (key
    // releases still do, so a key held when it opened does not stay down)
    this.frame.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.finish(null);
      e.stopPropagation();
    });
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
    // sits above the menus and the modal screens by stylesheet (`#name-prompt-root`)
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
  /** Yes / no question in the same dialog (no text field). */
  confirm(title: string, text: string): Promise<boolean> {
    this.finish(null);
    this.title.textContent = title;
    this.hint.textContent = text;
    this.input.value = 'yes';
    this.input.style.display = 'none';
    this.okLabel(true);
    this.root.style.display = 'flex';
    // like the browser's own confirm: Enter says yes, Escape no
    setTimeout(() => this.ok.focus(), 0);
    return new Promise((res) => (this.resolve = (v) => res(v !== null)));
  }
  private okLabel(yesNo: boolean) {
    this.ok.textContent = yesNo ? STR.prompt.yes : STR.prompt.ok;
    this.cancel.textContent = yesNo ? STR.prompt.no : STR.prompt.keep;
  }
  private finish(v: string | null) {
    this.input.style.display = '';
    this.okLabel(false);
    const r = this.resolve;
    this.resolve = null;
    this.root.style.display = 'none';
    r?.(v && v.trim() ? v.trim() : null);
  }
}
