import { sfx } from '../engine/audio';
import { STR } from '../strings';
import { parseDecimal } from './decimal';
import { btn, el } from './dom';

/**
 * The component kit: the same pieces in every screen, one section of `style.css`. The first half
 * is what the pieces decide (clamping, the footer's order, the question and its answer), DOM-free
 * and tested under Node. The second half draws them, and stays thin.
 */

// ---------------------------------------------------------------- what the pieces decide

/** The numbers a slider or a number field takes. */
export interface NumberRange {
  min: number;
  max: number;
  /** the steps, counted from `min`; none takes every number */
  step?: number;
  /** what Shift+click on − or + moves by, `step` without it */
  bigStep?: number;
  /**
   * Any whole number in the range is a value, typed or reached by − and +: `step` and `bigStep`
   * only say how far one press moves, and no value is rounded to a step.
   */
  free?: boolean;
  /** any whole number in the range stands; `step` is then only what − and + move by */
  whole?: boolean;
}

/**
 * `v` inside the range and on its nearest stop: the steps, and the top, which is a stop of its own
 * when they do not land on it. Not a number is `min`.
 */
export function clampToRange(v: number, r: NumberRange): number {
  if (Number.isNaN(v)) return r.min;
  const inside = Math.min(r.max, Math.max(r.min, v));
  if (r.free) return Math.min(r.max, Math.max(r.min, Math.round(inside)));
  if (r.whole) return Math.round(inside);
  if (!r.step) return inside;
  const stepped = r.min + Math.round((inside - r.min) / r.step) * r.step;
  // 0.1 + 0.2 stays 0.3: no value here has six decimals
  const stop = Math.min(r.max, Math.round(stepped * 1e6) / 1e6);
  return r.max - inside < Math.abs(inside - stop) ? r.max : stop;
}

/**
 * One press of − (-1) or + (1); `big` is Shift held. From a value between two steps, such as a top
 * they do not land on, it counts from the step next to it that way, so no stop is jumped.
 */
export function stepNumber(v: number, dir: 1 | -1, r: NumberRange, big = false): number {
  const by = (big ? r.bigStep : undefined) ?? r.step ?? 1;
  if (r.free || !r.step) return clampToRange(v + dir * by, r);
  const steps = (v - r.min) / r.step;
  const between = Math.abs(steps - Math.round(steps)) > 1e-6;
  const edge = dir > 0 ? Math.floor(steps) : Math.ceil(steps);
  return clampToRange((between ? r.min + edge * r.step : v) + dir * by, r);
}

/**
 * What was typed in a number field; text that is no number leaves `current`. A comma is a decimal
 * mark too (`parseDecimal`).
 */
export function parseNumber(text: string, r: NumberRange, current: number): number {
  const t = text.trim();
  const n = parseDecimal(t);
  return t === '' || Number.isNaN(n) ? current : clampToRange(n, r);
}

/** Where `v` sits in the range, 0 to 100, for the part of a track that is filled. */
export function rangePercent(v: number, r: NumberRange): number {
  return r.max > r.min ? ((clampToRange(v, r) - r.min) / (r.max - r.min)) * 100 : 0;
}

/** A meter's fill, 0 to 100, from a share of 1; anything that is no share is empty. */
export function meterPercent(share: number): number {
  return Number.isFinite(share) ? Math.min(100, Math.max(0, share * 100)) : 0;
}

/** The option a press picks: `id` when it is one of the options, else what was picked stays. */
export function pickOption(options: readonly { id: string }[], id: string, current: string) {
  return options.some((o) => o.id === id) ? id : current;
}

/** The next of `count` controls round from place `at` (-1: none has the focus yet). */
export function nextIndex(count: number, at: number, back: boolean): number {
  if (at < 0) return back ? count - 1 : 0;
  return (at + (back ? count - 1 : 1)) % count;
}

/** Is the control drawn? A folded list's buttons are in the page, and take no focus. */
export function isShown(e: { getClientRects(): { length: number } }): boolean {
  return e.getClientRects().length > 0;
}

