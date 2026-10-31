import { el } from './dom';
import { STR } from '../strings';
import {
  actionButton,
  columns,
  emptyState,
  formRow,
  listRow,
  note,
  page,
  slider,
  textField,
  well,
  type FootSpec,
} from './kit';
import type { Screen } from './modal';
import type { Confirm } from './menu';
import { groupRules, isChanged, splitInTwo } from './tuningModel';
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
  readonly icon = 'slider';
  readonly formKeys = true;
  readonly root = page();
  /** What the last preset action did; kept across re-renders, cleared by any other change. */
  private status = note('');
  // the field outlives a redraw of the screen: a name that could not be kept stays to be tried again
  private nameField = textField({
    placeholder: STR.tuning.presetName,
    maxLength: RULE_PRESET_NAME_MAX,
  });

  /**
   * `onChange` runs after every change to the live rules; `onClosed` when the screen is left,
   * which is when a preset saved or deleted here is known to whoever lists the presets.
   */
  constructor(
    private readonly onChange: () => void,
    private readonly onClosed: () => void,
    /** the game's dialog, for the questions about presets */
    private readonly prompt: Confirm,
  ) {}
  onOpen() {
    this.setStatus(null);
    this.render();
  }
  onClose() {
    this.onClosed();
  }
  frameFooter(): FootSpec {
    return {
      actions: [
        {
          label: STR.tuning.reset,
          onClick: () => {
            resetRules();
            this.setStatus(null);
            this.render();
            this.onChange();
          },
        },
      ],
      note: STR.tuning.note,
    };
  }

  private setStatus(text: string | null, cls = 'good') {
    this.status.textContent = text ?? '';
    this.status.className = `k-p ${text ? cls : ''}`.trim();
    this.status.style.display = text ? '' : 'none';
  }

  /** The presets well: a name and a save button, then one row per preset, newest first. */
  private presets(): HTMLElement {
    const save = actionButton(STR.tuning.savePreset, async () => {
      const n = this.nameField.input.value.trim();
      if (!n) return;
      if (
        listRulePresets().some((p) => p.name === n) &&
        !(await this.prompt.confirm(
          STR.tuning.overwritePresetTitle,
          STR.tuning.confirmOverwritePreset(n),
          { yes: STR.prompt.replace, danger: true },
        ))
      )
        return;
      if (!saveRulePreset(n)) {
        // the name stays in the field so the player can try again
        this.setStatus(STR.tuning.presetSaveFailed(n), 'bad');
        return;
      }
      this.nameField.input.value = '';
      this.render();
      this.setStatus(STR.tuning.presetSaved(n));
    });
    const presets = listRulePresets();
    const rows = presets.length
      ? presets.map((p) =>
          listRow({
            title: p.name,
            sub: [new Date(p.savedAt).toLocaleString()],
            right: [
              actionButton(
                STR.tuning.loadPreset,
                async () => {
                  // it replaces the whole live tuning, for the game in play only
                  if (
                    !(await this.prompt.confirm(
                      STR.tuning.loadPresetTitle,
                      STR.tuning.confirmLoadPreset(p.name),
                      { yes: STR.prompt.load },
                    ))
                  )
                    return;
                  const loaded = applyRulePreset(p.name);
                  // the sliders show the new values; a preset gone since the list was drawn drops out
                  this.render();
                  if (!loaded) return;
                  this.onChange();
                  this.setStatus(STR.tuning.presetLoaded(p.name));
                },
                { cls: 'small' },
              ),
              actionButton(
                STR.tuning.deletePreset,
                async () => {
                  if (
                    !(await this.prompt.confirm(
                      STR.tuning.deletePresetTitle,
                      STR.tuning.confirmDeletePreset(p.name),
                      { yes: STR.prompt.delete, danger: true },
                    ))
                  )
                    return;
                  const deleted = deleteRulePreset(p.name);
                  this.render();
                  if (deleted) this.setStatus(STR.tuning.presetDeleted(p.name));
                },
                { cls: 'small danger' },
              ),
            ],
          }),
        )
      : [emptyState({ text: STR.tuning.noPresets })];
    return well(
      { title: STR.tuning.presets, right: String(presets.length) },
      el('div', { class: 'k-inrow' }, this.nameField.root, save),
      this.status,
      el('div', { class: 'k-scroll' }, ...rows),
    );
  }

  /** One rule: its label, its hint, a slider with the value to type, marked when it is not shipped. */
  private row(m: (typeof RULE_META)[number]): HTMLElement {
    const shipped = DEFAULT_RULES[m.key] as number;
    const label = el(
      'span',
      {},
      m.label,
      m.newGame ? el('i', { class: 'k-tagn', text: STR.tuning.newGameOnly }) : null,
    );
    const row = formRow(
      label,
      slider({
        label: m.label,
        value: rules[m.key] as number,
        min: m.min,
        max: m.max,
        step: m.step,
        field: true,
        onInput: (v) => {
          setRules({ [m.key]: v } as Partial<Rules>);
          row.classList.toggle('chg', isChanged(rules[m.key] as number, shipped));
          this.setStatus(null);
          this.onChange();
        },
      }),
      m.hint,
    );
    row.classList.toggle('chg', isChanged(rules[m.key] as number, shipped));
    return row;
  }

  private render() {
    const grouped = groupRules(RULE_META);
    const groups = grouped.map((g) =>
      well({ title: g.name, right: String(g.rules.length) }, ...g.rules.map((m) => this.row(m))),
    );
    // the columns read in order: the presets, then the groups, cut where they are most even
    const cut = splitInTwo([5, ...grouped.map((g) => g.rules.length + 1)]);
    const blocks = [this.presets(), ...groups];
    this.root.replaceChildren(
      note(STR.tuning.scope),
      columns(blocks.slice(0, cut), blocks.slice(cut)),
    );
  }
}
