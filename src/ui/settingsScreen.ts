import { el, btn } from './dom';
import { STR } from '../strings';
import type { Screen } from './modal';
import type { Settings } from '../sim/save';

export interface SettingsActions {
  save(): void;
  load(): void;
  newGame(seed: string): void;
  exportSave(): string | null;
  importSave(json: string): boolean;
  saveAs(name: string): boolean;
  loadSlot(name: string): void;
  deleteSlot(name: string): void;
  slots(): { name: string; savedAt: number; version: number; day: number }[];
}

/** Settings and save management. */
export class SettingsScreen implements Screen {
  readonly id = 'settings';
  readonly title = STR.settings.title;
  readonly root = el('div', { class: 'cols' });
  private left = el('div', { class: 'col-body' });
  private right = el('div', { class: 'col-body' });

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

  private slider(label: string, key: 'master' | 'sfx' | 'music') {
    const input = el('input', {
      type: 'range',
      min: '0',
      max: '100',
      value: String(Math.round(this.settings[key] * 100)),
    }) as HTMLInputElement;
    const val = el('span', { class: 'num', text: `${Math.round(this.settings[key] * 100)}%` });
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
  private toggle(
    label: string,
    key: 'edgeScroll' | 'autosave' | 'dayNight' | 'smoke' | 'showFps' | 'weather' | 'autoContracts',
  ) {
    const b = btn(
      this.settings[key] ? STR.settings.on : STR.settings.off,
      () => {
        this.settings[key] = !this.settings[key];
        b.textContent = this.settings[key] ? STR.settings.on : STR.settings.off;
        b.classList.toggle('active', this.settings[key]);
        this.onChange();
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
      el('div', { class: 'sub dim', style: 'margin:4px 0 10px', text: STR.settings.audioNote }),
      el('div', { class: 'col-title', text: STR.settings.gameplay }),
      this.toggle(STR.settings.edgeScroll, 'edgeScroll'),
      this.toggle(STR.settings.autosave, 'autosave'),
      this.toggle(STR.settings.dayNight, 'dayNight'),
      this.toggle(STR.settings.smoke, 'smoke'),
      this.toggle(STR.settings.weather, 'weather'),
      this.toggle(STR.settings.showFps, 'showFps'),
      this.toggle(STR.settings.autoContracts, 'autoContracts'),
      el('div', { class: 'col-title', style: 'margin-top:10px', text: STR.settings.controls }),
      el('div', { class: 'sub', text: STR.settings.controlsText }),
    );
    const r = this.right;
    r.innerHTML = '';
    const info = this.info();
    r.append(
      el(
        'div',
        { class: 'kv' },
        el('span', { class: 'k', text: STR.debug.seed }),
        el('span', { class: 'v', text: String(info.seed) }),
      ),
      el(
        'div',
        { class: 'kv' },
        el('span', { class: 'k', text: STR.settings.lastSave }),
        el('span', {
          class: 'v',
          text: info.savedAt ? new Date(info.savedAt).toLocaleString() : '-',
        }),
      ),
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
    if (!slots.length) slotList.append(el('div', { class: 'dim', text: STR.settings.noSlots }));
    for (const sl of slots)
      slotList.append(
        el(
          'div',
          { class: 'kv' },
          el('span', {
            class: 'k',
            text: `${sl.name} · day ${sl.day} · v${sl.version} · ${new Date(sl.savedAt).toLocaleString()}`,
          }),
          el(
            'span',
            { class: 'row', style: 'margin:0' },
            btn(STR.settings.loadSlot, () => this.actions.loadSlot(sl.name), 'small'),
            btn(
              STR.settings.deleteSlot,
              () => {
                if (confirm(STR.settings.confirmDelete(sl.name))) {
                  this.actions.deleteSlot(sl.name);
                  this.render();
                }
              },
              'small',
            ),
          ),
        ),
      );
    r.append(
      el('div', { class: 'col-title', style: 'margin-top:12px', text: STR.settings.slots }),
      el(
        'div',
        { class: 'row' },
        nameInput,
        btn(
          STR.settings.saveAs,
          () => {
            const n = nameInput.value.trim();
            if (!n) return;
            if (this.actions.saveAs(n)) {
              nameInput.value = '';
              this.render();
            }
          },
          'accent',
        ),
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
            if (area.value.trim() && confirm(STR.settings.confirmImport))
              this.actions.importSave(area.value.trim());
          },
          'small',
        ),
      ),
    );
  }
}