/** One action of a screen's footer. */
export interface FootAction {
  label: string;
  onClick: () => void;
  /** the screen's forward action: rightmost, in the accent */
  primary?: boolean;
  /** it destroys something: red, and it asks through the in-game dialog first */
  danger?: boolean;
  title?: string;
  disabled?: boolean;
  icon?: IconName;
}

/** What a screen says about its footer; `footerLayout` places it. */
export interface FootSpec {
  actions?: readonly FootAction[];
  /** a short dim line after the secondary actions */
  note?: string;
  /** on its own it closes with Done, the rightmost accent; stacked, Back takes its place */
  done?: boolean;
}

export interface FootLayout {
  left: FootAction[];
  note: string | null;
  right: FootAction[];
}

/**
 * The one footer: secondary actions on the left in the order given, the primary rightmost. The
 * Back rule: on top of another screen or a menu, Back is the leftmost secondary, never the accent.
 * Done is an accent only on a screen with no forward action of its own. Null when nothing shows.
 */
export function footerLayout(
  spec: FootSpec | null,
  stacked: boolean,
  leave: () => void,
): FootLayout | null {
  const actions = spec?.actions ?? [];
  const left = actions.filter((a) => !a.primary);
  const right = actions.filter((a) => a.primary);
  if (stacked)
    left.unshift({ label: STR.kit.back, onClick: leave, icon: 'chevl', title: STR.kit.backHint });
  else if (spec?.done && !right.length)
    right.push({
      label: STR.kit.done,
      onClick: leave,
      primary: true,
      title: STR.kit.closeHint(null),
    });
  const note = spec?.note ?? null;
  return left.length || right.length || note ? { left, note, right } : null;
}

/** Where a dialog is drawn; a test passes a fake. */
export interface DialogHost<Q> {
  show(question: Q): void;
  hide(): void;
}

/**
 * One question at a time: it stays up until it is answered, and a new question dismisses the one
 * up, as Esc or a click beside it does.
 */
export class DialogFlow<Q, A> {
  private waiting: ((answer: A) => void) | null = null;

  constructor(
    private readonly host: DialogHost<Q>,
    /** the answer of a question dismissed */
    private readonly dismissed: A,
  ) {}

  get open() {
    return this.waiting !== null;
  }
  ask(question: Q): Promise<A> {
    this.dismiss();
    const answer = new Promise<A>((resolve) => (this.waiting = resolve));
    this.host.show(question);
    return answer;
  }
  answer(a: A) {
    const waiting = this.waiting;
    if (!waiting) return;
    this.waiting = null;
    this.host.hide();
    waiting(a);
  }
  dismiss() {
    this.answer(this.dismissed);
  }
}

/** How a question in the in-game dialog is put, past its title and text. */
export interface ConfirmOptions {
  /** the answer, naming what it does: Delete, Load, Start; Yes without it */
  yes?: string;
  /** the other answer; No without it */
  no?: string;
  /** the answer destroys something: it is red */
  danger?: boolean;
  /** a dim line under the question: what it is about */
  detail?: string;
}

// ---------------------------------------------------------------- what the pieces draw

type Content = Node | string | null | undefined;

