import { alertIconSvg } from './alertView';
import { btn, el } from './dom';
import {
  MENU_BAR,
  MenuBarState,
  type MenuAction,
  type MenuEntry,
  type MenuId,
  type MenuItem,
  type MenuMode,
} from './menuBarModel';
import { ttTerm, type TipBuild } from './tooltip';

/** The three lines of the Menu entry, on a 24 px grid: the workshop mock's. */
const MENU_ICON = '<path d="M4 6h16M4 12h16M4 18h16"/>';

/**
 * The menu bar of the top bar. `root` is its cell in the bar; `pane`, the open menu, stands in
 * `#ui-root` on its own: the cell clips when the bar runs short of room, and the input takes
 * anything under `#ui-root` for UI. The rows are made once and only shown and hidden, so one under
 * the pointer never goes while it is being clicked. The rules are `MenuBarState`'s.
 */
export class MenuBar {
  readonly root = el('div', { class: 'stat menus' });
  readonly pane = el('div', { id: 'menu-pane', class: 'panel', role: 'menu' });
  /** what each entry and row does; a `Record`, so a new action cannot go unwired */
  actions: Record<MenuAction, () => void> | null = null;
  private state = new MenuBarState();
  private entries = new Map<MenuId, HTMLButtonElement>();
  /** what stands in the bar for each entry: the button, or the term around it */
  private cells = new Map<MenuId, HTMLElement>();
  private rows = new Map<MenuAction, HTMLButtonElement>();
  /** where a row's count shows: on the row and on its entry */
  private badges = new Map<MenuAction, HTMLElement[]>();

  /** `tip` builds a tooltip that says the text it is given. */
  constructor(tip: (text: string) => TipBuild) {
    for (const entry of MENU_BAR) {
      const button = this.entryButton(entry);
      const cell = entry.tip ? ttTerm(button, tip(entry.tip)) : button;
      this.entries.set(entry.id, button);
      this.cells.set(entry.id, cell);
      this.root.append(cell);
      for (const item of entry.items) {
        const row = this.row(item);
        this.rows.set(item.action, row);
        this.pane.append(row);
        if (item.badge) {
          const both = [el('span', { class: 'badge' }), el('span', { class: 'badge' })];
          row.append(both[0]);
          button.append(both[1]);
          this.badges.set(item.action, both);
        }
      }
    }
    this.pane.style.display = 'none';
    // in the capture phase: a panel that keeps its clicks to itself still closes the menu
    document.addEventListener('mousedown', this.onMouseDown, true);
  }

  private entryButton(entry: MenuEntry) {
    const cls = entry.run ? 'small mb-entry' : 'small mb-entry mb-menu';
    const b = btn(entry.label, () => this.clicked(entry.id), cls);
    if (entry.id === 'menu') {
      // fixed markup, never from data
      const icon = el('span', { class: 'mb-icon' });
      icon.innerHTML = alertIconSvg(MENU_ICON, 13);
      b.prepend(icon);
    }
    if (!entry.run) {
      b.setAttribute('aria-haspopup', 'menu');
      b.setAttribute('aria-expanded', 'false');
    }
    b.addEventListener('mouseenter', () => {
      if (this.state.hover(entry.id)) this.draw();
    });
    return b;
  }

  private row(item: MenuItem) {
    const b = btn(item.label, () => this.picked(item.action), `mb-item mb-${item.action}`);
    b.setAttribute('role', 'menuitem');
    if (item.hint) b.title = item.hint;
    if (item.key) b.append(el('kbd', { text: item.key }));
    return b;
  }

  private clicked(id: MenuId) {
    const run = this.state.click(id);
    this.draw();
    if (run) this.actions?.[run]();
  }

  private picked(action: MenuAction) {
    const run = this.state.pick(action);
    this.draw();
    if (run) this.actions?.[run]();
  }

  /**
   * A press anywhere else closes the menu. On the map that is all it does: the world never sees a
   * press that only dismissed a menu, or a tool in hand would build there. Over the UI the press
   * goes on, so a button there still works.
   */
  private readonly onMouseDown = (e: MouseEvent) => {
    if (this.state.open === null) return;
    const on = e.target as Element | null;
    if (on?.closest?.('.mb-entry, #menu-pane')) return;
    this.close();
    if (!on?.closest?.('#ui-root')) e.stopPropagation();
  };

  private draw() {
    const open = this.state.open;
    for (const [id, b] of this.entries) {
      b.classList.toggle('active', id === open);
      if (b.hasAttribute('aria-expanded')) b.setAttribute('aria-expanded', String(id === open));
    }
    const shown = new Set(this.state.items.map((i) => i.action));
    for (const [action, row] of this.rows) row.style.display = shown.has(action) ? '' : 'none';
    this.pane.style.display = open ? '' : 'none';
    this.place();
  }

  /** The pane under the open entry: called again when the bar's spacing moves the entry. */
  place() {
    const entry = this.state.open && this.entries.get(this.state.open);
    if (entry) this.pane.style.left = `${Math.round(entry.getBoundingClientRect().left)}px`;
  }

  get isOpen() {
    return this.state.open !== null;
  }

  close() {
    if (this.state.close()) this.draw();
  }

  /** The entries of a mode, and a menu that was open goes. */
  setMode(mode: MenuMode) {
    this.state.setMode(mode);
    const shown = new Set(this.state.entries.map((e) => e.id));
    for (const [id, cell] of this.cells) cell.style.display = shown.has(id) ? '' : 'none';
    this.draw();
  }

  /** A switch's row: ticked while it is on. */
  setOn(action: MenuAction, on: boolean) {
    this.rows.get(action)?.classList.toggle('on', on);
  }

  /** A row's tooltip. */
  setHint(action: MenuAction, hint: string) {
    const row = this.rows.get(action);
    if (row) row.title = hint;
  }

  /** A row's count, empty for none; `urgent` draws it in red. */
  setBadge(action: MenuAction, count: string, urgent: boolean) {
    for (const b of this.badges.get(action) ?? []) {
      b.textContent = count;
      b.classList.toggle('urgent', urgent);
    }
  }
}
