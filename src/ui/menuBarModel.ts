/**
 * The top bar's menu bar worked out: its entries and their items in play and in the level editor,
 * and which menu is open. No DOM here, so it runs under Node; `menuBar.ts` draws it.
 */
import { STR } from '../strings';
import type { IconName } from './kit';
import { glyph, title, type TipDoc } from './tooltipDoc';

/** Everything the bar can do; `MenuBar.actions` has the code for each. */
export type MenuAction =
  | 'pause'
  | 'save'
  | 'savedGames'
  | 'settings'
  | 'audio'
  | 'depot'
  | 'roster'
  | 'signals'
  | 'contracts'
  | 'contractSettings'
  | 'market'
  | 'crafting'
  | 'cheat'
  | 'overview'
  | 'weather'
  | 'dayNight'
  | 'advisor'
  | 'notifications'
  | 'guide';

export type MenuId =
  | 'menu'
  | 'save'
  | 'savedGames'
  | 'settings'
  | 'audio'
  | 'fleet'
  | 'economy'
  | 'view'
  | 'notifications'
  | 'guide';

/** play = a game; editor = the level editor */
export type MenuMode = 'play' | 'editor';

export interface MenuItem {
  readonly action: MenuAction;
  readonly label: string;
  readonly icon: IconName;
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
  readonly icon: IconName;
  /** an entry with no menu: a click does this at once */
  readonly run?: MenuAction;
  /** what its tooltip says in place of its label */
  readonly tip?: string;
  readonly playOnly?: boolean;
  /** it has no place on the bar yet */
  readonly items: readonly MenuItem[];
}

