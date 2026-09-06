import { el, btn } from './dom';
import { STR } from '../strings';
import type { Editor } from '../editor/editor';
import { Terrain, TERRAIN_NAMES } from '../world/tiles';

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

/** Right-hand panel for the level editor: metadata, start block, brush size, file actions. */
export class EditorPanel {
  readonly root = el('div', { id: 'editor-panel', class: 'panel' });
  private body = el('div', { class: 'panel-body' });
  private status = el('div', { class: 'sub dim' });

  constructor(
    private readonly editor: Editor,
    private readonly actions: EditorActions,
  ) {
    this.root.append(el('div', { class: 'panel-title', text: STR.editor.title }), this.body);
    this.render();
  }

  setStatus(text: string) {
    this.status.textContent = text;
  }

  render() {
    const b = this.body;
    b.innerHTML = '';
    const l = this.editor.level;
    const field = (label: string, input: HTMLElement) =>
      el('div', { class: 'kv' }, el('span', { class: 'k', text: label }), input);
    const text = (value: string, on: (v: string) => void, width = '150px') => {
      const i = el('input', {
        class: 'text',
        type: 'text',
        value,
        style: `width:${width}`,
      }) as HTMLInputElement;
      i.addEventListener('change', () => on(i.value));
      return i;
    };
    const num = (value: number, on: (v: number) => void, min = 0, max = 1e9) => {
      const i = el('input', {
        class: 'text',
        type: 'number',
        value: String(value),
        min: String(min),
        max: String(max),
        style: 'width:90px',
      }) as HTMLInputElement;
      i.addEventListener('change', () => on(Math.max(min, Math.min(max, Number(i.value) || 0))));
      return i;
    };
    b.append(
      field(
        STR.editor.name,
        text(l.name, (v) => (l.name = v.trim() || l.name)),
      ),
      field(STR.editor.size, el('span', { class: 'v', text: `${l.w} x ${l.h}` })),
    );
    const desc = el('textarea', {
      class: 'text',
      style: 'width:100%;height:44px;margin:4px 0',
      placeholder: STR.editor.description,
    }) as HTMLTextAreaElement;
    desc.value = l.description;
    desc.addEventListener('change', () => (l.description = desc.value));
    b.append(desc);
    b.append(el('div', { class: 'col-title', text: STR.editor.start }));
    b.append(
      field(
        STR.hud.money,
        num(l.start.money, (v) => (l.start.money = v)),
      ),
      field(
        STR.hud.tickets,
        num(l.start.tickets, (v) => (l.start.tickets = v), 0, 9999),
      ),
      field(
        STR.hud.reputation,
        num(l.start.reputation, (v) => (l.start.reputation = v), 0, 99999),
      ),
      field(
        STR.editor.startTier,
        num(l.start.tier, (v) => (l.start.tier = v), 0, 4),
      ),
    );
    b.append(el('div', { class: 'col-title', text: STR.editor.brush }));
    const brushRow = el('div', { class: 'row', style: 'margin-top:2px' });
    for (const n of [1, 2, 3]) {
      const bb = btn(
        String(n),
        () => {
          this.editor.brushSize = n;
          this.render();
        },
        `small ${this.editor.brushSize === n ? 'active' : ''}`,
      );
      brushRow.append(bb);
    }
    b.append(brushRow);
    b.append(el('div', { class: 'sub dim', text: STR.editor.brushHint }));
    const fillRow = el('div', { class: 'row' });
    for (const t of [Terrain.Grass, Terrain.Water, Terrain.Rock]) {
      fillRow.append(btn(STR.editor.fill(TERRAIN_NAMES[t]), () => this.actions.fill(t), 'small'));
    }
    fillRow.append(btn(STR.editor.regenerate, () => this.actions.regenerate(), 'small'));
    b.append(fillRow);
    b.append(el('div', { class: 'col-title', text: STR.editor.file }));
    b.append(
      el(
        'div',
        { class: 'row' },
        btn(STR.editor.save, () => this.actions.save(), 'accent'),
        btn(STR.editor.saveAs, () => this.actions.saveAs(), 'small'),
        btn(STR.editor.playTest, () => this.actions.playTest(), 'accent'),
      ),
    );
    const area = el('textarea', {
      class: 'text',
      style: 'width:100%;height:60px;font-family:var(--font-mono);font-size:10px',
      spellcheck: 'false',
    }) as HTMLTextAreaElement;
    b.append(
      el(
        'div',
        { class: 'row' },
        btn(STR.settings.exportSave, () => (area.value = this.actions.exportJson()), 'small'),
        btn(
          STR.settings.importSave,
          () => {
            if (area.value.trim() && !this.actions.importJson(area.value.trim()))
              this.setStatus(STR.editor.badLevel);
          },
          'small',
        ),
        btn(STR.editor.exit, () => this.actions.exit(), 'small'),
      ),
      area,
      this.status,
    );
  }
}
