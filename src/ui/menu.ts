import { el, btn } from './dom';
import { STR } from '../strings';
import type { LevelData } from '../world/level';
import { SUPPLY_MODES, DEFAULT_SUPPLY, type SupplyMode } from '../sim/supply';
import type { SlotMeta } from '../sim/save';
import type { NamePrompt } from './namePrompt';
import { slotText } from './saveSlots';

/** Shared by both menus: music and effects volume, so the player can set them from the menu. */
export interface AudioActions {
  volume(key: 'music' | 'sfx'): number;
  setVolume(key: 'music' | 'sfx', v: number): void;
}

/** One labelled 0-100 slider wired straight to the live audio bus. */
function volumeRow(actions: AudioActions, key: 'music' | 'sfx', label: string) {
  const input = el('input', {
    class: 'menu-volume',
    type: 'range',
    min: '0',
    max: '100',
    value: String(Math.round(actions.volume(key) * 100)),
    'aria-label': label,
  }) as HTMLInputElement;
  const val = el('span', { class: 'num', text: `${Math.round(actions.volume(key) * 100)}%` });
  input.addEventListener('input', () => {
    actions.setVolume(key, Number(input.value) / 100);
    val.textContent = `${input.value}%`;
  });
  return el(
    'div',
    { class: 'menu-row' },
    el('span', { class: 'menu-volume-label dim', text: label }),
    input,
    val,
  );
}

/** The audio block shown in both the title screen and the pause menu. */
export function audioRows(actions: AudioActions) {
  return el(
    'div',
    { class: 'menu-audio' },
    el('div', { class: 'col-title', text: STR.settings.audio }),
    volumeRow(actions, 'music', STR.settings.music),
    volumeRow(actions, 'sfx', STR.settings.sfx),
  );
}

/** Shared by both menus: the named saves with load / delete. */
export interface SlotActions {
  slots(): SlotMeta[];
  loadSlot(name: string): void;
  deleteSlot(name: string): void;
}

/** The game's own dialog, which the menus and the settings screen ask their questions in. */
export type Confirm = Pick<NamePrompt, 'confirm'>;

/**
 * What one save holds and when it was written, one `cls` line each: day, age and money; how long
 * ago, with the date and time as its title; the format, when it is not this build's.
 */
export function slotLines(meta: SlotMeta, now: number, cls = 'sub'): HTMLElement[] {
  const t = slotText(meta, now);
  const lines = [el('div', { class: cls, text: t.detail })];
  if (t.saved) lines.push(el('div', { class: cls, text: t.saved, title: t.savedAt ?? '' }));
  if (t.format) lines.push(el('div', { class: cls, text: t.format }));
  return lines;
}

/** Delete a named save once the player says yes in the game's dialog. */
export function confirmDeleteSlot(
  prompt: Confirm,
  actions: Pick<SlotActions, 'deleteSlot'>,
  name: string,
  onDeleted: () => void,
) {
  void prompt.confirm(STR.saves.deleteTitle, STR.settings.confirmDelete(name)).then((ok) => {
    if (!ok) return;
    actions.deleteSlot(name);
    onDeleted();
  });
}

/** The named saves in the order `slots()` gives them (newest first), with load and delete. */
function slotList(actions: SlotActions, prompt: Confirm, onDeleted: () => void) {
  const list = el('div', { class: 'menu-levels' });
  const slots = actions.slots();
  const now = Date.now();
  if (!slots.length) list.append(el('div', { class: 'dim', text: STR.menu.noSaves }));
  for (const sl of slots)
    list.append(
      el(
        'div',
        { class: 'item', style: 'cursor:default' },
        el('div', {}, el('div', { class: 'name', text: sl.name }), ...slotLines(sl, now)),
        el(
          'div',
          { class: 'row', style: 'margin:0;flex-direction:column' },
          btn(STR.settings.loadSlot, () => actions.loadSlot(sl.name), 'small accent'),
          btn(
            STR.settings.deleteSlot,
            () => confirmDeleteSlot(prompt, actions, sl.name, onDeleted),
            'small',
          ),
        ),
      ),
    );
  return list;
}

export interface MainMenuActions extends SlotActions, AudioActions {
  continue(): void;
  newGame(seed: string, supply: SupplyMode): void;
  playLevel(id: string): void;
  editLevel(id: string): void;
  newLevel(size: number, generated: boolean, seed: string): void;
  deleteLevel(id: string): void;
  importLevel(json: string): boolean;
  exportLevel(id: string): string;
  tuning(): void;
  content(): void;
  settings(): void;
}