const ICONS = {
  play: '<path d="M7 5l12 7-12 7z"/>',
  save: '<path d="M5 4h11.5L20 7.5V20H5z"/><path d="M8.5 4v5h7V4M8.5 20v-6h8v6"/>',
  saveas:
    '<path d="M12 20H5V4h11.5L20 7.5V11"/><path d="M8.5 4v5h7V4"/><path d="M14.5 20.5l.7-2.8 5-5 2.1 2.1-5 5z"/>',
  folder: '<path d="M3 19V5h6l2 2.5h10V19z"/><path d="M3 10.5h18"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  slider: '<path d="M3 12h18"/><circle cx="14" cy="12" r="3" fill="currentColor"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.5M3.5 12h.5M3.5 18h.5"/>',
  undo: '<path d="M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  train:
    '<rect x="6" y="3" width="12" height="14" rx="2"/><path d="M6 10h12M8 17l-2 4M16 17l2 4M4 21h16"/><circle cx="9.5" cy="13.5" r="1" fill="currentColor"/><circle cx="14.5" cy="13.5" r="1" fill="currentColor"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  fuel: '<path d="M4.5 20V4.5h9V20M3 20h12M13.5 9H16a2 2 0 0 1 2 2v5a1.5 1.5 0 0 0 3 0V9.5L18.5 7"/><path d="M7 8h4"/>',
  home: '<path d="M3 11.5L12 4l9 7.5"/><path d="M5.5 9.5V20h13V9.5M10 20v-5.5h4V20"/>',
  chevl: '<path d="M15 5l-7 7 7 7"/>',
  scroll:
    '<path d="M7 3h11v14.5a3.5 3.5 0 0 1-3.5 3.5H7.5A3.5 3.5 0 0 1 4 17.5V17h10v.5a3.5 3.5 0 0 0 3.5 3.5M7 3a2.5 2.5 0 0 0-2.5 2.5V8H7M10 8h5M10 12h5"/>',
  coin: '<circle cx="12" cy="12" r="8.5"/><path d="M14.8 9.2c-.6-.8-1.6-1.2-2.8-1.2-1.6 0-2.8.8-2.8 2s1.2 1.6 2.8 2 2.8.8 2.8 2-1.2 2-2.8 2c-1.2 0-2.2-.4-2.8-1.2M12 6.5V8M12 16v1.5"/>',
  factory: '<path d="M3 21V10l5 3v-3l5 3V6h3l1-3h2l1 3v15zM3 21h18"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5.5 5.5"/>',
  export: '<path d="M12 15V3.5M7.5 8L12 3.5 16.5 8"/><path d="M5 13v7h14v-7"/>',
  import: '<path d="M12 3.5V15M7.5 10.5L12 15l4.5-4.5"/><path d="M5 13v7h14v-7"/>',
  copy: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="1.2"/><path d="M15.5 8.5V4H4v11.5h4.5"/>',
  mountain: '<path d="M2 20l7-12 4 6.5 3-4 6 9.5z"/>',
  keys: '<rect x="3" y="7.5" width="18" height="9" rx="2"/><path d="M8 12h8"/>',
};
export type IconName = keyof typeof ICONS;

/** A line icon, drawn in the text's colour. */
export function lineIcon(name: IconName): HTMLElement {
  const i = el('span', { class: 'k-ic', 'aria-hidden': 'true' });
  // fixed markup from this file, never from data
  i.innerHTML = `<svg viewBox="0 0 24 24">${ICONS[name]}</svg>`;
  return i;
}

/** A press: the click stays on the control, with the game's click sound. */
function onPress(e: HTMLElement, run: () => void) {
  e.addEventListener('click', (ev) => {
    ev.stopPropagation();
    sfx('ui.click');
    run();
  });
}

export interface ActionOptions {
  /** `pri` the accent, `danger` red, `pri danger` the red answer, `small` for a row of actions */
  cls?: string;
  icon?: IconName;
  /** small text at the button's far end: a key, a count */
  extra?: string;
  title?: string;
  disabled?: boolean;
}

/** The game's button with what the kit adds to it. A button that is off says why in its title. */
export function actionButton(
  label: string,
  onClick: () => void,
  o: ActionOptions = {},
): HTMLButtonElement {
  const b = btn(label, onClick, o.cls ?? '');
  if (o.icon) b.prepend(lineIcon(o.icon));
  if (o.extra) b.append(el('em', { text: o.extra }));
  if (o.title) b.title = o.title;
  if (o.disabled) b.disabled = true;
  return b;
}

/** A row of buttons, wrapping when it has to. */
export function buttonRow(...buttons: Content[]): HTMLElement {
  return el('div', { class: 'k-btnrow' }, ...buttons);
}

