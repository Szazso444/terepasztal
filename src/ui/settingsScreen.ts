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
  slider,
  textField,
  toggleSwitch,
  well,
  type FootSpec,
} from './kit';
import { contractRarityLabel } from './labels';
import { STR } from '../strings';
import type { FrameTabs, Screen } from './modal';
import { slotRows, type Confirm } from './menu';
import { autosaveText } from './saveSlots';
import {
  CONTRACT_RARITIES,
  contractPolicyFor,
  hasSlot,
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
  saveAs(name: string): boolean;
  loadSlot(name: string): void;
  deleteSlot(name: string): void;
  /** the named saves, newest first */
  slots(): SlotMeta[];
}

type Tab = 'audio' | 'gameplay' | 'contracts' | 'signalling' | 'controls' | 'saves';

const TABS: { id: Tab; label: string }[] = [
  { id: 'audio', label: STR.settings.audio },
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
  private tab: Tab = 'audio';
  /** how many named saves the Saves tab counts; storage is not read at every refresh */
  private slotCount = 0;
  /** autosave on or off and when the game was last stored; kept current while the screen is up */
  private autosaveLine = el('div', { class: 'k-kv' });
  // the fields outlive a redraw of the tab: what is typed in them stays
  private nameField = textField({
    placeholder: STR.settings.slotName,
    maxLength: 32,
    onEnter: () => void this.saveAs(),
  });
  private seedField = textField({ placeholder: STR.settings.seedPlaceholder });
  private transferBox = pasteBox();

  constructor(
    private readonly settings: Settings,
    private readonly onChange: () => void,
    private readonly actions: SettingsActions,
    private readonly info: () => {
      seed: number;
      savedAt: number | null;
      version: string;
      warning: string | null;
      /** there is no game to save: the title screen at boot */
      saveOff: boolean;
    },
    /** the game's dialog, for overwrite, delete and import questions */
    private readonly prompt: Confirm,
  ) {}

  onOpen() {
    this.render();
  }
  refresh() {
    if (this.tab === 'saves') this.showAutosave();
  }
  frameTabs(): FrameTabs {
    return {
      tabs: TABS.map((t) => (t.id === 'saves' ? { ...t, count: this.slotCount } : t)),
      current: this.tab,
      pick: (id) => {
        this.tab = id as Tab;
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
    if (this.autosaveLine.textContent !== text) {
      this.autosaveLine.textContent = '';
      this.autosaveLine.append(el('span', { text }));
    }
    this.autosaveLine.title = savedAt ? new Date(savedAt).toLocaleString() : '';
  }

  private volume(label: string, key: 'master' | 'sfx' | 'music' | 'ambient') {
    return formRow(
      label,
      slider({
        label,
        value: Math.round((this.settings[key] ?? 0.35) * 100),
        onInput: (v) => {
          this.settings[key] = v / 100;
          this.onChange();
        },
      }),
    );
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
    const off = { disabled: info.saveOff, title: info.saveOff ? STR.settings.saveOff : undefined };
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
        el(
          'div',
          { class: 'k-inrow' },
          this.nameField.root,
          actionButton(STR.settings.saveAs, () => void this.saveAs(), { ...off, icon: 'saveas' }),
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

  private async saveAs() {
    const f = this.nameField.input;
    const n = f.value.trim();
    if (!n) return;
    // replacing a save is asked first; a no writes nothing and leaves the name to change
    if (
      hasSlot(n) &&
      !(await this.prompt.confirm(STR.saves.overwriteTitle, STR.saves.confirmOverwrite(n), {
        yes: STR.prompt.replace,
        danger: true,
      }))
    )
      return;
    if (this.actions.saveAs(n)) {
      f.value = '';
      this.render();
    }
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
      case 'audio':
        return [
          well(
            STR.settings.audio,
            this.volume(STR.settings.master, 'master'),
            this.volume(STR.settings.sfx, 'sfx'),
            this.volume(STR.settings.music, 'music'),
            this.volume(STR.settings.ambient, 'ambient'),
            note(STR.settings.audioNote),
          ),
        ];
      case 'gameplay':
        return [
          well(
            STR.settings.gameplay,
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
