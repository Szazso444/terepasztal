import { el } from './dom';
import {
  actionButton,
  buttonRow,
  formRow,
  labelValue,
  note,
  numberField,
  pasteBox,
  segmented,
  textField,
  well,
  type TextField,
} from './kit';
import { STR } from '../strings';
import type { Editor } from '../editor/editor';
import { Terrain, TERRAIN_NAMES } from '../world/tiles';
import { AGE_COUNT, LAST_AGE, ageDef } from '../sim/ages';
import { SUPPLY_MODES, DEFAULT_SUPPLY, type SupplyMode } from '../sim/supply';

export interface EditorActions {
  save(): void;
  saveAs(): void;
  playTest(): void;
  exit(): void;
  exportJson(): string;
  importJson(json: string): boolean;
  fill(t: Terrain): void;
  regenerate(): void;
}

/** The ages a level can start in, in order, each by the name the player reads everywhere. */
export function startAges(): { tier: number; name: string }[] {
  return Array.from({ length: AGE_COUNT }, (_, tier) => {
    const id = ageDef(tier).id;
    return { tier, name: STR.ages.name[id] ?? id };
  });
}

/** The age a level's start shows: a tier outside the ages is shown as the nearest one. */
export function shownStartAge(tier: number): number {
  return Math.min(LAST_AGE, Math.max(0, Math.round(tier) || 0));
}

/** The brush sizes the painter offers. */
const BRUSHES = [1, 2, 3];

/** Right-hand panel for the level editor: metadata, start block, brush size, file actions. */
export class EditorPanel {
  readonly root = el('div', { id: 'editor-panel', class: 'panel' });
  private body = el('div', { class: 'panel-body k-edp' });
  private status = el('p', { class: 'k-p bad' });
  // the box outlives a redraw of the panel: what is pasted in it stays
  private transfer = pasteBox();

  constructor(
    private readonly editor: Editor,
    private readonly actions: EditorActions,
  ) {
    this.transfer.classList.add('ed-xfer');
    this.root.append(el('div', { class: 'panel-title', text: STR.editor.title }), this.body);
    this.render();
  }

  setStatus(text: string) {
    this.status.textContent = text;
  }

  render() {
    const l = this.editor.level;

    // the level: its name, its size and the description the level list shows
    const name: TextField = textField({
      value: l.name,
      onClear: () => (name.input.value = l.name),
    });
    name.input.addEventListener('change', () => {
      l.name = name.input.value.trim() || l.name;
      name.input.value = l.name;
    });
    const desc = pasteBox({ placeholder: STR.editor.description });
    desc.classList.add('ed-desc');
    desc.value = l.description;
    desc.addEventListener('change', () => (l.description = desc.value));

    // the start: money, the age by name, the production chain the level is played in
    const age = el('select', { class: 'text ed-age', 'aria-label': STR.editor.startTier });
    for (const a of startAges()) age.append(el('option', { value: String(a.tier), text: a.name }));
    age.value = String(shownStartAge(l.start.tier));
    age.addEventListener('change', () => (l.start.tier = Number(age.value)));
    const supply = segmented({
      options: SUPPLY_MODES.map((m) => ({ id: m, label: STR.menu.supplyModes[m] ?? m })),
      value: l.start.supply ?? DEFAULT_SUPPLY,
      cls: 'small',
      onChange: (id) => (l.start.supply = id as SupplyMode),
    });

    // the brush: its size, a fill of one terrain, a new map
    const brush = segmented({
      options: BRUSHES.map((n) => ({ id: String(n), label: String(n) })),
      value: String(this.editor.brushSize),
      cls: 'small',
      onChange: (id) => (this.editor.brushSize = Number(id)),
    });

    this.body.replaceChildren(
      well(
        null,
        formRow(STR.editor.name, name.root),
        labelValue(STR.editor.size, `${l.w} x ${l.h}`),
        el('div', { class: 'k-xfer' }, desc),
      ),
      well(
        STR.editor.start,
        formRow(
          STR.hud.money,
          numberField({
            label: STR.hud.money,
            value: l.start.money,
            min: 0,
            max: 1e9,
            step: 100,
            bigStep: 1000,
            free: true,
            cls: 'small ed-money',
            onChange: (v) => {
              l.start.money = v;
            },
          }),
        ),
        formRow(STR.editor.startTier, age),
        formRow(STR.menu.supply, supply),
      ),
      well(
        STR.editor.brush,
        formRow(STR.editor.size, brush),
        note(STR.editor.brushHint),
        buttonRow(
          ...[Terrain.Grass, Terrain.Water, Terrain.Rock].map((t) =>
            actionButton(STR.editor.fill(TERRAIN_NAMES[t]), () => this.actions.fill(t), {
              cls: 'small',
            }),
          ),
          actionButton(STR.editor.regenerate, () => this.actions.regenerate(), { cls: 'small' }),
        ),
      ),
      well(
        STR.editor.file,
        buttonRow(
          actionButton(STR.editor.save, () => this.actions.save(), { cls: 'pri', icon: 'save' }),
          actionButton(STR.editor.saveAs, () => this.actions.saveAs(), {
            cls: 'small',
            icon: 'saveas',
          }),
          actionButton(STR.editor.playTest, () => this.actions.playTest(), { cls: 'pri' }),
        ),
        el('div', { class: 'k-xfer' }, this.transfer),
        buttonRow(
          actionButton(
            STR.settings.exportSave,
            () => (this.transfer.value = this.actions.exportJson()),
            {
              cls: 'small',
              icon: 'export',
            },
          ),
          actionButton(
            STR.settings.importSave,
            () => {
              const json = this.transfer.value.trim();
              if (json && !this.actions.importJson(json)) this.setStatus(STR.editor.badLevel);
            },
            { cls: 'small', icon: 'import' },
          ),
          actionButton(STR.editor.exit, () => this.actions.exit(), { cls: 'small' }),
        ),
        this.status,
      ),
    );
  }
}