/** The hotkey as a small badge, for a header or a key table. */
export function keyBadge(key: string, title = STR.kit.hotkey(key)): HTMLElement {
  return el('kbd', { class: 'k-key', title, text: key });
}

/** Says a menu holds the clock. */
export function pausedBadge(): HTMLElement {
  return el('em', { class: 'k-badge', title: STR.kit.pausedHint, text: STR.menu.paused });
}

/** The scrolling body of a redone screen: `root` of the `Screen`, holding wells. */
export function page(...children: Content[]): HTMLElement {
  return el('div', { class: 'k-page' }, ...children);
}

/** Wells side by side, in equal columns, each as tall as its content. */
export function columns(...cols: HTMLElement[][]): HTMLElement {
  return el('div', { class: 'k-cols' }, ...cols.map((c) => el('div', { class: 'k-col' }, ...c)));
}

/** One side of a list and detail: a head that stays put over a body that scrolls. */
export interface Pane {
  head: HTMLElement;
  body: HTMLElement;
}

/**
 * List and detail: a list of a fixed width on the left, the picked item's detail on the right.
 * Each side scrolls on its own and keeps its head above the scroll. The caller fills the panes.
 */
export function listDetail(listWidth = 360): { root: HTMLElement; list: Pane; detail: Pane } {
  const pane = (): Pane => ({
    head: el('div', { class: 'k-pane-h' }),
    body: el('div', { class: 'k-pane-b' }),
  });
  const list = pane();
  const detail = pane();
  const root = el(
    'div',
    { class: 'k-split', style: `--k-lw:${listWidth}px` },
    el('div', { class: 'k-pane' }, list.head, list.body),
    el('div', { class: 'k-pane' }, detail.head, detail.body),
  );
  return { root, list, detail };
}

/** A section's title, with something small at the far end: a count, a legend. */
export function sectionHeader(title: string, right?: Content): HTMLElement {
  return el(
    'div',
    { class: 'k-sec' },
    el('span', { text: title }),
    right ? el('em', {}, right) : null,
  );
}

export interface WellOptions {
  title?: string;
  right?: Content;
  cls?: string;
}

/** A bevelled well, what a screen's body is made of; `head` is its title or its options. */
export function well(head: string | WellOptions | null, ...children: Content[]): HTMLElement {
  const o = typeof head === 'string' ? { title: head } : (head ?? {});
  return el(
    'div',
    { class: `k-well ${o.cls ?? ''}`.trim() },
    o.title ? sectionHeader(o.title, o.right) : null,
    ...children,
  );
}

/** A dim paragraph in a well; `cls` `bad` for a warning. */
export function note(text: string, cls = ''): HTMLElement {
  return el('p', { class: `k-p ${cls}`.trim(), text });
}

/** A label and its value. `tone`: `good` or `bad`. */
export function labelValue(label: Content, value: Content, tone = ''): HTMLElement {
  return el('div', { class: `k-kv ${tone}`.trim() }, el('span', {}, label), el('b', {}, value));
}

/** A form row: the label, with an optional dim line under it, and its control. */
export function formRow(label: Content, control: Content, sub?: string): HTMLElement {
  return el(
    'div',
    { class: 'k-row' },
    el('div', { class: 'k-lab' }, el('span', {}, label), sub ? el('small', { text: sub }) : null),
    el('div', { class: 'k-ctl' }, control),
  );
}

/** A meter bar with its label and value; `share` is how full, of 1. `tone`: `bad` or `warn`. */
export function meter(label: string, value: string, share: number, tone = ''): HTMLElement {
  const fill = el('i', { style: `width:${meterPercent(share)}%` });
  return el(
    'div',
    { class: `k-meter ${tone}`.trim() },
    el('span', { text: label }),
    el('b', { text: value }),
    el('div', { class: 'k-bar' }, fill),
  );
}

export interface SegOption {
  id: string;
  label: string;
  title?: string;
}

