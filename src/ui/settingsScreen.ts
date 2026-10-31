import { SIGNAL_LEVELS } from '../sim/signals';
import { el } from './dom';
import {
  actionButton,
  buttonRow,
  choiceRows,
  columns,
  formRow,
  keyBadge,
  labelValue,
  note,
  pasteBox,
  segmented,
  textField,
  toggleSwitch,
  well,
  type FootSpec,
} from './kit';
import { contractRarityLabel } from './labels';
import { LANGUAGE, LANGUAGES, LANGUAGE_NAME, STR, type Language } from '../strings';
import type { FrameTabs, Screen } from './modal';
import { slotRows, type Confirm } from './saveRows';
import { autosaveText } from './saveSlots';
import {
  CONTRACT_RARITIES,
  contractPolicyFor,
  uniformContractPolicy,
  type ContractPolicy,
  type Settings,
  type SlotMeta,
} from '../sim/save';

export interface SettingsActions {
  save(): void;
  load(): void;
  newGame(seed: string): void;
  exportSave(): string | null;
  exportDiagnostics(): string;
  importSave(json: string): boolean;
  /** open Saved games on its Save tab: a save is named there */
  saveAs(): void;
  loadSlot(name: string): void;
  deleteSlot(name: string): void;
  /** the named saves, newest first */
  slots(): SlotMeta[];
}

export type SettingsTab = 'gameplay' | 'contracts' | 'signalling' | 'controls' | 'saves';

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'gameplay', label: STR.settings.gameplay },
  { id: 'contracts', label: STR.settings.contractsTab },
  { id: 'signalling', label: STR.settings.signalling },
  { id: 'controls', label: STR.settings.controls },
  { id: 'saves', label: STR.settings.saves },
];

interface KeyRow {
  keys: readonly string[];
  text: string;
}

/** One line of the key table: its keys, what they do. */
function keyRow(r: KeyRow): HTMLElement {
  return el(
    'div',
    { class: 'k-krow' },
    el('span', {}, ...r.keys.map((k) => keyBadge(k, ''))),
    el('span', { text: r.text }),
  );
}

/** One group of the key table: the short rows two to a line, then the others. */
function keyWell(g: (typeof STR.settings.keyGroups)[number]): HTMLElement {
  const short = 'short' in g ? g.short : undefined;
  return well(
    { title: g.title, cls: 'k-keys' },
    short ? el('div', { class: 'k-kgrid' }, ...short.map(keyRow)) : null,
    ...g.rows.map(keyRow),
  );
}

/** Settings and save management: the category tabs over form columns. */
export class SettingsScreen implements Screen {
  readonly id = 'settings';
  readonly title = STR.settings.title;
  readonly frameSize = 'M';
  readonly icon = 'gear';
  readonly formKeys = true;
  readonly root = el('div', { class: 'k-page' });
  /** the row that opens the Notifications screen */
  onNotifications: (() => void) | null = null;
  /** the language control: it reloads the page, or the control goes back (`render`) */
  onLanguage: ((language: Language) => void) | null = null;
  private tab: SettingsTab = 'gameplay';
  /** how many named saves the Saves tab counts; storage is not read at every refresh */
  private slotCount = 0;
  /** autosave on or off and when the game was last stored; kept current while the screen is up */
  private autosaveValue = el('b');
  private autosaveLine = el(
    'div',
    { class: 'k-kv' },
    el('span', { text: STR.saves.autosave }),
    this.autosaveValue,
  );
  // the fields outlive a redraw of the tab: what is typed in them stays
  private seedField = textField({ placeholder: STR.settings.seedPlaceholder });
  private transferBox = pasteBox({ placeholder: STR.settings.transferHint });

  constructor(
    private readonly settings: Settings,
    private readonly onChange: () => void,
    private readonly actions: SettingsActions,
    private readonly info: () => {
      seed: number;
      savedAt: number | null;
      version: string;
      warning: string | null;
      /** there is no game to save: the title screen at boot, the level editor */
      saveOff: boolean;
      /** why, as the buttons' tip; the title's reason without it */
      saveOffWhy?: string;
    },
    /** the game's dialog, for overwrite, delete and import questions */
    private readonly prompt: Confirm,
  ) {}