/** Title screen. Overlays the (paused) world. */
export class MainMenu {
  readonly root = el('div', { id: 'menu-root', class: 'menu-root' });
  private left = el('div', { class: 'menu-col' });
  private right = el('div', { class: 'menu-col levels' });
  visible = false;

  constructor(
    private readonly actions: MainMenuActions,
    private readonly prompt: Confirm,
  ) {
    this.root.append(
      el(
        'div',
        { class: 'menu-frame panel' },
        el(
          'div',
          { class: 'menu-title' },
          el('div', { class: 'menu-title-main', text: STR.title }),
          el('div', { class: 'menu-title-sub', text: STR.menu.tagline }),
        ),
        el('div', { class: 'menu-cols' }, this.left, this.right),
        el('div', { class: 'menu-foot dim', text: STR.settings.controlsText }),
      ),
    );
    this.root.style.display = 'none';
  }

  /** `save` is the save Continue loads (`continueMeta()`), null when there is none. */
  show(save: SlotMeta | null, levels: LevelData[], custom: { rules: boolean; content: boolean }) {
    this.visible = true;
    this.root.style.display = 'flex';
    this.render(save, levels, custom);
  }
  hide() {
    this.visible = false;
    this.root.style.display = 'none';
  }

  private render(
    save: SlotMeta | null,
    levels: LevelData[],
    custom: { rules: boolean; content: boolean },
  ) {
    const l = this.left;
    l.innerHTML = '';
    const seedInput = el('input', {
      class: 'text',
      type: 'text',
      placeholder: STR.settings.seedPlaceholder,
      style: 'width:140px',
    }) as HTMLInputElement;
    const cont = btn(STR.menu.continue, () => this.actions.continue(), 'menu-btn accent');
    cont.disabled = !save;
    // what Continue goes back to, in the body font under the title-font label
    if (save)
      cont.append(
        el(
          'div',
          { style: 'font-family:var(--font-body);font-size:11px;letter-spacing:0' },
          ...slotLines(save, Date.now(), 'sub dim'),
        ),
      );
    // production chain of the new game: simple (default) or the full supply set
    const supply = el('select', { class: 'text', title: STR.menu.supply }) as HTMLSelectElement;
    for (const m of SUPPLY_MODES)
      supply.append(el('option', { value: m, text: STR.menu.supplyModes[m] ?? m }));
    supply.value = DEFAULT_SUPPLY;
    const supplyHint = el('div', { class: 'sub dim', style: 'max-width:300px' });
    const hint = () => (supplyHint.textContent = STR.menu.supplyHint[supply.value] ?? '');
    supply.addEventListener('change', hint);
    hint();
    l.append(
      cont,
      el(
        'div',
        { class: 'menu-row' },
        btn(
          STR.menu.newGame,
          () => this.actions.newGame(seedInput.value.trim(), supply.value as SupplyMode),
          'menu-btn',
        ),
        seedInput,
      ),
      el('div', { class: 'menu-row' }, el('span', { class: 'dim', text: STR.menu.supply }), supply),
      supplyHint,
      btn(
        STR.menu.tuning + (custom.rules ? ` ${STR.menu.modified}` : ''),
        () => this.actions.tuning(),
        'menu-btn',
      ),
      btn(
        STR.menu.content + (custom.content ? ` ${STR.menu.modified}` : ''),
        () => this.actions.content(),
        'menu-btn',
      ),
      btn(STR.topbar.settings, () => this.actions.settings(), 'menu-btn'),
      audioRows(this.actions),
      el('div', { class: 'col-title', style: 'margin-top:8px', text: STR.menu.savedGames }),
      slotList(this.actions, this.prompt, () => this.render(save, levels, custom)),
    );
    const r = this.right;
    r.innerHTML = '';
    r.append(el('div', { class: 'col-title', text: STR.menu.levels }));
    if (!levels.length) r.append(el('div', { class: 'dim', text: STR.menu.noLevels }));
    const list = el('div', { class: 'menu-levels' });
    for (const lv of levels) {
      list.append(
        el(
          'div',
          { class: 'item', style: 'cursor:default' },
          el(
            'div',
            {},
            el('div', { class: 'name', text: lv.name }),
            el('div', {
              class: 'sub',
              text: `${lv.w}x${lv.h} · ${STR.menu.levelStations(lv.stations.length)} · ${new Date(lv.updatedAt).toLocaleDateString()}`,
            }),
            lv.description
              ? el('div', { class: 'sub dim', text: lv.description.slice(0, 80) })
              : null,
          ),
          el(
            'div',
            { class: 'row', style: 'margin:0;flex-direction:column' },
            btn(STR.menu.play, () => this.actions.playLevel(lv.id), 'small accent'),
            btn(STR.menu.edit, () => this.actions.editLevel(lv.id), 'small'),
            btn(
              STR.menu.delete,
              () => {
                if (confirm(STR.menu.confirmDelete(lv.name))) this.actions.deleteLevel(lv.id);
              },
              'small',
            ),
          ),
        ),
      );
    }
    r.append(list);
    const size = el('select', { class: 'text' }) as HTMLSelectElement;
    for (const s of [32, 64, 96, 128])
      size.append(el('option', { value: String(s), text: `${s} x ${s}` }));
    size.value = '64';
    const lvlSeed = el('input', {
      class: 'text',
      type: 'text',
      placeholder: STR.settings.seedPlaceholder,
      style: 'width:100px',
    }) as HTMLInputElement;
    r.append(
      el('div', { class: 'col-title', style: 'margin-top:8px', text: STR.menu.newLevel }),
      el(
        'div',
        { class: 'row' },
        size,
        lvlSeed,
        btn(
          STR.menu.blank,
          () => this.actions.newLevel(Number(size.value), false, lvlSeed.value.trim()),
          'small',
        ),
        btn(
          STR.menu.generated,
          () => this.actions.newLevel(Number(size.value), true, lvlSeed.value.trim()),
          'small',
        ),
      ),
    );
    const area = el('textarea', {
      class: 'text',
      style: 'width:100%;height:40px;font-family:var(--font-mono);font-size:10px',
      placeholder: STR.menu.importHint,
      spellcheck: 'false',
    }) as HTMLTextAreaElement;
    r.append(
      area,
      el(
        'div',
        { class: 'row' },
        btn(
          STR.menu.importLevel,
          () => {
            if (area.value.trim() && !this.actions.importLevel(area.value.trim()))
              alert(STR.editor.badLevel);
          },
          'small',
        ),
      ),
    );
  }
}

