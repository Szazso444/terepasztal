import { el } from './dom';
import { actionButton, lineIcon, note, page, well, type IconName } from './kit';
import { ScreenFrame, type Screen, type ScreenManager } from './modal';
import { STR } from '../strings';
import type { LevelData } from '../world/level';
import type { SupplyMode } from '../sim/supply';
import type { SlotMeta } from '../sim/save';
import { textLines, type Confirm, type SlotActions } from './saveRows';
import { continueText, type Replacement, type ReplaceEffect } from './saveSlots';
import { LevelsScreen } from './levelsScreen';
import { NewGameScreen } from './newGameScreen';
import { titleEntries, type TitleEntry } from './titleModel';

export { slotRows, confirmDeleteSlot, slotLines } from './saveRows';
export type { Confirm, SlotActions } from './saveRows';

/**
 * What Continue goes back to, described like a save: the stored save (`continueMeta()`), or with
 * `live` the game being played under the title screen, which it was opened over.
 */
export interface ContinueTarget {
  meta: SlotMeta;
  live: boolean;
}

export interface MainMenuActions extends SlotActions {
  continue(): void;
  /** `tuning` is the saved tuning picked under New game, null for the shipped rules */
  newGame(seed: string, supply: SupplyMode, tuning: string | null): void;
  /** the tunings saved in Game tuning, newest first */
  tunings(): { name: string }[];
  /** the levels kept in this browser, newest first */
  levels(): LevelData[];
  /** what a replacement of this kind loses, for the tips of the buttons that start it */
  asks(kind: Replacement): ReplaceEffect | null;
  playLevel(id: string): void;
  editLevel(id: string): void;
  newLevel(size: number, generated: boolean, seed: string): void;
  deleteLevel(id: string): void;
  importLevel(json: string): boolean;
  exportLevel(id: string): string;
  /** Saved games, on its Load tab */
  savedGames(): void;
  tuning(): void;
  content(): void;
  settings(): void;
  audio(): void;
  /** Settings, on its Controls tab */
  controls(): void;
  credits(): void;
}

/**
 * The title screen: the root of the menus, an S frame with the wordmark for its header and no ×.
 * Its buttons open New game, Saved games, Levels and Settings over it; Esc and a click beside it
 * do nothing, as there is nothing under it to go back to. Over a game it says Paused.
 */
export class MainMenu {
  readonly root = el('div', { id: 'menu-root', class: 'menu-root' });
  private frame = new ScreenFrame(() => undefined);
  private newGame: NewGameScreen;
  private levelsScreen: LevelsScreen;
  /** what the title was last shown with: it is drawn again, for its counts, when a screen leaves */
  private last: { save: ContinueTarget | null; custom: { content: boolean } } | null = null;
  /** the counts on the buttons; read again only after something that changes them */
  private counts = { named: 0, levels: 0 };
  private stale = true;
  visible = false;

  constructor(
    private readonly actions: MainMenuActions,
    prompt: Confirm,
    private readonly screens: Pick<ScreenManager, 'open'>,
  ) {
    this.newGame = new NewGameScreen({
      newGame: (seed, supply, tuning) => actions.newGame(seed, supply, tuning),
      tunings: () => actions.tunings(),
      asks: () => actions.asks('overwrite'),
    });
    this.levelsScreen = new LevelsScreen(
      {
        levels: () => actions.levels(),
        playLevel: (id) => actions.playLevel(id),
        editLevel: (id) => actions.editLevel(id),
        newLevel: (size, generated, seed) => actions.newLevel(size, generated, seed),
        deleteLevel: (id) => {
          actions.deleteLevel(id);
          this.changed();
        },
        importLevel: (json) => {
          const kept = actions.importLevel(json);
          if (kept) this.changed();
          return kept;
        },
        asks: () => actions.asks('overwrite'),
      },
      prompt,
    );
    this.root.append(this.frame.root);
    this.root.style.display = 'none';
  }

  /** `save` is what Continue goes back to, null when there is nothing to continue. */
  show(save: ContinueTarget | null, custom: { content: boolean }) {
    this.visible = true;
    this.root.style.display = 'flex';
    document.body.classList.add('title-up');
    this.last = { save, custom };
    this.stale = true;
    this.render();
  }
  hide() {
    this.visible = false;
    this.root.style.display = 'none';
    document.body.classList.remove('title-up');
  }
  /** A screen over the title takes the view and the scrim: the map dims once. */
  setCovered(covered: boolean) {
    this.root.style.visibility = covered ? 'hidden' : '';
    // what the screen over it changed (a level imported, a save deleted) shows on its buttons
    if (!covered && this.visible) this.render();
  }

  /** A save or a level was added or deleted: the counts are read again when the title is drawn. */
  changed() {
    this.stale = true;
  }

  /** The tunings saved in Game tuning, drawn again in New game, and nothing else of it. */
  refreshTunings() {
    this.newGame.refreshTunings();
  }

  private press(e: TitleEntry) {
    const a = this.actions;
    switch (e.id) {
      case 'continue':
        return a.continue();
      case 'newGame':
        return this.screens.open(this.newGame);
      case 'saved':
        return a.savedGames();
      case 'levels':
        return this.screens.open(this.levelsScreen);
      case 'settings':
        return a.settings();
      case 'audio':
        return a.audio();
      case 'controls':
        return a.controls();
      case 'tuning':
        return a.tuning();
      case 'content':
        return a.content();
      case 'credits':
        return a.credits();
    }
  }