/** The bar, left to right, each menu top to bottom. */
export const MENU_BAR: readonly MenuEntry[] = [
  {
    id: 'menu',
    label: STR.menu.menuButton,
    icon: 'menu',
    run: 'pause',
    tip: STR.topbar.menuTip,
    items: [],
  },
  {
    id: 'save',
    label: STR.topbar.save,
    icon: 'save',
    run: 'save',
    playOnly: true,
    items: [],
  },
  {
    id: 'savedGames',
    label: STR.menu.savedGames,
    icon: 'saves',
    run: 'savedGames',
    playOnly: true,
    items: [],
  },
  {
    id: 'settings',
    label: STR.topbar.settings,
    icon: 'gear',
    run: 'settings',
    playOnly: true,
    items: [],
  },
  {
    id: 'audio',
    label: STR.topbar.audio,
    icon: 'speaker',
    run: 'audio',
    items: [],
  },
  {
    id: 'fleet',
    label: STR.topbar.fleet,
    icon: 'train',
    items: [
      { action: 'depot', label: STR.topbar.depot, icon: 'shed', key: 'F', playOnly: true },
      { action: 'roster', label: STR.topbar.roster, icon: 'list', key: 'V', playOnly: true },
      { action: 'signals', label: STR.topbar.signals, icon: 'semaphore' },
    ],
  },
  {
    id: 'economy',
    label: STR.topbar.economy,
    icon: 'coin',
    items: [
      {
        action: 'contracts',
        label: STR.topbar.contracts,
        icon: 'scroll',
        key: 'C',
        playOnly: true,
      },
      {
        action: 'contractSettings',
        label: STR.topbar.contractSettings,
        icon: 'gear',
        playOnly: true,
      },
      { action: 'market', label: STR.topbar.market, icon: 'scale', key: 'K', playOnly: true },
      { action: 'crafting', label: STR.topbar.crafting, icon: 'factory', key: 'G', playOnly: true },
      { action: 'cheat', label: STR.topbar.cheat, icon: 'plus', playOnly: true },
    ],
  },
  {
    id: 'view',
    label: STR.topbar.view,
    icon: 'eye',
    items: [
      { action: 'overview', label: STR.topbar.overview, icon: 'map', key: 'M' },
      {
        action: 'weather',
        label: STR.hud.weatherToggle,
        icon: 'cloud',
        hint: STR.hud.weatherToggleHint,
      },
      { action: 'dayNight', label: STR.hud.dayToggle, icon: 'moon', hint: STR.hud.dayToggleHint },
      { action: 'advisor', label: STR.advisor.button, icon: 'bulb', badge: true },
    ],
  },
  {
    id: 'notifications',
    label: STR.alerts.title,
    icon: 'bell',
    run: 'notifications',
    playOnly: true,
    items: [],
  },
  {
    id: 'guide',
    label: STR.topbar.guide,
    icon: 'book',
    run: 'guide',
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
 * Whose labels go when the bar is short of room, first to last; the icon stays and the tooltip
 * names it. First the entries that do one thing and whose icon says it (the longest labels come
 * early, as they free the most), last the three menus, whose names say what is behind them.
 */
export const FOLD_ORDER: readonly MenuId[] = [
  'notifications',
  'savedGames',
  'settings',
  'audio',
  'save',
  'guide',
  'menu',
  'view',
  'economy',
  'fleet',
];

/** The first `count` entries of the mode in `FOLD_ORDER`: the ones with no label. */
export function foldedEntries(mode: MenuMode, count: number): MenuId[] {
  const shown = new Set(entriesFor(mode).map((e) => e.id));
  return FOLD_ORDER.filter((id) => shown.has(id)).slice(0, count);
}

/** What an entry's tooltip says: its icon and its name, whether the label shows or not. */
export function entryTip(entry: MenuEntry): TipDoc {
  return [title(glyph(entry.icon), entry.tip ?? entry.label)];
}

/** A depot as the game tells the Fleet menu about it. */
export interface DepotFacts {
  readonly id: number;
  readonly name: string;
  readonly gauge: 'regular' | 'narrow';
  /** the trains at its platforms */
  readonly trains: number;
  /** its store is the one the resource bar shows */
  readonly shown: boolean;
}

/** One row of the Fleet menu under Depot. */
export interface DepotRow {
  readonly id: number;
  readonly label: string;
  readonly detail: string;
  readonly on: boolean;
}

/** The Fleet menu's rows of the depots, in the order given; none where the rows are closed. */
export function depotRows(mode: MenuMode, depots: readonly DepotFacts[]): DepotRow[] {
  if (mode !== 'play') return [];
  return depots.map((d) => ({
    id: d.id,
    label: d.name,
    detail: STR.topbar.depotDetail(d.gauge, d.trains),
    on: d.shown,
  }));
}

/** How long after a pick the next press still belongs to the menu: a double-click's second. */
export const PICK_GRACE_MS = 250;

/**
 * Which menu is open, and what the pointer does to it. A click opens a menu and a second one closes
 * it; with one open, resting on another menu's entry switches to it. An entry with no menu has no
 * pane to show: a click on it does what it does, and resting on it leaves the open menu alone.
 */
export class MenuBarState {
  open: MenuId | null = null;
  mode: MenuMode = 'play';
  /** when a row was last picked */
  private pickedAt = -Infinity;

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

  /** A row was picked at `now`: the menu closes; what to run, none for a row it does not have. */
  pick(action: MenuAction, now: number): MenuAction | null {
    const item = this.items.find((i) => i.action === action);
    this.open = null;
    if (!item) return null;
    this.pickedAt = now;
    return item.action;
  }

  /** A depot's row was picked at `now`, as `pick` has it; false outside the Fleet menu. */
  pickDepot(now: number): boolean {
    const fleet = this.open === 'fleet';
    this.open = null;
    if (fleet) this.pickedAt = now;
    return fleet;
  }

  /**
   * A press on the map at `now`: does the menu keep it from the map. A left press that dismisses a
   * menu only dismisses it, so a tool in hand does not build, and so does the second press of a
   * double-click on a row, which lands where the pane stood. The other buttons act as usual.
   */
  keepsPress(button: number, now: number): boolean {
    return button === 0 && (this.open !== null || now - this.pickedAt < PICK_GRACE_MS);
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
