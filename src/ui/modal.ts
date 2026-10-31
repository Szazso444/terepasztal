import { el, btn } from './dom';
import { STR } from '../strings';
import {
  actionButton,
  footerLayout,
  keyBadge,
  lineIcon,
  nextIndex,
  pausedBadge,
  tabStrip,
  type FootAction,
  type FootLayout,
  type FootSpec,
  type IconName,
  type TabDef,
} from './kit';
import { screenKey } from './keymap';

/** S a dialog as tall as its content, M a form, L the full frame. */
export type FrameSize = 'S' | 'M' | 'L';

/** The frame's tab strip: what a screen with tabs answers with. */
export interface FrameTabs {
  tabs: readonly TabDef[];
  current: string;
  /** show tab `id`; the frame draws the strip again after it */
  pick(id: string): void;
}

export interface Screen {
  readonly id: string;
  readonly title: string;
  readonly root: HTMLElement;
  /** the frame's size; L when it does not say */
  readonly frameSize?: FrameSize;
  /** it opens by itself, not by the player's asking: the build tool in hand stays there */
  readonly keepsTool?: boolean;
  /** the key shown in the header; a screen on a letter key has that without saying so */
  readonly hotkey?: string;
  /** the tooltip of that key */
  readonly hotkeyHint?: string;
  /** a line icon before the title */
  readonly icon?: IconName;
  /**
   * The keys that work controls stay in the frame, as the game takes Tab and Space for itself: Tab
   * goes round its controls, Space and Enter press the one that has the focus.
   */
  readonly formKeys?: boolean;
  /** the tab strip under the header, read again at every refresh; none without it */
  frameTabs?(): FrameTabs | null;
  /** the footer's actions, read again at every refresh; a screen on another still gets Back */
  frameFooter?(): FootSpec | null;
  onOpen?(): void;
  onClose?(): void;
  /** periodic refresh while open and on top */
  refresh?(): void;
}

/** What a stack calls on a screen: `onOpen` and `onClose` once each, as it enters and leaves. */
type Stackable = Pick<Screen, 'onOpen' | 'onClose'>;

export interface StackView<S> {
  /** the top screen changed; null when none is left. It goes up before the screen's `onOpen` */
  show(top: S | null): void;
  /** the change is complete */
  changed(top: S | null): void;
}

/**
 * The open screens, the top one showing. A screen under another keeps its state: it is neither
 * closed nor opened again when the one over it leaves. DOM-free, so it is tested under Node.
 */
export class ScreenStack<S extends Stackable> {
  private stack: S[] = [];

  constructor(private readonly view: StackView<S>) {}

  get current(): S | null {
    return this.stack[this.stack.length - 1] ?? null;
  }
  get depth() {
    return this.stack.length;
  }
  /** `s` alone: everything else closes. */
  open(s: S) {
    if (this.current === s) return;
    const staying = this.stack.includes(s);
    this.closeDown((o) => o === s);
    if (!staying) this.stack.push(s);
    this.arrive(staying ? null : s);
  }
  /** `s` over the top screen. One already in the stack is gone back to. */
  push(s: S) {
    if (this.current === s) return;
    if (this.stack.includes(s)) {
      while (this.current !== s) this.leaveTop();
      this.arrive(null);
      return;
    }
    this.stack.push(s);
    this.arrive(s);
  }
  /** The top screen leaves, and the one under it shows. */
  back() {
    if (!this.current) return;
    this.leaveTop();
    this.arrive(null);
  }
  /** Every screen leaves. */
  close() {
    if (!this.current) return;
    this.closeDown(() => false);
    this.arrive(null);
  }
  toggle(s: S) {
    if (this.current === s) this.back();
    else this.open(s);
  }

  private leaveTop() {
    this.stack.pop()?.onClose?.();
  }
  /** Close from the top down, keeping the one `keep` picks. */
  private closeDown(keep: (s: S) => boolean) {
    for (const s of [...this.stack].reverse()) if (!keep(s)) s.onClose?.();
    this.stack = this.stack.filter(keep);
  }
  /** Show the top; `opened` is the screen that has just entered. */
  private arrive(opened: S | null) {
    const top = this.current;
    this.view.show(top);
    opened?.onOpen?.();
    this.view.changed(top);
  }
}

/** Where a frame stands, as it shows a screen. */
export interface FrameState {
  /** on another screen or a menu: its way out is Back */
  stacked: boolean;
  /** a menu holds the clock with a game under it */
  paused: boolean;
}

/**
 * The frame every screen and dialog stands in: the header (amber title, hotkey, ×), the tab strip,
 * the body, the footer. `ScreenManager` has one; a menu or dialog outside the stack makes its own.
 */
export class ScreenFrame {
  // focusable, so a click on a dialog's text keeps the keys in the dialog
  readonly root = el('div', { class: 'panel k-frame', tabindex: '-1' });
  private iconSlot = el('span', { class: 'k-slot' });
  private titleEl = el('span', { class: 'k-ttl' });
  private badges = el('span', { class: 'k-slot' });
  private close: HTMLButtonElement;
  private tabsEl = el('div', { class: 'k-slot' });
  private body = el('div', { class: 'k-frame-body' });
  private foot = el('div', { class: 'k-foot' });
  private screen: Screen | null = null;
  private state: FrameState = { stacked: false, paused: false };
  /** what the strip and the footer drew: they are built again only when it changes */
  private drawnTabs = '';
  private drawnFoot = '';
  private tabs: FrameTabs | null = null;
  private layout: FootLayout | null = null;