  /** Get ready to open on a tab: the title's Controls button opens it on the key table. */
  show(tab: SettingsTab) {
    this.tab = tab;
  }
  onOpen() {
    this.render();
  }
  /** Stand on a tab when it opens: a screen that sends the player here says which. */
  showTab(id: string) {
    if (TABS.some((t) => t.id === id)) this.tab = id as SettingsTab;
  }
  refresh() {
    if (this.tab === 'saves') this.showAutosave();
  }
  frameTabs(): FrameTabs {
    return {
      tabs: TABS.map((t) => (t.id === 'saves' ? { ...t, count: this.slotCount } : t)),
      current: this.tab,
      pick: (id) => {
        this.tab = id as SettingsTab;
        this.render();
      },
    };
  }
  frameFooter(): FootSpec {
    return { note: STR.settings.appliesAtOnce, done: true };
  }

  /** The autosave line: whether it is on, how long ago the game was stored, the date as title. */
  private showAutosave() {
    const savedAt = this.info().savedAt;
    const text = autosaveText(!!this.settings.autosave, savedAt, Date.now());
    if (this.autosaveValue.textContent !== text) this.autosaveValue.textContent = text;
    this.autosaveLine.title = savedAt ? new Date(savedAt).toLocaleString() : '';
  }

  private switchRow(
    label: string,
    key: 'edgeScroll' | 'autosave' | 'dayNight' | 'smoke' | 'showFps' | 'weather',
  ) {
    return formRow(
      label,
      toggleSwitch(
        label,
        () => !!this.settings[key],
        (v) => {
          this.settings[key] = v;
          this.onChange();
        },
      ),
    );
  }

  /** One row per contract rarity: what happens to a new offer of that rarity. */
  private contractPolicyRows(): HTMLElement[] {
    const POLICIES: ContractPolicy[] = ['accept', 'prompt', 'deny'];
    return CONTRACT_RARITIES.map((r) =>
      formRow(
        el('span', { class: `crarity-${r}` }, contractRarityLabel(r), STR.contracts.rarity[r] ?? r),
        segmented({
          options: POLICIES.map((p) => ({ id: p, label: STR.settings.policy[p] })),
          value: contractPolicyFor(this.settings, r),
          onChange: (id) => {
            if (!this.settings.contractPolicy)
              this.settings.contractPolicy = uniformContractPolicy(
                contractPolicyFor(this.settings, r),
              );
            this.settings.contractPolicy[r] = id as ContractPolicy;
            this.onChange();
          },
        }),
      ),
    );
  }

