import { STR } from '../strings';
import type { SlotMeta } from '../sim/save';
import { el } from './dom';
import {
  actionButton,
  lineIcon,
  listRow,
  note,
  page,
  textField,
  well,
  type FootSpec,
  type TabDef,
} from './kit';
import type { FrameTabs, Screen } from './modal';
import { slotRows, textLines, type Confirm, type SlotActions, type Track } from './saveRows';
import {
  SLOT_NAME_MAX,
  canSaveHere,
  continueText,
  loadEffect,
  saveNameState,
  savedGamesTabs,
  type LoadEffect,
  type ReplaceSituation,
} from './saveSlots';

export type SavedTab = 'save' | 'load';

/** What the screen needs of the game. */
export interface SavedGamesActions extends SlotActions {
  /** the stored game Continue loads, null when there is none */
  autosave(): SlotMeta | null;
  /** when the stored game was last written; the screen draws it again when this moves */
  savedAt(): number | null;
  autosaveOn(): boolean;
  /** load the stored game: asks first over a game in play (panels) */
  loadLast(): void;
  /** where the player stands: what a load replaces, and whether there is a game to save */
  situation(): ReplaceSituation;
  /** the name offered, "Day N · seed" */
  defaultName(): string;
  /** store the game under a name and say so; false when storage refused it */
  saveAs(name: string): boolean;
}

/**
 * One screen for saving under a name and for loading: the title's Saved games, the pause menu's
 * Save as... and Load game, Settings' Save as... It has a Save tab (off where no game is being
 * played) and a Load tab with the autosave apart, above the named saves.
 */
export class SavedGamesScreen implements Screen {
  readonly id = 'saved';
  readonly title = STR.savedGames.title;
  readonly frameSize = 'M';
  readonly icon = 'folder';
  readonly formKeys = true;
  readonly root = page();
  /** what happens after a save went through: the menus close, or the screen goes back */
  onSaved: () => void = () => undefined;
  /** the frame's footer is drawn again now: the name typed changed what Save as may do */
  redraw: () => void = () => undefined;
  private tab: SavedTab = 'load';
  /** what the player typed, null for the name offered */
  private typed: string | null = null;
  private count = el('span', { class: 'k-count' });
  private name = textField({
    icon: 'saveas',
    placeholder: STR.savedGames.nameField,
    maxLength: SLOT_NAME_MAX,
    title: STR.savedGames.nameHint,
    onInput: (text) => {
      this.typed = text;
      this.nameChanged();
    },
    onEnter: () => void this.save(),
    onClear: () => {
      this.typed = null;
      this.name.input.value = this.actions.defaultName();
      this.nameChanged();
    },
  });
  /** the note under the field, and the list's rows, which follow the name typed */
  private nameNote = note('');
  private pickRows: { name: string; row: HTMLElement }[] = [];
  /** lines that say how long ago, and what they say now */
  private clocks: { line: HTMLElement; text: () => string }[] = [];
  private drawnSavedAt: number | null = null;
  /** read when the tab is drawn: storage is not parsed at every refresh */
  private slots: SlotMeta[] = [];
  private where: ReplaceSituation | null = null;

  constructor(
    private readonly actions: SavedGamesActions,
    private readonly prompt: Confirm,
  ) {
    this.name.root.append(this.count);
  }

  /**
   * Get ready to open on a tab (a Save tab where nothing can be saved opens on Load): what the
   * frame's first strip and footer read is already there, and the name starts as the one offered.
   */
  show(tab: SavedTab) {
    this.tab = tab;
    this.typed = null;
    this.name.input.value = this.actions.defaultName();
    this.read();
  }
  private read() {
    this.slots = this.actions.slots();
    this.where = this.actions.situation();
  }
  private get situation(): ReplaceSituation {
    return (this.where ??= this.actions.situation());
  }
  private get canSave() {
    return canSaveHere(this.situation);
  }
  private get shown(): SavedTab {
    return this.tab === 'save' && this.canSave ? 'save' : 'load';
  }

  onOpen() {
    this.render();
  }
  refresh() {
    for (const c of this.clocks) {
      const text = c.text();
      if (c.line.textContent !== text) c.line.textContent = text;
    }
    // an autosave went through: its row says what it holds now, unless the pointer is on it
    if (this.shown === 'load' && this.actions.savedAt() !== this.drawnSavedAt) {
      if (!this.root.querySelector('.sg-auto:hover')) this.render();
    }
  }
  frameTabs(): FrameTabs {
    const tabs: TabDef[] = savedGamesTabs(this.canSave, this.slots.length).map((t) => ({
      id: t.id,
      label: t.label,
      count: t.count,
      off: t.off,
    }));
    return {
      tabs,
      current: this.shown,
      pick: (id) => {
        this.tab = id as SavedTab;
        this.render();
      },
    };
  }
  frameFooter(): FootSpec {
    if (this.shown === 'save') {
      const s = this.state();
      return {
        actions: [
          {
            label: STR.savedGames.saveAsAction,
            primary: true,
            icon: 'saveas',
            disabled: !s.canSave,
            title: !s.canSave
              ? STR.savedGames.saveAsNoName
              : s.clash
                ? STR.savedGames.saveAsClash
                : STR.savedGames.saveAsHint,
            onClick: () => void this.save(),
          },
        ],
      };
    }
    return { note: STR.savedGames.loadNote[this.effect()] };
  }

