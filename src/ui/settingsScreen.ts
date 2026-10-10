import { SIGNAL_LEVELS } from '../sim/signals';
import { el, btn } from './dom';
import { STR } from '../strings';
import type { Screen } from './modal';
import { confirmDeleteSlot, slotLines, type Confirm } from './menu';
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

/** Settings and save management. */
export class SettingsScreen implements Screen {
  readonly id = 'settings';
  readonly title = STR.settings.title;
  readonly root = el('div', { class: 'cols' });
  private left = el('div', { class: 'col-body' });
  private right = el('div', { class: 'col-body' });
  /** autosave on or off and when the game was last stored; kept current while the screen is up */
  private autosaveLine = el('div', { class: 'kv' });

  constructor(
    private readonly settings: Settings,
    private readonly onChange: () => void,
    private readonly actions: SettingsActions,
    private readonly info: () => {
      seed: number;
      savedAt: number | null;
      version: string;
      warning: string | null;
    },
    /** the game's dialog, for overwrite, delete and import questions */
    private readonly prompt: Confirm,
  ) {
    this.root.append(
      el(
        'div',
        { class: 'col' },
        el('div', { class: 'col-title', text: STR.settings.options }),
        this.left,
      ),
      el(
        'div',
        { class: 'col' },
        el('div', { class: 'col-title', text: STR.settings.saves }),
        this.right,
      ),
    );
  }
  onOpen() {
    this.render();
  }
  refresh() {
    this.showAutosave();
  }

  /** The autosave line: whether it is on, how long ago the game was stored, the date as title. */
  private showAutosave() {
    const savedAt = this.info().savedAt;
    const text = autosaveText(!!this.settings.autosave, savedAt, Date.now());
    if (this.autosaveLine.textContent !== text) {
      this.autosaveLine.textContent = '';
      this.autosaveLine.append(el('span', { class: 'k', text }));
    }
    this.autosaveLine.title = savedAt ? new Date(savedAt).toLocaleString() : '';
  }

  private slider(label: string, key: 'master' | 'sfx' | 'music' | 'ambient') {
    const input = el('input', {
      type: 'range',
      min: '0',
      max: '100',
      value: String(Math.round((this.settings[key] ?? 0.35) * 100)),
    }) as HTMLInputElement;
    const val = el('span', {
      class: 'num',
      text: `${Math.round((this.settings[key] ?? 0.35) * 100)}%`,
    });
    input.addEventListener('input', () => {
      this.settings[key] = Number(input.value) / 100;
      val.textContent = `${input.value}%`;
      this.onChange();
    });
    return el(
      'div',
      { class: 'kv' },
      el('span', { class: 'k', text: label }),
      el('span', {}, input, ' ', val),
    );
  }
  /** One row per contract rarity: what happens to a new offer of that rarity. */
  private contractPolicyRows(): HTMLElement[] {
    const POLICIES: ContractPolicy[] = ['accept', 'prompt', 'deny'];
    return CONTRACT_RARITIES.map((r) => {
      const current = contractPolicyFor(this.settings, r);
      const buttons = POLICIES.map((p) =>
        btn(
          STR.settings.policy[p],
          () => {
            if (!this.settings.contractPolicy)
              this.settings.contractPolicy = uniformContractPolicy(current);
            this.settings.contractPolicy[r] = p;
            this.onChange();
            this.render();
          },
          `tiny ${current === p ? 'active' : ''}`,
        ),
      );
      return el(
        'div',
        { class: 'kv' },
        el('span', { class: `k crarity-${r}`, text: STR.contracts.rarity[r] ?? r }),
        el('span', { class: 'row', style: 'margin:0;gap:3px' }, ...buttons),
      );
    });
  }
  private toggle(
    label: string,
    key: 'edgeScroll' | 'autosave' | 'dayNight' | 'smoke' | 'showFps' | 'weather',
  ) {
    const b = btn(
      this.settings[key] ? STR.settings.on : STR.settings.off,
      () => {
        this.settings[key] = !this.settings[key];
        b.textContent = this.settings[key] ? STR.settings.on : STR.settings.off;
        b.classList.toggle('active', this.settings[key]);
        this.onChange();
        if (key === 'autosave') this.showAutosave();
      },
      `small ${this.settings[key] ? 'active' : ''}`,
    );
    return el('div', { class: 'kv' }, el('span', { class: 'k', text: label }), b);
  }

