import { el, btn } from './dom';
import { STR } from '../strings';
import type { Screen } from './modal';
import {
  rules,
  setRules,
  resetRules,
  RULE_META,
  DEFAULT_RULES,
  RULE_PRESET_NAME_MAX,
  listRulePresets,
  saveRulePreset,
  applyRulePreset,
  deleteRulePreset,
  type Rules,
} from '../sim/rules';

/** Live game-rule tuning: sliders for every multiplier and world parameter, and named presets. */
export class TuningScreen implements Screen {
  readonly id = 'tuning';
  readonly title = STR.tuning.title;
  readonly root = el('div', { class: 'cols', style: 'flex-direction:column' });
  private body = el('div', { class: 'col-body tuning-grid' });
  private foot = el('div', { class: 'col-foot' });
  /** What the last preset action did; kept across re-renders, cleared by any other change. */
  private status = el('div', { class: 'sub tuning-status' });

  constructor(private readonly onChange: () => void) {
    this.root.append(el('div', { class: 'col' }, this.body, this.foot));
  }
  onOpen() {
    this.setStatus(null);
    this.render();
  }

  private setStatus(text: string | null, cls = 'green') {
    this.status.textContent = text ?? '';
    this.status.className = `sub tuning-status ${text ? cls : ''}`.trim();
  }

  /** The presets block: a name and a save button, then one row per preset, newest first. */
  private presets(): HTMLElement {
    const nameInput = el('input', {
      class: 'text',
      type: 'text',
      placeholder: STR.tuning.presetName,
      maxlength: String(RULE_PRESET_NAME_MAX),
      style: 'width:160px',
    }) as HTMLInputElement;
    nameInput.addEventListener('keydown', (e) => e.stopPropagation());
    const save = btn(
      STR.tuning.savePreset,
      () => {
        const n = nameInput.value.trim();
        if (!n) return;
        if (
          listRulePresets().some((p) => p.name === n) &&
          !confirm(STR.tuning.confirmOverwritePreset(n))
        )
          return;
        if (!saveRulePreset(n)) {
          // the name stays in the input so the player can try again
          this.setStatus(STR.tuning.presetSaveFailed(n), 'red');
          return;
        }
        this.render();
        this.setStatus(STR.tuning.presetSaved(n));
      },
      'accent',
    );
    const list = el('div', { class: 'tuning-presets' });
    const presets = listRulePresets();
    if (!presets.length) list.append(el('div', { class: 'dim', text: STR.tuning.noPresets }));
    for (const p of presets)
      list.append(
        el(
          'div',
          { class: 'kv' },
          el(
            'span',
            {},
            el('span', { text: p.name }),
            el('span', { class: 'dim', text: ` · ${new Date(p.savedAt).toLocaleString()}` }),
          ),
          el(
            'span',
            { class: 'row', style: 'margin:0' },
            btn(
              STR.tuning.loadPreset,
              () => {
                const loaded = applyRulePreset(p.name);
                // the sliders show the new values; a preset gone since the list was drawn drops out
                this.render();
                if (!loaded) return;
                this.onChange();
                this.setStatus(STR.tuning.presetLoaded(p.name));
              },
              'small',
            ),
            btn(
              STR.tuning.deletePreset,
              () => {
                if (!confirm(STR.tuning.confirmDeletePreset(p.name))) return;
                const deleted = deleteRulePreset(p.name);
                this.render();
                if (deleted) this.setStatus(STR.tuning.presetDeleted(p.name));
              },
              'small',
            ),
          ),
        ),
      );
    return el(
      'div',
      { class: 'tuning-group tuning-wide' },
      el('div', { class: 'col-title', text: STR.tuning.presets }),
      el('div', { class: 'row' }, nameInput, save),
      this.status,
      list,
    );
  }

  private render() {
    const b = this.body;
    b.innerHTML = '';
    b.append(el('div', { class: 'sub dim tuning-wide', text: STR.tuning.scope }), this.presets());
    const groups = new Map<string, HTMLElement>();
    for (const m of RULE_META) {
      let g = groups.get(m.group);
      if (!g) {
        g = el('div', { class: 'tuning-group' }, el('div', { class: 'col-title', text: m.group }));
        groups.set(m.group, g);
        b.append(g);
      }
      const value = rules[m.key] as number;
      const range = el('input', {
        type: 'range',
        min: String(m.min),
        max: String(m.max),
        step: String(m.step),
        value: String(value),
      }) as HTMLInputElement;
      const num = el('input', {
        class: 'text',
        type: 'number',
        min: String(m.min),
        max: String(m.max),
        step: String(m.step),
        value: String(value),
        style: 'width:80px',
      }) as HTMLInputElement;
      const apply = (v: number) => {
        setRules({ [m.key]: v } as Partial<Rules>);
        const nv = rules[m.key] as number;
        range.value = String(nv);
        num.value = String(nv);
        row.classList.toggle('changed', nv !== (DEFAULT_RULES[m.key] as number));
        this.setStatus(null);
        this.onChange();
      };
      range.addEventListener('input', () => apply(Number(range.value)));
      num.addEventListener('change', () => apply(Number(num.value)));
      const row = el(
        'div',
        { class: `tuning-row ${value !== (DEFAULT_RULES[m.key] as number) ? 'changed' : ''}` },
        el(
          'div',
          { class: 'tuning-label' },
          el('span', { text: m.label }),
          m.newGame ? el('span', { class: 'tag', text: STR.tuning.newGameOnly }) : null,
          m.hint ? el('div', { class: 'sub dim', text: m.hint }) : null,
        ),
        range,
        num,
      );
      g.append(row);
    }
    const f = this.foot;
    f.innerHTML = '';
    f.append(
      el('span', { class: 'dim', text: STR.tuning.note }),
      el('span', { style: 'flex:1' }),
      btn(STR.tuning.reset, () => {
        resetRules();
        this.setStatus(null);
        this.render();
        this.onChange();
      }),
    );
  }
}