  private button(e: TitleEntry, save: ContinueTarget | null): HTMLButtonElement {
    const b = actionButton(e.label, () => this.press(e), {
      icon: e.icon,
      cls: e.primary ? 'pri' : '',
      extra: e.count !== undefined ? String(e.count) : undefined,
      title: e.off ?? e.tip,
      disabled: !!e.off,
    });
    if (e.mark) b.append(el('small', { class: 'ti-mod', text: e.mark }));
    if (e.id === 'continue') {
      // what Continue goes back to, in the body font under the title-font label
      const lines = save
        ? textLines(continueText(save, Date.now()), 'ti-line')
        : [el('div', { class: 'ti-line', text: STR.menu.noSaveLine })];
      b.replaceChildren(
        lineIcon(e.icon),
        el('span', { class: 'ti-main' }, el('b', { text: e.label }), ...lines),
      );
    }
    return b;
  }

  private render() {
    const { save, custom } = this.last ?? { save: null, custom: { content: false } };
    if (this.stale) {
      this.stale = false;
      this.counts = { named: this.actions.slots().length, levels: this.actions.levels().length };
    }
    const entries = titleEntries({
      canContinue: !!save,
      overGame: !!save?.live,
      named: this.counts.named,
      levels: this.counts.levels,
      contentModified: custom.content,
    });
    const buttons = entries.map((e) => this.button(e, save));
    const screen: Screen = {
      id: 'title',
      title: STR.title,
      frameSize: 'S',
      frameClass: 'k-title',
      noClose: true,
      formKeys: true,
      root: page(
        note(STR.menu.tagline, 'k-tag'),
        well(null, el('div', { class: 'k-stack' }, ...buttons)),
      ),
    };
    this.frame.show(screen, { stacked: false, paused: !!save?.live });
    // nothing has the focus when it opens: it starts on the first button that can be pressed, so
    // Tab goes on from there and Enter presses it
    buttons.find((b) => !b.disabled)?.focus();
  }
}

export interface PauseMenuActions extends SlotActions {
  resume(): void;
  save(): void;
  /** Saved games, on its Save tab */
  saveAs(): void;
  /** Saved games, on its Load tab */
  loadGame(): void;
  settings(): void;
  audio(): void;
  tuning(): void;
  content(): void;
  backToEditor(): void;
  mainMenu(): void;
}

/** In-game menu (Esc / Menu button): an S frame of its own, under the screens opened from it. */
export class PauseMenu {
  readonly root = el('div', { id: 'pause-root', class: 'menu-root' });
  private frame = new ScreenFrame(() => this.actions.resume());
  visible = false;
  /** what it was last shown with: it is drawn again, for the count on Load game, when a screen leaves */
  private shown: { testing: boolean; editor: boolean } | null = null;
  constructor(private readonly actions: PauseMenuActions) {
    this.root.append(this.frame.root);
    this.root.style.display = 'none';
    this.root.addEventListener('mousedown', (e) => {
      if (e.target === this.root) this.actions.resume();
    });
  }
  show(opts: { testing: boolean; editor: boolean }) {
    this.shown = opts;
    this.visible = true;
    this.root.style.display = 'flex';
    const item = (icon: IconName, label: string, run: () => void, cls = '', extra?: string) =>
      actionButton(label, run, { icon, cls, extra });
    const resume = item('play', STR.menu.resume, () => this.actions.resume(), 'pri', STR.kit.esc);
    const stack = el('div', { class: 'k-stack' }, resume);
    if (!opts.editor)
      stack.append(
        item('save', STR.settings.save, () => this.actions.save()),
        item('saveas', STR.menu.saveAs, () => this.actions.saveAs()),
        item(
          'folder',
          STR.menu.loadGame,
          () => this.actions.loadGame(),
          '',
          String(this.actions.slots().length),
        ),
      );
    stack.append(
      item('gear', STR.topbar.settings, () => this.actions.settings()),
      item('speaker', STR.settings.audio, () => this.actions.audio()),
      item('slider', STR.menu.tuning, () => this.actions.tuning()),
      item('list', STR.menu.content, () => this.actions.content()),
    );
    if (opts.testing)
      stack.append(item('undo', STR.menu.backToEditor, () => this.actions.backToEditor()));
    stack.append(item('home', STR.menu.mainMenu, () => this.actions.mainMenu()));
    const screen: Screen = {
      id: 'pause',
      title: opts.editor ? STR.editor.title : STR.menu.menuButton,
      frameSize: 'S',
      hotkey: STR.kit.esc,
      hotkeyHint: STR.menu.menuKeyHint,
      formKeys: true,
      root: page(well(null, stack)),
    };
    this.frame.show(screen, { stacked: false, paused: !opts.editor });
    resume.focus();
  }
  hide() {
    this.visible = false;
    this.root.style.display = 'none';
  }
  /** A screen over the menu takes the view and the scrim: the map dims once. */
  setCovered(covered: boolean) {
    this.root.style.visibility = covered ? 'hidden' : '';
    // the count on Load game follows what Saved games saved or deleted
    if (!covered && this.visible && this.shown) this.show(this.shown);
  }
}