/** One of a few short options. `wide` fills the row, `small` is for dense rows. */
export function segmented(o: {
  options: readonly SegOption[];
  value: string;
  onChange: (id: string) => void;
  cls?: string;
}): HTMLElement {
  let value = o.value;
  const root = el('span', { class: `k-seg ${o.cls ?? ''}`.trim(), role: 'radiogroup' });
  const buttons = o.options.map((opt) => {
    const b = el('button', { type: 'button', role: 'radio', text: opt.label });
    if (opt.title) b.title = opt.title;
    onPress(b, () => {
      value = pickOption(o.options, opt.id, value);
      show();
      o.onChange(value);
    });
    return b;
  });
  const show = () =>
    buttons.forEach((b, i) => {
      const on = o.options[i].id === value;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    });
  show();
  root.append(...buttons);
  return root;
}

export interface ChoiceOption {
  id: string;
  label: string;
  hint?: string;
}

/** One of several, each with its description: the rows themselves are the control. */
export function choiceRows(o: {
  options: readonly ChoiceOption[];
  value: string;
  onChange: (id: string) => void;
}): HTMLElement {
  let value = o.value;
  const rows = o.options.map((opt) => {
    const b = el(
      'button',
      { type: 'button', class: 'k-choice', role: 'radio' },
      el('i', { class: 'k-mark' }),
      el(
        'span',
        { class: 'k-lab' },
        el('span', { text: opt.label }),
        opt.hint ? el('small', { text: opt.hint }) : null,
      ),
    );
    onPress(b, () => {
      value = pickOption(o.options, opt.id, value);
      show();
      o.onChange(value);
    });
    return b;
  });
  const show = () =>
    rows.forEach((b, i) => {
      const on = o.options[i].id === value;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    });
  show();
  return el('div', { class: 'k-choices', role: 'radiogroup' }, ...rows);
}

/** A control that shows `get()`, and a click turns it over. */
function flip(
  cls: string,
  role: string,
  label: string,
  get: () => boolean,
  set: (v: boolean) => void,
): HTMLButtonElement {
  const e = el('button', { type: 'button', class: cls, role, title: label, 'aria-label': label });
  const show = () => {
    e.classList.toggle('on', get());
    e.setAttribute('aria-checked', String(get()));
  };
  onPress(e, () => {
    set(!get());
    show();
  });
  show();
  return e;
}

/** The one on / off control: no On / Off buttons, no checkboxes. */
export function toggleSwitch(
  label: string,
  get: () => boolean,
  set: (v: boolean) => void,
): HTMLButtonElement {
  return flip('k-sw', 'switch', label, get, set);
}

/**
 * The cell of a grid, the kit's one recorded checkbox exception: a cell has no label of its own
 * and the columns read as stripes. Grid cells only.
 */
export function gridCell(
  label: string,
  get: () => boolean,
  set: (v: boolean) => void,
): HTMLButtonElement {
  return flip('k-cell', 'checkbox', label, get, set);
}

/**
 * A number typed or dragged leaves the focus in an `<input>`, and the game reads no key from one:
 * Esc or Enter gives the keys back.
 */
function fieldKeys(
  f: HTMLInputElement | HTMLTextAreaElement,
  enter?: () => void,
  escape?: () => void,
) {
  (f as HTMLElement).addEventListener('keydown', (e) => {
    // Tab goes on to the frame, which keeps the focus inside it
    if (e.key === 'Tab') return;
    e.stopPropagation();
    if (e.key === 'Escape') {
      escape?.();
      f.blur();
    } else if (e.key === 'Enter' && f.tagName === 'INPUT') {
      enter?.();
      f.blur();
    }
  });
}

export interface SliderOptions extends Partial<NumberRange> {
  value: number;
  label: string;
  /**
   * Takes the value. What it returns is what was stored, which a rule may have rounded: the
   * control shows that, not what was asked for.
   */
  onInput: (v: number) => number | void;
  /** how the value reads; a percentage without it */
  format?: (v: number) => string;
  /**
   * The value is a number field beside the track in place of the text: it can be typed in, in its
   * own units and on no step, and it has the − and + of a number field (Shift for `bigStep`) and
   * the up and down keys. A rule with an exact value to give.
   */
  field?: boolean;
}