export interface PauseMenuActions extends SlotActions, AudioActions {
  resume(): void;
  save(): void;
  saveAs(): void;
  settings(): void;
  tuning(): void;
  content(): void;
  backToEditor(): void;
  mainMenu(): void;
}

/** In-game menu (Esc / Menu button). */
export class PauseMenu {
  readonly root = el('div', { id: 'pause-root', class: 'menu-root' });
  private box = el('div', { class: 'menu-frame panel small' });
  visible = false;
  constructor(
    private readonly actions: PauseMenuActions,
    private readonly prompt: Confirm,
  ) {
    this.root.append(this.box);
    this.root.style.display = 'none';
    this.root.addEventListener('mousedown', (e) => {
      if (e.target === this.root) this.actions.resume();
    });
  }
  /** `slotsOpen` shows the named saves unfolded, as they were before a delete redrew the menu. */
  show(opts: { testing: boolean; editor: boolean }, slotsOpen = false) {
    this.visible = true;
    this.root.style.display = 'flex';
    const b = this.box;
    b.innerHTML = '';
    b.append(
      el('div', {
        class: 'menu-title-main',
        style: 'font-size:22px',
        text: opts.editor ? STR.editor.title : STR.menu.paused,
      }),
    );
    b.append(btn(STR.menu.resume, () => this.actions.resume(), 'menu-btn accent'));
    if (!opts.editor) {
      b.append(btn(STR.settings.save, () => this.actions.save(), 'menu-btn'));
      b.append(btn(STR.menu.saveAs, () => this.actions.saveAs(), 'menu-btn'));
      // "Load game" unfolds the named saves under the button
      const list = slotList(this.actions, this.prompt, () => this.show(opts, true));
      list.style.display = slotsOpen ? 'flex' : 'none';
      list.classList.add('menu-slots');
      b.append(
        btn(
          STR.menu.loadGame,
          () => (list.style.display = list.style.display === 'none' ? 'flex' : 'none'),
          'menu-btn',
        ),
        list,
      );
    }
    b.append(btn(STR.topbar.settings, () => this.actions.settings(), 'menu-btn'));
    b.append(audioRows(this.actions));
    b.append(btn(STR.menu.tuning, () => this.actions.tuning(), 'menu-btn'));
    b.append(btn(STR.menu.content, () => this.actions.content(), 'menu-btn'));
    if (opts.testing)
      b.append(btn(STR.menu.backToEditor, () => this.actions.backToEditor(), 'menu-btn'));
    b.append(btn(STR.menu.mainMenu, () => this.actions.mainMenu(), 'menu-btn'));
  }
  hide() {
    this.visible = false;
    this.root.style.display = 'none';
  }
}
