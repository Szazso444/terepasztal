/**
 * The top bar's menu bar worked out: its entries and their items in play and in the level editor,
 * and which menu is open. No DOM here, so it runs under Node; `menuBar.ts` draws it.
 */
import { STR } from '../strings';

/** Everything the bar can do; `MenuBar.actions` has the code for each. */
export type MenuAction =
  | 'pause'
  | 'save'
  | 'savedGames'
  | 'settings'
  | 'quit'
  | 'depot'
  | 'roster'
  | 'signals'
  | 'contracts'
  | 'market'
  | 'crafting'
  | 'cheat'
  | 'overview'
  | 'weather'
  | 'dayNight'
  | 'advisor'
  | 'notifications';

export type MenuId = 'menu' | 'game' | 'fleet' | 'economy' | 'view' | 'notifications';

/** play = a game; editor = the level editor */
export type MenuMode = 'play' | 'editor';

export interface MenuItem {
  readonly action: MenuAction;
  readonly label: string;
  /** the key that does the same, right-aligned in the row */
  readonly key?: string;
  /** the row's own tooltip */
  readonly hint?: string;
  /** what it opens is closed in the level editor, and the row with it */
  readonly playOnly?: boolean;
  /** it carries a count, on the row and on its entry */
  readonly badge?: boolean;
}

export interface MenuEntry {
  readonly id: MenuId;
  readonly label: string;
  /** an entry with no menu: a click does this at once */
  readonly run?: MenuAction;
  /** the entry's own tooltip */
  readonly tip?: string;
  readonly playOnly?: boolean;
  readonly items: readonly MenuItem[];
}

/** The bar, left to right, each menu top to bottom. */
export const MENU_BAR: readonly MenuEntry[] = [
  { id: 'menu', label: STR.menu.menuButton, run: 'pause', tip: STR.topbar.menuTip, items: [] },
  {
    id: 'game',
    label: STR.topbar.game,
    items: [
      { action: 'save', label: STR.topbar.save, playOnly: true },
      { action: 'savedGames', label: STR.menu.savedGames, playOnly: true },
      { action: 'settings', label: STR.topbar.settings, playOnly: true },
      { action: 'quit', label: STR.topbar.quit },
    ],
  },
  {
    id: 'fleet',
    label: STR.topbar.fleet,
    items: [
      { action: 'depot', label: STR.topbar.depot, key: 'F', playOnly: true },
      { action: 'roster', label: STR.topbar.roster, key: 'V', playOnly: true },
      { action: 'signals', label: STR.topbar.signals },
    ],
  },
  {
    id: 'economy',
    label: STR.topbar.economy,
    items: [
      { action: 'contracts', label: STR.topbar.contracts, key: 'C', playOnly: true },
      { action: 'market', label: STR.topbar.market, key: 'K', playOnly: true },
      { action: 'crafting', label: STR.topbar.crafting, key: 'G', playOnly: true },
      { action: 'cheat', label: STR.topbar.cheat, playOnly: true },
    ],
  },
  {
    id: 'view',
    label: STR.topbar.view,
    items: [
      { action: 'overview', label: STR.topbar.overview, key: 'M' },
      { action: 'weather', label: STR.hud.weatherToggle, hint: STR.hud.weatherToggleHint },
      { action: 'dayNight', label: STR.hud.dayToggle, hint: STR.hud.dayToggleHint },
      { action: 'advisor', label: STR.advisor.button, badge: true },
    ],
  },
  {
    id: 'notifications',
    label: STR.alerts.title,
    run: 'notifications',
    playOnly: true,
    items: [],
  },
];

/** The bar in a mode: an entry left with nothing to open or do has no place in it. */
export function entriesFor(mode: MenuMode): MenuEntry[] {
  const inMode = (x: { playOnly?: boolean }) => mode === 'play' || !x.playOnly;
  return MENU_BAR.filter(inMode)
    .map((e) => ({ ...e, items: e.items.filter(inMode) }))
    .filter((e) => e.run || e.items.length);
}

/**
 * Which menu is open, and what the pointer does to it. A click opens a menu and a second one closes
 * it; with one open, resting on another menu's entry switches to it. An entry with no menu has no
 * pane to show: a click on it does what it does, and resting on it leaves the open menu alone.
 */
export class MenuBarState {
  open: MenuId | null = null;
  mode: MenuMode = 'play';

  get entries(): MenuEntry[] {
    return entriesFor(this.mode);
  }
  /** the rows of the open menu */
  get items(): readonly MenuItem[] {
    return this.entry(this.open)?.items ?? [];
  }
  private entry(id: MenuId | null) {
    return this.entries.find((e) => e.id === id);
  }

  /** A click on an entry; what it runs, if anything. */
  click(id: MenuId): MenuAction | null {
    const e = this.entry(id);
    if (!e) return null;
    if (e.run) {
      this.open = null;
      return e.run;
    }
    this.open = this.open === id ? null : id;
    return null;
  }

  /** The pointer came onto an entry; true when another menu opened. */
  hover(id: MenuId): boolean {
    const e = this.entry(id);
    if (this.open === null || this.open === id || !e || e.run) return false;
    this.open = id;
    return true;
  }

  /** A row was picked: the menu closes; what to run, none for a row the open menu does not have. */
  pick(action: MenuAction): MenuAction | null {
    const item = this.items.find((i) => i.action === action);
    this.open = null;
    return item ? item.action : null;
  }

  /** Close the open menu; true when one was open. */
  close(): boolean {
    const was = this.open !== null;
    this.open = null;
    return was;
  }

  setMode(mode: MenuMode) {
    this.mode = mode;
    this.open = null;
  }
}