/** A slider with its value: 0 to 100 in whole numbers unless it says otherwise. */
export function slider(o: SliderOptions): HTMLElement {
  const r: NumberRange = {
    min: o.min ?? 0,
    max: o.max ?? 100,
    step: o.step ?? 1,
    bigStep: o.bigStep,
  };
  const format = o.format ?? ((v: number) => `${v}%`);
  const value = clampToRange(o.value, r);
  const input = el('input', {
    type: 'range',
    min: String(r.min),
    max: String(r.max),
    step: String(r.step),
    value: String(value),
    'aria-label': o.label,
  });
  const typed = o.field
    ? el('input', {
        type: 'text',
        inputmode: 'decimal',
        value: String(value),
        'aria-label': o.label,
      })
    : null;
  const text = el('em');
  let pointing = false;
  let current = value;
  const show = (v: number) => {
    current = v;
    if (typed) typed.value = String(v);
    else text.textContent = format(v);
    input.style.setProperty('--k-fill', `${rangePercent(v, r)}%`);
  };
  /** Give the value on, and show what was stored. */
  const take = (v: number) => {
    const stored = o.onInput(v);
    const now = typeof stored === 'number' ? stored : v;
    show(now);
    if (now !== v) input.value = String(now);
  };
  input.addEventListener('input', () => take(clampToRange(Number(input.value), r)));
  let shown: HTMLElement = text;
  if (typed) {
    // any number in range: the field does not snap to the track's steps, the stepper does
    const range = { min: r.min, max: r.max };
    const press = (label: string, dir: 1 | -1) => {
      const b = el('button', { type: 'button', text: label });
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        sfx('ui.click');
        take(stepNumber(current, dir, r, e.shiftKey));
        input.value = String(current);
      });
      return b;
    };
    typed.addEventListener('change', () => {
      const v = parseNumber(typed.value, range, current);
      // nothing new (or no number): what is stored is shown again, and nothing is given on
      if (v === current) return show(current);
      take(v);
      input.value = String(current);
    });
    typed.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      take(stepNumber(current, e.key === 'ArrowUp' ? 1 : -1, r, e.shiftKey));
      input.value = String(current);
    });
    fieldKeys(typed, undefined, () => show(current));
    shown = el('span', { class: 'k-num' }, press('−', -1), el('span', {}, typed), press('+', 1));
  }
  // a press or a drag gives the keys back as it ends, wherever the pointer lets go
  for (const ended of ['pointerup', 'change'])
    input.addEventListener(ended, () => pointing && input.blur());
  input.addEventListener('pointerdown', () => (pointing = true));
  input.addEventListener('blur', () => (pointing = false));
  fieldKeys(input);
  show(value);
  return el('span', { class: 'k-sl' }, input, shown);
}

export interface NumberFieldOptions extends NumberRange {
  value: number;
  label: string;
  /** Takes the value. What it returns is what was stored, and the field shows that. */
  onChange: (v: number) => number | void;
  /** after the number */
  unit?: string;
  /** `small` for dense rows */
  cls?: string;
}

/** − and + around a number that can be typed too. Shift+click takes `bigStep`. */
export function numberField(o: NumberFieldOptions): HTMLElement {
  let value = clampToRange(o.value, o);
  const input = el('input', {
    type: 'text',
    inputmode: 'numeric',
    value: String(value),
    'aria-label': o.label,
  });
  const set = (v: number) => {
    input.value = String(v);
    if (v === value) return;
    value = v;
    const stored = o.onChange(v);
    if (typeof stored === 'number') {
      value = stored;
      input.value = String(stored);
    }
  };
  const press = (text: string, dir: 1 | -1) => {
    const b = el('button', { type: 'button', text });
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      sfx('ui.click');
      set(stepNumber(value, dir, o, e.shiftKey));
    });
    return b;
  };
  input.addEventListener('change', () => set(parseNumber(input.value, o, value)));
  fieldKeys(input, undefined, () => (input.value = String(value)));
  return el(
    'span',
    { class: `k-num ${o.cls ?? ''}`.trim() },
    press('−', -1),
    el('span', {}, input, o.unit ? el('small', { text: o.unit }) : null),
    press('+', 1),
  );
}

