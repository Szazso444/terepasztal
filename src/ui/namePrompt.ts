import { el } from './dom';
import { STR } from '../strings';
import { DialogFlow, note, page, well, type ConfirmOptions, type FootSpec } from './kit';
import { ScreenFrame, type Screen } from './modal';

/** A question for the dialog: a yes or no, or with `name` a text to type, starting from it. */
interface Question extends ConfirmOptions, NameOptions {
  title: string;
  text: string;
  name?: string;
}

/** What `ask` is told besides the question: how long the name may be, and whether it may be empty. */
export interface NameOptions {
  /** the most characters a name has; a town's by default */
  max?: number;
  /** an empty name is an answer too, not a dismissal: a seed left empty is a random one */
  empty?: boolean;
}

/** The longest name by default: a town's. */
const NAME_MAX = 20;

/** What Enter answers with: the name typed, trimmed; an empty one only where that is an answer. */
export function nameAnswer(typed: string, empty: boolean): string | null {
  const text = typed.trim();
  return text || (empty ? '' : null);
}

/** What a yes reads as: any text, as `ask` answers with the name typed. */
const YES = 'yes';

/**
 * The in-game dialog, over the menus and the screens: a yes or no question, or a name to type. It
 * replaces the browser's own dialogs, which stall the game loop. Esc or a click beside it says no;
 * Enter presses the focused answer. No key press reaches the game or the menu underneath while it
 * is up (key releases still do, so a key held when it opened does not stay down).
 */
export class NamePrompt {
  readonly root = el('div', { id: 'name-prompt-root' });
  private frame = new ScreenFrame(() => this.flow.dismiss());
  private input = el('input', { class: 'k-cf-in', type: 'text', maxlength: String(NAME_MAX) });
  /** the question up takes an empty name as an answer */
  private empty = false;
  private flow = new DialogFlow<Question, string | null>(
    { show: (q) => this.draw(q), hide: () => (this.root.style.display = 'none') },
    null,
  );

  constructor() {
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.answerName();
      else if (e.key === 'Escape') this.flow.dismiss();
      e.stopPropagation();
    });
    this.input.addEventListener('keyup', (e) => e.stopPropagation());
    this.frame.root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.flow.dismiss();
      e.stopPropagation();
    });
    this.root.append(this.frame.root);
    // sits above the menus and the modal screens by stylesheet (`#name-prompt-root`)
    this.root.style.display = 'none';
    this.root.addEventListener('mousedown', (e) => {
      if (e.target === this.root) this.flow.dismiss();
    });
  }
  get open() {
    return this.flow.open;
  }
  /** Ask for a name; resolves with the text, or null when dismissed. */
  ask(title: string, hint: string, value: string, o: NameOptions = {}): Promise<string | null> {
    return this.flow.ask({ title, text: hint, name: value, ...o });
  }
  /** A yes / no question. The answer names what it does; destroying something, it is red. */
  confirm(title: string, text: string, o: ConfirmOptions = {}): Promise<boolean> {
    return this.flow.ask({ ...o, title, text }).then((v) => v !== null);
  }

  private answerName() {
    this.flow.answer(nameAnswer(this.input.value, this.empty));
  }

  private draw(q: Question) {
    const naming = q.name !== undefined;
    const frameFooter = (): FootSpec => ({
      actions: [
        {
          label: q.no ?? (naming ? STR.prompt.keep : STR.prompt.no),
          onClick: () => this.flow.dismiss(),
        },
        {
          label: q.yes ?? (naming ? STR.prompt.ok : STR.prompt.yes),
          primary: true,
          danger: q.danger,
          onClick: () => (naming ? this.answerName() : this.flow.answer(YES)),
        },
      ],
    });
    const screen: Screen = {
      id: 'dialog',
      title: q.title,
      frameSize: 'S',
      formKeys: true,
      root: page(
        well(
          { cls: 'k-cf' },
          note(q.text, 'k-cf-q'),
          q.detail ? note(q.detail, 'k-cf-d') : null,
          naming ? this.input : null,
        ),
      ),
      frameFooter,
    };
    this.frame.show(screen, { stacked: false, paused: false });
    this.root.style.display = 'flex';
    this.empty = !!q.empty;
    if (naming) {
      this.input.maxLength = q.max ?? NAME_MAX;
      this.input.value = q.name ?? '';
      setTimeout(() => {
        this.input.focus();
        this.input.select();
      }, 0);
    } else setTimeout(() => this.frame.primaryButton?.focus(), 0);
  }
}