  /** @param leave what ×, Back and Done do */
  constructor(private readonly leave: () => void) {
    this.close = btn('×', () => this.leave(), 'k-x');
    this.root.append(
      el(
        'div',
        { class: 'panel-title k-head' },
        this.iconSlot,
        this.titleEl,
        this.badges,
        this.close,
      ),
      this.tabsEl,
      this.body,
      this.foot,
    );
    this.root.addEventListener('keydown', (e) => this.onKey(e));
  }

  show(s: Screen, state: FrameState) {
    this.screen = s;
    this.state = state;
    this.root.className = `panel k-frame sz-${s.frameSize ?? 'L'}`;
    this.iconSlot.replaceChildren(...(s.icon ? [lineIcon(s.icon)] : []));
    const key = s.hotkey ?? screenKey(s.id);
    this.badges.replaceChildren(
      ...(state.paused ? [pausedBadge()] : []),
      ...(key ? [keyBadge(key, s.hotkeyHint)] : []),
    );
    this.close.title = STR.kit.closeHint(key);
    this.body.replaceChildren(s.root);
    this.drawnTabs = this.drawnFoot = '';
    this.sync();
  }

  /** Bring the title, the strip and the footer up to the screen. What has not changed stays put. */
  sync() {
    const s = this.screen;
    if (!s) return;
    if (this.titleEl.textContent !== s.title) this.titleEl.textContent = s.title;
    this.tabs = s.frameTabs?.() ?? null;
    const tabs = this.tabs ? JSON.stringify([this.tabs.tabs, this.tabs.current]) : '';
    if (tabs !== this.drawnTabs) {
      this.drawnTabs = tabs;
      this.tabsEl.replaceChildren(
        ...(this.tabs
          ? [
              tabStrip(this.tabs.tabs, this.tabs.current, (id) => {
                this.tabs?.pick(id);
                this.sync();
              }),
            ]
          : []),
      );
    }
    this.layout = footerLayout(s.frameFooter?.() ?? null, this.state.stacked, () => this.leave());
    const foot = JSON.stringify(this.layout);
    if (foot !== this.drawnFoot) {
      this.drawnFoot = foot;
      this.drawFoot();
    }
  }

  /** The rightmost button of the footer, which a dialog puts the focus on. */
  get primaryButton(): HTMLElement | null {
    return this.foot.querySelector('.k-fr .btn:last-child');
  }

  private drawFoot() {
    const l = this.layout;
    if (!l) {
      this.foot.replaceChildren();
      return;
    }
    // a click runs the footer of the last refresh: the buttons outlive it
    const button = (side: 'left' | 'right') => (a: FootAction, i: number) =>
      actionButton(a.label, () => this.layout?.[side][i].onClick(), {
        cls: [a.primary ? 'pri' : '', a.danger ? 'danger' : ''].join(' ').trim(),
        icon: a.icon,
        title: a.title,
        disabled: a.disabled,
      });
    this.foot.replaceChildren(
      el(
        'div',
        { class: 'k-fl' },
        ...l.left.map(button('left')),
        l.note ? el('span', { class: 'k-note', text: l.note }) : null,
      ),
      el('div', { class: 'k-fr' }, ...l.right.map(button('right'))),
    );
  }

  private onKey(e: KeyboardEvent) {
    if (!this.screen?.formKeys) return;
    if (e.code !== 'Tab' && e.code !== 'Space' && e.code !== 'Enter') return;
    e.stopPropagation();
    if (e.code !== 'Tab') return;
    e.preventDefault();
    const all = [...this.root.querySelectorAll<HTMLElement>('button:not(:disabled), input')];
    if (!all.length) return;
    const at = all.indexOf(document.activeElement as HTMLElement);
    all[nextIndex(all.length, at, e.shiftKey)].focus();
  }
}

/**
 * The modal screens over the game, in one frame, on a scrim. `open` is one screen at a time, as a
 * letter key does; `push` stacks one on it, and Back, Esc, the × or a click beside it return to
 * the one under. The clock runs on behind a screen; only the menus stop it.
 */
export class ScreenManager {
  readonly root = el('div', { id: 'modal-root' });
  private frame = new ScreenFrame(() => this.back());
  private stack = new ScreenStack<Screen>({
    show: (s) => this.show(s),
    changed: (s) => this.onChange?.(s),
  });
  onChange: ((s: Screen | null) => void) | null = null;
  /** a menu stands under the screens, which go back to it */
  menuUnder: (() => boolean) | null = null;
  /** that menu holds the clock with a game under it: the header says so */
  pausedUnder: (() => boolean) | null = null;

  constructor() {
    this.root.append(this.frame.root);
    this.root.style.display = 'none';
    this.root.addEventListener('mousedown', (e) => {
      if (e.target === this.root) this.back();
    });
  }
  /** the top screen */
  get current() {
    return this.stack.current;
  }
  /** the top screen stands on another one or on a menu */
  get stacked() {
    return this.stack.depth > 1 || !!this.menuUnder?.();
  }
  /** Open `s` alone, in place of whatever is up. */
  open(s: Screen) {
    this.stack.open(s);
  }
  /** Open `s` over the top screen, which Back and Esc return to. */
  push(s: Screen) {
    this.stack.push(s);
  }
  /** The top screen leaves; the one under it shows, if any. */
  back() {
    this.stack.back();
  }
  /** Every screen leaves. */
  close() {
    this.stack.close();
  }
  /** The same hotkey again closes it; on another screen, it takes the place of everything up. */
  toggle(s: Screen) {
    this.stack.toggle(s);
  }
  refresh() {
    this.current?.refresh?.();
    this.frame.sync();
  }
  /** Draw the tab strip and the footer again now, not at the next refresh. */
  redraw() {
    this.frame.sync();
  }

  private show(s: Screen | null) {
    this.root.style.display = s ? 'flex' : 'none';
    if (s) this.frame.show(s, { stacked: this.stacked, paused: !!this.pausedUnder?.() });
  }
}