export interface TextFieldOptions {
  value?: string;
  placeholder?: string;
  maxLength?: number;
  icon?: IconName;
  onInput?: (text: string) => void;
  onEnter?: (text: string) => void;
  /** Esc: what it does in place of clearing the text, as a field with a default gives that back */
  onClear?: () => void;
  title?: string;
}

export interface TextField {
  root: HTMLElement;
  input: HTMLInputElement;
}

/** The kit's text field. Enter ends the typing; Esc ends it and clears the text. */
export function textField(o: TextFieldOptions = {}): TextField {
  const input = el('input', {
    type: 'text',
    spellcheck: 'false',
    value: o.value ?? '',
    placeholder: o.placeholder ?? '',
  });
  if (o.maxLength) input.maxLength = o.maxLength;
  if (o.title) input.title = o.title;
  input.addEventListener('input', () => o.onInput?.(input.value));
  fieldKeys(
    input,
    () => o.onEnter?.(input.value),
    () => {
      if (o.onClear) return o.onClear();
      if (!input.value) return;
      input.value = '';
      o.onInput?.('');
    },
  );
  return { root: el('span', { class: 'k-field' }, o.icon ? lineIcon(o.icon) : null, input), input };
}

/** A text field with the search glass, and a × that clears it while it holds text. */
export function searchField(o: TextFieldOptions = {}): TextField {
  const clear = el('button', { type: 'button', class: 'k-qx', title: STR.kit.clear, text: '×' });
  const show = (text: string) => clear.classList.toggle('on', !!text);
  const f = textField({
    icon: 'search',
    ...o,
    onInput: (text) => {
      show(text);
      o.onInput?.(text);
    },
  });
  onPress(clear, () => {
    f.input.value = '';
    show('');
    o.onInput?.('');
  });
  show(o.value ?? '');
  f.root.append(clear);
  return f;
}

/** A box of several lines: paste a save or a level here. */
export function pasteBox(o: { placeholder?: string; title?: string } = {}): HTMLTextAreaElement {
  const area = el('textarea', {
    class: 'k-paste',
    spellcheck: 'false',
    placeholder: o.placeholder ?? '',
  });
  if (o.title) area.title = o.title;
  fieldKeys(area);
  return area;
}

export interface ChipOption {
  id: string;
  label: string;
  count?: number;
  on?: boolean;
}

/** Filter chips: several on at once. */
export function chips(
  options: readonly ChipOption[],
  onToggle: (id: string, on: boolean) => void,
): HTMLElement {
  return el(
    'div',
    { class: 'k-chips' },
    ...options.map((opt) => {
      const b = el(
        'button',
        { type: 'button', class: `k-chip ${opt.on ? 'on' : ''}`.trim() },
        opt.label,
        opt.count !== undefined ? el('b', { text: String(opt.count) }) : null,
      );
      onPress(b, () => onToggle(opt.id, b.classList.toggle('on')));
      return b;
    }),
  );
}

/** The slot a sprite sits in; with nothing to show, a dashed box. */
export function spriteSlot(sprite: Node | null): HTMLElement {
  return el('span', { class: `k-spr ${sprite ? '' : 'empty'}`.trim() }, sprite);
}

export interface CardOptions {
  title: Content;
  /** the strip down its left side: `common` to `legendary` */
  rarity?: string;
  /** the rarity's label, above the title */
  rarityLabel?: Content;
  /** a small tag after the title: `Lv 3` */
  badge?: string;
  /** at the far end of the title line: a payout */
  right?: Content;
  /** a sprite slot under the title; undefined for none */
  sprite?: Node | null;
  sub?: Content;
  body?: Content;
  foot?: Content;
  on?: boolean;
  onClick?: () => void;
  /** a state: `locked`, `off`, `unowned` */
  cls?: string;
}