  private effect(): LoadEffect {
    return loadEffect(this.situation);
  }
  private state() {
    return saveNameState(
      this.typed,
      this.actions.defaultName(),
      this.slots.map((s) => s.name),
    );
  }

  /** The note and the list follow the name as it is typed; the field itself is never touched. */
  private nameChanged() {
    const s = this.state();
    this.count.textContent = `${s.shown.length}/${SLOT_NAME_MAX}`;
    this.nameNote.textContent = s.clash
      ? STR.savedGames.clashNote(s.name)
      : STR.savedGames.nameNote;
    this.nameNote.classList.toggle('warn', s.clash);
    for (const p of this.pickRows) p.row.classList.toggle('on', p.name === s.name);
    this.redraw();
  }

  /** Save under the name typed; replacing a save asks first, and a no changes nothing. */
  private async save() {
    const s = this.state();
    if (!s.canSave || !this.canSave) return;
    if (
      s.clash &&
      !(await this.prompt.confirm(STR.saves.overwriteTitle, STR.saves.confirmOverwrite(s.name), {
        yes: STR.prompt.replace,
        danger: true,
      }))
    )
      return;
    if (this.actions.saveAs(s.name)) this.onSaved();
  }

  private track: Track = (line, text) => this.clocks.push({ line, text });

  private saveTab(): HTMLElement[] {
    const slots = this.slots;
    const s = this.state();
    this.count.textContent = `${s.shown.length}/${SLOT_NAME_MAX}`;
    this.nameNote.textContent = s.clash
      ? STR.savedGames.clashNote(s.name)
      : STR.savedGames.nameNote;
    this.nameNote.classList.toggle('warn', s.clash);
    const rows = slotRows(
      this.actions,
      this.prompt,
      () => this.render(),
      STR.savedGames.noNamedPick,
      {
        pick: {
          on: (n) => n === s.name,
          onPick: (n) => {
            this.typed = n;
            this.name.input.value = n;
            this.nameChanged();
          },
        },
        track: this.track,
      },
    );
    this.pickRows = slots.map((m, i) => ({ name: m.name, row: rows[i] }));
    return [
      well(
        STR.savedGames.saveAsWell,
        el('div', { class: 'k-inrow' }, this.name.root),
        this.nameNote,
      ),
      well(
        { title: STR.savedGames.named, right: String(slots.length) },
        slots.length ? note(STR.savedGames.pickNote) : null,
        ...rows,
      ),
    ];
  }

  /** The autosave row: the game Continue loads, its Load in the column the named saves' Loads use. */
  private autosaveRow(): HTMLElement {
    const meta = this.actions.autosave();
    const on = this.actions.autosaveOn();
    const sub = meta
      ? textLines(continueText({ meta, live: false }, Date.now()), 'k-sub', (line) =>
          this.track(line, () => continueText({ meta, live: false }, Date.now()).saved ?? ''),
        )
      : [el('div', { class: 'k-sub', text: STR.saves.autosaveStatus(on, null) })];
    const load = actionButton(STR.settings.loadSlot, () => this.actions.loadLast(), {
      cls: 'small',
      icon: 'folder',
      disabled: !meta,
      title: meta
        ? this.effect() === 'game'
          ? STR.savedGames.loadLastOver
          : STR.savedGames.loadLastStored
        : STR.savedGames.loadLastNone,
    });
    // a Delete the autosave does not have, hidden: Load stands where the named saves' Loads do
    const hold = actionButton(STR.settings.deleteSlot, () => undefined, { cls: 'small danger' });
    hold.classList.add('k-hold');
    hold.setAttribute('aria-hidden', 'true');
    hold.tabIndex = -1;
    return listRow({
      title: el('span', { class: 'k-ttl-ic' }, lineIcon('save'), STR.savedGames.autosave),
      sub: [el('span', {}, ...sub)],
      right: [load, hold],
      cls: 'sg-auto',
    });
  }

  private loadTab(): HTMLElement[] {
    const slots = this.slots;
    const on = this.actions.autosaveOn();
    this.drawnSavedAt = this.actions.savedAt();
    const tip = STR.savedGames.loadThis(STR.savedGames.loadTip[this.effect()]);
    return [
      well(
        {
          title: STR.savedGames.autosave,
          right: on ? STR.savedGames.autosaveEvery : STR.savedGames.autosaveOff,
        },
        this.autosaveRow(),
      ),
      well(
        { title: STR.savedGames.named, right: String(slots.length) },
        ...slotRows(this.actions, this.prompt, () => this.render(), STR.menu.noSaves, {
          loadTitle: tip,
          track: this.track,
        }),
      ),
    ];
  }

  /** Draw the tab. The field is kept, so what is typed in it stays through any tab or list change. */
  render() {
    this.read();
    this.clocks = [];
    this.pickRows = [];
    this.root.replaceChildren(...(this.shown === 'save' ? this.saveTab() : this.loadTab()));
  }
}