  render() {
    const l = this.left;
    l.innerHTML = '';
    l.append(
      el('div', { class: 'col-title', text: STR.settings.audio }),
      this.slider(STR.settings.master, 'master'),
      this.slider(STR.settings.sfx, 'sfx'),
      this.slider(STR.settings.music, 'music'),
      this.slider(STR.settings.ambient, 'ambient'),
      el('div', { class: 'sub dim', style: 'margin:4px 0 10px', text: STR.settings.audioNote }),
      el('div', { class: 'col-title', text: STR.settings.gameplay }),
      this.toggle(STR.settings.edgeScroll, 'edgeScroll'),
      this.toggle(STR.settings.autosave, 'autosave'),
      this.toggle(STR.settings.dayNight, 'dayNight'),
      this.toggle(STR.settings.smoke, 'smoke'),
      this.toggle(STR.settings.weather, 'weather'),
      this.toggle(STR.settings.showFps, 'showFps'),
      el('div', {
        class: 'col-title',
        style: 'margin-top:10px',
        text: STR.settings.contractPolicy,
      }),
      ...this.contractPolicyRows(),
      el('div', { class: 'sub dim', text: STR.settings.contractPolicyHint }),
      el('div', { class: 'col-title', style: 'margin-top:10px', text: STR.settings.signalling }),
      el(
        'div',
        { class: 'row', style: 'gap:3px;flex-wrap:wrap' },
        ...SIGNAL_LEVELS.map((lv) =>
          btn(
            STR.settings.signalLevel[lv],
            () => {
              this.settings.signalling = lv;
              this.onChange();
              this.render();
            },
            `tiny ${(this.settings.signalling ?? 'auto') === lv ? 'active' : ''}`,
          ),
        ),
      ),
      el('div', { class: 'sub dim', text: STR.settings.signallingHint }),
      el('div', { class: 'col-title', style: 'margin-top:10px', text: STR.settings.controls }),
      el('div', { class: 'sub', text: STR.settings.controlsText }),
    );
    const r = this.right;
    r.innerHTML = '';
    const info = this.info();
    this.showAutosave();
    r.append(
      el(
        'div',
        { class: 'kv' },
        el('span', { class: 'k', text: STR.debug.seed }),
        el('span', { class: 'v', text: String(info.seed) }),
      ),
      this.autosaveLine,
      el(
        'div',
        { class: 'kv' },
        el('span', { class: 'k', text: STR.settings.version }),
        el('span', { class: 'v', text: info.version }),
      ),
      el(
        'div',
        { class: 'row' },
        btn(
          STR.settings.save,
          () => {
            this.actions.save();
            this.render();
          },
          'accent',
        ),
        btn(STR.settings.load, () => this.actions.load()),
      ),
    );
    // named slots
    const nameInput = el('input', {
      class: 'text',
      type: 'text',
      placeholder: STR.settings.slotName,
      maxlength: '32',
      style: 'width:160px',
    }) as HTMLInputElement;
    nameInput.addEventListener('keydown', (e) => e.stopPropagation());
    const slotList = el('div', { class: 'slots' });
    const slots = this.actions.slots();
    const now = Date.now();
    if (!slots.length) slotList.append(el('div', { class: 'dim', text: STR.settings.noSlots }));
    for (const sl of slots)
      slotList.append(
        el(
          'div',
          { class: 'kv', style: 'align-items:center;gap:8px' },
          el('div', {}, el('div', { text: sl.name }), ...slotLines(sl, now, 'sub dim')),
          el(
            'span',
            { class: 'row', style: 'margin:0;flex-wrap:nowrap' },
            btn(STR.settings.loadSlot, () => this.actions.loadSlot(sl.name), 'small'),
            btn(
              STR.settings.deleteSlot,
              () => confirmDeleteSlot(this.prompt, this.actions, sl.name, () => this.render()),
              'small',
            ),
          ),
        ),
      );
    const saveAs = async () => {
      const n = nameInput.value.trim();
      if (!n) return;
      // replacing a save is asked first; a no writes nothing and leaves the name to change
      if (
        hasSlot(n) &&
        !(await this.prompt.confirm(STR.saves.overwriteTitle, STR.saves.confirmOverwrite(n)))
      )
        return;
      if (this.actions.saveAs(n)) {
        nameInput.value = '';
        this.render();
      }
    };
    r.append(
      el('div', { class: 'col-title', style: 'margin-top:12px', text: STR.settings.slots }),
      el(
        'div',
        { class: 'row' },
        nameInput,
        btn(STR.settings.saveAs, () => void saveAs(), 'accent'),
      ),
      slotList,
    );
    const seedInput = el('input', {
      class: 'text',
      type: 'text',
      placeholder: STR.settings.seedPlaceholder,
      style: 'width:160px',
    }) as HTMLInputElement;
    r.append(
      el('div', { class: 'col-title', style: 'margin-top:12px', text: STR.settings.newGame }),
      el('div', { class: 'sub dim', text: STR.settings.newGameNote }),
      el(
        'div',
        { class: 'row' },
        seedInput,
        btn(STR.settings.newGame, () => {
          if (confirm(STR.settings.confirmNew)) this.actions.newGame(seedInput.value.trim());
        }),
      ),
    );
    r.append(el('div', { class: 'sub dim', text: STR.settings.formatNote }));
    if (info.warning) r.append(el('div', { class: 'sub red', text: info.warning }));
    const area = el('textarea', {
      class: 'text',
      style: 'width:100%;height:120px;font-family:var(--font-mono);font-size:10px',
      spellcheck: 'false',
    }) as HTMLTextAreaElement;
    r.append(
      el('div', { class: 'col-title', style: 'margin-top:12px', text: STR.settings.transfer }),
      area,
      el(
        'div',
        { class: 'row' },
        btn(
          STR.settings.exportSave,
          () => {
            const j = this.actions.exportSave();
            area.value = j ?? '';
          },
          'small',
        ),
        btn(
          STR.settings.importSave,
          () => {
            const text = area.value.trim();
            if (!text) return;
            void this.prompt
              .confirm(STR.saves.importTitle, STR.settings.confirmImport)
              .then((ok) => ok && this.actions.importSave(text));
          },
          'small',
        ),
        btn(
          STR.settings.diagnostics,
          () => {
            area.value = this.actions.exportDiagnostics();
            area.select();
            void navigator.clipboard?.writeText(area.value).catch(() => undefined);
          },
          'small',
        ),
      ),
      el('div', { class: 'sub dim', text: STR.settings.diagnosticsHint }),
    );
  }
}
