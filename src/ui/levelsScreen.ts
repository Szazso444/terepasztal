import { STR } from '../strings';
import type { LevelData } from '../world/level';
import { el } from './dom';
import {
  actionButton,
  emptyState,
  formRow,
  listRow,
  page,
  pasteBox,
  segmented,
  textField,
  well,
} from './kit';
import type { Confirm } from './saveRows';
import type { Screen } from './modal';
import type { ReplaceEffect } from './saveSlots';

/** The sizes a new level can have. */
export const LEVEL_SIZES = [32, 64, 96, 128] as const;
export type LevelMap = 'blank' | 'generated';

/** One level of the list, as it is read: the lines under its name. */
export interface LevelRow {
  id: string;
  name: string;
  /** `64x64 · 6 stations · 21/10/2026` */
  line: string;
  /** the first 80 characters of the description, null without one */
  description: string | null;
}

/** The list's rows, in the order given (newest first); `date` writes a time the way the player's locale does. */
export function levelRows(levels: readonly LevelData[], date: (ms: number) => string): LevelRow[] {
  return levels.map((lv) => ({
    id: lv.id,
    name: lv.name,
    line: `${lv.w}x${lv.h} · ${STR.menu.levelStations(lv.stations.length)} · ${date(lv.updatedAt)}`,
    description: lv.description ? lv.description.slice(0, 80) : null,
  }));
}

/** What New level asks the game for: a size, whether it is generated from the seed, the seed text. */
export function newLevelRequest(size: number, map: LevelMap, seed: string) {
  return { size, generated: map === 'generated', seed: seed.trim() };
}

/** The id a level text carries, null when it is no JSON or has none: the row an import picks out. */
export function levelIdOf(text: string): string | null {
  try {
    const v: unknown = JSON.parse(text);
    const id = v && typeof v === 'object' ? (v as { id?: unknown }).id : null;
    return typeof id === 'string' ? id : null;
  } catch {
    return null;
  }
}

/** What the screen needs of the title screen's actions. */
export interface LevelsActions {
  levels(): LevelData[];
  /** the questions of the game's rules are asked there */
  playLevel(id: string): void;
  editLevel(id: string): void;
  newLevel(size: number, generated: boolean, seed: string): void;
  deleteLevel(id: string): void;
  importLevel(json: string): boolean;
  /** what Play level loses, for its tip */
  asks(): ReplaceEffect | null;
}

/**
 * The hand-made levels: one list, each level with its own Play, Edit and Delete, then the New
 * level and Import level wells. The body scrolls when it is taller than the frame.
 */
export class LevelsScreen implements Screen {
  readonly id = 'levels';
  readonly title = STR.menu.levels;
  readonly frameSize = 'M';
  readonly icon = 'mountain';
  readonly formKeys = true;
  readonly root = page();
  private size = 64;
  private map: LevelMap = 'blank';
  /** the level an import has just added, picked out in the list */
  private picked: string | null = null;
  private error = el('span', { class: 'k-err' });
  // the fields outlive a redraw of the list: what is typed or pasted stays
  private seed = textField({ placeholder: STR.settings.seedPlaceholder });
  private box = pasteBox({ placeholder: STR.menu.importHint, title: STR.menu.importBoxHint });
  private importButton = actionButton(STR.menu.importLevel, () => this.import(), {
    icon: 'import',
  });

  constructor(
    private readonly actions: LevelsActions,
    private readonly prompt: Confirm,
  ) {
    this.box.addEventListener('input', () => {
      this.error.textContent = '';
      this.syncImport();
    });
  }

  onOpen() {
    this.size = 64;
    this.map = 'blank';
    this.picked = null;
    this.seed.input.value = '';
    this.box.value = '';
    this.error.textContent = '';
    this.render();
  }

  private syncImport() {
    const empty = !this.box.value.trim();
    this.importButton.disabled = empty;
    this.importButton.title = empty ? STR.menu.importEmptyHint : STR.menu.importButtonHint;
  }

  /** A level text that is no level is told so at the well's head; one that is goes on the list. */
  private import() {
    const text = this.box.value.trim();
    if (!text) return;
    if (!this.actions.importLevel(text)) {
      this.error.textContent = STR.editor.badLevel;
      return;
    }
    this.picked = levelIdOf(text);
    this.box.value = '';
    this.error.textContent = '';
    this.render();
  }

  private list(): HTMLElement {
    const rows = levelRows(this.actions.levels(), (ms) => new Date(ms).toLocaleDateString());
    const asks = this.actions.asks();
    const playTip =
      asks === 'game'
        ? STR.menu.playLevelOver
        : asks === 'stored'
          ? STR.menu.playLevelAsks
          : STR.menu.playLevelHint;
    return well(
      null,
      ...(rows.length
        ? rows.map((r) =>
            listRow({
              title: r.name,
              sub: [r.line, r.description ? el('em', { text: r.description }) : null],
              on: r.id === this.picked,
              right: [
                actionButton(STR.menu.play, () => this.actions.playLevel(r.id), {
                  cls: 'small pri',
                  icon: 'play',
                  title: playTip,
                }),
                actionButton(STR.menu.edit, () => this.actions.editLevel(r.id), {
                  cls: 'small',
                  title: STR.menu.editLevelHint,
                }),
                actionButton(STR.menu.delete, () => this.delete(r), {
                  cls: 'small danger',
                  title: STR.menu.deleteLevelHint,
                }),
              ],
            }),
          )
        : [emptyState({ icon: 'mountain', text: STR.menu.noLevels })]),
    );
  }

  private delete(r: LevelRow) {
    void this.prompt
      .confirm(STR.menu.deleteLevelTitle, STR.menu.confirmDelete(r.name), {
        yes: STR.prompt.delete,
        danger: true,
      })
      .then((ok) => {
        if (!ok) return;
        this.actions.deleteLevel(r.id);
        this.picked = null;
        this.render();
      });
  }

  private newLevelWell(): HTMLElement {
    const hint = this.map === 'blank' ? STR.menu.levelBlankNote : STR.menu.levelGeneratedNote;
    return well(
      STR.menu.newLevel,
      formRow(
        STR.menu.levelSize,
        segmented({
          cls: 'small',
          options: LEVEL_SIZES.map((s) => ({ id: String(s), label: STR.menu.levelSizeOption(s) })),
          value: String(this.size),
          onChange: (id) => (this.size = Number(id)),
        }),
      ),
      formRow(
        STR.menu.levelMap,
        segmented({
          cls: 'small',
          options: [
            { id: 'blank', label: STR.menu.blank },
            { id: 'generated', label: STR.menu.generated },
          ],
          value: this.map,
          onChange: (id) => {
            this.map = id as LevelMap;
            this.render();
          },
        }),
        hint,
      ),
      el(
        'div',
        { class: 'k-inrow' },
        this.seed.root,
        actionButton(
          STR.menu.newLevel,
          () => {
            const r = newLevelRequest(this.size, this.map, this.seed.input.value);
            this.actions.newLevel(r.size, r.generated, r.seed);
          },
          { icon: 'plus', title: STR.menu.newLevelHint },
        ),
      ),
    );
  }

  private importWell(): HTMLElement {
    this.syncImport();
    return well(
      { title: STR.menu.importLevel, right: this.error },
      el(
        'div',
        { class: 'k-xfer lv-imp' },
        this.box,
        el('div', { class: 'k-btncol' }, this.importButton),
      ),
    );
  }

  render() {
    // the body keeps its place when the list changes under it
    const at = this.root.scrollTop;
    this.root.replaceChildren(this.list(), this.newLevelWell(), this.importWell());
    this.root.scrollTop = at;
  }
}