  private saveTab(): HTMLElement {
    const info = this.info();
    this.showAutosave();
    const why = info.saveOffWhy ?? STR.settings.saveOff;
    const off = { disabled: info.saveOff, title: info.saveOff ? why : undefined };
    const left = [
      well(
        STR.settings.thisGame,
        labelValue(STR.debug.seed, String(info.seed)),
        this.autosaveLine,
        labelValue(STR.settings.version, info.version),
        info.warning ? note(info.warning, 'bad') : null,
        buttonRow(
          actionButton(
            STR.settings.save,
            () => {
              this.actions.save();
              this.render();
            },
            { ...off, icon: 'save' },
          ),
          actionButton(STR.settings.load, () => this.actions.load(), { icon: 'folder' }),
        ),
        note(STR.settings.formatNote),
      ),
      well(
        STR.settings.newGame,
        note(STR.settings.newGameNote),
        el(
          'div',
          { class: 'k-inrow' },
          this.seedField.root,
          actionButton(STR.settings.newGame, () => void this.newGame(), { cls: 'danger' }),
        ),
      ),
    ];
    const area = this.transferBox;
    const right = [
      well(
        { title: STR.settings.slots, right: String(this.slotCount) },
        buttonRow(
          actionButton(STR.menu.saveAs, () => this.actions.saveAs(), {
            ...off,
            title: info.saveOff ? why : STR.settings.saveAsOpens,
            icon: 'saveas',
          }),
        ),
        ...slotRows(this.actions, this.prompt, () => this.render(), STR.settings.noSlots),
      ),
      well(
        STR.settings.transfer,
        el(
          'div',
          { class: 'k-xfer' },
          area,
          el(
            'div',
            { class: 'k-btncol' },
            actionButton(
              STR.settings.exportSave,
              () => {
                area.value = this.actions.exportSave() ?? '';
              },
              { cls: 'small', icon: 'export' },
            ),
            actionButton(STR.settings.importSave, () => void this.importSave(), {
              cls: 'small',
              icon: 'import',
            }),
            actionButton(
              STR.settings.diagnostics,
              () => {
                area.value = this.actions.exportDiagnostics();
                area.select();
                void navigator.clipboard?.writeText(area.value).catch(() => undefined);
              },
              { cls: 'small', icon: 'copy' },
            ),
          ),
        ),
        note(STR.settings.diagnosticsHint),
      ),
    ];
    return columns(left, right);
  }

  private async newGame() {
    if (
      await this.prompt.confirm(STR.settings.newGame, STR.settings.confirmNew, {
        yes: STR.prompt.start,
        danger: true,
      })
    )
      this.actions.newGame(this.seedField.input.value.trim());
  }

  private async importSave() {
    const text = this.transferBox.value.trim();
    if (!text) return;
    if (
      await this.prompt.confirm(STR.saves.importTitle, STR.settings.confirmImport, {
        yes: STR.prompt.import,
      })
    )
      this.actions.importSave(text);
  }

  private drawTab(): (HTMLElement | null)[] {
    switch (this.tab) {
      case 'gameplay':
        return [
          well(
            STR.settings.gameplay,
            formRow(
              STR.settings.language,
              segmented({
                options: LANGUAGES.map((id) => ({ id, label: LANGUAGE_NAME[id] })),
                value: LANGUAGE,
                onChange: (id) => this.onLanguage?.(id as Language),
              }),
              STR.settings.languageNote,
            ),
            this.switchRow(STR.settings.edgeScroll, 'edgeScroll'),
            this.switchRow(STR.settings.autosave, 'autosave'),
            this.switchRow(STR.settings.dayNight, 'dayNight'),
            this.switchRow(STR.settings.smoke, 'smoke'),
            this.switchRow(STR.settings.weather, 'weather'),
            this.switchRow(STR.settings.showFps, 'showFps'),
            formRow(
              STR.alerts.title,
              actionButton(STR.alerts.open, () => this.onNotifications?.(), { cls: 'small' }),
            ),
          ),
        ];
      case 'contracts':
        return [
          well(
            STR.settings.contractPolicy,
            ...this.contractPolicyRows(),
            note(STR.settings.contractPolicyHint),
          ),
        ];
      case 'signalling':
        return [
          well(
            STR.settings.signalling,
            choiceRows({
              options: SIGNAL_LEVELS.map((lv) => ({
                id: lv,
                label: STR.settings.signalLevel[lv],
                hint: STR.settings.signalHint[lv],
              })),
              value: this.settings.signalling ?? 'auto',
              onChange: (id) => {
                this.settings.signalling = id as (typeof SIGNAL_LEVELS)[number];
                this.onChange();
              },
            }),
            note(STR.settings.signallingNote),
          ),
        ];
      case 'controls': {
        const groups = STR.settings.keyGroups;
        return [columns(groups.slice(0, 3).map(keyWell), groups.slice(3).map(keyWell))];
      }
      case 'saves':
        return [this.saveTab()];
    }
  }

  render() {
    this.slotCount = this.actions.slots().length;
    this.root.replaceChildren(...this.drawTab().filter((n) => n !== null));
  }
}