export function card(o: CardOptions): HTMLElement {
  const cls = ['k-card', o.rarity ? `r-${o.rarity}` : '', o.on ? 'on' : '', o.cls ?? ''];
  const c = el(
    'div',
    { class: cls.filter(Boolean).join(' ') },
    el(
      'div',
      { class: 'k-card-h' },
      o.rarityLabel,
      el('b', {}, o.title),
      o.badge ? el('em', { text: o.badge }) : null,
      o.right,
    ),
    o.sprite !== undefined ? spriteSlot(o.sprite) : null,
    o.sub ? el('div', { class: 'k-card-s' }, o.sub) : null,
    o.body,
    o.foot ? el('div', { class: 'k-card-f' }, o.foot) : null,
  );
  if (o.onClick) onPress(c, o.onClick);
  return c;
}

/** Cards laid out, at least `min` px wide each. */
export function cardGrid(cards: readonly HTMLElement[], min = 200): HTMLElement {
  return el(
    'div',
    { class: 'k-cards', style: `grid-template-columns:repeat(auto-fill,minmax(${min}px,1fr))` },
    ...cards,
  );
}

export interface ListRowOptions {
  title: Content;
  /** the lines under the title */
  sub?: readonly Content[];
  /** a sprite slot on the left; undefined for none */
  sprite?: Node | null;
  /** the row's actions, at its far end */
  right?: readonly Content[];
  /** a line of small actions under the text */
  foot?: readonly Content[];
  on?: boolean;
  onClick?: () => void;
  cls?: string;
}

export function listRow(o: ListRowOptions): HTMLElement {
  const r = el(
    'div',
    { class: ['k-li', o.on ? 'on' : '', o.cls ?? ''].filter(Boolean).join(' ') },
    o.sprite !== undefined ? spriteSlot(o.sprite) : null,
    el(
      'div',
      { class: 'k-li-m' },
      el('b', {}, o.title),
      ...(o.sub ?? []).map((s) => el('small', {}, s)),
      o.foot ? el('div', { class: 'k-li-f' }, ...o.foot) : null,
    ),
    o.right ? el('div', { class: 'k-li-a' }, ...o.right) : null,
  );
  if (o.onClick) onPress(r, o.onClick);
  return r;
}

/** What a list says with nothing in it. */
export function emptyState(o: {
  text: string;
  title?: string;
  icon?: IconName;
  action?: Content;
}): HTMLElement {
  return el(
    'div',
    { class: 'k-empty' },
    o.icon ? lineIcon(o.icon) : null,
    o.title ? el('b', { text: o.title }) : null,
    el('span', { text: o.text }),
    o.action,
  );
}

export interface TabDef {
  id: string;
  label: string;
  /** a count on the tab's line */
  count?: number | null;
  /** it cannot be opened, for this reason: dim, with the reason as its title */
  off?: string | null;
  /** a dot after the label, with this as its title: the tab holds something set apart */
  mark?: string | null;
}

/** A strip of tabs: the frame's, or one inside a well. */
export function tabStrip(
  tabs: readonly TabDef[],
  current: string,
  onPick: (id: string) => void,
): HTMLElement {
  return el(
    'div',
    { class: 'k-tabs', role: 'tablist' },
    ...tabs.map((t) => {
      const on = t.id === current;
      const b = el(
        'button',
        {
          type: 'button',
          class: `k-tab ${on ? 'on' : ''}`.trim(),
          role: 'tab',
          'aria-selected': String(on),
        },
        el('span', { text: t.label }),
        t.count !== undefined && t.count !== null
          ? el('b', { class: 'k-cnt', text: String(t.count) })
          : null,
        t.mark ? el('i', { class: 'k-dot', title: t.mark }) : null,
      );
      if (t.off) {
        b.disabled = true;
        b.title = t.off;
      } else onPress(b, () => onPick(t.id));
      return b;
    }),
  );
}
